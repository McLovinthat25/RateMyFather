// Region grouping and area-level ZIP lookup.
// ZIP search is AREA-LEVEL ONLY: a 5-digit ZIP resolves via its 3-digit prefix to a
// city/state area. Results are labelled "area-level" and are never exact-ZIP matches,
// except for user-added profiles that carry an exact ZIP (matched separately in server.js).
// Directory profiles carry no ZIP, so they can only ever appear via area-level search.

const REGIONS = {
  Northeast: ['CT', 'ME', 'MA', 'NH', 'RI', 'VT', 'NJ', 'NY', 'PA'],
  Midwest: ['IL', 'IN', 'MI', 'OH', 'WI', 'IA', 'KS', 'MN', 'MO', 'NE', 'ND', 'SD'],
  South: ['DE', 'FL', 'GA', 'MD', 'NC', 'SC', 'VA', 'DC', 'WV', 'AL', 'KY', 'MS', 'TN', 'AR', 'LA', 'OK', 'TX'],
  West: ['AZ', 'CO', 'ID', 'MT', 'NV', 'NM', 'UT', 'WY', 'AK', 'CA', 'HI', 'OR', 'WA'],
};

function regionOf(state) {
  if (!state) return 'Other listings';
  const s = String(state).toUpperCase();
  for (const [region, states] of Object.entries(REGIONS)) {
    if (states.includes(s)) return region;
  }
  return 'Other listings';
}

