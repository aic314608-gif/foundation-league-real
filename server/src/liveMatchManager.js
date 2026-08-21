const { pool, withTransaction, kvSet, kvGet, kvDelete, kvListByPrefix } = require('./db');
const { createMatchState, tick, performSubstitution, possessionPct } = require('./engine/matchSim');
const { MENTALITIES, FORMATION_NAMES } = require('./constants/formations');
const { recordMatchChemistry, getLineupChemistryMult } = require('./services/chemistry');

const BASE_TICK_MS = 1700; // real ms per simulated minute at 1x speed
const KV_PREFIX = 'live_match:';

const live = new Map(); // matchId -> { state, interval, io }

// --- persistence: match state is plain JSON (no Maps/Sets), so it's a
// straight round-trip through Postgres — survives a restart mid-match
// instead of that match just vanishing from server memory.
async function persistMatch(matchId, state) {
  await kvSet(`${KV_PREFIX}${matchId}`, state);
}

async function clearPersistedMatch(matchId) {
  await kvDelete(`${KV_PREFIX}${matchId}`);
}

/** Called once at server boot. Reloads any matches that were live when the
 * process last stopped and restarts their tick loops in place — viewers
 * just see the match pick back up from its last simulated minute.
 * Staggered slightly (a few hundred ms apart) rather than all firing in
 * the same instant: a restart can resume dozens of matches at once, and
 * if several of them are already sitting at minute 90, they'd otherwise
 * all try to finalize (and hit Postgres) in the very same tick — exactly
 * the pile-up that caused the deadlock this was built to avoid. */
async function resumeLiveMatches(io) {
  const saved = await kvListByPrefix(KV_PREFIX);
  saved.forEach(({ value: state }, i) => {
    if (state.finished || state.status !== 'live') return;
    const entry = { state, io, interval: null };
    live.set(state.matchId, entry);
    entry.interval = setTimeout(() => {
      runTick(entry).catch((err) => {
        console.error(`Live match ${state.matchId} tick failed, will retry:`, err);
        scheduleTick(entry);
      });
    }, 150 * i);
  });
  if (saved.length) console.log(`Resumed ${saved.length} live match(es) after restart.`);
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, position: p.position, squad_number: p.squad_number,
    sentOff: !!p.sentOff, cameOnAt: p.cameOnAt || null, injury_status: p.injury_status,
    is_star: p.is_star, card_type: p.card_type || null,
  };
}

function publicState(state) {
  return {
    matchId: state.matchId, status: state.status, half: state.half, minute: state.minute,
    homeTeam: state.homeTeam, awayTeam: state.awayTeam,
    homeScore: state.homeScore, awayScore: state.awayScore,
    homeFormation: state.homeFormation, awayFormation: state.awayFormation,
    homeMentality: state.homeMentality, awayMentality: state.awayMentality,
    homeLineup: state.homeLineup.map(publicPlayer), awayLineup: state.awayLineup.map(publicPlayer),
    homeBench: state.homeBench.map(publicPlayer), awayBench: state.awayBench.map(publicPlayer),
    subsUsed: state.subsUsed, maxSubs: state.maxSubs,
    stats: state.stats, possession: possessionPct(state),
    commentary: state.commentary.slice(-40),
    speed: state.speed,
    formations: FORMATION_NAMES, mentalities: MENTALITIES,
  };
}

async function fetchAvailableSquad(teamId) {
  const { rows } = await pool.query(
    `SELECT * FROM players WHERE team_id = $1 AND retired = false ORDER BY id`, [teamId]);
  return rows;
}

async function startMatch(matchId, io) {
  if (live.has(matchId)) return live.get(matchId).state;

  const { rows: matchRows } = await pool.query('SELECT * FROM matches WHERE id = $1', [matchId]);
  const match = matchRows[0];
  if (!match) throw new Error('Match not found.');
  if (match.status === 'finished') throw new Error('Match has already been played.');

  const { rows: teamRows } = await pool.query('SELECT * FROM teams WHERE id = ANY($1)', [[match.home_team_id, match.away_team_id]]);
  const homeTeam = teamRows.find((t) => t.id === match.home_team_id);
  const awayTeam = teamRows.find((t) => t.id === match.away_team_id);
  if (!homeTeam || !awayTeam) throw new Error('Teams not found.');

  const [homeSquad, awaySquad] = await Promise.all([fetchAvailableSquad(homeTeam.id), fetchAvailableSquad(awayTeam.id)]);
  if (homeSquad.length < 11 || awaySquad.length < 11) {
    throw new Error('Both clubs need at least 11 available (non-retired, uninjured) players to kick off.');
  }

  const state = createMatchState({
    matchId, stageId: match.stage_id, season: match.season, matchday: match.matchday,
    homeTeam, awayTeam, homeSquad, awaySquad,
  });
  // Lineup is only known once createMatchState picks the starting XI, so
  // chemistry (which depends on who's actually selected) is computed just after.
  state.homeChemMult = await getLineupChemistryMult(pool, state.homeLineup.map((p) => p.id));
  state.awayChemMult = await getLineupChemistryMult(pool, state.awayLineup.map((p) => p.id));

  await pool.query(`UPDATE matches SET status = 'live', minute = 0, home_formation = $1, away_formation = $2 WHERE id = $3`,
    [state.homeFormation, state.awayFormation, matchId]);

  const entry = { state, io, interval: null };
  live.set(matchId, entry);
  await persistMatch(matchId, state);
  scheduleTick(entry);
  io.to(`match-${matchId}`).emit('match:state', publicState(state));
  return state;
}

