const { pool, kvSet, kvGet, kvDelete } = require('./db');
const { createAuctionState, placeBid, checkExpiry, autoFillRemaining, currentPlayer } = require('./engine/auctionEngine');

const KV_KEY = 'live_auction';

let current = null; // { state, io, dbId, stageId, stageName, lotType, teamIds }
let checkTimer = null;

// --- persistence: survives a server restart mid-auction (Render redeploy/
// spin-down) instead of the auction just vanishing from memory. The 3 Maps
// in auction state (playersById/budgets/counts) aren't JSON-native, so we
// convert them to arrays of entries going in and rebuild them coming back.
function serializeState(state) {
  return {
    ...state,
    playersById: [...state.playersById.entries()],
    budgets: [...state.budgets.entries()],
    counts: [...state.counts.entries()],
  };
}

function deserializeState(saved) {
  return {
    ...saved,
    playersById: new Map(saved.playersById),
    budgets: new Map(saved.budgets),
    counts: new Map(saved.counts),
  };
}

async function persistCurrent() {
  if (!current) { await kvDelete(KV_KEY); return; }
  await kvSet(KV_KEY, {
    state: serializeState(current.state), dbId: current.dbId, stageId: current.stageId,
    stageName: current.stageName, lotType: current.lotType, teamIds: current.teamIds,
  });
}

/** Called once at server boot. If an auction was mid-flight when the
 * process last stopped, reloads it from Postgres and resumes the expiry
 * loop — bidders just see it pick back up, deadlines intact (deadline is
 * an absolute timestamp, so downtime simply eats into that lot's clock,
 * same as a real auction house's clock keeps running). */
async function resumeAuction(io) {
  const saved = await kvGet(KV_KEY);
  if (!saved) return;
  const state = deserializeState(saved.state);
  if (state.status !== 'active') { await kvDelete(KV_KEY); return; }
  current = { state, io, dbId: saved.dbId, stageId: saved.stageId, stageName: saved.stageName, lotType: saved.lotType, teamIds: saved.teamIds };
  startExpiryLoop();
  console.log(`Resumed live auction ${saved.dbId} (${saved.lotType}, stage ${saved.stageId || 'all'}) after restart.`);
}

function publicAuctionState() {
  if (!current) return { status: 'idle' };
  const { state, lotType } = current;
  const lot = currentPlayer(state);
  const lotView = lot ? (lotType === 'coach' ? {
    id: lot.id, name: lot.name, specialty: lot.specialty, rating: lot.rating, market_value: lot.market_value,
  } : {
    id: lot.id, name: lot.name, position: lot.position, age: lot.age,
    star_rating: lot.star_rating, potential: lot.potential, nationality: lot.nationality,
    pace: lot.pace, shooting: lot.shooting, passing: lot.passing, dribbling: lot.dribbling,
    defending: lot.defending, physical: lot.physical, goalkeeping: lot.goalkeeping,
    market_value: lot.market_value,
  }) : null;

  return {
    status: state.status,
    dbId: current.dbId,
    stageId: current.stageId || null,
    stageName: current.stageName || null,
    lotType: lotType || 'player',
    currentPlayer: lotView,
    currentBid: state.currentBid, currentBidTeamId: state.currentBidTeamId,
    deadline: state.deadline, queueRemaining: Math.max(0, state.queue.length - state.queuePosition),
    soldCount: state.soldCount, unsoldCount: state.unsoldCount,
    recentLog: state.log.slice(-15),
  };
}

/** Returns the 3 stages in tier order, each flagged with whether coaches
 * and squads look done, so the admin UI can walk through: Elite manager
 * auction -> Elite player auction -> Rise manager auction -> ... */
async function getStageAuctionStatus() {
  const { rows } = await pool.query(`
    SELECT s.id, s.name, s.tier_order,
      COUNT(t.id)::int AS team_count,
      COALESCE(SUM(CASE WHEN pc.n >= 11 THEN 1 ELSE 0 END), 0)::int AS teams_staffed,
      COALESCE(SUM(CASE WHEN t.coach_id IS NOT NULL THEN 1 ELSE 0 END), 0)::int AS teams_with_coach
    FROM stages s
    LEFT JOIN teams t ON t.stage_id = s.id
    LEFT JOIN (
      SELECT team_id, COUNT(*)::int AS n FROM players WHERE team_id IS NOT NULL AND retired = false GROUP BY team_id
    ) pc ON pc.team_id = t.id
    GROUP BY s.id, s.name, s.tier_order
    ORDER BY s.tier_order`);
  return rows.map((r) => ({
    ...r,
    completed: r.team_count > 0 && r.teams_staffed >= r.team_count,
    coachesCompleted: r.team_count > 0 && r.teams_with_coach >= r.team_count,
  }));
}

