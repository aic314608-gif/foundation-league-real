const {
  STAGE_DEFAULT_NAMES, COACH_SPECIALTIES, FIRST_NAMES, LAST_NAMES, NATIONALITIES,
} = require('../constants/names');
const {
  REAL_CLUBS, REAL_MANAGERS, YOUTH_COACH_NAMES, MEDICAL_STAFF_NAMES, TIER_PROFILE, realPlayerSpecs,
} = require('../constants/realWorld');
const { GOALKEEPER } = require('../constants/formations');
const { generatePositionStats, rand, clamp, potentialFromStar, rollStar } = require('./attributes');
const { estimateMarketValue, estimateWage } = require('./economy');
const { derivePlayerPlaystyle, derivePlayerFormationFit, deriveCoachPlaystyle, deriveCoachFormationFit } = require('./playstyles');

const STARTER_FORMATIONS = ['4-3-3', '4-2-3-1', '4-4-2', '3-5-2', '3-4-3', '4-3-3 Attack', '4-1-4-1', '4-2-2-2'];
const INITIAL_TEAM_BUDGET = 150_000_000;
const CLUBS_PER_STAGE = 8;

function pick(arr) { return arr[rand(0, arr.length - 1)]; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Builds one real player as a free agent, using the engine's own stat
 * generator steered by the player's quality tier (S/A/B/C/D — a rough
 * reputation-based tier, not a licensed rating) rather than a fully
 * random roll. Age comes straight from the real-world spec. */
function buildRealPlayer(spec) {
  const { name, position, nationality, age, tier } = spec;
  const profile = TIER_PROFILE[tier] || TIER_PROFILE.C;

  // Younger + higher-tier players get more headroom above their current
  // level; older players are treated as at/near their ceiling already.
  const youthBoost = age <= 21 ? 0.35 : age <= 24 ? 0.15 : 0;
  const star = clamp(rollStar(profile.star, 0.35) + youthBoost, 1.1, 5.0);
  const potential = potentialFromStar(star);
  const ageFactor = clamp((age - 16) / 9, 0.4, 1);
  const quality = profile.quality * (0.75 + 0.25 * ageFactor);

  const stats = generatePositionStats(position, quality);
  if (stats.goalkeeping === undefined) stats.goalkeeping = position === GOALKEEPER ? rand(55, 75) : 10;

  const player = {
    name,
    age,
    position,
    secondary_position: null,
    nationality,
    squad_number: null,
    ...stats,
    potential,
    star_rating: star,
    development_rate: Math.round((0.6 + Math.random() * 1.0) * 100) / 100,
    form: rand(55, 85),
    fitness: 100,
    morale: rand(65, 85),
    injury_status: 'Healthy',
    is_star: tier === 'S',
    is_youth_product: false,
    team_id: null,
    contract_seasons_left: 0,
    wage: 0,
    listed: false,
    wants_to_leave: false,
  };
  player.market_value = estimateMarketValue(player);
  player.wage = estimateWage(player.market_value);
  player.playstyle = derivePlayerPlaystyle(player);
  player.formation_fit = derivePlayerFormationFit(player);
  return player;
}

function randomYouthAge() { return rand(16, 19); }

function randomPosition() {
  const roll = Math.random();
  if (roll < 0.13) return pick(['GK']);
  if (roll < 0.42) return pick(['CB', 'CB', 'LB', 'RB', 'LWB', 'RWB']);
  if (roll < 0.72) return pick(['CDM', 'CM', 'CM', 'CAM', 'LM', 'RM']);
  return pick(['ST', 'ST', 'CF', 'LW', 'RW']);
}

/** Builds one fresh youth-academy prospect. Unlike the real-player pool
 * (a fixed, finite set of real pros used up by the auction), academy
 * graduates are new unknown talents each season, so they're generated —
 * same as the rest of the engine did before real players were added.
 * Not a real person. */
