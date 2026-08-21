const { pool, withTransaction } = require('../db');
const { estimateWage, evaluateContractOffer, evaluateTransferOffer, generateSponsorOffers, evaluateSponsorCounter } = require('../engine/economy');
const { addNews } = require('./leagueOps');

// "Has a manager" means the team is human-controlled — that's anyone with
// team_id pointing at it, not just role='manager' (an admin/owner who
// self-claimed a club is just as human-controlled and should get the same
// manual review, not silent AI auto-accept/reject).
async function teamHasManager(client, teamId) {
  const { rows } = await client.query(`SELECT 1 FROM users WHERE team_id = $1 LIMIT 1`, [teamId]);
  return rows.length > 0;
}

async function currentSeason(client) {
  const { rows } = await client.query('SELECT season FROM stages ORDER BY tier_order LIMIT 1');
  return rows[0]?.season || 1;
}

async function listPlayer(playerId, teamId, askingPrice) {
  const { rows: check } = await pool.query('SELECT card_type FROM players WHERE id = $1', [playerId]);
  if (check[0]?.card_type) throw new Error('Icon, Hero, and Special players are admin-assigned and cannot be listed for transfer.');
  const { rows } = await pool.query('UPDATE players SET listed = true, asking_price = $1 WHERE id = $2 AND team_id = $3 RETURNING *', [askingPrice, playerId, teamId]);
  if (!rows.length) throw new Error('Player not found on that team.');
  return rows[0];
}

async function unlistPlayer(playerId, teamId) {
  const { rows } = await pool.query('UPDATE players SET listed = false, asking_price = NULL WHERE id = $1 AND team_id = $2 RETURNING *', [playerId, teamId]);
  if (!rows.length) throw new Error('Player not found on that team.');
  return rows[0];
}

async function executeTransfer(client, player, buyerTeamId, amount) {
  const season = await currentSeason(client);
  await client.query('UPDATE teams SET budget = budget - $1 WHERE id = $2', [amount, buyerTeamId]);
  if (player.team_id) await client.query('UPDATE teams SET budget = budget + $1 WHERE id = $2', [amount, player.team_id]);
  const newWage = estimateWage(player.market_value);
  await client.query(
    `UPDATE players SET team_id = $1, listed = false, asking_price = NULL, wants_to_leave = false,
     wage = $2, contract_seasons_left = 3 WHERE id = $3`,
    [buyerTeamId, newWage, player.id],
  );
  const { rows: buyer } = await client.query('SELECT name FROM teams WHERE id = $1', [buyerTeamId]);
  await addNews(client, 'transfer', `${player.name} joins ${buyer[0]?.name || 'a new club'} for $${amount.toLocaleString()}.`, season);
}