function scheduleTick(entry) {
  const delay = Math.max(200, Math.round(BASE_TICK_MS / (entry.state.speed || 1)));
  entry.interval = setTimeout(() => {
    runTick(entry).catch((err) => {
      // A single match's DB hiccup (deadlock, dropped connection, etc.)
      // must never take the whole process down — Node treats an unhandled
      // rejection as fatal by default, and this tick loop runs unattended
      // for dozens of concurrent matches. Log it and just retry on the
      // next tick instead of crashing every other live match/auction/page
      // along with it.
      console.error(`Live match ${entry.state.matchId} tick failed, will retry:`, err);
      scheduleTick(entry);
    });
  }, delay);
}

async function runTick(entry) {
  const { state, io } = entry;
  if (state.finished) {
    // We only get here on a retry after finalizeMatch threw previously.
    // tick() already flipped state.finished before that failed attempt, so
    // re-running the normal path below would just no-op forever — retry
    // finalizing directly instead, or this match would silently freeze
    // half-finished (never cleared, never removed from `live`).
    try {
      await finalizeMatch(state);
      await clearPersistedMatch(state.matchId);
      io.to(`match-${state.matchId}`).emit('match:finished', publicState(state));
      live.delete(state.matchId);
    } catch (err) {
      console.error(`Live match ${state.matchId} finalize failed, will retry:`, err);
      scheduleTick(entry);
    }
    return;
  }
  const events = tick(state) || [];
  io.to(`match-${state.matchId}`).emit('match:tick', {
    minute: state.minute, half: state.half, homeScore: state.homeScore, awayScore: state.awayScore,
    events, stats: state.stats, possession: possessionPct(state),
    injuredPlayers: state.injuredPlayers.slice(-3), subsUsed: state.subsUsed,
  });

  if (events.some((e) => e.type === 'sub')) {
    io.to(`match-${state.matchId}`).emit('match:state', publicState(state));
  }

  if (state.finished) {
    await finalizeMatch(state);
    await clearPersistedMatch(state.matchId);
    io.to(`match-${state.matchId}`).emit('match:finished', publicState(state));
    live.delete(state.matchId);
    return;
  }
  await persistMatch(state.matchId, state);
  scheduleTick(entry);
}

