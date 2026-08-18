// Name pools for world generation. Real clubs/managers/players now live in
// ./realWorld.js and are used by worldGen.js instead of the fictional
// FIRST_NAMES/LAST_NAMES/STAGE_TEAM_NAMES/STAR_TEMPLATES pools below.
// Those fictional pools are kept here (unused by worldGen) only as a
// fallback reference; STAGE_DEFAULT_NAMES, COACH_SPECIALTIES, and
// SPONSOR_NAMES are still actively used.

const FIRST_NAMES = [
  'James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles',
  'Leon', 'Cristian', 'Kalvin', 'Erik', 'Kevin', 'Mahmoud', 'Harold', 'Nemesio', 'Roberto', 'Karam',
  'Luka', 'Victor', 'Sadio', 'Rahim', 'Trenton', 'Philippe', 'Jack', 'Mason', 'Bukayo', 'Declan',
  'Marcus', 'Jaden', 'Gabriel', 'Bernardo', 'Ruben', 'Joao', 'Bruno', 'Diogo', 'Edrick', 'Alistair',
  'Nico', 'Rico', 'Fabio', 'Andres', 'Diego', 'Mateo', 'Pablo', 'Lucas', 'Enzo', 'Theo',
  'Malik', 'Idris', 'Kofi', 'Samuel', 'Junior', 'Elias', 'Noah', 'Felix', 'Oscar', 'Leo',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez',
  'Meslin', 'Rondaldi', 'Mbeppe', 'Halland', 'Debroeck', 'Salahin', 'Kaine', 'Junioro', 'Lewandowsky', 'Benzemar',
  'Modritch', 'van Dyk', 'Manet', 'Sterlingham', 'Alexrund', 'Fodenwick', 'Grealisham', 'Mountjoy', 'Sakamoto', 'Ricewood',
  'Rashforth', 'Sanchoe', 'Jesuson', 'Silvano', 'Diaznet', 'Cancelot', 'Fernandinho', 'Jotham', 'Mendrick', 'Beckerath',
  'Okafor', 'Adeyemi', 'Nakamura', 'Petrov', 'Kovac', 'Novak', 'Larsson', 'Eriksen', 'Hansen', 'Berg',
];

const NATIONALITIES = [
  'England', 'Spain', 'France', 'Germany', 'Italy', 'Brazil', 'Argentina', 'Portugal', 'Netherlands', 'Belgium',
  'Croatia', 'Uruguay', 'Senegal', 'Nigeria', 'Morocco', 'Japan', 'USA', 'Ghana', 'Poland', 'Denmark',
];

// Team names by stage (tier 1 = strongest, matches the source bot's
// "Elite" and "Rise" club pools, extended with a third tier).
const STAGE_TEAM_NAMES = [
  ['Manchester Union', 'Merseyside Reds', 'West London Blues', 'North London Gunners',
    'Sky Blue City', 'Northside Spurs', 'Magpies United', 'Villa Lions'],
  ['Toffee City', 'Yorkshire Whites', 'Fox City', 'Hammers United',
    'Wolverine Wanderers', 'Saints FC', 'Seagulls United', 'Eagles Palace'],
  ['Riverside Town', 'Harborview FC', 'Meadowbrook United', 'Ironbridge City',
    'Clifton Rovers', 'Ashford Athletic', 'Kingswood FC', 'Millbrook United'],
];

const STAGE_DEFAULT_NAMES = ['Elite Division', 'Rise Championship', 'Foundation League'];

const STADIUM_NAMES = [
  ['Old Trafford', 'Manchester'], ['Anfield', 'Liverpool'], ['Stamford Bridge', 'London'],
  ['Emirates Stadium', 'London'], ['Etihad Stadium', 'Manchester'], ['Northside Stadium', 'London'],
  ['St. James Park', 'Newcastle'], ['Villa Park', 'Birmingham'], ['Goodison Park', 'Liverpool'],
  ['Elland Road', 'Leeds'], ['King Power Stadium', 'Leicester'], ["St. Mary's Stadium", 'Southampton'],
  ['Molineux Stadium', 'Wolverhampton'], ['Amex Community Stadium', 'Brighton'], ['Selhurst Park', 'London'],
  ['Craven Cottage', 'London'], ['London Stadium', 'London'], ['Bramall Lane', 'Sheffield'],
  ['The City Ground', 'Nottingham'], ['Vitality Stadium', 'Bournemouth'], ['Riverside Arena', 'Middlesbrough'],
  ['Portman Road', 'Ipswich'], ['Carrow Road', 'Norwich'], ['Hillsborough', 'Sheffield'],
];

// Distinct crest colors so 24 teams stay visually distinguishable — kept
// separate from the app's own UI palette (tokens.css).
const TEAM_COLORS = [
  '#D6455D', '#2FBF71', '#4C9FE8', '#E8B84B', '#8E5CD9', '#E8703A',
  '#3FA7A0', '#C2467B', '#5B8C3A', '#3E6FD9', '#D98F3E', '#7A5CC0',
  '#B0374A', '#2E9E5B', '#3C88C2', '#C79A2E', '#6B4FA0', '#D65C2E',
  '#2E9E8C', '#A83F6B', '#4C7A2E', '#2F5FBF', '#BF7E2F', '#5C4FA0',
];

