// Reads the daily results spreadsheet (the sheet the published PDF is printed from) into rows for
// ls_import_results. Works on a plain 2-D array of cell values, so it doesn't care whether the
// file was .xlsx, .xls or .csv.
//
// Expected header row (column order doesn't matter, extra columns are ignored):
//   Car # | CC | Class | First Name | LastName | Out? | Year | Make | Model | Color |
//   RT - 1 | ET - 1 | MPH - 1 | RT - 2 | ... | Avg. R/T | Avg. ET | Avg. MPH
// "CC" is the class letter and "Class" its name. Without a CC column, the class letter is taken
// from the start of the Class cell ("A Unlimited" -> A).

const norm = (v) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const FIELDS = {
  car_number: ['car', 'carno', 'carnumber', 'number', 'no', 'num'],
  class_code: ['cc', 'classcode', 'code'],
  class_name: ['class', 'classname'],
  first_name: ['first', 'firstname', 'fname'],
  last_name: ['last', 'lastname', 'lname', 'surname'],
  out: ['out', 'dropped', 'dnf'],
  year: ['year', 'yr'],
  make: ['make'],
  model: ['model'],
  color: ['color', 'colour'],
};
const DAY_COL = /^(rt|et|mph)(\d{1,2})$/;

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = (rows[i] ?? []).map(norm);
    const hasName = cells.some((c) => FIELDS.first_name.includes(c) || FIELDS.last_name.includes(c));
    const hasDay = cells.some((c) => DAY_COL.test(c));
    if (hasName && hasDay) return i;
  }
  return -1;
}

const text = (v) => (v == null ? '' : String(v).trim());

function number(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  return Number(s);
}

const isWaiver = (v) => /waiv/i.test(String(v ?? ''));
const truthy = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s !== '' && !['no', 'n', 'false', '0', '-'].includes(s);
};

export function parseResultsSheet(rows) {
  const headerAt = findHeader(rows);
  if (headerAt < 0) {
    throw new Error('Could not find the header row. It needs First Name / LastName and RT - 1, ET - 1, MPH - 1 style columns.');
  }
  const header = rows[headerAt].map(norm);
  const col = {};
  for (const [field, names] of Object.entries(FIELDS)) {
    const i = header.findIndex((h) => names.includes(h) || (field === 'car_number' && /^car/.test(h)));
    if (i >= 0) col[field] = i;
  }
  // "Car #" sometimes sits across two header rows ("Car" above "#"); fall back to the first column.
  if (col.car_number == null) col.car_number = 0;
  if (col.class_code == null && col.class_name == null) throw new Error('No Class or CC column found.');

  const dayCols = {}; // day -> { rt, et, mph } column indexes
  header.forEach((h, i) => {
    const m = h.match(DAY_COL);
    if (!m) return;
    const day = Number(m[2]);
    (dayCols[day] ??= {})[m[1]] = i;
  });
  const days = Object.keys(dayCols).map(Number).sort((a, b) => a - b);

  // Track names usually sit in the row above the RT/ET/MPH headers.
  const dayLocations = {};
  const above = rows[headerAt - 1] ?? [];
  for (const d of days) {
    const cols = Object.values(dayCols[d]);
    const name = cols.map((i) => text(above[i])).find(Boolean);
    if (name) dayLocations[d] = name;
  }

  const entrants = [];
  const warnings = [];
  const seen = new Map();
  for (let r = headerAt + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (!row.some((c) => text(c) !== '')) continue;
    let car = text(row[col.car_number]).replace(/\.0+$/, '');
    let code = col.class_code != null ? text(row[col.class_code]).toUpperCase() : '';
    let name = col.class_name != null ? text(row[col.class_name]) : '';
    if (!code && name) {
      const m = name.match(/^([A-Z0-9]{1,4})\s+(.+)$/);
      if (m) [code, name] = [m[1], m[2]];
    }
    const first = col.first_name != null ? text(row[col.first_name]) : '';
    const last = col.last_name != null ? text(row[col.last_name]) : '';
    if (!car && !first && !last) continue; // spacer / totals row
    if (!car || !/^[A-Za-z0-9-]{1,8}$/.test(car)) {
      warnings.push(`Row ${r + 1}: skipped, no usable car number (${first} ${last})`.trim());
      continue;
    }
    if (!/^[A-Z0-9]{1,4}$/.test(code)) {
      warnings.push(`Row ${r + 1}: skipped car #${car}, no class letter`);
      continue;
    }
    if (seen.has(car)) warnings.push(`Car #${car} appears twice (rows ${seen.get(car)} and ${r + 1}); the later row wins`);
    seen.set(car, r + 1);

    const e = { car_number: car, class_code: code, class_name: name, runs: [] };
    for (const f of ['first_name', 'last_name', 'year', 'make', 'model', 'color']) {
      if (col[f] != null) e[f] = text(row[col[f]]).replace(/\.0+$/, '');
    }
    if (col.out != null) e.out = truthy(row[col.out]);

    for (const d of days) {
      const c = dayCols[d];
      const vals = ['rt', 'et', 'mph'].map((k) => (c[k] != null ? row[c[k]] : null));
      if (vals.some(isWaiver)) continue;
      const [rt, et, mph] = vals.map(number);
      if (et == null) {
        if (vals.some((v) => text(v) !== '')) warnings.push(`Car #${car} day ${d}: ET "${text(vals[1])}" isn't a number, skipped`);
        continue;
      }
      e.runs.push({ day: d, rt, et, mph });
    }
    entrants.push(e);
  }

  // Later duplicates win.
  const unique = [...new Map(entrants.map((e) => [e.car_number, e])).values()];
  const classes = [...new Set(unique.map((e) => e.class_code))].sort();
  return {
    entrants: unique,
    days,
    dayLocations,
    classes,
    runCount: unique.reduce((n, e) => n + e.runs.length, 0),
    outCount: unique.filter((e) => e.out).length,
    warnings,
  };
}
