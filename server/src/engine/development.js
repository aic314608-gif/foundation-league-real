const { calculateOverall, clamp, recomputeCategories, CATEGORY_SUBS } = require('./attributes');
const { buildFreeAgent } = require('./worldGen');
const { GOALKEEPER } = require('../constants/formations');

const PACE_RELIANT = new Set(['LW', 'RW', 'LB', 'RB', 'LWB', 'RWB', 'ST']);
const AGES_GRACEFULLY = new Set(['CB', 'CDM', 'CM', 'GK']);
const DEV_MAGNITUDE = 2; // "up to 2" points per sub-attribute, per cycle

const OUTFIELD_CATEGORIES = ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical'];
const GK_CATEGORIES = ['goalkeeping', 'physical', 'passing', 'defending'];

/**
 * Runs one development cycle (intended cadence: roughly every 6 months /
 * twice a season) on a single player, nudging their sub-attributes up,
 * down, or leaving them unchanged based on age, position ("playstyle"),
 * morale, and how far below/above their potential their current overall
 * sits. `facilityBonus` (from the club's youth-academy level) speeds up
 * growth for young players and slows decline for veterans alike. Mutates
 * the player object in place (sub-attributes, then recomputed category
 * totals) and returns a {attr: delta} map of what changed. Marquee
 * (card_type) players should never be passed in here.
 */
function developPlayer(player, facilityBonus = 0) {
  const overall = calculateOverall(player);
  const gapToPotential = (player.potential ?? overall) - overall;

  let bias;
  if (player.age <= 20) bias = 0.65 + gapToPotential / 120;
  else if (player.age <= 23) bias = 0.4 + gapToPotential / 140;
  else if (player.age <= 28) bias = 0.05 + gapToPotential / 200;
  else if (player.age <= 31) bias = -0.15;
  else if (player.age <= 34) bias = -0.45;
  else bias = -0.8;

  if (player.age > 29 && PACE_RELIANT.has(player.position)) bias -= 0.15;
  if (player.age > 31 && AGES_GRACEFULLY.has(player.position)) bias += 0.1;
  bias += (Number(player.morale || 70) - 70) / 500;
  bias += facilityBonus;
  bias = clamp(bias, -1, 1);

  const categories = player.position === GOALKEEPER ? GK_CATEGORIES : OUTFIELD_CATEGORIES;
  const subAttrs = categories.flatMap((c) => CATEGORY_SUBS[c]);

  const changes = {};
  for (const attr of subAttrs) {
    const noise = (Math.random() - 0.5) * 0.7;
    let delta = Math.round((bias + noise) * DEV_MAGNITUDE);
    delta = clamp(delta, -DEV_MAGNITUDE, DEV_MAGNITUDE);
    const current = Number(player[attr]) || 30;
    const next = clamp(current + delta, 15, 100);
    if (next !== current) {
      changes[attr] = next - current;
      player[attr] = next;
    }
  }
  recomputeCategories(player);
  return changes;
}

function developmentSummary(changes) {
  const total = Object.values(changes).reduce((a, b) => a + b, 0);
  if (total > 0) return `improved (+${total} across key sub-attributes)`;
  if (total < 0) return `declined (${total} across key sub-attributes)`;
  return 'held steady';
}

/** Runs the development cycle across a whole player list. `facilityBonusFor`
 * is an optional fn(player) -> number, e.g. derived from the player's
 * club's youth-academy level. Marquee (card_type) players are skipped —
 * they are admin-managed only. Returns a digest for a news feed/report. */
function runDevelopmentCycle(players, facilityBonusFor = () => 0) {
  const notable = [];
  for (const player of players) {
    if (player.retired || player.card_type) continue;
    const before = calculateOverall(player);
    const changes = developPlayer(player, facilityBonusFor(player));
    const after = calculateOverall(player);
    if (Math.abs(after - before) >= 1.5) {
      notable.push({ player, before, after, summary: developmentSummary(changes) });
    }
  }
  notable.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
  return notable;
}

function retirementProbability(age) {
  if (age < 33) return 0;
  if (age < 34) return 0.03;
  if (age < 36) return 0.1;
  if (age < 38) return 0.25;
  if (age < 40) return 0.5;
  return 0.9;
}

/** Rolls retirement for every eligible player. Marquee (card_type) players
 * never retire automatically — they are club fixtures managed by admin.
 * Returns the list of players who retired this cycle. */
function runRetirementCheck(players, season) {
  const retirees = [];
  for (const player of players) {
    if (player.retired || player.card_type || player.age < 33) continue;
    if (Math.random() < retirementProbability(player.age)) {
      player.retired = true;
      player.retired_season = season;
      retirees.push(player);
    }
  }
  return retirees;
}

/** Generates this season's academy graduates for one team: 1-5 players
 * (equal to the club's youth-academy level), with quality scaled by both
 * that level and the team's current division tier (better academies in
 * higher divisions produce better prospects on average). */
function generateYouthIntake(team) {
  const level = clamp(Number(team.youth_level || 1), 1, 5);
  const tierOrder = Number(team.tier_order || 2);
  const tierBonus = (3 - tierOrder) * 0.3; // Elite +0.6, Rise +0.3, Foundation +0
  const center = 1.9 + tierBonus + (level - 1) * 0.35;
  const count = level; // 1-5 players per year, directly tied to academy level

  const graduates = [];
  for (let i = 0; i < count; i++) {
    const p = buildFreeAgent({ starCenter: center, isYouth: true });
    p.contract_seasons_left = 3;
    p.wage = Math.max(500, Math.round((p.wage * 0.35) / 500) * 500);
    graduates.push(p);
  }
  return graduates;
}

module.exports = {
  developPlayer, developmentSummary, runDevelopmentCycle, runRetirementCheck, generateYouthIntake, retirementProbability,
};
