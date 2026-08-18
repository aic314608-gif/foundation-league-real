const { pool, withTransaction, bulkInsert } = require('../db');
const { buildWorld } = require('../engine/worldGen');
const { buildStageFixtures } = require('../engine/fixtures');
const { runDevelopmentCycle, runRetirementCheck, generateYouthIntake } = require('../engine/development');
const { applySeasonChemistry } = require('./chemistry');
const { seasonPrizeMoney } = require('../engine/economy');
const { calculateOverall, CATEGORY_SUBS } = require('../engine/attributes');

const STAT_COLUMNS = [...Object.keys(CATEGORY_SUBS), ...Object.values(CATEGORY_SUBS).flat()];

const PLAYER_COLUMNS = [
  'team_id', 'name', 'age', 'position', 'secondary_position', 'nationality', 'squad_number',
  ...STAT_COLUMNS,
  'potential', 'star_rating', 'development_rate', 'form', 'fitness', 'morale', 'injury_status',
  'is_star', 'is_youth_product', 'wage', 'contract_seasons_left', 'market_value',
  'playstyle', 'formation_fit',
];

async function persistPlayerStats(client, player) {
  const sets = STAT_COLUMNS.map((c, i) => `${c} = $${i + 1}`).join(', ');
  const values = STAT_COLUMNS.map((c) => player[c]);
  values.push(player.id);
  await client.query(`UPDATE players SET ${sets} WHERE id = $${STAT_COLUMNS.length + 1}`, values);
}

async function addNews(client, category, text, season = null) {
  await client.query('INSERT INTO news_items (season, category, text) VALUES ($1,$2,$3)', [season, category, text]);
}

/** Nuclear option: wipes every game table and rebuilds a brand new world
 * (blank teams + a fresh free-agent pool + coaches). User accounts are kept
 * but every manager claim is cleared since the teams they owned no longer
 * exist. */
async function resetFullWorld() {
  return withTransaction(async (client) => {
    await client.query(`TRUNCATE news_items, retirements, season_history, sponsor_offers,
      contract_offers, transfer_offers, auctions, matches, players, coaches, teams, stages
      RESTART IDENTITY CASCADE`);
    await client.query(`UPDATE users SET role = 'viewer', team_id = NULL WHERE role != 'admin'`);
    await client.query(`UPDATE users SET team_id = NULL`);

    const world = buildWorld();

    const stageRows = await bulkInsert(client, 'stages',
      ['name', 'tier_order', 'season', 'promotion_spots', 'relegation_spots'],
      world.stages, { returning: 'id' });

    const teamsWithStage = world.teams.map((t, i) => ({
      ...t,
      stage_id: stageRows[t.__tierIndex].id,
    }));
    const teamRows = await bulkInsert(client, 'teams',
      ['stage_id', 'name', 'short_name', 'color', 'stadium_name', 'formation', 'mentality', 'budget', 'youth_level',
        'youth_coach_name', 'medical_staff_name'],
      teamsWithStage, { returning: 'id' });

    const coachRows = await bulkInsert(client, 'coaches',
      ['name', 'specialty', 'rating', 'wage', 'team_id', 'playstyle', 'formation_fit'],
      world.coaches.map((c) => ({ ...c, team_id: null })), { returning: 'id' });

    await bulkInsert(client, 'players', PLAYER_COLUMNS,
      world.freeAgents.map((p) => ({ ...p, team_id: null })));

    await client.query(`INSERT INTO auctions (season, status) VALUES (1, 'idle')`);
    await addNews(client, 'league', 'The league has been reset. 24 clubs are ready and the free-agent pool is open — kick things off with the season auction.', 1);

    return { stages: stageRows.length, teams: teamRows.length, players: world.freeAgents.length, coaches: coachRows.length };
  });
}

/** Lighter reset: clears this season's results/fixtures and zeroes team
 * season stats, but keeps every squad, contract, and financial exactly as
 * it is. Useful for "we made a mistake, replay the season." */
async function resetCurrentSeason(homeAndAway = true) {
  return withTransaction(async (client) => {
    const { rows: stages } = await client.query('SELECT * FROM stages ORDER BY tier_order');
    const season = stages[0]?.season || 1;
    await client.query('DELETE FROM matches WHERE season = $1', [season]);
    await client.query(`UPDATE teams SET wins=0, draws=0, losses=0, points=0, goals_for=0, goals_against=0, form='{}'`);
    for (const stage of stages) {
      await generateFixtures(client, stage.id, season, homeAndAway);
    }
    await addNews(client, 'league', `Season ${season} was reset — fresh fixtures, same squads.`, season);
    return { season };
  });
}

async function generateFixtures(client, stageId, season, homeAndAway = true) {
  const { rows: teams } = await client.query('SELECT id FROM teams WHERE stage_id = $1', [stageId]);
  if (teams.length < 2) return [];
  await client.query('DELETE FROM matches WHERE stage_id = $1 AND season = $2 AND status = $3', [stageId, season, 'scheduled']);
  const fixtures = buildStageFixtures(teams.map((t) => t.id), { homeAndAway });
  if (!fixtures.length) return [];
  const rows = fixtures.map((f) => ({
    stage_id: stageId, season, matchday: f.matchday, home_team_id: f.homeTeamId, away_team_id: f.awayTeamId, status: 'scheduled',
  }));
  return bulkInsert(client, 'matches', ['stage_id', 'season', 'matchday', 'home_team_id', 'away_team_id', 'status'], rows);
}