// 3-digit ZIP prefix -> { city, state }. Covers major metro prefixes; unknown prefixes
// return null and the UI says so plainly instead of guessing an area.
const ZIP_PREFIX_AREAS = {
  '100': { city: 'New York', state: 'NY' }, '101': { city: 'New York', state: 'NY' },
  '102': { city: 'New York', state: 'NY' }, '103': { city: 'Staten Island', state: 'NY' },
  '104': { city: 'Bronx', state: 'NY' }, '110': { city: 'Queens', state: 'NY' },
  '111': { city: 'Long Island City', state: 'NY' }, '112': { city: 'Brooklyn', state: 'NY' },
  '115': { city: 'Hempstead', state: 'NY' }, '117': { city: 'Long Island', state: 'NY' },
  '120': { city: 'Albany', state: 'NY' }, '122': { city: 'Albany', state: 'NY' },
  '130': { city: 'Syracuse', state: 'NY' }, '132': { city: 'Syracuse', state: 'NY' },
  '140': { city: 'Buffalo', state: 'NY' }, '142': { city: 'Buffalo', state: 'NY' },
  '146': { city: 'Rochester', state: 'NY' }, '150': { city: 'Pittsburgh', state: 'PA' },
  '152': { city: 'Pittsburgh', state: 'PA' }, '165': { city: 'Erie', state: 'PA' },
  '170': { city: 'Harrisburg', state: 'PA' }, '171': { city: 'Harrisburg', state: 'PA' },
  '180': { city: 'Allentown', state: 'PA' }, '181': { city: 'Allentown', state: 'PA' },
  '190': { city: 'Philadelphia', state: 'PA' }, '191': { city: 'Philadelphia', state: 'PA' },
  '193': { city: 'West Chester', state: 'PA' }, '196': { city: 'Reading', state: 'PA' },
  '200': { city: 'Washington', state: 'DC' }, '201': { city: 'Arlington', state: 'VA' },
  '208': { city: 'Bethesda', state: 'MD' }, '210': { city: 'Baltimore', state: 'MD' },
  '212': { city: 'Baltimore', state: 'MD' }, '220': { city: 'Alexandria', state: 'VA' },
  '230': { city: 'Richmond', state: 'VA' }, '232': { city: 'Richmond', state: 'VA' },
  '270': { city: 'Charlotte', state: 'NC' }, '272': { city: 'Greensboro', state: 'NC' },
  '276': { city: 'Raleigh', state: 'NC' }, '280': { city: 'Charlotte', state: 'NC' },
  '282': { city: 'Charlotte', state: 'NC' }, '290': { city: 'Columbia', state: 'SC' },
  '294': { city: 'Charleston', state: 'SC' }, '300': { city: 'Atlanta', state: 'GA' },
  '303': { city: 'Atlanta', state: 'GA' }, '310': { city: 'Macon', state: 'GA' },
  '320': { city: 'Jacksonville', state: 'FL' }, '322': { city: 'Jacksonville', state: 'FL' },
  '330': { city: 'Miami', state: 'FL' }, '331': { city: 'Miami', state: 'FL' },
  '334': { city: 'West Palm Beach', state: 'FL' }, '336': { city: 'Tampa', state: 'FL' },
  '337': { city: 'St. Petersburg', state: 'FL' }, '328': { city: 'Orlando', state: 'FL' },
  '339': { city: 'Fort Myers', state: 'FL' }, '350': { city: 'Birmingham', state: 'AL' },
  '352': { city: 'Birmingham', state: 'AL' }, '370': { city: 'Nashville', state: 'TN' },
  '372': { city: 'Nashville', state: 'TN' }, '381': { city: 'Memphis', state: 'TN' },
  '400': { city: 'Louisville', state: 'KY' }, '402': { city: 'Louisville', state: 'KY' },
  '405': { city: 'Lexington', state: 'KY' }, '430': { city: 'Columbus', state: 'OH' },
  '432': { city: 'Columbus', state: 'OH' }, '440': { city: 'Cleveland', state: 'OH' },
  '441': { city: 'Cleveland', state: 'OH' }, '450': { city: 'Cincinnati', state: 'OH' },
  '452': { city: 'Cincinnati', state: 'OH' }, '454': { city: 'Dayton', state: 'OH' },
  '460': { city: 'Indianapolis', state: 'IN' }, '462': { city: 'Indianapolis', state: 'IN' },
  '480': { city: 'Detroit', state: 'MI' }, '482': { city: 'Detroit', state: 'MI' },
  '490': { city: 'Kalamazoo', state: 'MI' }, '495': { city: 'Grand Rapids', state: 'MI' },
  '500': { city: 'Des Moines', state: 'IA' }, '503': { city: 'Des Moines', state: 'IA' },
  '530': { city: 'Milwaukee', state: 'WI' }, '532': { city: 'Milwaukee', state: 'WI' },
  '537': { city: 'Madison', state: 'WI' }, '550': { city: 'St. Paul', state: 'MN' },
  '551': { city: 'St. Paul', state: 'MN' }, '554': { city: 'Minneapolis', state: 'MN' },
  '600': { city: 'Chicago', state: 'IL' }, '601': { city: 'Chicago', state: 'IL' },
  '602': { city: 'Evanston', state: 'IL' }, '606': { city: 'Chicago', state: 'IL' },
  '607': { city: 'Chicago', state: 'IL' }, '608': { city: 'Chicago', state: 'IL' },
  '620': { city: 'St. Louis', state: 'MO' }, '631': { city: 'St. Louis', state: 'MO' },
  '640': { city: 'Kansas City', state: 'MO' }, '641': { city: 'Kansas City', state: 'MO' },
  '660': { city: 'Kansas City', state: 'KS' }, '662': { city: 'Overland Park', state: 'KS' },
  '670': { city: 'Wichita', state: 'KS' }, '672': { city: 'Wichita', state: 'KS' },
  '680': { city: 'Omaha', state: 'NE' }, '681': { city: 'Omaha', state: 'NE' },
  '700': { city: 'New Orleans', state: 'LA' }, '701': { city: 'New Orleans', state: 'LA' },
  '705': { city: 'Lafayette', state: 'LA' }, '708': { city: 'Baton Rouge', state: 'LA' },
  '730': { city: 'Oklahoma City', state: 'OK' }, '731': { city: 'Oklahoma City', state: 'OK' },
  '740': { city: 'Tulsa', state: 'OK' }, '750': { city: 'Dallas', state: 'TX' },
  '752': { city: 'Dallas', state: 'TX' }, '760': { city: 'Fort Worth', state: 'TX' },
  '761': { city: 'Fort Worth', state: 'TX' }, '770': { city: 'Houston', state: 'TX' },
  '772': { city: 'Houston', state: 'TX' }, '782': { city: 'San Antonio', state: 'TX' },
  '787': { city: 'Austin', state: 'TX' }, '799': { city: 'El Paso', state: 'TX' },
  '800': { city: 'Denver', state: 'CO' }, '802': { city: 'Denver', state: 'CO' },
  '803': { city: 'Boulder', state: 'CO' }, '809': { city: 'Colorado Springs', state: 'CO' },
  '820': { city: 'Cheyenne', state: 'WY' }, '830': { city: 'Jackson', state: 'WY' },
  '840': { city: 'Salt Lake City', state: 'UT' }, '841': { city: 'Salt Lake City', state: 'UT' },
  '850': { city: 'Phoenix', state: 'AZ' }, '852': { city: 'Mesa', state: 'AZ' },
  '853': { city: 'Phoenix', state: 'AZ' }, '857': { city: 'Tucson', state: 'AZ' },
  '870': { city: 'Albuquerque', state: 'NM' }, '871': { city: 'Albuquerque', state: 'NM' },
  '880': { city: 'Las Cruces', state: 'NM' }, '890': { city: 'Las Vegas', state: 'NV' },
  '891': { city: 'Las Vegas', state: 'NV' }, '895': { city: 'Reno', state: 'NV' },
  '900': { city: 'Los Angeles', state: 'CA' }, '902': { city: 'Beverly Hills', state: 'CA' },
  '904': { city: 'Santa Monica', state: 'CA' }, '906': { city: 'Long Beach', state: 'CA' },
  '908': { city: 'Long Beach', state: 'CA' }, '911': { city: 'Pasadena', state: 'CA' },
  '920': { city: 'San Diego', state: 'CA' }, '921': { city: 'San Diego', state: 'CA' },
  '930': { city: 'Oxnard', state: 'CA' }, '931': { city: 'Santa Barbara', state: 'CA' },
  '934': { city: 'San Luis Obispo', state: 'CA' }, '937': { city: 'Fresno', state: 'CA' },
  '941': { city: 'San Francisco', state: 'CA' }, '943': { city: 'Palo Alto', state: 'CA' },
  '944': { city: 'San Mateo', state: 'CA' }, '945': { city: 'Oakland', state: 'CA' },
  '946': { city: 'Oakland', state: 'CA' }, '950': { city: 'San Jose', state: 'CA' },
  '951': { city: 'San Jose', state: 'CA' }, '952': { city: 'Stockton', state: 'CA' },
  '958': { city: 'Sacramento', state: 'CA' }, '960': { city: 'Redding', state: 'CA' },
  '970': { city: 'Portland', state: 'OR' }, '972': { city: 'Portland', state: 'OR' },
  '974': { city: 'Eugene', state: 'OR' }, '980': { city: 'Seattle', state: 'WA' },
  '981': { city: 'Seattle', state: 'WA' }, '983': { city: 'Tacoma', state: 'WA' },
  '984': { city: 'Tacoma', state: 'WA' }, '986': { city: 'Vancouver', state: 'WA' },
  '988': { city: 'Spokane', state: 'WA' }, '992': { city: 'Spokane', state: 'WA' },
  '995': { city: 'Anchorage', state: 'AK' }, '967': { city: 'Honolulu', state: 'HI' },
  '968': { city: 'Honolulu', state: 'HI' }, '006': { city: 'San Juan', state: 'PR' },
  '009': { city: 'San Juan', state: 'PR' },
};

function areaForZip(zip) {
  if (!/^\d{5}$/.test(String(zip || '').trim())) return null;
  return ZIP_PREFIX_AREAS[String(zip).trim().slice(0, 3)] || null;
}

module.exports = { REGIONS, regionOf, ZIP_PREFIX_AREAS, areaForZip };
