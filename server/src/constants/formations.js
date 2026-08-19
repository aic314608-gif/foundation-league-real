// Formation library — each formation lists outfield slot counts by position.
// Ported/trimmed from the original bot's 45-formation library down to a
// curated set of real, distinct systems (still far more than "pick 4-4-2").
const FORMATIONS = {
  '4-4-2':           { GK: 1, CB: 2, LB: 1, RB: 1, LM: 1, RM: 1, CM: 2, ST: 2 },
  '4-4-2 Diamond':    { GK: 1, CB: 2, LB: 1, RB: 1, CDM: 1, CM: 2, CAM: 1, ST: 2 },
  '4-3-3':            { GK: 1, CB: 2, LB: 1, RB: 1, CM: 3, LW: 1, RW: 1, ST: 1 },
  '4-2-3-1':          { GK: 1, CB: 2, LB: 1, RB: 1, CDM: 2, CAM: 1, LM: 1, RM: 1, ST: 1 },
  '4-1-4-1':          { GK: 1, CB: 2, LB: 1, RB: 1, CDM: 1, LM: 1, RM: 1, CM: 2, ST: 1 },
  '3-4-3':            { GK: 1, CB: 3, LWB: 1, RWB: 1, CM: 2, LW: 1, RW: 1, ST: 1 },
  '3-5-2':            { GK: 1, CB: 3, LWB: 1, RWB: 1, CDM: 1, CM: 1, CAM: 1, ST: 2 },
  '3-4-2-1':          { GK: 1, CB: 3, LWB: 1, RWB: 1, CM: 2, CAM: 2, ST: 1 },
  '5-3-2':            { GK: 1, CB: 3, LWB: 1, RWB: 1, CM: 3, ST: 2 },
  '5-4-1':            { GK: 1, CB: 3, LWB: 1, RWB: 1, LM: 1, RM: 1, CM: 2, ST: 1 },
  '4-2-4':            { GK: 1, CB: 2, LB: 1, RB: 1, CM: 2, LW: 1, RW: 1, ST: 2 },
  '4-3-2-1':          { GK: 1, CB: 2, LB: 1, RB: 1, CM: 3, CAM: 2, ST: 1 },
  '4-5-1':            { GK: 1, CB: 2, LB: 1, RB: 1, LM: 1, RM: 1, CM: 3, ST: 1 },
  '5-2-3':            { GK: 1, CB: 3, LWB: 1, RWB: 1, CDM: 2, LW: 1, RW: 1, ST: 1 },
  '4-3-3 Attack':     { GK: 1, CB: 2, LB: 1, RB: 1, CM: 2, CAM: 1, LW: 1, RW: 1, ST: 1 },
  '4-3-3 Holding':    { GK: 1, CB: 2, LB: 1, RB: 1, CDM: 1, CM: 2, LW: 1, RW: 1, ST: 1 },
  '3-1-4-2':          { GK: 1, CB: 3, CDM: 1, LM: 1, RM: 1, CM: 2, ST: 2 },
  '4-1-2-3':          { GK: 1, CB: 2, LB: 1, RB: 1, CDM: 1, CM: 2, LW: 1, RW: 1, ST: 1 },
  '4-2-2-2':          { GK: 1, CB: 2, LB: 1, RB: 1, CDM: 2, CAM: 2, ST: 2 },
  'WM (2-3-5)':       { GK: 1, CB: 2, CM: 3, LW: 1, RW: 1, CF: 1, ST: 2 },
};

const FORMATION_NAMES = Object.keys(FORMATIONS);

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'CF', 'ST'];

const POSITION_FULL_NAME = {
  GK: 'Goalkeeper', CB: 'Center Back', LB: 'Left Back', RB: 'Right Back',
  LWB: 'Left Wing Back', RWB: 'Right Wing Back', CDM: 'Defensive Midfielder',
  CM: 'Central Midfielder', CAM: 'Attacking Midfielder', LM: 'Left Midfielder',
  RM: 'Right Midfielder', LW: 'Left Winger', RW: 'Right Winger',
  CF: 'Center Forward', ST: 'Striker',
};

const GOALKEEPER = 'GK';
const DEFENDER_POSITIONS = new Set(['CB', 'LB', 'RB', 'LWB', 'RWB']);
const MIDFIELDER_POSITIONS = new Set(['CDM', 'CM', 'CAM', 'LM', 'RM']);
const ATTACKER_POSITIONS = new Set(['LW', 'RW', 'CF', 'ST']);

const MENTALITIES = ['Attacking', 'Possession', 'Balanced', 'Counter Attack', 'High Press', 'Defensive', 'Park the Bus'];

function formationTotalPlayers(name) {
  const t = FORMATIONS[name];
  if (!t) return 0;
  return Object.values(t).reduce((a, b) => a + b, 0);
}

// Attack/defense bias derived from how many attacking vs defending slots a
// formation fields, relative to a 3-attacker / 4-defender baseline. Used as
// a small live multiplier when a manager changes formation mid-match.
function formationBias(name) {
  const t = FORMATIONS[name] || FORMATIONS['4-3-3'];
  let atk = 0, def = 0, mid = 0;
  for (const [pos, count] of Object.entries(t)) {
    if (ATTACKER_POSITIONS.has(pos)) atk += count;
    else if (DEFENDER_POSITIONS.has(pos)) def += count;
    else if (MIDFIELDER_POSITIONS.has(pos)) mid += count;
  }
  return {
    attack: 1 + (atk - 3) * 0.035 + (mid - 4) * 0.012,
    defense: 1 + (def - 4) * 0.035,
  };
}

module.exports = {
  FORMATIONS, FORMATION_NAMES, POSITIONS, POSITION_FULL_NAME, GOALKEEPER,
  DEFENDER_POSITIONS, MIDFIELDER_POSITIONS, ATTACKER_POSITIONS, MENTALITIES,
  formationTotalPlayers, formationBias,
};
