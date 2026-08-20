const { GOALKEEPER, DEFENDER_POSITIONS, MIDFIELDER_POSITIONS } = require('../constants/formations');

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(v, lo = 20, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

// Every top-level category (pace/shooting/passing/dribbling/defending/
// physical/goalkeeping) is the rounded average of three sub-attributes —
// this is what "multiple categories and sub-categories that make up the
// overall" refers to. Sub-stats jitter independently around a per-player
// category center so two players with the same pace can still differ in
// acceleration vs. top speed, etc.
const CATEGORY_SUBS = {
  pace: ['pace_acceleration', 'pace_sprint_speed', 'pace_agility'],
  shooting: ['shoot_finishing', 'shoot_power', 'shoot_long_shots'],
  passing: ['pass_short', 'pass_long', 'pass_vision'],
  dribbling: ['dribble_control', 'dribble_balance', 'dribble_composure'],
  defending: ['defend_tackling', 'defend_marking', 'defend_interceptions'],
  physical: ['phys_strength', 'phys_stamina', 'phys_aggression'],
  goalkeeping: ['gk_reflexes', 'gk_handling', 'gk_positioning'],
};

function genCategory(lo, hi) {
  const center = rand(lo, hi);
  const subValues = [0, 0, 0].map(() => clamp(center + rand(-6, 6), 15, 100));
  const category = Math.round(subValues.reduce((a, b) => a + b, 0) / subValues.length);
  return { category, subValues };
}

/** Recomputes every category value from its sub-attributes. Call this
 * after directly mutating any sub-attribute (development cycle, admin
 * edits) so the category stays consistent with what's underneath it. */
function recomputeCategories(player) {
  for (const [category, subs] of Object.entries(CATEGORY_SUBS)) {
    const values = subs.map((s) => Number(player[s]));
    if (values.some((v) => Number.isNaN(v))) continue;
    player[category] = Math.round(values.reduce((a, b) => a + b, 0) / values.length);
  }
  return player;
}

// Six-category model (each built from three sub-attributes) — a
// deliberately scoped-down version of the source bot's 15-25 granular
// custom stats per player, so every player still has an individual,
// position-shaped, drill-down-able profile rather than one flat number.
//
// Tier separation: the quality multiplier (14) and the ceilings below were
// tuned together so tier actually controls how high a player can go, not
// just where they average. Previously the multiplier (8) shifted the whole
// [lo,hi] window by only ~8-10 points between the worst and best tier,
// while each window itself spanned 20-30 points — so a bottom-tier (D)
// player's unlucky-in-a-good-way roll could land in the same range as a
// top-tier (S) player's average roll, producing "random" 90+ overalls on
// players never meant to be stars. Lowering each ceiling by 8 and roughly
// doubling the multiplier means a low tier's best-case roll and a high
// tier's worst-case roll no longer overlap as much — 90+ becomes something
// only S/A tier (genuine world-class real players) can realistically reach.
function generatePositionStats(position, quality = 0) {
  const q = quality * 14;
  const range = (lo, hi) => [clamp(lo + Math.round(q)), clamp(hi - 8 + Math.round(q))];
  const out = {};

  const apply = (category, [lo, hi]) => {
    const { category: value, subValues } = genCategory(lo, hi);
    out[category] = value;
    CATEGORY_SUBS[category].forEach((key, i) => { out[key] = subValues[i]; });
  };

  if (position === GOALKEEPER) {
    apply('pace', range(30, 55));
    apply('shooting', range(15, 35));
    apply('passing', range(45, 75));
    apply('dribbling', range(25, 50));
    apply('defending', range(35, 60));
    apply('physical', range(60, 88));
    apply('goalkeeping', range(60, 92));
    return out;
  }
  if (DEFENDER_POSITIONS.has(position)) {
    const wideBack = position !== 'CB';
    apply('pace', range(wideBack ? 65 : 50, wideBack ? 90 : 82));
    apply('shooting', range(25, 55));
    apply('passing', range(55, 85));
    apply('dribbling', range(50, 78));
    apply('defending', range(70, 95));
    apply('physical', range(65, 93));
    apply('goalkeeping', [10, 10]);
    return out;
  }
  if (MIDFIELDER_POSITIONS.has(position)) {
    apply('pace', range(55, 88));
    apply('shooting', range(45, 82));
    apply('passing', range(65, 94));
    apply('dribbling', range(62, 92));
    apply('defending', range(40, 85));
    apply('physical', range(58, 88));
    apply('goalkeeping', [10, 10]);
    return out;
  }
  // attackers
  apply('pace', range(70, 96));
  apply('shooting', range(68, 95));
  apply('passing', range(52, 85));
  apply('dribbling', range(68, 94));
  apply('defending', range(15, 45));
  apply('physical', range(58, 88));
  apply('goalkeeping', [10, 10]);
  return out;
}

const OVERALL_WEIGHTS = {
  GK: { goalkeeping: 0.65, physical: 0.15, passing: 0.15, defending: 0.05 },
  CB: { defending: 0.4, physical: 0.25, passing: 0.15, pace: 0.1, shooting: 0.1 },
  LB: { pace: 0.25, defending: 0.25, dribbling: 0.15, passing: 0.2, physical: 0.15 },
  RB: { pace: 0.25, defending: 0.25, dribbling: 0.15, passing: 0.2, physical: 0.15 },
  LWB: { pace: 0.3, defending: 0.2, dribbling: 0.2, passing: 0.2, physical: 0.1 },
  RWB: { pace: 0.3, defending: 0.2, dribbling: 0.2, passing: 0.2, physical: 0.1 },
  CDM: { defending: 0.35, passing: 0.25, physical: 0.2, dribbling: 0.1, pace: 0.1 },
  CM: { passing: 0.3, dribbling: 0.2, defending: 0.2, physical: 0.15, pace: 0.15 },
  CAM: { passing: 0.3, dribbling: 0.25, shooting: 0.25, pace: 0.2 },
  LM: { pace: 0.3, dribbling: 0.25, passing: 0.25, shooting: 0.2 },
  RM: { pace: 0.3, dribbling: 0.25, passing: 0.25, shooting: 0.2 },
  LW: { pace: 0.3, dribbling: 0.3, shooting: 0.25, passing: 0.15 },
  RW: { pace: 0.3, dribbling: 0.3, shooting: 0.25, passing: 0.15 },
  CF: { shooting: 0.35, dribbling: 0.2, passing: 0.2, physical: 0.15, pace: 0.1 },
  ST: { shooting: 0.4, pace: 0.25, physical: 0.2, dribbling: 0.15 },
};

function calculateOverall(player) {
  const weights = OVERALL_WEIGHTS[player.position] || { passing: 0.25, dribbling: 0.25, physical: 0.25, shooting: 0.25 };
  let total = 0;
  for (const [attr, w] of Object.entries(weights)) {
    total += (Number(player[attr]) || 50) * w;
  }
  return Math.round(total * 10) / 10;
}

// Star rating (1.1-5.0, one decimal — a scouting-style headline number) maps
// linearly onto the potential range (40-100) used everywhere else. Youth
// intake rolls a star first and derives potential from it; general pool
// generation rolls potential first and derives a star for display.
const STAR_MIN = 1.1, STAR_MAX = 5.0, POT_MIN = 40, POT_MAX = 100;

function potentialFromStar(star) {
  const s = clamp(star, STAR_MIN, STAR_MAX);
  return Math.round(POT_MIN + (s - STAR_MIN) * (POT_MAX - POT_MIN) / (STAR_MAX - STAR_MIN));
}

function starFromPotential(potential) {
  const p = clamp(potential, POT_MIN, POT_MAX);
  const star = STAR_MIN + (p - POT_MIN) * (STAR_MAX - STAR_MIN) / (POT_MAX - POT_MIN);
  return Math.round(star * 10) / 10;
}

function rollStar(center = 2.8, spread = 1.9) {
  const u = (Math.random() + Math.random() + Math.random()) / 3;
  const star = center + (u - 0.5) * spread;
  return Math.round(clamp(star, STAR_MIN, STAR_MAX) * 10) / 10;
}

module.exports = {
  generatePositionStats, calculateOverall, recomputeCategories, CATEGORY_SUBS, rand, clamp,
  potentialFromStar, starFromPotential, rollStar, STAR_MIN, STAR_MAX,
};