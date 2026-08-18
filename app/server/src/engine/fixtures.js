/**
 * Circle-method round robin: for N teams returns N-1 rounds, each with N/2
 * fixtures, so every team plays every other team exactly once. Alternates
 * which side of the fixed pairing is "home" round-to-round for fairness.
 */
function roundRobinRounds(teamIds) {
  let arr = [...teamIds];
  if (arr.length % 2 !== 0) arr.push(null); // bye if odd count
  const n = arr.length;
  const half = n / 2;
  const rounds = [];

  for (let round = 0; round < n - 1; round++) {
    const pairings = [];
    for (let i = 0; i < half; i++) {
      const a = arr[i];
      const b = arr[n - 1 - i];
      if (a !== null && b !== null) {
        pairings.push(round % 2 === 0 ? [a, b] : [b, a]);
      }
    }
    rounds.push(pairings);
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }
  return rounds;
}

/**
 * Builds the full matchday schedule for a stage's 8 teams.
 * Returns [{ matchday, homeTeamId, awayTeamId }, ...]
 */
function buildStageFixtures(teamIds, { homeAndAway = true } = {}) {
  const firstLeg = roundRobinRounds(teamIds);
  const rounds = homeAndAway
    ? [...firstLeg, ...firstLeg.map((r) => r.map(([a, b]) => [b, a]))]
    : firstLeg;

  const fixtures = [];
  rounds.forEach((pairings, idx) => {
    pairings.forEach(([home, away]) => {
      fixtures.push({ matchday: idx + 1, homeTeamId: home, awayTeamId: away });
    });
  });
  return fixtures;
}

module.exports = { roundRobinRounds, buildStageFixtures };
