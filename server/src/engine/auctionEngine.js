const BID_WINDOW_MS = 22_000;
const SOFT_CLOSE_MS = 8_000;
const MAX_SQUAD_SIZE = 35;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function startingBid(player, valueField = 'market_value') {
  const base = Math.round((player[valueField] || 1_000_000) * 0.25 / 50_000) * 50_000;
  return Math.max(150_000, base);
}

// Flat step so quick-bid buttons ($500K/$1M/$5M/$10M) always land exactly
// where they say: current bid + button amount, never rounded up further.
function minIncrement() {
  return 500_000;
}

/**
 * Builds a fresh auction state. `players` and `teams` are full DB rows;
 * squadCounts is a Map(teamId -> current squad size) used to steer
 * auto-fill toward teams that still need players.
 */
function createAuctionState({ id, season, players, teams, squadCounts, maxPerTeam = MAX_SQUAD_SIZE, valueField = 'market_value' }) {
  const queue = shuffle(players.map((p) => p.id));
  const playersById = new Map(players.map((p) => [p.id, p]));
  const budgets = new Map(teams.map((t) => [t.id, Number(t.budget)]));
  const counts = new Map(teams.map((t) => [t.id, squadCounts.get(t.id) || 0]));

  const state = {
    id, season, status: queue.length ? 'active' : 'completed',
    queue, queuePosition: 0, maxPerTeam, valueField,
    playersById, budgets, counts,
    currentPlayerId: null, currentBid: 0, currentBidTeamId: null,
    deadline: null, log: [], soldCount: 0, unsoldCount: 0,
  };
  advanceToNext(state);
  return state;
}

function currentPlayer(state) {
  return state.currentPlayerId ? state.playersById.get(state.currentPlayerId) : null;
}

function advanceToNext(state) {
  if (state.queuePosition >= state.queue.length) {
    state.status = 'completed';
    state.currentPlayerId = null;
    state.deadline = null;
    return;
  }
  const nextId = state.queue[state.queuePosition];
  state.queuePosition += 1;
  state.currentPlayerId = nextId;
  const player = state.playersById.get(nextId);
  state.currentBid = player ? startingBid(player, state.valueField) : 150_000;
  state.currentBidTeamId = null;
  state.deadline = Date.now() + BID_WINDOW_MS;
}

/** Freezes the clock on the current lot. Remaining time is stashed so
 * resumeAuction can pick up exactly where it left off instead of giving
 * everyone a fresh full window. */
function pauseAuction(state) {
  if (state.status !== 'active') throw new Error('Auction is not active, so it cannot be paused.');
  state.pauseRemainingMs = Math.max(0, (state.deadline || Date.now()) - Date.now());
  state.deadline = null;
  state.status = 'paused';
}

/** Unfreezes the clock, restoring whatever time was left when paused. */
function resumeAuction(state) {
  if (state.status !== 'paused') throw new Error('Auction is not paused, so it cannot be resumed.');
  state.deadline = Date.now() + (state.pauseRemainingMs ?? BID_WINDOW_MS);
  state.pauseRemainingMs = null;
  state.status = 'active';
}

function placeBid(state, teamId, amount) {
  if (state.status === 'paused') return { ok: false, error: 'Auction is paused.' };
  if (state.status !== 'active') return { ok: false, error: 'Auction is not active.' };
  const player = currentPlayer(state);
  if (!player) return { ok: false, error: 'No player currently up for auction.' };

  const required = state.currentBidTeamId ? state.currentBid + minIncrement(state.currentBid) : state.currentBid;
  if (amount < required) return { ok: false, error: `Bid must be at least ${required.toLocaleString()}.` };

  const budget = state.budgets.get(teamId) ?? 0;
  if (amount > budget) return { ok: false, error: 'Bid exceeds your remaining budget.' };

  const squadCount = state.counts.get(teamId) ?? 0;
  if (squadCount >= state.maxPerTeam) return { ok: false, error: 'Squad is already at the maximum size.' };

  if (teamId === state.currentBidTeamId) return { ok: false, error: 'You are already the highest bidder.' };

  state.currentBid = amount;
  state.currentBidTeamId = teamId;
  const remaining = state.deadline - Date.now();
  if (remaining < SOFT_CLOSE_MS) state.deadline = Date.now() + SOFT_CLOSE_MS;

  const entry = { type: 'bid', playerId: player.id, playerName: player.name, teamId, amount, at: Date.now() };
  state.log.push(entry);
  return { ok: true, event: entry };
}

