const { clamp } = require('../engine/attributes');

const CAP = 100;

function pairKey(idA, idB) {
  return idA < idB ? [idA, idB] : [idB, idA];
}

// Younger pairs build chemistry faster (more football ahead of them
// together); a big age gap between the two slows it down a bit.
function ageFactor(ageA, ageB) {
  const avgAge = (ageA + ageB) / 2;
  const gap = Math.abs(ageA - ageB);
  const base = clamp(1.4 - avgAge * 0.02, 0.5, 1.3);
  const gapPenalty = gap > 10 ? 0.8 : gap > 5 ? 0.92 : 1.0;
  return base * gapPenalty;
}

/** Called from liveMatchManager.finalizeMatch. For every pair of teammates
 * (same side) who both played minutes this match, bumps minutes_together
 * and chemistry_score, weighted by how much of the match they overlapped
 * for and by ageFactor. */
async function recordMatchChemistry(client, teamId, lineup, playerMatchStats) {
  const played = lineup
    .map((p) => ({ id: p.id, age: p.age, minutes: playerMatchStats[p.id]?.minutes || 0 }))
    .filter((p) => p.minutes > 0);

  for (let i = 0; i < played.length; i++) {
    for (let j = i + 1; j < played.length; j++) {
      const a = played[i], b = played[j];
      const [idA, idB] = pairKey(a.id, b.id);
      const overlapMinutes = Math.min(a.minutes, b.minutes);
      if (overlapMinutes <= 0) continue;
      const gain = 0.35 * ageFactor(a.age, b.age) * (overlapMinutes / 90);
      await client.query(
        `INSERT INTO chemistry_pairs (player_a_id, player_b_id, team_id, minutes_together, chemistry_score)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
           team_id = EXCLUDED.team_id,
           minutes_together = chemistry_pairs.minutes_together + $4,
           chemistry_score = LEAST(${CAP}, chemistry_pairs.chemistry_score + $5),
           updated_at = now()`,
        [idA, idB, teamId, overlapMinutes, gain],
      );
    }
  }
}

/** Called at season rollover: every pair of current (non-retired)
 * squadmates on the same team gets +1 season together and a smaller flat
 * chemistry bump (off-pitch familiarity, not just shared minutes). */
async function applySeasonChemistry(client) {
  const { rows: teams } = await client.query('SELECT id FROM teams');
  for (const team of teams) {
    const { rows: squad } = await client.query(
      'SELECT id, age FROM players WHERE team_id = $1 AND retired = false', [team.id],
    );
    for (let i = 0; i < squad.length; i++) {
      for (let j = i + 1; j < squad.length; j++) {
        const a = squad[i], b = squad[j];
        const [idA, idB] = pairKey(a.id, b.id);
        const gain = 1.5 * ageFactor(a.age, b.age);
        await client.query(
          `INSERT INTO chemistry_pairs (player_a_id, player_b_id, team_id, seasons_together, chemistry_score)
           VALUES ($1, $2, $3, 1, $4)
           ON CONFLICT (player_a_id, player_b_id) DO UPDATE SET
             team_id = EXCLUDED.team_id,
             seasons_together = chemistry_pairs.seasons_together + 1,
             chemistry_score = LEAST(${CAP}, chemistry_pairs.chemistry_score + $4),
             updated_at = now()`,
          [idA, idB, team.id, gain],
        );
      }
    }
  }
}

/** Average pairwise chemistry among a starting XI, as an in-match strength
 * multiplier (roughly 1.0-1.08). Missing pairs (never played together)
 * simply count as 0 chemistry, pulling the average down — that's the
 * point, a brand-new-look XI shouldn't get a bonus. */
async function getLineupChemistryMult(pool, lineupIds) {
  if (lineupIds.length < 2) return 1;
  const { rows } = await pool.query(
    `SELECT chemistry_score FROM chemistry_pairs WHERE player_a_id = ANY($1) AND player_b_id = ANY($1)`,
    [lineupIds],
  );
  const totalPairs = (lineupIds.length * (lineupIds.length - 1)) / 2;
  const sum = rows.reduce((s, r) => s + Number(r.chemistry_score), 0);
  const avg = sum / totalPairs; // pairs with no row count as 0, intentionally
  return 1 + clamp(avg / CAP, 0, 1) * 0.08;
}

/** Top chemistry partners for a player, for display on their profile. */
async function getTopPartners(pool, playerId, limit = 5) {
  const { rows } = await pool.query(
    `SELECT CASE WHEN player_a_id = $1 THEN player_b_id ELSE player_a_id END AS partner_id,
            minutes_together, seasons_together, chemistry_score
     FROM chemistry_pairs WHERE player_a_id = $1 OR player_b_id = $1
     ORDER BY chemistry_score DESC LIMIT $2`,
    [playerId, limit],
  );
  return rows;
}

module.exports = { recordMatchChemistry, applySeasonChemistry, getLineupChemistryMult, getTopPartners };
