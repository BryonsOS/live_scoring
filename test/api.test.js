import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

let server;
let base;
let cookie = '';

async function call(method, path, body, { auth = true } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(auth && cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json, headers: res.headers };
}

before(async () => {
  server = createApp({ store: openDb(':memory:'), adminPassword: 'secret' });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeStreams();
  server.close();
});

test('admin routes need a login', async () => {
  assert.equal((await call('GET', '/api/admin/state')).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401);
  const ok = await call('POST', '/api/login', { password: 'secret' });
  assert.equal(ok.status, 200);
  cookie = ok.headers.get('set-cookie').split(';')[0];
  assert.equal((await call('GET', '/api/admin/state')).status, 200);
});

test('a forged cookie is rejected', async () => {
  const res = await fetch(`${base}/api/admin/state`, { headers: { Cookie: 'ls_admin=9999999999.forged' } });
  assert.equal(res.status, 401);
});

test('fresh database is seeded with Sick Week days and classes', async () => {
  const { json } = await call('GET', '/api/standings');
  assert.equal(json.days.length, 5);
  assert.equal(json.standings.find((c) => c.code === 'R').name, 'DYO');
  assert.deepEqual(json.standings.find((c) => c.code === 'A').waivedDays, [3]);
});

test('entering a time is pushed to stream listeners and reflected in standings', async () => {
  await call('POST', '/api/admin/entrants/import', {
    csv: 'Car #,Class,First Name,Last Name,Year,Make,Model,Color\n401,A,Joshua,Chechak,1972,Plymouth,Barracuda,Yellow\n10,A,Niklas,Linrin,1967,Pontiac,Firebird,"Dark Grey"\n',
  });

  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream`, { signal: ctrl.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const nextEvent = async () => {
    while (!buf.includes('\n\n')) buf += decoder.decode((await reader.read()).value, { stream: true });
    const i = buf.indexOf('\n\n');
    const chunk = buf.slice(0, i);
    buf = buf.slice(i + 2);
    return JSON.parse(chunk.split('\n').find((l) => l.startsWith('data: ')).slice(6));
  };
  const initial = await nextEvent();

  const saved = await call('PUT', '/api/admin/runs', { carNumber: '10', day: 1, rt: '0.496', et: '6.303', mph: '228.81' });
  assert.equal(saved.status, 200);
  const pushed = await nextEvent();
  ctrl.abort();

  assert.ok(pushed.version > initial.version);
  const a = pushed.standings.find((c) => c.code === 'A');
  assert.equal(a.rows[0].carNumber, '10');
  assert.equal(a.rows[0].rank, 1);
  assert.equal(a.rows[0].avgEt, 6.303);
  assert.equal(pushed.recent[0].carNumber, '10');
});

test('run validation', async () => {
  assert.equal((await call('PUT', '/api/admin/runs', { carNumber: '999', day: 1, et: '10' })).status, 404);
  assert.equal((await call('PUT', '/api/admin/runs', { carNumber: '10', day: 3, et: '10' })).status, 400, 'waived day');
  assert.equal((await call('PUT', '/api/admin/runs', { carNumber: '10', day: 2, et: 'abc' })).status, 400);
  assert.equal((await call('PUT', '/api/admin/runs', { carNumber: '10', day: 2, et: '' })).status, 400);
  // Red-light reaction times are negative and must be accepted.
  assert.equal((await call('PUT', '/api/admin/runs', { carNumber: '10', day: 2, rt: '-0.365', et: '9.5', mph: '141' })).status, 200);
});

test('penalty uses configured values and re-entry replaces the day', async () => {
  await call('PUT', '/api/admin/runs', { carNumber: '401', day: 1, penalty: true });
  let { json } = await call('GET', '/api/standings');
  let row = json.standings.find((c) => c.code === 'A').rows.find((r) => r.carNumber === '401');
  assert.deepEqual(row.results[1], { rt: 1, et: 20, mph: 50, penalty: true });

  await call('PUT', '/api/admin/runs', { carNumber: '401', day: 1, rt: '0.664', et: '7.760', mph: '129.19' });
  ({ json } = await call('GET', '/api/standings'));
  row = json.standings.find((c) => c.code === 'A').rows.find((r) => r.carNumber === '401');
  assert.equal(row.results[1].et, 7.76);
  assert.equal(row.completed, 1);
});

test('duplicate car numbers and unknown classes are rejected', async () => {
  assert.equal((await call('POST', '/api/admin/entrants', { car_number: '10', class_code: 'A' })).status, 409);
  assert.equal((await call('POST', '/api/admin/entrants', { car_number: '77', class_code: 'ZZ' })).status, 400);
});

test('class with entrants cannot be deleted; empty one can', async () => {
  assert.equal((await call('DELETE', '/api/admin/classes/A')).status, 409);
  assert.equal((await call('DELETE', '/api/admin/classes/B')).status, 200);
});

test('CSV export lists waivers and averages', async () => {
  const res = await fetch(`${base}/api/standings.csv`);
  const text = await res.text();
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(text, /^Place,Car #,Class/);
  assert.match(text, /1,10,A,Unlimited,Niklas,Linrin,,1967,Pontiac,Firebird,Dark Grey,0\.496,6\.303,228\.81,-0\.365,9\.500,141\.00,Waiver,Waiver,Waiver/);
});

test('static pages are served and path traversal is blocked', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/admin`)).status, 200);
  assert.equal((await fetch(`${base}/..%2fpackage.json`)).status, 404);
});