async function startAuction(io, stageId = null, lotType = 'player') {
  if (current && current.state.status === 'active') throw new Error('An auction is already in progress.');

  let teams;
  let stageName = null;
  if (stageId) {
    const teamRows = await pool.query('SELECT * FROM teams WHERE stage_id = $1', [stageId]);
    teams = teamRows.rows;
    if (!teams.length) throw new Error('That stage has no clubs.');
    const stageRow = await pool.query('SELECT name FROM stages WHERE id = $1', [stageId]);
    stageName = stageRow.rows[0]?.name || null;
  } else {
    const teamRows = await pool.query('SELECT * FROM teams');
    teams = teamRows.rows;
  }

  const { rows: stageRows } = await pool.query('SELECT season FROM stages ORDER BY tier_order LIMIT 1');
  const season = stageRows[0]?.season || 1;
  const { rows: auctionRows } = await pool.query(
    `INSERT INTO auctions (season, status) VALUES ($1, 'active') RETURNING id`, [season]);

  let lots; let squadCounts; let maxPerTeam; let valueField;
  if (lotType === 'coach') {
    const { rows } = await pool.query(`SELECT * FROM coaches WHERE team_id IS NULL`);
    if (!rows.length) throw new Error('No free-agent coaches available to auction.');
    lots = rows.map((c) => ({ ...c, market_value: Math.round((c.rating || 70) * 400_000) }));
    squadCounts = new Map(teams.map((t) => [t.id, t.coach_id ? 1 : 0]));
    maxPerTeam = 1;
    valueField = 'market_value';
  } else {
    const { rows: players } = await pool.query(`SELECT * FROM players WHERE team_id IS NULL AND retired = false AND card_type IS NULL`);
    if (!players.length) throw new Error('No free agents available to auction.');
    const { rows: countRows } = await pool.query(
      `SELECT team_id, COUNT(*)::int AS n FROM players WHERE team_id IS NOT NULL AND retired = false GROUP BY team_id`);
    squadCounts = new Map(countRows.map((r) => [r.team_id, r.n]));
    lots = players;
    maxPerTeam = 35;
    valueField = 'market_value';
  }

  const state = createAuctionState({ id: auctionRows[0].id, season, players: lots, teams, squadCounts, maxPerTeam, valueField });
  current = { state, io, dbId: auctionRows[0].id, stageId, stageName, lotType, teamIds: teams.map((t) => t.id) };
  await persistCurrent();
  startExpiryLoop();
  io.to('auction-room').emit('auction:state', publicAuctionState());
  return publicAuctionState();
}

function startExpiryLoop() {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(async () => {
    if (!current) return;
    const result = checkExpiry(current.state);
    if (result) {
      await persistResult(result);
      await persistCurrent();
      current.io.to('auction-room').emit('auction:result', result);
      current.io.to('auction-room').emit('auction:state', publicAuctionState());
      if (current.state.status === 'completed') {
        await finalizeAuctionRecord();
        current.io.to('auction-room').emit('auction:completed', { soldCount: current.state.soldCount, unsoldCount: current.state.unsoldCount });
        clearInterval(checkTimer);
        checkTimer = null;
      }
    }
  }, 1000);
}

async function persistResult(result) {
  if (result.type !== 'sold') return;
  if (current.lotType === 'coach') {
    await pool.query(
      `UPDATE coaches SET team_id = $1, wage = GREATEST(2000, ROUND($2 / 42.0 / 500) * 500) WHERE id = $3`,
      [result.teamId, result.amount, result.playerId],
    );
    await pool.query(`UPDATE teams SET coach_id = $1, budget = budget - $2 WHERE id = $3`, [result.playerId, result.amount, result.teamId]);
  } else {
    await pool.query(
      `UPDATE players SET team_id = $1, wage = GREATEST(1000, ROUND($2 / 42.0 / 500) * 500), contract_seasons_left = 3 WHERE id = $3`,
      [result.teamId, result.amount, result.playerId],
    );
    await pool.query(`UPDATE teams SET budget = budget - $1 WHERE id = $2`, [result.amount, result.teamId]);
  }
}

async function bid(teamId, amount) {
  if (!current || current.state.status !== 'active') throw new Error('No auction is currently active.');
  const result = placeBid(current.state, teamId, amount);
  if (!result.ok) throw new Error(result.error);
  await persistCurrent();
  current.io.to('auction-room').emit('auction:bid', result.event);
  current.io.to('auction-room').emit('auction:state', publicAuctionState());
  return publicAuctionState();
}

async function autoFillRest(io) {
  if (!current || current.state.status !== 'active') throw new Error('No auction is currently active.');
  let teams;
  if (current.teamIds && current.teamIds.length) {
    teams = current.teamIds.map((id) => ({ id }));
  } else {
    const { rows } = await pool.query('SELECT id FROM teams');
    teams = rows;
  }
  const results = autoFillRemaining(current.state, teams);
  for (const r of results) await persistResult(r);
  await finalizeAuctionRecord();
  io.to('auction-room').emit('auction:completed', { soldCount: current.state.soldCount, unsoldCount: current.state.unsoldCount, bulk: true });
  if (checkTimer) { clearInterval(checkTimer); checkTimer = null; }
  return { sold: results.filter((r) => r.type === 'sold').length, unsold: results.filter((r) => r.type === 'unsold').length };
}

async function finalizeAuctionRecord() {
  if (!current) return;
  await pool.query(`UPDATE auctions SET status = 'completed' WHERE id = $1`, [current.dbId]);
  await kvDelete(KV_KEY);
}

function getState() {
  return publicAuctionState();
}

module.exports = { startAuction, bid, autoFillRest, getState, getStageAuctionStatus, resumeAuction };
