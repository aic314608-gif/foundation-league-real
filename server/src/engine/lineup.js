const { FORMATIONS, DEFENDER_POSITIONS, MIDFIELDER_POSITIONS, ATTACKER_POSITIONS, GOALKEEPER } = require('../constants/formations');
const { calculateOverall } = require('./attributes');

function groupFor(position) {
  if (position === GOALKEEPER) return 'GK';
  if (DEFENDER_POSITIONS.has(position)) return 'DEF';
  if (MIDFIELDER_POSITIONS.has(position)) return 'MID';
  return 'ATT';
}

/**
 * Picks a starting XI (+ bench) for a formation from a pool of available
 * (fit, not-retired) players. Exact position match first, then same
 * positional group, then best-overall-available so a match is never
 * fielded short. Returns { lineup: [player,...], bench: [player,...] }
 * with the full player rows (not just ids) for convenience.
 */
function selectStartingXI(availablePlayers, formationName) {
  const template = { ...(FORMATIONS[formationName] || FORMATIONS['4-3-3']) };
  const pool = [...availablePlayers].sort((a, b) => calculateOverall(b) - calculateOverall(a));
  const selected = [];
  const selectedIds = new Set();

  const take = (predicate, count) => {
    if (count <= 0) return;
    const matches = pool.filter((p) => !selectedIds.has(p.id) && predicate(p));
    const chosen = matches.slice(0, count);
    for (const p of chosen) {
      selected.push(p);
      selectedIds.add(p.id);
    }
    return count - chosen.length;
  };

  // Pass 1: exact position match
  for (const [pos, count] of Object.entries(template)) {
    const remaining = take((p) => p.position === pos, count);
    template[pos] = remaining;
  }
  // Pass 2: same positional group (e.g. any midfielder for a CDM slot)
  for (const [pos, count] of Object.entries(template)) {
    if (count <= 0) continue;
    const group = groupFor(pos);
    const remaining = take((p) => groupFor(p.position) === group, count);
    template[pos] = remaining;
  }
  // Pass 3: graceful degradation — best remaining outfield players so we
  // never field fewer than 11 just because the squad lacks a specialist.
  const totalNeeded = Object.values(FORMATIONS[formationName] || FORMATIONS['4-3-3']).reduce((a, b) => a + b, 0);
  if (selected.length < totalNeeded) {
    const stillNeeded = totalNeeded - selected.length;
    const hasGK = selected.some((p) => p.position === GOALKEEPER);
    let fillPool = pool.filter((p) => !selectedIds.has(p.id));
    if (!hasGK) {
      const gk = fillPool.find((p) => p.position === GOALKEEPER);
      if (gk) {
        selected.push(gk);
        selectedIds.add(gk.id);
        fillPool = fillPool.filter((p) => p.id !== gk.id);
      }
    }
    for (const p of fillPool.slice(0, totalNeeded - selected.length)) {
      selected.push(p);
      selectedIds.add(p.id);
    }
  }

  const bench = pool.filter((p) => !selectedIds.has(p.id));
  return { lineup: selected, bench };
}

module.exports = { selectStartingXI, groupFor };
