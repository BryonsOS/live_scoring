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
