const { pool, withTransaction } = require('../db');
const { canTeamHoldCardType, CARD_TYPE_LABEL } = require('../engine/marquee');
const { calculateOverall, recomputeCategories, CATEGORY_SUBS } = require('../engine/attributes');
const { addNews } = require('./leagueOps');

async function requestMarquee(teamId, cardType) {
  return withTransaction(async (client) => {
    const check = await canTeamHoldCardType(client, teamId, cardType);
    if (!check.ok) throw new Error(check.reason);
    const { rows: existing } = await client.query(
      `SELECT id FROM marquee_requests WHERE team_id=$1 AND card_type=$2 AND status='pending'`, [teamId, cardType]);
    if (existing.length) throw new Error('A request for this slot is already pending.');
    const { rows } = await client.query(
      `INSERT INTO marquee_requests (team_id, card_type) VALUES ($1,$2) RETURNING *`, [teamId, cardType]);
    return rows[0];
  });
}

async function listMarqueeRequests(status = 'pending') {
  const { rows } = await pool.query(
    `SELECT r.*, t.name AS team_name FROM marquee_requests r JOIN teams t ON t.id = r.team_id
     WHERE r.status = $1 ORDER BY r.created_at ASC`, [status]);
  return rows;
}

async function dismissRequest(requestId) {
  const { rows } = await pool.query(`UPDATE marquee_requests SET status='dismissed' WHERE id=$1 RETURNING *`, [requestId]);
  if (!rows.length) throw new Error('Request not found.');
  return rows[0];
}

/**
 * Admin creates a marquee player by hand: full name + position + every
 * stat + wage are supplied directly. `stats` may give either full
 * sub-attributes (e.g. shoot_finishing, pass_vision, ...) for real
 * drill-down detail, or just the six flat categories as a shortcut —
 * whichever sub-attributes are missing are filled in at the category
 * value so the numbers stay consistent either way. Optionally fulfills a
 * pending request. Validates tier eligibility and the 1-per-type cap.
 */
async function createMarqueePlayer({ teamId, cardType, requestId, name, position, age, nationality, stats, wage }) {
  return withTransaction(async (client) => {
    const check = await canTeamHoldCardType(client, teamId, cardType);
    if (!check.ok) throw new Error(check.reason);

    const player = {
      name, position, age: age || 27, nationality: nationality || 'Unknown', secondary_position: null,
      squad_number: null, potential: null, star_rating: null, development_rate: 0, form: 80, fitness: 100,
      morale: 90, injury_status: 'Healthy', is_star: true, is_youth_product: false, card_type: cardType,
      contract_seasons_left: 99, wage: wage || 0,
    };
    for (const [category, subs] of Object.entries(CATEGORY_SUBS)) {
      const categoryDefault = stats[category] ?? (category === 'goalkeeping' && position !== 'GK' ? 10 : 50);
      for (const sub of subs) player[sub] = stats[sub] ?? categoryDefault;
    }
    recomputeCategories(player);
    player.potential = Math.round(calculateOverall(player));
    player.star_rating = 5.0;
    player.market_value = 0; // never transferred, so no market value

    const subColumns = Object.values(CATEGORY_SUBS).flat();
    const columns = ['team_id', 'name', 'age', 'position', 'secondary_position', 'nationality', 'squad_number',
      'pace', 'shooting', 'passing', 'dribbling', 'defending', 'physical', 'goalkeeping', ...subColumns,
      'potential', 'star_rating', 'development_rate', 'form', 'fitness', 'morale', 'injury_status', 'is_star',
      'is_youth_product', 'card_type', 'contract_seasons_left', 'wage', 'market_value'];
    const values = columns.map((c) => (c === 'team_id' ? teamId : player[c]));
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await client.query(
      `INSERT INTO players (${columns.join(', ')}) VALUES (${placeholders}) RETURNING *`, values);

    if (requestId) {
      await client.query(`UPDATE marquee_requests SET status='fulfilled' WHERE id=$1`, [requestId]);
    }
    const { rows: teamRows } = await client.query('SELECT name FROM teams WHERE id=$1', [teamId]);
    await addNews(client, 'transfer', `${teamRows[0]?.name} unveil ${CARD_TYPE_LABEL[cardType]} signing: ${name}!`);
    return rows[0];
  });
}

module.exports = { requestMarquee, listMarqueeRequests, dismissRequest, createMarqueePlayer };
