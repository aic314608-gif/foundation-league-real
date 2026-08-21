const { FORMATIONS, formationBias, ATTACKER_POSITIONS, MIDFIELDER_POSITIONS, DEFENDER_POSITIONS, GOALKEEPER } = require('../constants/formations');
const { calculateOverall, rand } = require('./attributes');
const { selectStartingXI } = require('./lineup');
const { playerFitMultiplier } = require('./playstyles');

// ---- Tunable constants (kept together so behaviour is easy to re-balance) ----
// Only one side is "in possession" per simulated minute in this model, so
// CHANCE_BASE is a probability per possession-minute, not per team-minute —
// tuned via a 150-match headless run to land near real-world averages
// (~10-13 shots/team, ~2.2-2.6 goals/match, ~1.3 cards/match, ~0.3-0.9
// injuries/match).
const CHANCE_BASE = 0.26;       // base probability the side in possession creates a shot this minute
const CHANCE_SCALE = 500;       // divides the attack-vs-defense gap
const FOUL_PROB = 0.05;         // per-minute probability of a foul (matches source bot's tuning)
const RED_CARD_SHARE = 0.08;    // of fouls
const YELLOW_CARD_SHARE = 0.22; // of fouls (on top of red share)
const INJURY_BASE_PROB = 0.00035; // per player, per minute, scaled by age/fitness

const MENTALITY_MODS = {
  Attacking: { attack: 1.18, defense: 0.86, fatigue: 1.08 },
  Possession: { attack: 1.05, defense: 1.02, fatigue: 1.05 },
  Balanced: { attack: 1.0, defense: 1.0, fatigue: 1.0 },
  'Counter Attack': { attack: 1.08, defense: 1.06, fatigue: 0.95 },
  'High Press': { attack: 1.1, defense: 0.95, fatigue: 1.2 },
  Defensive: { attack: 0.85, defense: 1.15, fatigue: 0.95 },
  'Park the Bus': { attack: 0.62, defense: 1.3, fatigue: 0.85 },
};

