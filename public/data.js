// All Supabase access lives here. Pages get plain snapshots and call these helpers.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';
import { computeStandings } from './scoring.js';

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const TABLES = ['ls_runs', 'ls_entrants', 'ls_classes', 'ls_days', 'ls_settings'];
const POLL_FALLBACK_MS = 15_000; // when live updates aren't available
const POLL_SAFETY_MS = 60_000; // even when live, in case an update was missed

// Turn database errors into messages an official can act on.
function friendly(error) {
  const msg = error?.message ?? String(error);
  switch (error?.code) {
    case '23505':
      if (msg.includes('car_number')) return 'That car number is already registered';
      if (msg.includes('ls_classes_pkey')) return 'A class with that code already exists';
      if (msg.includes('ls_admins_pkey')) return 'That email is already an admin';
      return 'That already exists';
    case '23503':
      return msg.includes('ls_entrants') ? 'That class still has entrants; move them to another class first' : msg;
    case '23514':
      if (msg.includes('code_check')) return 'Class code must be 1-4 letters or numbers';
      if (msg.includes('email_check')) return 'Enter a valid email address';
      return msg.replace(/^new row .* violates check constraint/, 'Invalid value:');
    case '42501':
      return 'Not authorized: sign in with an admin email';
    case 'PGRST202':
      return 'This action needs a database update; see the README (ls_save_days)';
    default:
      return msg;
  }
}

async function run(promise) {
  const { data, error } = await promise;
  if (error) throw new Error(friendly(error));
  return data;
}

// ---------- reading ----------
export async function fetchSnapshot() {
  const snap = await run(sb.rpc('ls_snapshot'));
  return shape(snap);
}

function shape(snap) {
  const days = snap.days;
  const classes = snap.classes;
  const entrants = snap.entrants;
  const runs = snap.runs; // newest first
  const byId = new Map(entrants.map((e) => [e.id, e]));
  const recent = runs
    .map((r) => ({ ...r, entrant: byId.get(r.entrant_id) }))
    .filter((r) => r.entrant)
    .map((r) => ({
      entrantId: r.entrant_id,
      carNumber: r.entrant.car_number,
      name: `${r.entrant.first_name} ${r.entrant.last_name}`.trim(),
      classCode: r.entrant.class_code,
      day: r.day,
      rt: r.rt,
      et: r.et,
      mph: r.mph,
      penalty: r.penalty,
      at: r.updated_at,
    }));
  return {
    event: snap.settings,
    days,
    classes,
    entrants,
    runs,
    recent,
    standings: computeStandings({ days, classes, entrants, runs }),
    updatedAt: snap.serverTime,
  };
}

// Calls onSnapshot with fresh data now and after every change anywhere in the event.
// onStatus receives 'live' | 'polling' | 'offline'.
export function watch(onSnapshot, onStatus) {
  let timer = null;
  let pollTimer = null;
  let live = false;
  let inFlight = false;
  let again = false;

  async function load() {
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    try {
      onSnapshot(await fetchSnapshot());
      onStatus(live ? 'live' : 'polling');
    } catch {
      onStatus('offline');
    } finally {
      inFlight = false;
      if (again) {
        again = false;
        load();
      }
    }
  }

  // Spread viewers' reloads over a second so a single entry doesn't arrive as one spike.
  function soon() {
    clearTimeout(timer);
    timer = setTimeout(load, 250 + Math.random() * 1000);
  }

  function schedulePoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(load, live ? POLL_SAFETY_MS : POLL_FALLBACK_MS);
  }

  let channel = sb.channel('ls-changes');
  for (const table of TABLES) channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, soon);
  channel.subscribe((status) => {
    const wasLive = live;
    live = status === 'SUBSCRIBED';
    onStatus(live ? 'live' : 'polling');
    if (live !== wasLive) schedulePoll();
    if (live && !wasLive) load(); // catch anything missed while disconnected
  });

  load();
  schedulePoll();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load());
  return () => {
    clearTimeout(timer);
    clearInterval(pollTimer);
    sb.removeChannel(channel);
  };
}

// ---------- auth ----------
export async function currentEmail() {
  const { data } = await sb.auth.getSession();
  return data.session?.user?.email ?? null;
}

export const isAdmin = () => run(sb.rpc('ls_is_admin'));
export const signInWithPassword = (email, password) => run(sb.auth.signInWithPassword({ email, password }));
export const sendLoginLink = (email) =>
  run(sb.auth.signInWithOtp({ email, options: { emailRedirectTo: `${location.origin}/admin` } }));