async function generateFixturesForStage(stageId, homeAndAway = true) {
  return withTransaction(async (client) => {
    const { rows } = await client.query('SELECT season FROM stages WHERE id = $1', [stageId]);
    if (!rows.length) throw new Error('Stage not found');
    return generateFixtures(client, stageId, rows[0].season, homeAndAway);
  });
}

/** Twice-a-season development pass without any season rollover — this is
 * the standalone "run development cycle" admin action. */
async function runMidSeasonDevelopment() {
  return withTransaction(async (client) => {
    const { rows: players } = await client.query(
      `SELECT p.*, COALESCE(t.youth_level, 1) AS team_youth_level
       FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE p.retired = false`);
    const facilityBonusFor = (p) => (Number(p.team_youth_level || 1) - 1) * 0.06;
    const notable = runDevelopmentCycle(players, facilityBonusFor);
    for (const player of players) {
      if (player.card_type) continue;
      await persistPlayerStats(client, player);
    }
    const { rows: stageRows } = await client.query('SELECT season FROM stages ORDER BY tier_order LIMIT 1');
    const season = stageRows[0]?.season || 1;
    if (notable.length) {
      const top = notable.slice(0, 5).map((n) => `${n.player.name} ${n.summary}`).join('; ');
      await addNews(client, 'development', `Development report: ${top}.`, season);
    }
    return { playersProcessed: players.length, notable: notable.slice(0, 20).map((n) => ({ id: n.player.id, name: n.player.name, before: n.before, after: n.after, summary: n.summary })) };
  });
}

/** Full end-of-season rollover: finalize standings -> pay prize money and
 * settle wages/sponsors -> promotion & relegation -> development cycle ->
 * retirements -> youth intake -> reset stats -> bump season -> new
 * fixtures. This is the main "advance the league" admin action. */