function buildFreeAgent({ starCenter = 2.7, isYouth = true } = {}) {
  const position = randomPosition();
  const star = rollStar(starCenter, isYouth ? 1.6 : 2.3);
  const potential = potentialFromStar(star);
  const age = randomYouthAge();
  const ageFactor = clamp((age - 16) / 9, 0.4, 1);
  const quality = ((potential - 70) / 40) * ageFactor;

  const stats = generatePositionStats(position, quality);
  if (stats.goalkeeping === undefined) stats.goalkeeping = position === GOALKEEPER ? rand(55, 75) : 10;

  const first = pick(FIRST_NAMES);
  const last = pick(LAST_NAMES);

  const player = {
    name: `${first[0]}. ${last}`,
    age,
    position,
    secondary_position: null,
    nationality: pick(NATIONALITIES),
    squad_number: null,
    ...stats,
    potential,
    star_rating: star,
    development_rate: Math.round((0.6 + Math.random() * 1.0) * 100) / 100,
    form: rand(55, 85),
    fitness: 100,
    morale: rand(65, 85),
    injury_status: 'Healthy',
    is_star: false,
    is_youth_product: true,
    team_id: null,
    contract_seasons_left: 0,
    wage: 0,
    listed: false,
    wants_to_leave: false,
  };
  player.market_value = estimateMarketValue(player);
  player.wage = estimateWage(player.market_value);
  player.playstyle = derivePlayerPlaystyle(player);
  player.formation_fit = derivePlayerFormationFit(player);
  return player;
}

/** Builds a real free-agent pool from the full curated real-player list —
 * every entry used exactly once (no combinatoric duplicates), shuffled so
 * squad quality isn't clustered by list order. */
function buildFreeAgentPool() {
  return shuffle(realPlayerSpecs()).map(buildRealPlayer);
}

/** A pool of real free-agent coaches/managers (72 — 3x the club count),
 * all auctioned off to begin with, same as players. */
function buildCoachPool() {
  return REAL_MANAGERS.map((name) => {
    const rating = rand(70, 96);
    const coach = { name, specialty: pick(COACH_SPECIALTIES), rating, team_id: null };
    coach.playstyle = deriveCoachPlaystyle(coach);
    coach.formation_fit = deriveCoachFormationFit(coach);
    coach.wage = Math.round((rating * rand(4000, 8000)) / 1000) * 1000;
    return coach;
  });
}

/**
 * Builds an entire fresh world in memory: 3 stages (Elite / Rise /
 * Foundation) x 8 real clubs each (identity + financials only, no squads)
 * plus a global real free-agent player pool and a real-manager coach pool.
 * Teams are populated afterwards via the tier-by-tier auction.
 */
function buildWorld() {
  const stages = STAGE_DEFAULT_NAMES.map((name, i) => ({
    name,
    tier_order: i + 1,
    season: 1,
    promotion_spots: i === 0 ? 0 : 2,
    relegation_spots: i === STAGE_DEFAULT_NAMES.length - 1 ? 0 : 2,
  }));

  const youthCoachNames = shuffle(YOUTH_COACH_NAMES);
  const medicalStaffNames = shuffle(MEDICAL_STAFF_NAMES);

  const teams = REAL_CLUBS.map((club, i) => ({
    __tierIndex: Math.floor(i / CLUBS_PER_STAGE),
    name: club.name,
    short_name: club.short_name,
    color: club.color,
    stadium_name: club.stadium_name,
    formation: pick(STARTER_FORMATIONS),
    mentality: 'Balanced',
    budget: INITIAL_TEAM_BUDGET,
    youth_level: 1,
    youth_coach_name: youthCoachNames[i % youthCoachNames.length],
    medical_staff_name: medicalStaffNames[i % medicalStaffNames.length],
  }));

  const freeAgents = buildFreeAgentPool();
  const coaches = buildCoachPool();

  return { stages, teams, freeAgents, coaches };
}

module.exports = { buildWorld, buildRealPlayer, buildFreeAgent, buildFreeAgentPool, buildCoachPool, INITIAL_TEAM_BUDGET };