async function finalizeMatch(state) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE matches SET status='finished', home_score=$1, away_score=$2, minute=90, events=$3, stats=$4, played_at=now() WHERE id=$5`,
      [state.homeScore, state.awayScore, JSON.stringify(state.commentary), JSON.stringify(state.stats), state.matchId],
    );

    const homeResult = state.homeScore > state.awayScore ? 'W' : state.homeScore < state.awayScore ? 'L' : 'D';
    const awayResult = homeResult === 'W' ? 'L' : homeResult === 'L' ? 'W' : 'D';
    // Always touch team rows in a fixed order (ascending id), never
    // home-then-away. With many matches finalizing concurrently after a
    // restart, two simultaneous transactions locking the same two teams'
    // rows in opposite orders (e.g. match A: team 1 then team 2, match B
    // involving the same pair as team 2 then team 1) is a textbook deadlock
    // — Postgres has to kill one side (error 40P01), which took the whole
    // process down. A single consistent lock order makes that impossible.
    const teamResults = [
      { teamId: state.homeTeam.id, result: homeResult, gf: state.homeScore, ga: state.awayScore },
      { teamId: state.awayTeam.id, result: awayResult, gf: state.awayScore, ga: state.homeScore },
    ].sort((a, b) => a.teamId - b.teamId);
    for (const r of teamResults) await applyTeamResult(client, r.teamId, r.result, r.gf, r.ga);
    await recordMatchChemistry(client, state.homeTeam.id, state.homeLineup, state.playerMatchStats);
    await recordMatchChemistry(client, state.awayTeam.id, state.awayLineup, state.playerMatchStats);

    for (const [playerId, stats] of Object.entries(state.playerMatchStats)) {
      if (!stats.minutes && !stats.goals && !stats.assists) continue;
      await client.query(
        `UPDATE players SET goals = goals + $1, assists = assists + $2, appearances = appearances + $3,
         yellow_cards = yellow_cards + $4, red_cards = red_cards + $5, fitness = GREATEST(40, fitness - 12)
         WHERE id = $6`,
        [stats.goals, stats.assists, stats.minutes > 0 ? 1 : 0, stats.yellow, stats.red, playerId],
      );
    }

    const injuredIds = state.injuredPlayers.map((i) => i.playerId);
    for (const inj of state.injuredPlayers) {
      await client.query(
        `UPDATE players SET injury_status = 'Injured', injury_matches_remaining = $1 WHERE id = $2`,
        [inj.recoveryMatches || 2, inj.playerId],
      );
    }
    // Time passes for everyone else on both squads, whether they played or not.
    await client.query(
      `UPDATE players SET injury_matches_remaining = injury_matches_remaining - 1
       WHERE team_id = ANY($1) AND injury_status = 'Injured' AND injury_matches_remaining > 0
       AND NOT (id = ANY($2))`,
      [[state.homeTeam.id, state.awayTeam.id], injuredIds.length ? injuredIds : [0]],
    );
    await client.query(
      `UPDATE players SET injury_status = 'Healthy' WHERE injury_status = 'Injured' AND injury_matches_remaining <= 0`,
    );
  });
}

async function applyTeamResult(client, teamId, result, gf, ga) {
  const points = result === 'W' ? 3 : result === 'D' ? 1 : 0;
  await client.query(
    `UPDATE teams SET
      wins = wins + $1, draws = draws + $2, losses = losses + $3,
      points = points + $4, goals_for = goals_for + $5, goals_against = goals_against + $6,
      form = (
        SELECT ARRAY(SELECT unnest(array_append(form, $7::text)) OFFSET GREATEST(0, array_length(array_append(form, $7::text),1) - 5))
      )
     WHERE id = $8`,
    [result === 'W' ? 1 : 0, result === 'D' ? 1 : 0, result === 'L' ? 1 : 0, points, gf, ga, result, teamId],
  );
}

function getPublicState(matchId) {
  const entry = live.get(matchId);
  return entry ? publicState(entry.state) : null;
}

function isLive(matchId) {
  return live.has(matchId);
}

async function applyTactics(matchId, side, { formation, mentality }, userTeamId, isAdmin) {
  const entry = live.get(matchId);
  if (!entry) throw new Error('Match is not live.');
  const { state } = entry;
  const teamId = side === 'home' ? state.homeTeam.id : state.awayTeam.id;
  if (!isAdmin && userTeamId !== teamId) throw new Error('You do not manage this side.');
  if (formation && FORMATION_NAMES.includes(formation)) state[`${side}Formation`] = formation;
  if (mentality && MENTALITIES.includes(mentality)) state[`${side}Mentality`] = mentality;
  await persistMatch(matchId, state);
  entry.io.to(`match-${matchId}`).emit('match:state', publicState(state));
  return publicState(state);
}

async function applySub(matchId, side, outId, inId, userTeamId, isAdmin) {
  const entry = live.get(matchId);
  if (!entry) throw new Error('Match is not live.');
  const { state } = entry;
  const teamId = side === 'home' ? state.homeTeam.id : state.awayTeam.id;
  if (!isAdmin && userTeamId !== teamId) throw new Error('You do not manage this side.');
  const result = performSubstitution(state, side, outId, inId);
  if (!result.ok) throw new Error(result.error);
  await persistMatch(matchId, state);
  entry.io.to(`match-${matchId}`).emit('match:state', publicState(state));
  return publicState(state);
}

async function setSpeed(matchId, speed, userTeamId, isAdmin) {
  const entry = live.get(matchId);
  if (!entry) throw new Error('Match is not live.');
  const { state } = entry;
  if (!isAdmin && userTeamId !== state.homeTeam.id && userTeamId !== state.awayTeam.id) {
    throw new Error('You are not part of this match.');
  }
  state.speed = Math.max(1, Math.min(6, Number(speed) || 1));
  await persistMatch(matchId, state);
  return publicState(state);
}

module.exports = { startMatch, getPublicState, isLive, applyTactics, applySub, setSpeed, publicState, live, resumeLiveMatches };