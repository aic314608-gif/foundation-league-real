// Playstyle + formation-fit engine.
//
// "Playstyle" reuses the existing MENTALITIES vocabulary (Attacking,
// Possession, Balanced, Counter Attack, High Press, Defensive, Park the
// Bus) — a player/coach who "thrives in High Press" performs best when
// their team's mentality is set to High Press. "Formation fit" is a
// 20-99 rating per formation (from constants/formations.FORMATION_NAMES).
//
// Honesty note: none of this is hand-scouted real tactical history for
// 1,003 real players and 72 real coaches — that isn't something a model
// can respond responsibly claim to have researched at that scale. Instead
// it's derived deterministically from each player's own generated
// attributes (pace/dribbling -> Counter Attack/wide systems, passing ->
// Possession, physical/defending -> Defensive systems, etc.) and each
// coach's specialty tag, so it's internally consistent and meaningfully
// tied to who they are in-engine, even though it isn't a real scouting
// report. Training lets any player/coach improve at a formation over time.

const { FORMATION_NAMES, FORMATIONS, ATTACKER_POSITIONS, MIDFIELDER_POSITIONS, DEFENDER_POSITIONS, GOALKEEPER } = require('../constants/formations');
const { MENTALITIES } = require('../constants/formations');
const { rand, clamp } = require('./attributes');

const TRAIN_INCREMENT = 4;
const TRAIN_CAP = 99;

/** Which mentality a formation naturally suits best, used to weight the
 * random-but-attribute-steered playstyle roll toward formations that make
 * tactical sense together (a 5-3-2 leans Defensive/Counter, a 4-3-3
 * Attack leans Attacking/Possession, etc.) rather than being pure noise. */
function formationLeaning(formationName) {
  const shape = FORMATIONS[formationName] || {};
  let atk = 0, def = 0;
  for (const [pos, n] of Object.entries(shape)) {
    if (ATTACKER_POSITIONS.has(pos)) atk += n;
    if (DEFENDER_POSITIONS.has(pos)) def += n;
  }
  if (def >= 5) return 'Defensive';
  if (atk >= 3 && /Attack/.test(formationName)) return 'Attacking';
  if (atk >= 3) return 'Possession';
  return 'Balanced';
}

function derivePlayerPlaystyle(player) {
  const pace = Number(player.pace) || 50;
  const passing = Number(player.passing) || 50;
  const dribbling = Number(player.dribbling) || 50;
  const defending = Number(player.defending) || 50;
  const physical = Number(player.physical) || 50;
  const shooting = Number(player.shooting) || 50;

  const scores = {
    Possession: passing * 1.2 + dribbling * 0.6,
    'Counter Attack': pace * 1.1 + shooting * 0.5,
    'High Press': physical * 0.7 + pace * 0.7 + defending * 0.4,
    Defensive: defending * 1.2 + physical * 0.4,
    Attacking: shooting * 1.0 + dribbling * 0.5 + pace * 0.3,
    'Park the Bus': defending * 0.9 + physical * 0.6,
    Balanced: (passing + defending + pace + physical) / 4,
  };
  if (player.position === GOALKEEPER) {
    // Keepers lean on the same signal but goalkeeping quality replaces outfield scores.
    scores.Defensive += (Number(player.goalkeeping) || 50) * 0.6;
    scores['Park the Bus'] += (Number(player.goalkeeping) || 50) * 0.4;
  }

  // Small deterministic jitter (seeded off name length + age) so identical
  // stat lines don't always resolve to the exact same tag.
  const seed = ((player.name || '').length * 7 + (player.age || 25)) % 11;
  const entries = Object.entries(scores).map(([k, v]) => [k, v + seed * 0.8]);
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

function deriveCoachPlaystyle(coach) {
  const map = {
    Attacking: 'Attacking', Possession: 'Possession', Defensive: 'Defensive',
    Tactical: 'Balanced', 'Man-Management': 'Balanced', 'Youth Development': 'Balanced',
  };
  return map[coach.specialty] || 'Balanced';
}

/** Builds a formation_fit map for every known formation. `primaryStyle` is
 * the playstyle tag already derived; formations that lean toward it get a
 * higher baseline rating, everything else is lower with some spread, all
 * scaled by the entity's overall quality (0-1, e.g. potential/100 or
 * rating/100) so a better player/coach is competent in more systems. */
function buildFormationFit(primaryStyle, qualityFrac) {
  const fit = {};
  const q = clamp(qualityFrac, 0.2, 1);
  for (const name of FORMATION_NAMES) {
    const leaning = formationLeaning(name);
    const base = leaning === primaryStyle ? 72 : (leaning === 'Balanced' || primaryStyle === 'Balanced') ? 58 : 44;
    const spread = rand(-8, 8);
    const scaled = base + (q - 0.6) * 40 + spread;
    fit[name] = Math.round(clamp(scaled, 20, 95));
  }
  return fit;
}

function derivePlayerFormationFit(player) {
  const style = player.playstyle || derivePlayerPlaystyle(player);
  const qualityFrac = clamp((Number(player.potential) || 65) / 100, 0.2, 1);
  return buildFormationFit(style, qualityFrac);
}

function deriveCoachFormationFit(coach) {
  const style = coach.playstyle || deriveCoachPlaystyle(coach);
  const qualityFrac = clamp((Number(coach.rating) || 70) / 100, 0.2, 1);
  return buildFormationFit(style, qualityFrac);
}

/** Nudges one formation's fit rating up for training, with diminishing
 * returns as it approaches the cap. Returns the updated fit object (does
 * not mutate the input). */
function trainFormation(formationFit, formationName) {
  const fit = { ...formationFit };
  const current = fit[formationName] ?? 50;
  const headroom = TRAIN_CAP - current;
  const gain = Math.max(1, Math.round(TRAIN_INCREMENT * (headroom / (TRAIN_CAP - 20))));
  fit[formationName] = Math.min(TRAIN_CAP, current + gain);
  return fit;
}

/** In-match multiplier for a player's effectiveness given the formation and
 * team mentality actually being played, from their fit rating (20-99) and
 * whether their playstyle matches the mentality. Used by matchSim's
 * computeStrength. Returns roughly 0.87-1.20. */
function playerFitMultiplier(player, formationName, mentality) {
  const fit = (player.formation_fit && player.formation_fit[formationName]) ?? 55;
  const formationMult = 0.87 + (fit / 100) * 0.3; // 20->0.93 .. 99->1.167
  const styleMult = player.playstyle === mentality ? 1.06 : (MENTALITIES.includes(mentality) ? 0.98 : 1);
  return formationMult * styleMult;
}

module.exports = {
  derivePlayerPlaystyle, deriveCoachPlaystyle, buildFormationFit,
  derivePlayerFormationFit, deriveCoachFormationFit, trainFormation,
  playerFitMultiplier, formationLeaning, TRAIN_INCREMENT, TRAIN_CAP,
};
