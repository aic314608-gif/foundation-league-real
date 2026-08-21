// Icon ("legend"), Hero, and Special are hand-curated marquee player slots.
// They are never generated procedurally and never enter the auction or
// transfer market — an admin creates them directly for a team, one per
// type per team, gated by the team's current stage tier:
//   Tier 1 (Elite):      Icon + Hero + Special  -> max 8 Icons league-wide
//   Tier 2 (Rise):       Hero + Special         -> max 16 Heroes league-wide
//   Tier 3 (Foundation): Special only           -> max 24 Specials league-wide
const TIER_CARD_TYPES = {
  1: ['legend', 'hero', 'special'],
  2: ['hero', 'special'],
  3: ['special'],
};

const CARD_TYPE_LABEL = { legend: 'Icon', hero: 'Hero', special: 'Special' };

// Suggested (not enforced) overall ratings, shown to the admin as a
// starting point when hand-building a card's stats.
const CARD_TYPE_SUGGESTED_OVERALL = { legend: 95, hero: 89, special: 85 };

function cardTypesAllowedForTier(tierOrder) {
  return TIER_CARD_TYPES[tierOrder] || [];
}

async function canTeamHoldCardType(client, teamId, cardType) {
  if (!['hero', 'legend', 'special'].includes(cardType)) return { ok: false, reason: 'Unknown marquee type.' };
  const { rows } = await client.query(
    `SELECT t.id, s.tier_order FROM teams t JOIN stages s ON s.id = t.stage_id WHERE t.id = $1`, [teamId]);
  if (!rows.length) return { ok: false, reason: 'Team not found.' };
  const allowed = cardTypesAllowedForTier(rows[0].tier_order);
  if (!allowed.includes(cardType)) {
    return { ok: false, reason: `${CARD_TYPE_LABEL[cardType]} players are not permitted at this division's level.` };
  }
  const { rows: existing } = await client.query(
    `SELECT COUNT(*)::int AS n FROM players WHERE team_id = $1 AND card_type = $2 AND retired = false`, [teamId, cardType]);
  if (existing[0].n > 0) return { ok: false, reason: `This team already has a ${CARD_TYPE_LABEL[cardType]} player.` };
  return { ok: true };
}

module.exports = { TIER_CARD_TYPES, CARD_TYPE_LABEL, CARD_TYPE_SUGGESTED_OVERALL, cardTypesAllowedForTier, canTeamHoldCardType };
