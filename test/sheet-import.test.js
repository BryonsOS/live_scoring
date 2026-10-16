import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResultsSheet } from '../public/sheet-import.js';

// Same layout as the printed Sick Week results: track names above the RT/ET/MPH headers.
const header = ['Car #', 'CC', 'Class', 'First Name', 'LastName', 'Out?', 'Year', 'Make', 'Model', 'Color',
  'RT - 1', 'ET - 1', 'MPH - 1', 'RT - 2', 'ET - 2', 'MPH - 2', 'RT - 3', 'ET - 3', 'MPH - 3', 'Avg. R/T', 'Avg. ET', 'Avg. MPH'];
const tracks = [null, null, null, null, null, null, null, null, null, null, 'Gainesville, FL', null, null, 'Adel, GA', null, null, 'Bradenton, FL'];

test('reads drivers, times, waivers, out and track names', () => {
  const p = parseResultsSheet([
    ['Sick Week 2026 - Day 3'],
    tracks,
    header,
    [10, 'A', 'Unlimited', 'Niklas', 'Linrin', null, 1967, 'Pontiac', 'Firebird', 'Dark Grey', 0.496, 6.303, 228.81, '0.490', '6.384', '224.47', 'Waiver', 'Waiver', 'Waiver', 0.49, 6.34, 226],
    [1, 'A', 'Unlimited', 'Tom', 'Bailey', '✔', 1969, 'Chevrolet', 'Camaro', 'White/Orange', 0.15, 6.243, 164.89, null, null, null],
    [],
    [null, null, null, null, null, null, null, null, null, null, null, 'Totals'],
  ]);
  assert.deepEqual(p.days, [1, 2, 3]);
  assert.deepEqual(p.dayLocations, { 1: 'Gainesville, FL', 2: 'Adel, GA', 3: 'Bradenton, FL' });
  assert.equal(p.entrants.length, 2);
  const [n, t] = p.entrants;
  assert.equal(n.car_number, '10');
  assert.equal(n.class_code, 'A');
  assert.equal(n.year, '1967');
  assert.equal(n.out, false);
  assert.deepEqual(n.runs, [{ day: 1, rt: 0.496, et: 6.303, mph: 228.81 }, { day: 2, rt: 0.49, et: 6.384, mph: 224.47 }]);
  assert.equal(t.out, true);
  assert.deepEqual(t.runs.map((r) => r.day), [1]);
  assert.equal(p.runCount, 3);
  assert.deepEqual(p.warnings, []);
});

test('takes the class letter from "A Unlimited" when there is no CC column', () => {
  const p = parseResultsSheet([
    ['Car', 'Class', 'First', 'Last', 'RT-1', 'ET-1', 'MPH-1'],
    ['401', 'R DYO', 'Joshua', 'Chechak', '0.664', '7.760', '129.19'],
  ]);
  assert.equal(p.entrants[0].class_code, 'R');
  assert.equal(p.entrants[0].class_name, 'DYO');
  assert.equal(p.entrants[0].out, undefined, 'no Out column means leave it alone');
});

test('flags bad rows and duplicate cars instead of guessing', () => {
  const p = parseResultsSheet([
    header,
    [5, 'A', 'Unlimited', 'Nick', 'Cryer', null, 1933, 'Ford', 'Coupe', 'Black', 0.041, 'DNF', 179.88],
    [null, 'A', 'Unlimited', 'No', 'Number'],
    [5, 'A', 'Unlimited', 'Nick', 'Cryer', null, 1933, 'Ford', 'Coupe', 'Black', 0.041, 7.435, 179.88],
  ]);
  assert.equal(p.entrants.length, 1);
  assert.deepEqual(p.entrants[0].runs, [{ day: 1, rt: 0.041, et: 7.435, mph: 179.88 }]);
  assert.equal(p.warnings.length, 3);
  assert.match(p.warnings.join('\n'), /ET "DNF"/);
  assert.match(p.warnings.join('\n'), /no usable car number/);
  assert.match(p.warnings.join('\n'), /appears twice/);
});

test('rejects a sheet without the expected headers', () => {
  assert.throws(() => parseResultsSheet([['Name', 'Time'], ['Bob', 10]]), /header row/);
});

test('a day where a whole class is "Waiver" is reported as waived for that class (rain day)', () => {
  const p = parseResultsSheet([
    header,
    [10, 'A', 'Unlimited', 'N', 'L', null, 1967, 'P', 'F', 'G', 0.4, 6.3, 228, 0.4, 6.4, 224, 'Waiver', 'Waiver', 'Waiver'],
    [5, 'A', 'Unlimited', 'N', 'C', null, 1933, 'F', 'C', 'B', 0.1, 7.4, 179, null, null, null, 'Waiver', 'Waiver', 'Waiver'],
    [401, 'R', 'DYO', 'J', 'C', null, 1972, 'P', 'B', 'Y', 0.6, 7.7, 129, 0.6, 7.6, 177, 0.4, 7.5, 180],
  ]);
  assert.deepEqual(p.waivers.A, { waived: [3], run: [1, 2] });
  assert.deepEqual(p.waivers.R, { waived: [], run: [1, 2, 3] });
});

test('Sick 66 layout: ET/MPH only, 4-decimal ETs, "Canceled" rain day', () => {
  const p = parseResultsSheet([
    [null, null, null, null, null, null, null, null, null, null, 'Asbury, MO', null, 'Bonne Terre, MO', null, 'Havana, IL', null],
    ['Car #', 'CC', 'Class', 'First Name', 'Last Name', 'Out?', 'Year', 'Make', 'Model', 'Color', 'ET - 1', 'MPH - 1', 'ET - 2', 'MPH - 2', 'ET - 3', 'MPH - 3', 'Finals', 'Finals'],
    [31, 'A', 'A/Gas Gasser (1/8)', 'Phil', 'Haack', null, 1955, 'Chevrolet', 210, 'Blue', 6.2314, 110.57, 'Canceled', 'Canceled', 6.1, 112.52, 6.1657, 111.545],
    [183, 'B', 'B/Gas Gasser (1/8)', 'Jason', 'Linke', '✔', 1951, 'Ford', '4 Dr Sedan', 'Black', 9.1641, 78.56, 'Canceled', 'Canceled', null, null, null, null],
  ]);
  assert.deepEqual(p.warnings, []);
  assert.deepEqual(p.dayLocations, { 1: 'Asbury, MO', 2: 'Bonne Terre, MO', 3: 'Havana, IL' });
  assert.deepEqual(p.entrants[0].runs, [{ day: 1, rt: null, et: 6.2314, mph: 110.57 }, { day: 3, rt: null, et: 6.1, mph: 112.52 }]);
  assert.equal(p.entrants[0].model, '210');
  assert.equal(p.entrants[1].out, true);
  assert.deepEqual(p.waivers.A.waived, [2]);
  assert.deepEqual(p.waivers.B.waived, [2]);
});
