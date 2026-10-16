import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { DEFAULT_CLASSES, DEFAULT_DAYS, DEFAULT_SETTINGS } from './defaults.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS days (
  num      INTEGER PRIMARY KEY,
  location TEXT NOT NULL DEFAULT '',
  date     TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS classes (
  code        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  waived_days TEXT NOT NULL DEFAULT '[]',
  sort        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS entrants (
  id         INTEGER PRIMARY KEY,
  car_number TEXT NOT NULL UNIQUE,
  class_code TEXT NOT NULL REFERENCES classes(code) ON UPDATE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name  TEXT NOT NULL DEFAULT '',
  year       TEXT NOT NULL DEFAULT '',
  make       TEXT NOT NULL DEFAULT '',
  model      TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '',
  out        INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS runs (
  entrant_id INTEGER NOT NULL REFERENCES entrants(id) ON DELETE CASCADE,
  day        INTEGER NOT NULL REFERENCES days(num) ON DELETE CASCADE,
  rt         REAL,
  et         REAL NOT NULL,
  mph        REAL,
  penalty    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entrant_id, day)
);
CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY,
  at     TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);
`;

const ENTRANT_FIELDS = ['car_number', 'class_code', 'first_name', 'last_name', 'year', 'make', 'model', 'color'];

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();

function parseClass(row) {
  return { code: row.code, name: row.name, waivedDays: JSON.parse(row.waived_days), sort: row.sort };
}

function cleanDays(list, validDays) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map(Number))].filter((d) => validDays.includes(d)).sort((a, b) => a - b);
}

function optionalNumber(value, label) {
  if (value === '' || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label} must be a number`);
  return n;
}

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  seedIfEmpty(db);
  return new Store(db);
}

function seedIfEmpty(db) {
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, String(v));
  insertSetting.run('session_secret', randomBytes(32).toString('hex'));

  if (db.prepare('SELECT COUNT(*) AS n FROM days').get().n === 0) {
    const ins = db.prepare('INSERT INTO days (num, location, date) VALUES (?, ?, ?)');
    for (const d of DEFAULT_DAYS) ins.run(d.num, d.location, d.date ?? '');
  }
  if (db.prepare('SELECT COUNT(*) AS n FROM classes').get().n === 0) {
    const ins = db.prepare('INSERT INTO classes (code, name, waived_days, sort) VALUES (?, ?, ?, ?)');
    DEFAULT_CLASSES.forEach((c, i) => ins.run(c.code, c.name, JSON.stringify(c.waivedDays), i));
  }
}

class Store {
  constructor(db) {
    this.db = db;
  }

  tx(fn) {
    this.db.exec('BEGIN');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  log(action, detail) {
    this.db.prepare('INSERT INTO audit (at, action, detail) VALUES (?, ?, ?)').run(now(), action, JSON.stringify(detail));
  }

  // ---- settings ----
  settings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  publicSettings() {
    const s = this.settings();
    return {
      eventName: s.event_name,
      penaltyRt: Number(s.penalty_rt),
      penaltyEt: Number(s.penalty_et),
      penaltyMph: Number(s.penalty_mph),
    };
  }

  updateSettings(input) {
    const map = { eventName: 'event_name', penaltyRt: 'penalty_rt', penaltyEt: 'penalty_et', penaltyMph: 'penalty_mph' };
    const upd = this.db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    this.tx(() => {
      for (const [field, key] of Object.entries(map)) {
        if (input[field] === undefined) continue;
        let value = String(input[field]).trim();
        if (field !== 'eventName' && !Number.isFinite(Number(value))) throw new HttpError(400, `${field} must be a number`);
        if (field === 'eventName' && !value) throw new HttpError(400, 'Event name is required');
        upd.run(value, key);
      }
      this.log('settings', input);
    });
  }

  // ---- days ----
  days() {
    return this.db.prepare('SELECT num, location, date FROM days ORDER BY num').all().map((d) => ({ ...d }));
  }

  dayNums() {
    return this.days().map((d) => d.num);
  }

  saveDays(list) {
    if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, 'At least one day is required');
    const nums = list.map((d) => Number(d.num));
    if (nums.some((n) => !Number.isInteger(n) || n < 1)) throw new HttpError(400, 'Day numbers must be positive integers');
    if (new Set(nums).size !== nums.length) throw new HttpError(400, 'Day numbers must be unique');
    this.tx(() => {
      const keep = new Set(nums);
      for (const d of this.days()) {
        if (!keep.has(d.num)) this.db.prepare('DELETE FROM days WHERE num = ?').run(d.num);
      }
      const up = this.db.prepare(
        'INSERT INTO days (num, location, date) VALUES (?, ?, ?) ON CONFLICT(num) DO UPDATE SET location = excluded.location, date = excluded.date',
      );
      for (const d of list) up.run(Number(d.num), String(d.location ?? '').trim(), String(d.date ?? '').trim());
      this.log('days', list);
    });
  }