async function makeTransferOffer(playerId, fromTeamId, amount, message) {
  return withTransaction(async (client) => {
    const { rows: playerRows } = await client.query('SELECT * FROM players WHERE id = $1', [playerId]);
    const player = playerRows[0];
    if (!player) throw new Error('Player not found.');
    if (!player.team_id) throw new Error('Player is a free agent — sign them with a contract offer instead.');
    if (player.card_type) throw new Error('Icon, Hero, and Special players are admin-assigned and cannot be transferred.');
    if (player.team_id === fromTeamId) throw new Error('You already own this player.');

    const { rows: offerRows } = await client.query(
      `INSERT INTO transfer_offers (player_id, from_team_id, to_team_id, amount, message) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [playerId, fromTeamId, player.team_id, amount, message || null],
    );
    const offer = offerRows[0];

    const hasManager = await teamHasManager(client, player.team_id);
    if (!hasManager) {
      const evaluation = evaluateTransferOffer(player, amount);
      if (evaluation.accept) {
        await executeTransfer(client, player, fromTeamId, amount);
        await client.query(`UPDATE transfer_offers SET status='accepted', resolved_at=now() WHERE id=$1`, [offer.id]);
        return { ...offer, status: 'accepted', auto: true };
      }
      await client.query(`UPDATE transfer_offers SET status='rejected', resolved_at=now() WHERE id=$1`, [offer.id]);
      return { ...offer, status: 'rejected', auto: true, reason: evaluation.reason };
    }
    return offer;
  });
}

async function respondTransferOffer(offerId, responderTeamId, decision) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM transfer_offers WHERE id = $1 FOR UPDATE', [offerId]);
    const offer = rows[0];
    if (!offer) throw new Error('Offer not found.');
    if (offer.status !== 'pending') throw new Error('This offer has already been resolved.');
    if (offer.to_team_id !== responderTeamId) throw new Error('This offer is not addressed to your team.');

    if (decision === 'accept') {
      const { rows: playerRows } = await client.query('SELECT * FROM players WHERE id = $1', [offer.player_id]);
      await executeTransfer(client, playerRows[0], offer.from_team_id, Number(offer.amount));
      await client.query(`UPDATE transfer_offers SET status='accepted', resolved_at=now() WHERE id=$1`, [offerId]);
      await client.query(`UPDATE transfer_offers SET status='withdrawn', resolved_at=now() WHERE player_id=$1 AND status='pending' AND id != $2`, [offer.player_id, offerId]);
    } else {
      await client.query(`UPDATE transfer_offers SET status='rejected', resolved_at=now() WHERE id=$1`, [offerId]);
    }
    return { ...offer, status: decision === 'accept' ? 'accepted' : 'rejected' };
  });
}

async function offerContract(playerId, teamId, wage, seasons) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM players WHERE id = $1', [playerId]);
    const player = rows[0];
    if (!player) throw new Error('Player not found.');
    if (player.card_type) throw new Error('Icon, Hero, and Special players are admin-assigned — edit their wage directly via the admin panel.');
    if (player.team_id && player.team_id !== teamId) throw new Error('Player is contracted to another club — make a transfer offer instead.');

    const { rows: teamRows } = await client.query('SELECT * FROM teams WHERE id = $1', [teamId]);
    const team = teamRows[0];
    const season = await currentSeason(client);
    const seasonWageCost = wage; // per-season cost, checked loosely against budget below
    if (seasonWageCost > Number(team.budget)) throw new Error('Offer exceeds available budget.');

    const evaluation = evaluateContractOffer(player, wage, seasons);
    await client.query(
      `INSERT INTO contract_offers (player_id, team_id, wage, seasons, status) VALUES ($1,$2,$3,$4,$5)`,
      [playerId, teamId, wage, seasons, evaluation.accept ? 'accepted' : 'rejected'],
    );

    if (evaluation.accept) {
      await client.query(
        `UPDATE players SET team_id=$1, wage=$2, contract_seasons_left=$3, wants_to_leave=false, listed=false, asking_price=NULL WHERE id=$4`,
        [teamId, wage, seasons, playerId],
      );
      await addNews(client, 'contract', `${player.name} ${player.team_id ? 'signs a new deal with' : 'joins'} ${team.name} (${seasons} season${seasons > 1 ? 's' : ''}).`, season);
    }
    return { accepted: evaluation.accept, reason: evaluation.reason, fairWage: evaluation.fairWage };
  });
}

async function releasePlayer(playerId, teamId) {
  const { rows } = await pool.query(
    `UPDATE players SET team_id=NULL, wage=0, contract_seasons_left=0, listed=false, asking_price=NULL, wants_to_leave=false
     WHERE id=$1 AND team_id=$2 RETURNING *`, [playerId, teamId]);
  if (!rows.length) throw new Error('Player not found on that team.');
  return rows[0];
}

async function getOrCreateSponsorOffers(teamId) {
  return withTransaction(async (client) => {
    const season = await currentSeason(client);
    const { rows: existing } = await client.query(
      `SELECT * FROM sponsor_offers WHERE team_id=$1 AND season=$2 AND status='pending' ORDER BY id`, [teamId, season]);
    if (existing.length) return existing;

    const { rows: teamRows } = await client.query('SELECT t.*, s.tier_order FROM teams t JOIN stages s ON s.id = t.stage_id WHERE t.id = $1', [teamId]);
    const team = teamRows[0];
    const offers = generateSponsorOffers({ ...team, __tierOrder: team.tier_order });
    const inserted = [];
    for (const offer of offers) {
      const { rows } = await client.query(
        `INSERT INTO sponsor_offers (team_id, season, sponsor_name, value, length_seasons) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [teamId, season, offer.sponsor_name, offer.value, offer.length_seasons],
      );
      inserted.push(rows[0]);
    }
    return inserted;
  });
}

