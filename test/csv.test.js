import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvToEntrants, parseCsv, standingsToCsv } from '../public/csv.js';

test('parses quoted fields and Excel tab-separated paste', () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""e"""\n1,2,3\n'), [['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  assert.deepEqual(parseCsv('Car #\tClass\r\n401\tA\r\n'), [['Car #', 'Class'], ['401', 'A']]);
});

test('maps loose headers to entrant fields', () => {
  const rows = csvToEntrants('CC,Car #,First Name,LastName,Year,Make,Model,Color\nA,10,Niklas,Linrin,1967,Pontiac,Firebird,Dark Grey\n');
  assert.deepEqual(rows, [
    { car_number: '10', class_code: 'A', first_name: 'Niklas', last_name: 'Linrin', year: '1967', make: 'Pontiac', model: 'Firebird', color: 'Dark Grey' },
  ]);
});

test('rejects a sheet without car # and class columns', () => {
  assert.throws(() => csvToEntrants('Name,Year\nBob,1970\n'), /Car #/);
});

test('standings export marks waivers and out drivers', () => {
  const days = [{ num: 1 }, { num: 2 }];
  const standings = [
    {
      code: 'A',
      name: 'Unlimited',
      rows: [
        { rank: 1, carNumber: '10', firstName: 'N', lastName: 'L', out: false, year: '1967', make: 'Pontiac', model: 'Firebird', color: 'Grey, dark',
          results: { 1: { rt: 0.496, et: 6.303, mph: 228.81 }, 2: { waived: true } }, avgRt: 0.496, avgEt: 6.303, avgMph: 228.81 },
        { rank: null, carNumber: '1', firstName: 'T', lastName: 'B', out: true, year: '', make: '', model: '', color: '',
          results: { 1: null, 2: { waived: true } }, avgRt: null, avgEt: null, avgMph: null },
      ],
    },
  ];
  const lines = standingsToCsv(days, standings).trim().split('\r\n');
  assert.equal(lines[1], '1,10,A,Unlimited,N,L,,1967,Pontiac,Firebird,"Grey, dark",0.496,6.303,228.81,Waiver,Waiver,Waiver,0.496,6.303,228.81');
  assert.equal(lines[2], ',1,A,Unlimited,T,B,Y,,,,,,,,Waiver,Waiver,Waiver,,,');
});
