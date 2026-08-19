const crypto = require('crypto');
const { pool } = require('../db');
const { hashPassword } = require('../auth');

async function writeAudit(client, { actorUserId, actorName, action, targetType, targetId, details }) {
  const runner = client || pool;
  await runner.query(
    `INSERT INTO audit_log (actor_user_id, actor_name, action, target_type, target_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [actorUserId || null, actorName || null, action, targetType || null, targetId || null, details ? JSON.stringify(details) : null],
  );
}

async function listAudit({ limit = 100, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM audit_log ORDER BY created_at DESC LIMIT $1 OFFSET $2`, [limit, offset],
  );
  return rows;
}

function slugUsername(teamName) {
  const normalized = teamName.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // strip accents: é -> e
  return normalized.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 24);
}

function generatePassword() {
  // 10 random chars from an unambiguous alphabet (no 0/O/1/l/I) — easy to
  // read off a screen and hand to someone.
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomFillSync(new Uint8Array(10)))
    .map((b) => alphabet[b % alphabet.length]).join('');
}

/** Creates a manager login for every club that doesn't already have one —
 * one dedicated account per club, admin-provisioned rather than
 * self-claimed. Plaintext passwords are only ever returned here, at
 * creation time; after this they're hashed like any other account. */
async function provisionManagerLogins(actorUser) {
  const { rows: teams } = await pool.query(
    `SELECT t.id, t.name FROM teams t
     WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.team_id = t.id AND u.role = 'manager')
     ORDER BY t.name`,
  );
  const created = [];
  for (const team of teams) {
    let username = slugUsername(team.name);
    // Guard against a username collision (e.g. two runs after a partial team-name clash).
    const { rows: clash } = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (clash.length) username = `${username}-${team.id}`;

    const password = generatePassword();
    const hash = await hashPassword(password);
    const { rows } = await pool.query(
      `INSERT INTO users (username, password_hash, role, team_id) VALUES ($1,$2,'manager',$3) RETURNING id`,
      [username, hash, team.id],
    );
    await writeAudit(null, {
      actorUserId: actorUser?.id, actorName: actorUser?.username, action: 'provision_manager_login',
      targetType: 'team', targetId: team.id, details: { username, teamName: team.name },
    });
    created.push({ teamId: team.id, teamName: team.name, userId: rows[0].id, username, password });
  }
  return created;
}

/** Admin resets any user's password (typically a club login) — returns the
 * new plaintext password once. Fully overwrites whatever they had before. */
async function resetPassword(actorUser, targetUserId, chosenPassword) {
  const password = chosenPassword && chosenPassword.length >= 4 ? chosenPassword : generatePassword();
  const hash = await hashPassword(password);
  const { rows } = await pool.query(
    'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id, username, team_id', [hash, targetUserId],
  );
  if (!rows.length) throw new Error('User not found.');
  await writeAudit(null, {
    actorUserId: actorUser?.id, actorName: actorUser?.username, action: 'reset_password',
    targetType: 'user', targetId: targetUserId, details: { username: rows[0].username },
  });
  return { ...rows[0], password };
}

module.exports = { writeAudit, listAudit, provisionManagerLogins, resetPassword, generatePassword };