/** Call periodically (e.g. every second). If the deadline has passed,
 * resolves the current player (sold/unsold) and moves to the next one.
 * Returns a result event, or null if nothing happened yet. */
function checkExpiry(state) {
  if (state.status !== 'active' || !state.deadline) return null;
  if (Date.now() < state.deadline) return null;

  const player = currentPlayer(state);
  let result;
  if (player && state.currentBidTeamId) {
    const teamId = state.currentBidTeamId;
    state.budgets.set(teamId, (state.budgets.get(teamId) || 0) - state.currentBid);
    state.counts.set(teamId, (state.counts.get(teamId) || 0) + 1);
    state.soldCount += 1;
    result = { type: 'sold', playerId: player.id, playerName: player.name, teamId, amount: state.currentBid };
  } else if (player) {
    state.unsoldCount += 1;
    result = { type: 'unsold', playerId: player.id, playerName: player.name };
  }
  if (result) state.log.push({ ...result, at: Date.now() });

  advanceToNext(state);
  return result;
}

/** Randomly (weighted toward teams that need players most, respecting
 * remaining budget) assigns every player still in the queue, including the
 * one currently up. Used to finish squad-building quickly without forcing
 * a real-time bid on all ~600 players. */
function autoFillRemaining(state, teams) {
  const results = [];
  const remainingIds = [state.currentPlayerId, ...state.queue.slice(state.queuePosition)].filter(Boolean);
  const teamIds = teams.map((t) => t.id);

  for (const pid of remainingIds) {
    const player = state.playersById.get(pid);
    if (!player) continue;
    const candidates = teamIds
      .filter((tid) => (state.counts.get(tid) || 0) < state.maxPerTeam)
      .sort((a, b) => (state.counts.get(a) || 0) - (state.counts.get(b) || 0));
    if (!candidates.length) {
      results.push({ type: 'unsold', playerId: pid, playerName: player.name });
      continue;
    }
    // Weight toward the neediest few teams rather than always picking the single neediest.
    const pool = candidates.slice(0, Math.max(3, Math.ceil(candidates.length / 3)));
    const teamId = pool[Math.floor(Math.random() * pool.length)];
    const price = Math.min(state.budgets.get(teamId) || 0, startingBid(player, state.valueField));
    state.budgets.set(teamId, (state.budgets.get(teamId) || 0) - price);
    state.counts.set(teamId, (state.counts.get(teamId) || 0) + 1);
    results.push({ type: 'sold', playerId: pid, playerName: player.name, teamId, amount: price });
  }

  state.status = 'completed';
  state.currentPlayerId = null;
  state.deadline = null;
  state.queuePosition = state.queue.length;
  return results;
}

/** Immediately resolves the current lot without waiting out the clock —
 * sold to whoever's currently highest bidder if any, otherwise unsold —
 * then advances to the next lot. Works even while paused (the skip takes
 * the lot with it). Shares its resolution logic with checkExpiry so a
 * skipped lot behaves identically to one that just timed out. */
function skipCurrentLot(state) {
  if (state.status !== 'active' && state.status !== 'paused') {
    throw new Error('No lot is currently up for auction.');
  }
  const player = currentPlayer(state);
  let result = null;
  if (player && state.currentBidTeamId) {
    const teamId = state.currentBidTeamId;
    state.budgets.set(teamId, (state.budgets.get(teamId) || 0) - state.currentBid);
    state.counts.set(teamId, (state.counts.get(teamId) || 0) + 1);
    state.soldCount += 1;
    result = { type: 'sold', playerId: player.id, playerName: player.name, teamId, amount: state.currentBid };
  } else if (player) {
    state.unsoldCount += 1;
    result = { type: 'unsold', playerId: player.id, playerName: player.name };
  }
  if (result) state.log.push({ ...result, at: Date.now() });

  state.pauseRemainingMs = null;
  state.status = 'active'; // advanceToNext flips this to 'completed' itself if the queue's empty
  advanceToNext(state);
  return result;
}

module.exports = { createAuctionState, placeBid, checkExpiry, autoFillRemaining, currentPlayer, startingBid, minIncrement, pauseAuction, resumeAuction, skipCurrentLot, BID_WINDOW_MS };
