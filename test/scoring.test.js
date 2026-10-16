import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStandings } from '../public/scoring.js';

const days = [1, 2, 3, 4, 5].map((num) => ({ num, location: '' }));
const classes = [
  { code: 'A', name: 'Unlimited', waivedDays: [3] },
  { code: 'R', name: 'DYO', waivedDays: [] },
];

// Class A, Sick Week 2026 day 5 results: [car, first, last, out, [rt, et, mph] per day 1,2,4,5]
const classA = [
  ['5', 'Nick', 'Cryer', 0, [[0.041, 7.435, 179.88], [0.011, 7.13, 193.24], [0.017, 7.007, 195.85], [0.037, 7.561, 198.58]]],
  ['10', 'Niklas', 'Linrin', 0, [[0.496, 6.303, 228.81], [0.49, 6.384, 224.47], [0.308, 6.814, 148.46], [0.536, 6.461, 224.28]]],
  ['266', 'Raj', 'Ahuja', 0, [[0.616, 8.914, 147.76], [0.422, 20.0, 50.0], [0.236, 8.817, 149.48], [0.183, 8.786, 150.41]]],
  ['3', 'Timothy', 'Blythe', 0, [[0.452, 7.331, 192.58], [0.288, 7.339, 195.17], [0.089, 7.283, 192.99], [0.257, 7.322, 193.52]]],
  ['1', 'Tom', 'Bailey', 1, [[0.15, 6.243, 164.89], [0.263, 6.728, 135.44]]],
];

function build(rows, classCode, dayList) {
  const entrants = [];
  const runs = [];
  rows.forEach(([car, first, last, out, results], i) => {
    const id = entrants.length + 1;
    entrants.push({ id, car_number: car, class_code: classCode, first_name: first, last_name: last, out, year: '', make: '', model: '', color: '' });
    results.forEach(([rt, et, mph], j) => runs.push({ entrant_id: id, day: dayList[j], rt, et, mph, penalty: et === 20 ? 1 : 0 }));
  });
  return { entrants, runs };
}

test('class A matches the published 2026 order and averages', () => {
  const { entrants, runs } = build(classA, 'A', [1, 2, 4, 5]);
  const [a] = computeStandings({ days, classes, entrants, runs });
  assert.deepEqual(
    a.rows.map((r) => [r.rank, r.lastName]),
    [[1, 'Linrin'], [2, 'Cryer'], [3, 'Blythe'], [4, 'Ahuja'], [null, 'Bailey']],
  );
  const linrin = a.rows[0];
  assert.equal(linrin.avgEt, 6.4905);
  assert.equal(linrin.avgRt, 0.4575);
  assert.equal(linrin.avgMph, 206.505);
  assert.equal(linrin.required, 4);
  assert.deepEqual(linrin.results[3], { waived: true });
  assert.equal(a.rows[2].avgEt, 7.31875);
});

test('mid-week: drivers with more counted days rank ahead', () => {
  const { entrants, runs } = build(
    [
      ['1', 'Fast', 'OneDay', 0, [[0.1, 9.0, 150]]],
      ['2', 'Slow', 'TwoDays', 0, [[0.1, 11.0, 120], [0.1, 11.0, 120]]],
      ['3', 'No', 'Times', 0, []],
    ],
    'R',
    [1, 2],
  );
  const [, r] = computeStandings({ days, classes, entrants, runs });
  assert.deepEqual(r.rows.map((x) => [x.rank, x.lastName, x.completed]), [[1, 'TwoDays', 2], [2, 'OneDay', 1], [null, 'Times', 0]]);
});

test('ties on ET break on higher MPH', () => {
  const { entrants, runs } = build(
    [
      ['1', 'A', 'Slower', 0, [[0.1, 10.0, 130]]],
      ['2', 'B', 'Faster', 0, [[0.1, 10.0, 131]]],
    ],
    'R',
    [1],
  );
  const [, r] = computeStandings({ days, classes, entrants, runs });
  assert.deepEqual(r.rows.map((x) => x.lastName), ['Faster', 'Slower']);
});

test('times on a waived day are ignored', () => {
  const { entrants, runs } = build([['1', 'A', 'B', 0, [[0.1, 10, 130], [0.1, 5, 200]]]], 'A', [1, 3]);
  const [a] = computeStandings({ days, classes, entrants, runs });
  assert.equal(a.rows[0].avgEt, 10);
  assert.equal(a.rows[0].completed, 1);
});