async function respondSponsorOffer(offerId, teamId, decision, counterValue) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM sponsor_offers WHERE id = $1 FOR UPDATE', [offerId]);
    const offer = rows[0];
    if (!offer) throw new Error('Offer not found.');
    if (offer.team_id !== teamId) throw new Error('This offer is not addressed to your team.');
    if (offer.status !== 'pending') throw new Error('This offer has already been resolved.');

    let finalValue = Number(offer.value);
    let accept = decision === 'accept';

    if (decision === 'counter') {
      const evalResult = evaluateSponsorCounter(Number(offer.value), Number(counterValue));
      accept = evalResult.accept;
      finalValue = evalResult.counter ?? finalValue;
    }

    if (!accept) {
      await client.query(`UPDATE sponsor_offers SET status='rejected' WHERE id=$1`, [offerId]);
      return { accepted: false };
    }

    await client.query(`UPDATE sponsor_offers SET status='accepted', value=$1 WHERE id=$2`, [finalValue, offerId]);
    await client.query(`UPDATE sponsor_offers SET status='expired' WHERE team_id=$1 AND season=$2 AND id != $3 AND status='pending'`, [teamId, offer.season, offerId]);
    await client.query(
      `UPDATE teams SET sponsor_name=$1, sponsor_value=$2, sponsor_seasons_left=$3 WHERE id=$4`,
      [offer.sponsor_name, finalValue, offer.length_seasons, teamId],
    );
    const season = await currentSeason(client);
    await addNews(client, 'sponsor', `New sponsorship: ${offer.sponsor_name} backs a club for ${offer.length_seasons} season(s) at $${finalValue.toLocaleString()}/season.`, season);
    return { accepted: true, value: finalValue };
  });
}

async function hireCoach(coachId, teamId) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM coaches WHERE id = $1', [coachId]);
    if (!rows.length) throw new Error('Coach not found.');
    if (rows[0].team_id) throw new Error('That coach is already contracted to a club.');
    await client.query('UPDATE coaches SET team_id = NULL WHERE team_id = $1', [teamId]);
    await client.query('UPDATE coaches SET team_id = $1 WHERE id = $2', [teamId, coachId]);
    await client.query('UPDATE teams SET coach_id = $1 WHERE id = $2', [coachId, teamId]);
    return rows[0];
  });
}

async function fireCoach(teamId) {
  return withTransaction(async (client) => {
    await client.query('UPDATE coaches SET team_id = NULL WHERE team_id = $1', [teamId]);
    await client.query('UPDATE teams SET coach_id = NULL WHERE id = $1', [teamId]);
  });
}

// Facility upgrade cost scales two ways:
//  - by tier: Elite clubs pay more per level than Rise, which pay more
//    than Foundation — roughly matching the 4:2:1 ratio of their auction
//    budgets, so upgrading stays a comparable proportion of a club's
//    financial firepower at every level.
//  - by level: cost doubles each level (exponential), so level 5 is far
//    more of a stretch than level 2, not a flat increment.
const TIER_FACILITY_BASE = { 1: 20_000_000, 2: 10_000_000, 3: 5_000_000 }; // tier_order -> base cost
const FACILITY_GROWTH_FACTOR = 2;

function facilityUpgradeCost(nextLevel, tierOrder = 3) {
  const base = TIER_FACILITY_BASE[tierOrder] ?? TIER_FACILITY_BASE[3];
  return Math.round(base * FACILITY_GROWTH_FACTOR ** (nextLevel - 2));
}

async function upgradeFacility(teamId, facility) {
  if (!['youth_level', 'medical_level'].includes(facility)) throw new Error('Unknown facility.');
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT t.*, s.tier_order FROM teams t LEFT JOIN stages s ON s.id = t.stage_id WHERE t.id = $1 FOR UPDATE OF t`, [teamId]);
    const team = rows[0];
    if (!team) throw new Error('Team not found.');
    const current = Number(team[facility]);
    if (current >= 5) throw new Error('Facility is already at the maximum level.');
    const cost = facilityUpgradeCost(current + 1, Number(team.tier_order) || 3);
    if (Number(team.budget) < cost) throw new Error(`Upgrade costs $${cost.toLocaleString()} — not enough budget.`);
    await client.query(`UPDATE teams SET ${facility} = $1, budget = budget - $2 WHERE id = $3`, [current + 1, cost, teamId]);
    const season = await currentSeason(client);
    await addNews(client, 'league', `${team.name} invest in their ${facility === 'youth_level' ? 'youth academy' : 'medical facilities'} (now level ${current + 1}).`, season);
    return { facility, level: current + 1, spent: cost };
  });
}

module.exports = {
  listPlayer, unlistPlayer, makeTransferOffer, respondTransferOffer, offerContract, releasePlayer,
  getOrCreateSponsorOffers, respondSponsorOffer, hireCoach, fireCoach, upgradeFacility, facilityUpgradeCost,
};
