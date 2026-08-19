const { calculateOverall } = require('./attributes');
const { SPONSOR_NAMES } = require('../constants/names');

function ageMultiplier(age) {
  if (age <= 20) return 1.35;
  if (age <= 23) return 1.2;
  if (age <= 27) return 1.1;
  if (age <= 30) return 0.9;
  if (age <= 33) return 0.6;
  if (age <= 36) return 0.35;
  return 0.15;
}

function estimateMarketValue(player) {
  const overall = calculateOverall(player);
  const base = Math.pow(Math.max(overall, 30) / 50, 3) * 3_000_000;
  const potentialBonus = Math.max(0, (player.potential || overall) - overall) * 45_000;
  const raw = (base + potentialBonus) * ageMultiplier(player.age);
  return Math.max(50_000, Math.round(raw / 10_000) * 10_000);
}

function estimateWage(marketValue) {
  return Math.max(1_000, Math.round(marketValue / 42 / 500) * 500);
}

// Stage 1 (Elite) pays the most, Stage 3 (Foundation) the least — this is
// what ties "which stage a team is in" to its financial trajectory.
function seasonPrizeMoney(tierOrder, finalPosition, teamsInStage = 8) {
  const tierBase = { 1: 40_000_000, 2: 18_000_000, 3: 8_000_000 }[tierOrder] || 8_000_000;
  const positionBonus = Math.round(tierBase * 0.6 * ((teamsInStage - finalPosition + 1) / teamsInStage));
  return tierBase + positionBonus;
}

function stageWageCeiling(tierOrder) {
  return { 1: 4_500_000, 2: 1_800_000, 3: 700_000 }[tierOrder] || 700_000;
}

/**
 * A player (not a human) evaluates a contract offer. Higher wage relative
 * to their market-value-implied "fair wage", longer security for veterans,
 * and star players demanding a premium all factor in.
 */
function evaluateContractOffer(player, wage, seasons) {
  const fairWage = estimateWage(player.market_value || estimateMarketValue(player));
  const starPremium = player.is_star ? 1.15 : 1.0;
  const ambitionFactor = player.wants_to_leave ? 1.2 : 1.0;
  const threshold = fairWage * starPremium * ambitionFactor;

  const wageScore = wage / Math.max(1, threshold);
  const agingPenalty = player.age >= 32 ? 0.08 : 0;
  const acceptProb = Math.min(0.97, Math.max(0.03, wageScore - 0.55 + agingPenalty));

  const accept = Math.random() < acceptProb;
  let reason;
  if (accept) {
    reason = wageScore >= 1.1 ? 'Delighted with the wage on offer.' : 'Happy with the terms.';
  } else {
    reason = wageScore < 0.8 ? 'Feels the wage is well below their value.' : 'Wants a little more to be convinced.';
  }
  return { accept, reason, fairWage: Math.round(threshold) };
}

/** An unmanaged ("uncontrolled") team's front office evaluates an incoming
 * transfer bid for one of its players. */
function evaluateTransferOffer(player, offerAmount) {
  const value = player.market_value || estimateMarketValue(player);
  const reluctance = player.wants_to_leave ? 0.85 : 1.05;
  const ratio = offerAmount / Math.max(1, value * reluctance);
  const acceptProb = Math.min(0.95, Math.max(0.02, (ratio - 0.85) * 1.6));
  const accept = Math.random() < acceptProb;
  return { accept, reason: accept ? 'Accepts the bid.' : 'Rejects the bid as too low.', estimatedValue: value };
}

function generateSponsorOffers(team, count = 3) {
  const tierMultiplier = { 1: 1.6, 2: 1.0, 3: 0.55 };
  const usedNames = new Set();
  const offers = [];
  while (offers.length < count) {
    const name = SPONSOR_NAMES[Math.floor(Math.random() * SPONSOR_NAMES.length)];
    if (usedNames.has(name)) continue;
    usedNames.add(name);
    const seasons = 1 + Math.floor(Math.random() * 3);
    const base = (2_000_000 + Math.random() * 6_000_000) * (tierMultiplier[team.__tierOrder] || 1);
    offers.push({
      sponsor_name: name,
      value: Math.round(base / 50_000) * 50_000,
      length_seasons: seasons,
    });
  }
  return offers;
}

/** Sponsor's response to a counter-proposal: meets partway if the ask is
 * reasonable, otherwise walks away. */
function evaluateSponsorCounter(offerValue, requestedValue) {
  const ratio = requestedValue / offerValue;
  if (ratio > 1.35) return { accept: false, counter: null };
  if (ratio <= 1.1) return { accept: true, counter: requestedValue };
  const middle = Math.round((offerValue + requestedValue) / 2 / 50_000) * 50_000;
  return { accept: true, counter: middle };
}

module.exports = {
  estimateMarketValue, estimateWage, seasonPrizeMoney, stageWageCeiling,
  evaluateContractOffer, evaluateTransferOffer, generateSponsorOffers, evaluateSponsorCounter,
};
