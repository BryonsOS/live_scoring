// Small RFC 4180-style CSV reader/writer (quoted fields, embedded commas/quotes/newlines).

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',' || ch === '\t') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// Accepts loose header names ("Car #", "First Name", "Class") and maps them to entrant fields.
const HEADER_ALIASES = {
  car_number: ['car', 'car #', 'car#', 'car number', 'car no', 'number', '#', 'car_number'],
  class_code: ['class', 'cc', 'class code', 'class_code'],
  first_name: ['first', 'first name', 'firstname', 'first_name'],
  last_name: ['last', 'last name', 'lastname', 'last_name'],
  year: ['year'],
  make: ['make'],
  model: ['model'],
  color: ['color', 'colour'],
};

export function csvToEntrants(text) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one entrant');
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const index = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const i = header.findIndex((h) => aliases.includes(h));
    if (i >= 0) index[field] = i;
  }
  if (index.car_number == null || index.class_code == null) {
    throw new Error('CSV header must include at least "Car #" and "Class" columns');
  }
  return rows.slice(1).map((r) => {
    const e = {};
    for (const [field, i] of Object.entries(index)) e[field] = (r[i] ?? '').trim();
    return e;
  });
}

export function toCsv(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
}

// Standings export laid out like the published results sheet.
export function standingsToCsv(days, standings) {
  const head = ['Place', 'Car #', 'Class', 'Class Name', 'First Name', 'Last Name', 'Out', 'Year', 'Make', 'Model', 'Color'];
  for (const d of days) head.push(`RT - ${d.num}`, `ET - ${d.num}`, `MPH - ${d.num}`);
  head.push('Avg. R/T', 'Avg. ET', 'Avg. MPH');
  const rows = [head];
  for (const cls of standings) {
    for (const r of cls.rows) {
      const line = [r.rank ?? '', r.carNumber, cls.code, cls.name, r.firstName, r.lastName, r.out ? 'Y' : '', r.year, r.make, r.model, r.color];
      for (const d of days) {
        const x = r.results[d.num];
        if (x?.waived) line.push('Waiver', 'Waiver', 'Waiver');
        else if (x) line.push(x.rt?.toFixed(3) ?? '', x.et?.toFixed(3) ?? '', x.mph?.toFixed(2) ?? '');
        else line.push('', '', '');
      }
      line.push(r.avgRt ?? '', r.avgEt ?? '', r.avgMph ?? '');
      rows.push(line);
    }
  }
  return toCsv(rows);
}