export const signOut = () => sb.auth.signOut();
export const changePassword = (password) => run(sb.auth.updateUser({ password }));
export const onAuthChange = (cb) => sb.auth.onAuthStateChange((_event, session) => cb(session?.user?.email ?? null));

// ---------- writing (admins only; enforced by the database) ----------
const num = (v) => (v === '' || v == null ? null : Number(v));

export function saveRun({ carNumber, day, rt, et, mph, penalty }) {
  for (const [label, v] of [['RT', rt], ['ET', et], ['MPH', mph]]) {
    if (!penalty && v !== '' && v != null && !Number.isFinite(Number(v))) throw new Error(`${label} must be a number`);
  }
  return run(
    sb.rpc('ls_save_run', { p_car: String(carNumber).trim(), p_day: day, p_rt: num(rt), p_et: num(et), p_mph: num(mph), p_penalty: !!penalty }),
  );
}

export const deleteRun = (entrantId, day) => run(sb.from('ls_runs').delete().eq('entrant_id', entrantId).eq('day', day));

const ENTRANT_FIELDS = ['car_number', 'class_code', 'first_name', 'last_name', 'year', 'make', 'model', 'color'];
function cleanEntrant(input) {
  const e = Object.fromEntries(ENTRANT_FIELDS.map((f) => [f, String(input[f] ?? '').trim()]));
  e.class_code = e.class_code.toUpperCase();
  e.out = !!input.out;
  if (!e.car_number) throw new Error('Car number is required');
  return e;
}

export function saveEntrant(input, id) {
  const e = cleanEntrant(input);
  return id ? run(sb.from('ls_entrants').update(e).eq('id', id)) : run(sb.from('ls_entrants').insert(e));
}
export const setOut = (id, out) => run(sb.from('ls_entrants').update({ out }).eq('id', id));
export const deleteEntrant = (id) => run(sb.from('ls_entrants').delete().eq('id', id));
export const importEntrants = (rows) => run(sb.rpc('ls_import_entrants', { p_rows: rows }));
export const importResults = (rows) => run(sb.rpc('ls_import_results', { p_rows: rows }));

export function saveClass(input, originalCode) {
  const c = {
    code: String(input.code ?? '').trim().toUpperCase(),
    name: String(input.name ?? '').trim(),
    waived_days: [...new Set(input.waivedDays ?? [])].sort((a, b) => a - b),
  };
  if (!c.code || !c.name) throw new Error('Class code and name are required');
  if (originalCode) return run(sb.from('ls_classes').update(c).eq('code', originalCode));
  return run(sb.from('ls_classes').insert({ ...c, sort: input.sort ?? 99 }));
}
export const setWaivedDays = (code, days) =>
  run(sb.from('ls_classes').update({ waived_days: [...new Set(days)].sort((a, b) => a - b) }).eq('code', code));
export const deleteClass = (code) => run(sb.from('ls_classes').delete().eq('code', code));

export function saveDays(days) {
  const clean = days.map((d) => ({ num: Number(d.num), location: String(d.location ?? '').trim(), date: d.date || '' }));
  if (clean.some((d) => !Number.isInteger(d.num) || d.num < 1)) throw new Error('Day numbers must be positive whole numbers');
  return run(sb.rpc('ls_save_days', { p_days: clean }));
}

export function saveSettings({ eventName, penaltyRt, penaltyEt, penaltyMph }) {
  const vals = { event_name: String(eventName).trim(), penalty_rt: num(penaltyRt), penalty_et: num(penaltyEt), penalty_mph: num(penaltyMph) };
  if (!vals.event_name) throw new Error('Event name is required');
  if ([vals.penalty_rt, vals.penalty_et, vals.penalty_mph].some((v) => v == null || !Number.isFinite(v))) {
    throw new Error('Penalty values must be numbers');
  }
  return run(sb.from('ls_settings').update(vals).eq('id', 1));
}

// Bulk resets (admins only, enforced by row level security). Deleting drivers also removes their times.
export const clearTimes = () => run(sb.from('ls_runs').delete().gt('entrant_id', 0));
export const clearDriversAndTimes = () => run(sb.from('ls_entrants').delete().gt('id', 0));

export const listAdmins = () => run(sb.from('ls_admins').select('email, added_at').order('email'));
export const addAdmin = (email) => run(sb.from('ls_admins').insert({ email: String(email).trim().toLowerCase() }));
export const removeAdmin = (email) => run(sb.from('ls_admins').delete().eq('email', email));