  // ---- classes ----
  classes() {
    return this.db.prepare('SELECT * FROM classes ORDER BY sort, code').all().map(parseClass);
  }

  saveClass(input, originalCode) {
    const code = String(input.code ?? '').trim().toUpperCase();
    const name = String(input.name ?? '').trim();
    if (!code || !name) throw new HttpError(400, 'Class code and name are required');
    const waived = JSON.stringify(cleanDays(input.waivedDays, this.dayNums()));
    return this.tx(() => {
      if (originalCode) {
        const existing = this.db.prepare('SELECT code FROM classes WHERE code = ?').get(originalCode);
        if (!existing) throw new HttpError(404, 'Class not found');
        if (code !== originalCode && this.db.prepare('SELECT 1 FROM classes WHERE code = ?').get(code)) {
          throw new HttpError(409, `Class ${code} already exists`);
        }
        this.db.prepare('UPDATE classes SET code = ?, name = ?, waived_days = ? WHERE code = ?').run(code, name, waived, originalCode);
      } else {
        if (this.db.prepare('SELECT 1 FROM classes WHERE code = ?').get(code)) throw new HttpError(409, `Class ${code} already exists`);
        const sort = this.db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS s FROM classes').get().s;
        this.db.prepare('INSERT INTO classes (code, name, waived_days, sort) VALUES (?, ?, ?, ?)').run(code, name, waived, sort);
      }
      this.log('class.save', { originalCode, code, name });
      return code;
    });
  }

  deleteClass(code) {
    const used = this.db.prepare('SELECT COUNT(*) AS n FROM entrants WHERE class_code = ?').get(code).n;
    if (used > 0) throw new HttpError(409, `Class ${code} still has ${used} entrant(s); move them first`);
    const res = this.db.prepare('DELETE FROM classes WHERE code = ?').run(code);
    if (res.changes === 0) throw new HttpError(404, 'Class not found');
    this.log('class.delete', { code });
  }

  // ---- entrants ----
  entrants() {
    return this.db.prepare('SELECT * FROM entrants').all().map((e) => ({ ...e }));
  }

  entrantByCar(carNumber) {
    const row = this.db.prepare('SELECT * FROM entrants WHERE car_number = ?').get(String(carNumber).trim());
    return row ? { ...row } : null;
  }

  normalizeEntrant(input) {
    const e = {};
    for (const f of ENTRANT_FIELDS) e[f] = String(input[f] ?? '').trim();
    e.class_code = e.class_code.toUpperCase();
    if (!e.car_number) throw new HttpError(400, 'Car number is required');
    if (!this.db.prepare('SELECT 1 FROM classes WHERE code = ?').get(e.class_code)) {
      throw new HttpError(400, `Unknown class "${e.class_code}" for car ${e.car_number}`);
    }
    e.out = input.out ? 1 : 0;
    return e;
  }

  saveEntrant(input, id) {
    const e = this.normalizeEntrant(input);
    return this.tx(() => {
      const clash = this.db.prepare('SELECT id FROM entrants WHERE car_number = ?').get(e.car_number);
      if (clash && clash.id !== id) throw new HttpError(409, `Car #${e.car_number} is already registered`);
      if (id) {
        const res = this.db
          .prepare(
            `UPDATE entrants SET car_number=?, class_code=?, first_name=?, last_name=?, year=?, make=?, model=?, color=?, out=? WHERE id=?`,
          )
          .run(...ENTRANT_FIELDS.map((f) => e[f]), e.out, id);
        if (res.changes === 0) throw new HttpError(404, 'Entrant not found');
      } else {
        const res = this.db
          .prepare(
            `INSERT INTO entrants (car_number, class_code, first_name, last_name, year, make, model, color, out) VALUES (?,?,?,?,?,?,?,?,?)`,
          )
          .run(...ENTRANT_FIELDS.map((f) => e[f]), e.out);
        id = Number(res.lastInsertRowid);
      }
      this.log('entrant.save', { id, ...e });
      return id;
    });
  }