async function advanceSeason({ homeAndAway = true } = {}) {
  return withTransaction(async (client) => {
    const { rows: stages } = await client.query('SELECT * FROM stages ORDER BY tier_order');
    if (!stages.length) throw new Error('No stages found — reset the league first.');
    const season = stages[0].season;
    const nextSeason = season + 1;

    const stageHistory = [];
    const promotions = new Map(); // teamId -> new stageId
    const stageTeams = new Map(); // stageId -> ordered team rows

    for (const stage of stages) {
      const { rows: teams } = await client.query(
        `SELECT * FROM teams WHERE stage_id = $1
         ORDER BY points DESC, (goals_for - goals_against) DESC, goals_for DESC`, [stage.id]);
      stageTeams.set(stage.id, teams);

      // Prize money + wage/sponsor settlement, tied to this stage's tier.
      for (let i = 0; i < teams.length; i++) {
        const team = teams[i];
        const prize = seasonPrizeMoney(stage.tier_order, i + 1, teams.length);
        const { rows: wageRows } = await client.query(
          `SELECT COALESCE(SUM(wage),0) AS total FROM players WHERE team_id = $1 AND retired = false`, [team.id]);
        const { rows: coachRows } = await client.query(`SELECT wage FROM coaches WHERE team_id = $1`, [team.id]);
        const wageBill = Number(wageRows[0].total) + (coachRows[0]?.wage ? Number(coachRows[0].wage) : 0);

        let sponsorIncome = 0;
        let sponsorSeasonsLeft = team.sponsor_seasons_left;
        if (sponsorSeasonsLeft > 0) {
          sponsorIncome = Number(team.sponsor_value);
          sponsorSeasonsLeft -= 1;
        }
        const netChange = prize + sponsorIncome - wageBill;
        const newBudget = Number(team.budget) + netChange;

        await client.query(
          `UPDATE teams SET budget = $1, sponsor_seasons_left = $2,
           sponsor_name = CASE WHEN $2 <= 0 THEN NULL ELSE sponsor_name END,
           sponsor_value = CASE WHEN $2 <= 0 THEN 0 ELSE sponsor_value END
           WHERE id = $3`,
          [newBudget, sponsorSeasonsLeft, team.id],
        );
      }

      stageHistory.push({
        season, stage_name: stage.name,
        champion: teams[0]?.name || null,
        promoted: [], relegated: [],
      });
    }

    // Promotion / relegation between consecutive tiers.
    for (let i = 0; i < stages.length - 1; i++) {
      const upper = stages[i];
      const lower = stages[i + 1];
      const upperTeams = stageTeams.get(upper.id);
      const lowerTeams = stageTeams.get(lower.id);
      const relegateCount = upper.relegation_spots;
      const promoteCount = lower.promotion_spots;
      const n = Math.min(relegateCount, promoteCount, upperTeams.length, lowerTeams.length);

      const relegated = upperTeams.slice(-n);
      const promoted = lowerTeams.slice(0, n);
      for (const team of relegated) {
        await client.query('UPDATE teams SET stage_id = $1 WHERE id = $2', [lower.id, team.id]);
      }
      for (const team of promoted) {
        await client.query('UPDATE teams SET stage_id = $1 WHERE id = $2', [upper.id, team.id]);
      }
      stageHistory[i].relegated = relegated.map((t) => t.name);
      stageHistory[i + 1].promoted = promoted.map((t) => t.name);

      // Promotion lifts morale league-wide, relegation dents it — this is
      // what makes "which stage a team finishes in" bite beyond the table.
      if (relegated.length) {
        await client.query(`UPDATE players SET morale = GREATEST(10, morale - 15) WHERE team_id = ANY($1)`, [relegated.map((t) => t.id)]);
      }
      if (promoted.length) {
        await client.query(`UPDATE players SET morale = LEAST(99, morale + 15) WHERE team_id = ANY($1)`, [promoted.map((t) => t.id)]);
      }
    }

    for (const h of stageHistory) {
      await client.query(
        `INSERT INTO season_history (season, stage_name, champion, promoted, relegated) VALUES ($1,$2,$3,$4,$5)`,
        [h.season, h.stage_name, h.champion, h.promoted, h.relegated],
      );
      if (h.champion) await addNews(client, 'league', `${h.champion} are champions of ${h.stage_name} for Season ${h.season}!`, h.season);
      if (h.promoted.length) await addNews(client, 'league', `Promoted to ${h.stage_name}: ${h.promoted.join(', ')}.`, h.season);
      if (h.relegated.length) await addNews(client, 'league', `Relegated from ${h.stage_name}: ${h.relegated.join(', ')}.`, h.season);
    }

    // Development cycle (2nd of the season) + retirement + youth intake.
    const { rows: allPlayers } = await client.query(
      `SELECT p.*, COALESCE(t.youth_level, 1) AS team_youth_level
       FROM players p LEFT JOIN teams t ON t.id = p.team_id WHERE p.retired = false`);
    const facilityBonusFor = (p) => (Number(p.team_youth_level || 1) - 1) * 0.06;
    runDevelopmentCycle(allPlayers, facilityBonusFor);
    const retirees = runRetirementCheck(allPlayers, nextSeason);
    const retireeIds = new Set(retirees.map((r) => r.id));

    for (const player of allPlayers) {
      if (retireeIds.has(player.id) || player.card_type) continue;
      await persistPlayerStats(client, player);
      await client.query(
        `UPDATE players SET age = age + 1, fitness = 100, contract_seasons_left = GREATEST(0, contract_seasons_left - 1) WHERE id = $1`,
        [player.id],
      );
    }
    for (const r of retirees) {
      const overall = Math.round(calculateOverall(r));
      await client.query(
        `UPDATE players SET retired = true, retired_season = $1, team_id = NULL, age = age + 1 WHERE id = $2`,
        [nextSeason, r.id],
      );
      await client.query(
        `INSERT INTO retirements (season, player_name, team_name, age, final_overall, position, goals, appearances)
         SELECT $1, $2, t.name, $3, $4, $5, p.goals, p.appearances FROM players p LEFT JOIN teams t ON t.id = $6 WHERE p.id = $6`,
        [nextSeason, r.name, r.age + 1, overall, r.position, r.id],
      );
    }
    if (retirees.length) {
      await addNews(client, 'retirement', `${retirees.length} player(s) called time on their careers this off-season, including ${retirees.slice(0, 3).map((r) => r.name).join(', ')}.`, nextSeason);
    }

    // Youth intake — 1 to 5 graduates per team depending on academy level,
    // quality scaled by both academy level and the club's current tier.
    const { rows: teams } = await client.query(
      `SELECT t.*, s.tier_order FROM teams t JOIN stages s ON s.id = t.stage_id`);
    let youthTotal = 0;
    for (const team of teams) {
      const graduates = generateYouthIntake(team);
      await bulkInsert(client, 'players', PLAYER_COLUMNS, graduates.map((p) => ({ ...p, team_id: team.id })));
      youthTotal += graduates.length;
    }
    await addNews(client, 'youth', `Academies across the league graduated ${youthTotal} new prospects for Season ${nextSeason}.`, nextSeason);

    // Squadmates who stuck together this season build chemistry.
    await applySeasonChemistry(client);

    // Reset season stats and bump season counters.
    await client.query(`UPDATE teams SET wins=0, draws=0, losses=0, points=0, goals_for=0, goals_against=0, form='{}'`);
    await client.query('UPDATE stages SET season = $1', [nextSeason]);

    for (const stage of stages) {
      await generateFixtures(client, stage.id, nextSeason, homeAndAway);
    }

    return { season: nextSeason, stageHistory, retirees: retirees.length, youthGraduates: youthTotal };
  });
}

module.exports = {
  resetFullWorld, resetCurrentSeason, generateFixtures, generateFixturesForStage,
  runMidSeasonDevelopment, advanceSeason, addNews,
};
