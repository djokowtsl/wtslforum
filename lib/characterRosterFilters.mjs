const filterFields = new Set([
  'acceleration',
  'style',
  'playing_hand',
  'forehand_type',
  'backhand_type',
  'country',
]);

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalize(value) {
  return clean(value).toLocaleLowerCase();
}

const countryCodes = `
AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ
EC EE EG EH ER ES ET
FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU
ID IE IL IM IN IO IQ IR IS IT
JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ
LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ
OM
PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA
RE RO RS RU RW
SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ
UA UG UM US UY UZ
VA VC VE VG VI VN VU
WF WS YE YT
ZA ZM ZW
XK
`.trim().split(/\s+/);
const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryNamesByCode = new Map(
  countryCodes.map((code) => [code, code === 'XK' ? 'Kosovo' : regionNames.of(code) || code]),
);
const countryCodesByName = new Map();
for (const [code, name] of countryNamesByCode) {
  countryCodesByName.set(normalize(code), code);
  countryCodesByName.set(normalize(name), code);
}
const allNationalityOptions = [...new Set(countryNamesByCode.values())].sort((first, second) =>
  first.localeCompare(second, undefined, { sensitivity: 'base' }),
);

function countryDisplayName(value) {
  const cleaned = clean(value);
  const code = countryCodesByName.get(normalize(cleaned));
  return code ? countryNamesByCode.get(code) : cleaned;
}

function normalizeCountry(value) {
  const normalized = normalize(value);
  return countryCodesByName.get(normalized) || normalized;
}

export function characterFilterOptions(metadata, field) {
  if (!filterFields.has(field)) return [];

  if (field === 'country') {
    const values = new Map(allNationalityOptions.map((name) => [normalize(name), name]));
    for (const row of metadata) {
      const value = clean(row?.country);
      if (!value) continue;
      const name = countryDisplayName(value);
      if (name) values.set(normalize(name), name);
    }
    return [...values.values()].sort((first, second) =>
      first.localeCompare(second, undefined, { sensitivity: 'base' }),
    );
  }

  const values = new Map();
  for (const row of metadata) {
    const value = clean(row?.[field]);
    const key = normalize(value);
    if (key && !values.has(key)) values.set(key, value);
  }

  return [...values.values()].sort((first, second) =>
    first.localeCompare(second, undefined, { sensitivity: 'base' }),
  );
}

export function filterCharacterNames(names, metadata, filters) {
  const activeFilters = Object.entries(filters)
    .filter(([field, value]) => filterFields.has(field) && normalize(value));
  if (!activeFilters.length) return names;

  const metadataByCharacter = new Map(
    metadata.map((row) => [normalize(row.character), row]),
  );
  return names.filter((name) => {
    const row = metadataByCharacter.get(normalize(name));
    return Boolean(row) && activeFilters.every(([field, value]) => {
      const normalizeValue = field === 'country' ? normalizeCountry : normalize;
      return normalizeValue(row[field]) === normalizeValue(value);
    });
  });
}