  setOut(id, out) {
    const res = this.db.prepare('UPDATE entrants SET out = ? WHERE id = ?').run(out ? 1 : 0, id);
    if (res.changes === 0) throw new HttpError(404, 'Entrant not found');
    this.log('entrant.out', { id, out: !!out });
  }

  deleteEntrant(id) {
    const res = this.db.prepare('DELETE FROM entrants WHERE id = ?').run(id);
    if (res.changes === 0) throw new HttpError(404, 'Entrant not found');
    this.log('entrant.delete', { id });
  }

  // Rows already parsed from CSV. Existing car numbers are updated, new ones inserted.
  importEntrants(rows) {
    return this.tx(() => {
      let added = 0;
      let updated = 0;
      for (const row of rows) {
        const e = this.normalizeEntrant(row);
        const existing = this.db.prepare('SELECT id, out FROM entrants WHERE car_number = ?').get(e.car_number);
        if (existing) {
          this.db
            .prepare(`UPDATE entrants SET class_code=?, first_name=?, last_name=?, year=?, make=?, model=?, color=? WHERE id=?`)
            .run(...ENTRANT_FIELDS.slice(1).map((f) => e[f]), existing.id);
          updated++;
        } else {
          this.db
            .prepare(
              `INSERT INTO entrants (car_number, class_code, first_name, last_name, year, make, model, color, out) VALUES (?,?,?,?,?,?,?,?,?)`,
            )
            .run(...ENTRANT_FIELDS.map((f) => e[f]), e.out);
          added++;
        }
      }
      this.log('entrant.import', { added, updated });
      return { added, updated };
    });
  }

  // ---- runs ----
  runs() {
    return this.db.prepare('SELECT * FROM runs').all().map((r) => ({ ...r }));
  }

  recentRuns(limit = 25) {
    return this.db
      .prepare(
        `SELECT r.*, e.car_number, e.first_name, e.last_name, e.class_code
           FROM runs r JOIN entrants e ON e.id = r.entrant_id
          ORDER BY r.updated_at DESC LIMIT ?`,
      )
      .all(limit)
      .map((r) => ({ ...r }));
  }

  saveRun(input) {
    const entrant = this.entrantByCar(input.carNumber ?? '');
    if (!entrant) throw new HttpError(404, `No entrant with car #${input.carNumber}`);
    const day = Number(input.day);
    if (!this.dayNums().includes(day)) throw new HttpError(400, `Day ${input.day} is not an event day`);
    const cls = this.classes().find((c) => c.code === entrant.class_code);
    if (cls.waivedDays.includes(day)) throw new HttpError(400, `Class ${cls.code} waives day ${day}`);

    let rt, et, mph;
    const penalty = !!input.penalty;
    if (penalty) {
      const s = this.publicSettings();
      [rt, et, mph] = [s.penaltyRt, s.penaltyEt, s.penaltyMph];
    } else {
      rt = optionalNumber(input.rt, 'RT');
      et = optionalNumber(input.et, 'ET');
      mph = optionalNumber(input.mph, 'MPH');
      if (et == null || et <= 0) throw new HttpError(400, 'ET is required and must be greater than 0');
      if (mph != null && mph <= 0) throw new HttpError(400, 'MPH must be greater than 0');
    }

    this.tx(() => {
      this.db
        .prepare(
          `INSERT INTO runs (entrant_id, day, rt, et, mph, penalty, updated_at) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(entrant_id, day) DO UPDATE SET rt=excluded.rt, et=excluded.et, mph=excluded.mph,
             penalty=excluded.penalty, updated_at=excluded.updated_at`,
        )
        .run(entrant.id, day, rt, et, mph, penalty ? 1 : 0, now());
      this.log('run.save', { car: entrant.car_number, day, rt, et, mph, penalty });
    });
    return { entrantId: entrant.id, day };
  }

  deleteRun(entrantId, day) {
    const res = this.db.prepare('DELETE FROM runs WHERE entrant_id = ? AND day = ?').run(entrantId, day);
    if (res.changes === 0) throw new HttpError(404, 'Result not found');
    this.log('run.delete', { entrantId, day });
  }
}