// A short set of hand-tuned "star" players who anchor each squad with a
// clear identity (fast winger, commanding center-back, etc.), same spirit
// as the source bot's REAL_PLAYER_TEMPLATES but purely fictional.
const STAR_TEMPLATES = [
  { name: 'A. Sonko', position: 'LB', stats: { pace: 95, shooting: 55, passing: 82, dribbling: 86, defending: 78, physical: 80 } },
  { name: 'T. Ashworth', position: 'RB', stats: { pace: 82, shooting: 60, passing: 92, dribbling: 78, defending: 75, physical: 74 } },
  { name: 'V. Draken', position: 'CB', stats: { pace: 70, shooting: 40, passing: 85, dribbling: 65, defending: 94, physical: 93 } },
  { name: 'K. Debroeck', position: 'CAM', stats: { pace: 78, shooting: 84, passing: 95, dribbling: 90, defending: 45, physical: 70 } },
  { name: 'N. Kanto', position: 'CDM', stats: { pace: 80, shooting: 55, passing: 84, dribbling: 75, defending: 94, physical: 90 } },
  { name: 'K. Mendez', position: 'ST', stats: { pace: 97, shooting: 92, passing: 65, dribbling: 91, defending: 25, physical: 78 } },
  { name: 'L. Marchetti', position: 'RW', stats: { pace: 91, shooting: 88, passing: 89, dribbling: 97, defending: 35, physical: 68 } },
  { name: 'E. Haavik', position: 'ST', stats: { pace: 87, shooting: 95, passing: 65, dribbling: 80, defending: 25, physical: 88 } },
  { name: 'A. Beckenrot', position: 'GK', stats: { pace: 50, shooting: 20, passing: 70, dribbling: 40, defending: 60, physical: 82, goalkeeping: 91 } },
  { name: 'M. Neurath', position: 'GK', stats: { pace: 48, shooting: 20, passing: 75, dribbling: 42, defending: 58, physical: 80, goalkeeping: 90 } },
  { name: 'M. Salahin', position: 'RW', stats: { pace: 93, shooting: 90, passing: 80, dribbling: 89, defending: 30, physical: 72 } },
  { name: 'H. Kaine', position: 'ST', stats: { pace: 78, shooting: 93, passing: 82, dribbling: 82, defending: 30, physical: 82 } },
  { name: 'V. Dijkhoff', position: 'CB', stats: { pace: 78, shooting: 45, passing: 86, dribbling: 68, defending: 92, physical: 90 } },
  { name: 'S. Mahne', position: 'LW', stats: { pace: 92, shooting: 85, passing: 78, dribbling: 88, defending: 35, physical: 74 } },
  { name: 'R. Sterlingham', position: 'LW', stats: { pace: 94, shooting: 82, passing: 76, dribbling: 87, defending: 30, physical: 70 } },
  { name: 'J. Belingram', position: 'CM', stats: { pace: 80, shooting: 84, passing: 88, dribbling: 85, defending: 78, physical: 85 } },
];

const COACH_FIRST_NAMES = [
  'Gerard', 'Marco', 'Antonio', 'Jurgen', 'Carlo', 'Diego', 'Frank', 'Hansi', 'Massimo', 'Rafael',
  'Otto', 'Didier', 'Arsene', 'Claudio', 'Mauricio', 'Unai', 'Erik', 'Roberto', 'Thiago', 'Nuno',
];
const COACH_LAST_NAMES = [
  'Alonzo', 'Ferretti', 'Kowalski', 'Brandt', 'Ancelotto', 'Silveira', 'Lambert', 'Voss', 'Conti', 'Marquez',
  'Reyes', 'Deschamp', 'Winger', 'Ranelli', 'Pochet', 'Emerson', 'Haaglund', 'Martina', 'Souza', 'Espirito',
];
const COACH_SPECIALTIES = ['Attacking', 'Defensive', 'Possession', 'Youth Development', 'Man-Management', 'Tactical'];

const SPONSOR_NAMES = [
  'GlobalBank Group', 'SkyView Media', 'Regional Partners Ltd', 'Volt Energy', 'Northstar Airlines',
  'Bluewave Telecom', 'Ironclad Insurance', 'Harborlight Brewing', 'Quantum Motors', 'Crestline Foods',
  'Apex Sportswear', 'Meridian Bank', 'Solaris Tech', 'Union Freight', 'Pinnacle Insurance', 'Cobalt Airlines',
];

// Only a handful of "Legend" (Icon-tier) players exist league-wide, so
// each gets a hand-authored identity rather than combinatoric naming.
const LEGEND_TEMPLATES = [
  { name: 'Roberto Vancetti', position: 'ST' },
  { name: 'Heinrich Dobrev', position: 'CB' },
  { name: 'Paulo Ferreira Neto', position: 'CAM' },
  { name: 'Aleksandar Kostic', position: 'CDM' },
  { name: 'Julio Bastida', position: 'RW' },
  { name: 'Werner Achterberg', position: 'GK' },
];

module.exports = {
  FIRST_NAMES, LAST_NAMES, NATIONALITIES, STAGE_TEAM_NAMES, STAGE_DEFAULT_NAMES,
  STADIUM_NAMES, TEAM_COLORS, STAR_TEMPLATES, COACH_FIRST_NAMES, COACH_LAST_NAMES,
  COACH_SPECIALTIES, SPONSOR_NAMES, LEGEND_TEMPLATES,
};
