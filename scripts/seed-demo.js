// Fills a database with made-up drivers and a few days of times so the pages can be tried out.
// Usage: DB_PATH=data/demo.db node scripts/seed-demo.js
import { openDb } from '../src/db.js';

const dbPath = process.env.DB_PATH ?? new URL('../data/demo.db', import.meta.url).pathname;
const store = openDb(dbPath);
const first = ['Alex', 'Jordan', 'Casey', 'Riley', 'Morgan', 'Taylor', 'Jamie', 'Drew', 'Sam', 'Pat', 'Chris', 'Robin'];
const last = ['Smith', 'Garcia', 'Nguyen', 'Brown', 'Lopez', 'Miller', 'Davis', 'Clark', 'Lewis', 'Walker', 'Young', 'King'];
const cars = [['1969', 'Chevrolet', 'Camaro'], ['1970', 'Dodge', 'Charger'], ['1987', 'Ford', 'Mustang'], ['1966', 'Chevrolet', 'Nova'], ['2004', 'GMC', 'Sierra'], ['1972', 'Plymouth', 'Duster']];
const colors = ['Black', 'Red', 'White', 'Blue', 'Orange', 'Grey'];
const base = { A: 7, C: 8.2, G: 11.5, N: 9, R: 11, S: 12 };
let rand = 42;
const rnd = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);

const rows = [];
let car = 100;
for (const [code, et] of Object.entries(base)) {
  for (let i = 0; i < 6; i++) {
    const [year, make, model] = cars[Math.floor(rnd() * cars.length)];
    rows.push({ car_number: String(car++), class_code: code, first_name: first[Math.floor(rnd() * 12)], last_name: last[Math.floor(rnd() * 12)], year, make, model, color: colors[Math.floor(rnd() * 6)], _et: et });
  }
}
store.importEntrants(rows);
for (const r of rows) {
  for (const day of [1, 2]) {
    if (rnd() < 0.08) store.saveRun({ carNumber: r.car_number, day, penalty: true });
    else {
      const et = r._et + rnd() * 2.5;
      store.saveRun({ carNumber: r.car_number, day, rt: (rnd() * 0.8).toFixed(3), et: et.toFixed(3), mph: (1350 / et).toFixed(2) });
    }
  }
}
console.log(`Demo data written to ${dbPath} (${rows.length} entrants, days 1-2 entered)`);