const SHOT_WEIGHT = {
  ST: 3.2, CF: 2.6, LW: 2.3, RW: 2.3, CAM: 2.0, CM: 1.1, LM: 1.4, RM: 1.4,
  CDM: 0.55, LWB: 0.4, RWB: 0.4, LB: 0.25, RB: 0.25, CB: 0.15, GK: 0.01,
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function other(side) { return side === 'home' ? 'away' : 'home'; }

function freshTeamStats() {
  return { shots: 0, onTarget: 0, corners: 0, fouls: 0, possessionTicks: 0 };
}

function clonePlayer(p) {
  return { ...p, matchFitness: p.fitness, sentOff: false, cameOnAt: null };
}

/**
 * Builds the live in-memory state for a match about to kick off. `homeTeam`
 * / `awayTeam` are full team rows; `homeSquad` / `awaySquad` are that team's
 * full (available) player rows. Falls back to an auto-picked XI if the
 * team's saved lineup is missing/invalid/short (e.g. due to injuries).
 */
function createMatchState({ matchId, stageId, season, matchday, homeTeam, awayTeam, homeSquad, awaySquad, homeChemMult = 1, awayChemMult = 1 }) {
  const buildSide = (team, squad) => {
    const available = squad.filter((p) => !p.retired && p.injury_status !== 'Injured');
    const savedLineupIds = new Set(team.lineup_ids || []);
    let lineup = available.filter((p) => savedLineupIds.has(p.id));
    let bench;
    const formation = FORMATIONS[team.formation] ? team.formation : '4-3-3';
    const neededSlots = Object.values(FORMATIONS[formation]).reduce((a, b) => a + b, 0);

    if (lineup.length < neededSlots) {
      const picked = selectStartingXI(available, formation);
      lineup = picked.lineup;
      bench = picked.bench;
    } else {
      lineup = lineup.slice(0, neededSlots);
      const usedIds = new Set(lineup.map((p) => p.id));
      const savedBenchIds = new Set(team.bench_ids || []);
      bench = available.filter((p) => !usedIds.has(p.id) && savedBenchIds.has(p.id));
      const extras = available.filter((p) => !usedIds.has(p.id) && !savedBenchIds.has(p.id));
      bench = [...bench, ...extras];
    }
    return {
      lineup: lineup.map(clonePlayer),
      bench: bench.map(clonePlayer),
      formation,
      mentality: team.mentality && MENTALITY_MODS[team.mentality] ? team.mentality : 'Balanced',
    };
  };

  const home = buildSide(homeTeam, homeSquad);
  const away = buildSide(awayTeam, awaySquad);

  const playerMatchStats = {};
  for (const p of [...home.lineup, ...away.lineup]) {
    playerMatchStats[p.id] = { goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, tackles: 0, saves: 0, minutes: 0, yellow: 0, red: 0 };
  }

  return {
    matchId, stageId, season, matchday,
    status: 'live',
    half: 1,
    minute: 0,
    homeTeam: { id: homeTeam.id, name: homeTeam.name, color: homeTeam.color },
    awayTeam: { id: awayTeam.id, name: awayTeam.name, color: awayTeam.color },
    homeLineup: home.lineup, homeBench: home.bench,
    awayLineup: away.lineup, awayBench: away.bench,
    homeFormation: home.formation, awayFormation: away.formation,
    homeMentality: home.mentality, awayMentality: away.mentality,
    homeScore: 0, awayScore: 0,
    homeMedical: Number(homeTeam.medical_level || 1),
    awayMedical: Number(awayTeam.medical_level || 1),
    possession: Math.random() < 0.5 ? 'home' : 'away',
    subsUsed: { home: 0, away: 0 },
    maxSubs: 5,
    stats: { home: freshTeamStats(), away: freshTeamStats() },
    commentary: [],
    scorers: [],
    injuredPlayers: [],
    cardedPlayers: [],
    playerMatchStats,
    speed: 1,
    finished: false,
    homeChemMult, awayChemMult,
  };
}

function log(state, minute, text, meta = {}) {
  const entry = { minute, text, ...meta };
  state.commentary.push(entry);
  if (state.commentary.length > 160) state.commentary.shift();
  return entry;
}

function computeStrength(lineup, formationName, mentality, chemistryMult = 1) {
  const onField = lineup.filter((p) => !p.sentOff);
  let attack = 0, defense = 0, midfield = 0, gk = 35;
  for (const p of onField) {
    const overall = calculateOverall(p);
    const fitnessMult = 0.82 + 0.18 * ((p.matchFitness ?? p.fitness) / 100);
    const formMult = 0.82 + 0.32 * (p.form / 100);
    const tacticalFitMult = playerFitMultiplier(p, formationName, mentality);
    const eff = overall * fitnessMult * formMult * tacticalFitMult;
    if (p.position === GOALKEEPER) {
      gk = p.goalkeeping * fitnessMult * formMult * tacticalFitMult;
    } else if (ATTACKER_POSITIONS.has(p.position)) {
      attack += eff;
    } else if (MIDFIELDER_POSITIONS.has(p.position)) {
      attack += eff * 0.45;
      defense += eff * 0.3;
      midfield += eff;
    } else if (DEFENDER_POSITIONS.has(p.position)) {
      defense += eff;
      midfield += eff * 0.15;
    }
  }
  const bias = formationBias(formationName);
  const mod = MENTALITY_MODS[mentality] || MENTALITY_MODS.Balanced;
  return {
    attack: attack * bias.attack * mod.attack * chemistryMult,
    defense: defense * bias.defense * mod.defense * chemistryMult,
    midfield: midfield * chemistryMult,
    gk,
    fatigueMult: mod.fatigue,
  };
}

function pickWeighted(items, weightFn) {
  const weights = items.map(weightFn);
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return items[Math.floor(Math.random() * items.length)];
  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

function pickShooter(lineup) {
  const eligible = lineup.filter((p) => !p.sentOff && p.position !== GOALKEEPER);
  if (!eligible.length) return null;
  return pickWeighted(eligible, (p) => (SHOT_WEIGHT[p.position] || 0.5) * (0.5 + p.shooting / 100));
}

function pickAssister(lineup, excludeId) {
  const eligible = lineup.filter((p) => !p.sentOff && p.id !== excludeId);
  if (!eligible.length || Math.random() > 0.68) return null;
  return pickWeighted(eligible, (p) => 0.3 + p.passing / 100);
}

function statsFor(state, side) { return state.stats[side]; }
function lineupFor(state, side) { return side === 'home' ? state.homeLineup : state.awayLineup; }
function benchFor(state, side) { return side === 'home' ? state.homeBench : state.awayBench; }

function resolveShotChance(state, side) {
  const lineup = lineupFor(state, side);
  const defLineup = lineupFor(state, other(side));
  const shooter = pickShooter(lineup);
  if (!shooter) return;
  const pStats = state.playerMatchStats[shooter.id];
  statsFor(state, side).shots += 1;
  pStats.shots += 1;

  const onTargetProb = clamp(0.30 + (shooter.shooting - 60) / 320, 0.15, 0.6);
  if (Math.random() >= onTargetProb) {
    return log(state, state.minute, `${shooter.name} fires over the bar.`, { type: 'shot_off' });
  }
  statsFor(state, side).onTarget += 1;
  pStats.shotsOnTarget += 1;

  const gk = defLineup.find((p) => p.position === GOALKEEPER && !p.sentOff);
  const gkSkill = gk ? gk.goalkeeping : 45;
  const saveProb = clamp(0.62 + (gkSkill - 60) / 260 - (shooter.shooting - 60) / 340, 0.35, 0.92);
  if (Math.random() < saveProb) {
    if (gk) state.playerMatchStats[gk.id].saves += 1;
    return log(state, state.minute, `${shooter.name}'s effort is saved${gk ? ` by ${gk.name}` : ''}!`, { type: 'save' });
  }

  // GOAL
  if (side === 'home') state.homeScore += 1; else state.awayScore += 1;
  pStats.goals += 1;
  const assister = pickAssister(lineup, shooter.id);
  if (assister) state.playerMatchStats[assister.id].assists += 1;

  const scoreLine = `${state.homeScore}-${state.awayScore}`;
  const entry = log(state, state.minute, `GOAL! ${shooter.name}${assister ? ` (assist: ${assister.name})` : ''} makes it ${scoreLine}.`, {
    type: 'goal', side, scorer: shooter.name, scorerId: shooter.id,
    assist: assister ? assister.name : null, score: { home: state.homeScore, away: state.awayScore },
  });
  state.scorers.push({ minute: state.minute, side, name: shooter.name });
  return entry;
}

function maybeCorner(state, side) {
  if (Math.random() < 0.06) {
    statsFor(state, side).corners += 1;
    log(state, state.minute, `Corner kick for ${side === 'home' ? state.homeTeam.name : state.awayTeam.name}.`, { type: 'corner' });
  }
}

function issueCard(state, side, player, isRed) {
  const pStats = state.playerMatchStats[player.id];
  if (isRed) {
    player.sentOff = true;
    pStats.red += 1;
    log(state, state.minute, `RED CARD! ${player.name} is sent off.`, { type: 'red', side, playerId: player.id, playerName: player.name });
  } else {
    pStats.yellow += 1;
    log(state, state.minute, `Yellow card shown to ${player.name}.`, { type: 'yellow', side, playerId: player.id, playerName: player.name });
  }
  state.cardedPlayers.push({ playerId: player.id, name: player.name, side, isRed });
}

function maybeFoulOrCard(state, attackingSide) {
  if (Math.random() >= FOUL_PROB) return;
  const defendingSide = other(attackingSide);
  const defenders = lineupFor(state, defendingSide).filter((p) => !p.sentOff);
  if (!defenders.length) return;
  const fouler = defenders[Math.floor(Math.random() * defenders.length)];
  statsFor(state, defendingSide).fouls += 1;

  const roll = Math.random();
  if (roll < RED_CARD_SHARE) issueCard(state, defendingSide, fouler, true);
  else if (roll < RED_CARD_SHARE + YELLOW_CARD_SHARE) issueCard(state, defendingSide, fouler, false);
}

function autoSubForInjury(state, side, injuredPlayer) {
  if (state.subsUsed[side] >= state.maxSubs) return;
  const bench = benchFor(state, side);
  if (!bench.length) return;
  const samePos = bench.filter((p) => p.position === injuredPlayer.position);
  const replacement = (samePos[0] || bench[0]);
  performSubstitution(state, side, injuredPlayer.id, replacement.id, { auto: true });
}

function tickInjuriesAndFatigue(state) {
  for (const side of ['home', 'away']) {
    const lineup = lineupFor(state, side);
    for (const p of lineup) {
      if (p.sentOff) continue;
      const highRunning = MIDFIELDER_POSITIONS.has(p.position);
      const drain = highRunning ? 0.32 : 0.2;
      p.matchFitness = clamp((p.matchFitness ?? p.fitness) - drain, 35, 100);
      state.playerMatchStats[p.id].minutes += 1;

      const ageFactor = p.age > 30 ? 1 + (p.age - 30) * 0.06 : (p.age < 21 ? 1.1 : 1);
      const fatigueFactor = 1 + (100 - p.matchFitness) / 100;
      const prob = INJURY_BASE_PROB * ageFactor * fatigueFactor;
      if (Math.random() < prob) {
        const severity = Math.random() < 0.78 ? 'Minor' : (Math.random() < 0.85 ? 'Major' : 'Severe');
        const baseRecovery = { Minor: rand(1, 3), Major: rand(4, 7), Severe: rand(8, 14) }[severity];
        const medicalLevel = side === 'home' ? state.homeMedical : state.awayMedical;
        const recoveryMult = 1 - (clamp(medicalLevel, 1, 5) - 1) * 0.125; // level 5 = up to half the time
        const recoveryMatches = Math.max(1, Math.round(baseRecovery * recoveryMult));
        p.injury_status = 'Injured';
        p.__severity = severity;
        p.__recoveryMatches = recoveryMatches;
        state.injuredPlayers.push({ playerId: p.id, name: p.name, side, severity, recoveryMatches });
        log(state, state.minute, `${p.name} goes down with an injury (${severity.toLowerCase()}, out ~${recoveryMatches} match${recoveryMatches > 1 ? 'es' : ''}).`, { type: 'injury', side, playerId: p.id });
        autoSubForInjury(state, side, p);
      }
    }
  }
}

function performSubstitution(state, side, outId, inId, { auto = false } = {}) {
  if (state.subsUsed[side] >= state.maxSubs) return { ok: false, error: 'No substitutions remaining for this team.' };
  const lineup = lineupFor(state, side);
  const bench = benchFor(state, side);
  const outIdx = lineup.findIndex((p) => p.id === outId);
  const inIdx = bench.findIndex((p) => p.id === inId);
  if (outIdx === -1) return { ok: false, error: 'That player is not currently on the pitch.' };
  if (inIdx === -1) return { ok: false, error: 'That player is not available on the bench.' };

  const outPlayer = lineup[outIdx];
  const inPlayer = bench[inIdx];
  inPlayer.cameOnAt = state.minute;
  lineup[outIdx] = inPlayer;
  bench.splice(inIdx, 1);
  if (!auto) bench.push(outPlayer);
  state.subsUsed[side] += 1;

  if (!state.playerMatchStats[inPlayer.id]) {
    state.playerMatchStats[inPlayer.id] = { goals: 0, assists: 0, shots: 0, shotsOnTarget: 0, tackles: 0, saves: 0, minutes: 0, yellow: 0, red: 0 };
  }
  const entry = log(state, state.minute, `${auto ? 'Enforced substitution' : 'Substitution'}: ${inPlayer.name} replaces ${outPlayer.name}.`, {
    type: 'sub', side, inId: inPlayer.id, inName: inPlayer.name, outId: outPlayer.id, outName: outPlayer.name, auto,
  });
  return { ok: true, event: entry };
}

/**
 * Advances the match by exactly one simulated minute. Returns the list of
 * commentary entries generated this tick (often empty — most minutes are
 * uneventful) so the caller can broadcast every one of them, not just a
 * single "headline" event. Returns null once the match has fully finished.
 */
function tick(state) {
  if (state.finished) return null;

  if (state.half === 1 && state.minute >= 45) {
    state.half = 2;
    state.minute = 45;
    return [log(state, 45, 'Half-time.', { type: 'half_time' })];
  }
  if (state.half === 2 && state.minute >= 90) {
    state.finished = true;
    state.status = 'finished';
    return [log(state, 90, `Full-time: ${state.homeTeam.name} ${state.homeScore}-${state.awayScore} ${state.awayTeam.name}.`, { type: 'full_time' })];
  }

  state.minute += 1;
  const commentaryStart = state.commentary.length;
  tickInjuriesAndFatigue(state);

  const homeStrength = computeStrength(state.homeLineup, state.homeFormation, state.homeMentality, state.homeChemMult ?? 1);
  const awayStrength = computeStrength(state.awayLineup, state.awayFormation, state.awayMentality, state.awayChemMult ?? 1);

  const homeMidControl = homeStrength.midfield + homeStrength.attack * 0.15 + 4; // small home boost
  const awayMidControl = awayStrength.midfield + awayStrength.attack * 0.15;
  const homeShare = homeMidControl / Math.max(1, homeMidControl + awayMidControl);
  const attackingSide = Math.random() < homeShare ? 'home' : 'away';
  statsFor(state, attackingSide).possessionTicks += 1;
  statsFor(state, other(attackingSide)).possessionTicks += 0; // explicit no-op for clarity
  state.possession = attackingSide;

  const attackers = attackingSide === 'home' ? homeStrength : awayStrength;
  const defenders = attackingSide === 'home' ? awayStrength : homeStrength;
  const gap = attackers.attack - defenders.defense;
  const chanceProb = clamp(CHANCE_BASE + gap / CHANCE_SCALE, 0.08, 0.55);

  if (Math.random() < chanceProb) {
    resolveShotChance(state, attackingSide);
  } else {
    maybeCorner(state, attackingSide);
  }

  maybeFoulOrCard(state, attackingSide);

  return state.commentary.slice(commentaryStart);
}

function possessionPct(state) {
  const h = state.stats.home.possessionTicks;
  const a = state.stats.away.possessionTicks;
  const total = h + a;
  if (!total) return { home: 50, away: 50 };
  return { home: Math.round((h / total) * 100), away: Math.round(100 - (h / total) * 100) };
}

module.exports = {
  createMatchState, tick, performSubstitution, computeStrength, possessionPct, MENTALITY_MODS,
};
