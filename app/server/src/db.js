const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set. Set it to an external Postgres connection string.');
}

// Render's managed Postgres requires SSL from external connections but the
// certificate chain isn't always in the default trust store, so we relax
// verification. Local dev (localhost) does not use SSL.
const useSSL = connectionString && !/localhost|127\.0\.0\.1/.test(connectionString);

const pool = new Pool({
  connectionString,
  ssl: useSSL ? { rejectUnauthorized: false } : false,
  max: 10,
});

pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error', err);
});

async function query(text, params) {
  return pool.query(text, params);
}

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function migrate() {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('Database schema is up to date.');
}

/**
 * Inserts many rows into `table` in chunks (to stay well under Postgres'
 * parameter limit) using a single multi-VALUES statement per chunk.
 * `rows` is an array of objects; `columns` fixes column order.
 * Returns all inserted rows (with generated ids) in input order.
 */
async function bulkInsert(client, table, columns, rows, { returning = 'id', chunkSize = 150 } = {}) {
  const runner = client || pool;
  const inserted = [];
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = [];
    const placeholders = chunk.map((row, i) => {
      const base = i * columns.length;
      const tuple = columns.map((col, j) => {
        values.push(row[col] === undefined ? null : row[col]);
        return `$${base + j + 1}`;
      });
      return `(${tuple.join(', ')})`;
    });
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders.join(', ')} RETURNING ${returning}`;
    const result = await runner.query(sql, values);
    inserted.push(...result.rows);
  }
  return inserted;
}

/**
 * Generic JSON key-value persistence, used to survive Render restarts for
 * state that would otherwise only live in server memory (an in-progress
 * live match or live auction). Mirrors the migrate() pattern: safe to call
 * repeatedly, and lives in the same Postgres database as everything else —
 * no separate store, so it's covered by the same backups/durability.
 */
async function kvSet(key, valueObj) {
  const payload = JSON.stringify(valueObj);
  await pool.query(
    `INSERT INTO kv_store (store_key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (store_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, payload],
  );
}

async function kvGet(key) {
  const { rows } = await pool.query('SELECT value FROM kv_store WHERE store_key = $1', [key]);
  return rows.length ? JSON.parse(rows[0].value) : null;
}

async function kvDelete(key) {
  await pool.query('DELETE FROM kv_store WHERE store_key = $1', [key]);
}

async function kvListByPrefix(prefix) {
  const { rows } = await pool.query('SELECT store_key, value FROM kv_store WHERE store_key LIKE $1', [`${prefix}%`]);
  return rows.map((r) => ({ key: r.store_key, value: JSON.parse(r.value) }));
}

module.exports = { pool, query, withTransaction, migrate, bulkInsert, kvSet, kvGet, kvDelete, kvListByPrefix };
