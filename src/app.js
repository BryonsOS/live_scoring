import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './db.js';
import { computeStandings } from './scoring.js';
import { checkPassword, clearCookie, isAuthed, sessionCookie } from './auth.js';
import { csvToEntrants, toCsv } from './csv.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const PAGES = { '/': 'index.html', '/admin': 'admin.html' };

export function createApp({ store, adminPassword, secureCookies = false }) {
  const secret = store.settings().session_secret;
  const clients = new Set();
  let snapshot = null;
  let version = 0;

  function buildSnapshot() {
    const days = store.days();
    const classes = store.classes();
    const standings = computeStandings({ days, classes, entrants: store.entrants(), runs: store.runs() });
    const recent = store.recentRuns(12).map((r) => ({
      carNumber: r.car_number,
      name: `${r.first_name} ${r.last_name}`.trim(),
      classCode: r.class_code,
      day: r.day,
      rt: r.rt,
      et: r.et,
      mph: r.mph,
      penalty: !!r.penalty,
      at: r.updated_at,
    }));
    return { version, updatedAt: new Date().toISOString(), event: store.publicSettings(), days, standings, recent };
  }

  function current() {
    if (!snapshot) snapshot = buildSnapshot();
    return snapshot;
  }

  // Called after every write: rebuild once and push to every open page.
  function changed() {
    version++;
    snapshot = buildSnapshot();
    const msg = `event: standings\ndata: ${JSON.stringify(snapshot)}\n\n`;
    for (const res of clients) res.write(msg);
  }

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': ping\n\n');
  }, 25_000);
  heartbeat.unref();

  function send(res, status, body, headers = {}) {
    const json = typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
    res.end(json);
  }

  async function readJson(req) {
    if (!(req.headers['content-type'] ?? '').includes('application/json')) {
      throw new HttpError(415, 'Expected application/json');
    }
    let size = 0;
    const chunks = [];
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 2_000_000) throw new HttpError(413, 'Request too large');
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      throw new HttpError(400, 'Invalid JSON');
    }
  }

  function stream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 3000\nevent: standings\ndata: ${JSON.stringify(current())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  function standingsCsv() {
    const { days, standings } = current();
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

  async function serveStatic(res, pathname) {
    const file = PAGES[pathname] ?? pathname.slice(1);
    const full = normalize(join(PUBLIC_DIR, file));
    if (!full.startsWith(PUBLIC_DIR)) return send(res, 404, { error: 'Not found' });
    try {
      const data = await readFile(full);
      res.writeHead(200, {
        'Content-Type': MIME[extname(full)] ?? 'application/octet-stream',
        'Cache-Control': extname(full) === '.html' ? 'no-cache' : 'public, max-age=300',
      });
      res.end(data);
    } catch {
      send(res, 404, { error: 'Not found' });
    }
  }

  async function adminRoute(req, res, method, path) {
    let m;
    if (method === 'GET' && path === '/api/admin/state') {
      const s = current();
      return send(res, 200, {
        event: s.event,
        days: s.days,
        classes: store.classes(),
        entrants: store.entrants(),
        runs: store.runs(),
        recent: store.recentRuns(40),
      });
    }
    if (method === 'PUT' && path === '/api/admin/settings') {
      store.updateSettings(await readJson(req));
    } else if (method === 'PUT' && path === '/api/admin/days') {
      store.saveDays((await readJson(req)).days);
    } else if (method === 'POST' && path === '/api/admin/classes') {
      store.saveClass(await readJson(req));
    } else if ((m = path.match(/^\/api\/admin\/classes\/([^/]+)$/))) {
      const code = decodeURIComponent(m[1]);
      if (method === 'PUT') store.saveClass(await readJson(req), code);
      else if (method === 'DELETE') store.deleteClass(code);
      else return send(res, 405, { error: 'Method not allowed' });
    } else if (method === 'POST' && path === '/api/admin/entrants') {
      const id = store.saveEntrant(await readJson(req));
      changed();
      return send(res, 201, { id });
    } else if (method === 'POST' && path === '/api/admin/entrants/import') {
      const { csv } = await readJson(req);
      let rows;
      try {
        rows = csvToEntrants(String(csv ?? ''));
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      const result = store.importEntrants(rows);
      changed();
      return send(res, 200, result);
    } else if ((m = path.match(/^\/api\/admin\/entrants\/(\d+)(\/out)?$/))) {
      const id = Number(m[1]);
      if (m[2] && method === 'PUT') store.setOut(id, (await readJson(req)).out);
      else if (!m[2] && method === 'PUT') store.saveEntrant(await readJson(req), id);
      else if (!m[2] && method === 'DELETE') store.deleteEntrant(id);
      else return send(res, 405, { error: 'Method not allowed' });
    } else if (method === 'PUT' && path === '/api/admin/runs') {
      const result = store.saveRun(await readJson(req));
      changed();
      return send(res, 200, result);
    } else if ((m = path.match(/^\/api\/admin\/runs\/(\d+)\/(\d+)$/)) && method === 'DELETE') {
      store.deleteRun(Number(m[1]), Number(m[2]));
    } else {
      return send(res, 404, { error: 'Not found' });
    }
    changed();
    return send(res, 200, { ok: true });
  }

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;

    if (method === 'GET' && path === '/api/stream') return stream(req, res);
    if (method === 'GET' && path === '/api/standings') return send(res, 200, current());
    if (method === 'GET' && path === '/api/standings.csv') {
      const name = current().event.eventName.replace(/[^\w-]+/g, '_');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}_standings.csv"`,
        'Cache-Control': 'no-store',
      });
      return res.end(standingsCsv());
    }
    if (method === 'GET' && path === '/api/health') return send(res, 200, { ok: true, clients: clients.size });

    if (method === 'POST' && path === '/api/login') {
      const { password } = await readJson(req);
      if (!checkPassword(adminPassword, password)) {
        await new Promise((r) => setTimeout(r, 500));
        return send(res, 401, { error: 'Wrong password' });
      }
      return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(secret, secureCookies) });
    }
    if (method === 'POST' && path === '/api/logout') return send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
    if (method === 'GET' && path === '/api/session') return send(res, 200, { authed: isAuthed(req, secret) });

    if (path.startsWith('/api/admin/')) {
      if (!isAuthed(req, secret)) return send(res, 401, { error: 'Please log in' });
      return adminRoute(req, res, method, path);
    }
    if (path.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
    if (method === 'GET' || method === 'HEAD') return serveStatic(res, path);
    return send(res, 405, { error: 'Method not allowed' });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      const status = err.status ?? 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : err.message });
      else res.end();
    });
  });
  server.on('close', () => clearInterval(heartbeat));
  server.closeStreams = () => {
    for (const res of clients) res.end();
    clients.clear();
  };
  return server;
}
