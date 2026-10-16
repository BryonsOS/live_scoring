import { esc, fmt, timeAgo, store, setLiveBadge, downloadFile, initThemeToggle } from './common.js';

import { csvToEntrants, standingsToCsv } from './csv.js';
import { parseResultsSheet } from './sheet-import.js';
import * as db from './data.js';

const $ = (id) => document.getElementById(id);
initThemeToggle($('theme-toggle'));
let state = null;
let day = store.get('ls.admin.day', 1);
let editingEntrantId = null;
let stopWatching = null;

// ---------- helpers ----------
function flashMsg(id, text, ok = true) {
  const el = $(id);
  el.textContent = text;
  el.className = `msg ${ok ? 'ok' : 'err'}`;
  clearTimeout(el._t);
  if (ok) el._t = setTimeout(() => (el.textContent = ''), 5000);
}

const fullName = (e) => `${e.first_name} ${e.last_name}`.trim() || '(no name)';
const vehicle = (e) => [e.year, e.make, e.model, e.color].filter(Boolean).join(' · ');
const classOf = (code) => state.classes.find((c) => c.code === code);
const entrantByCar = (car) => state.entrants.find((e) => e.car_number === String(car).trim());

async function refresh(snapshot) {
  state = snapshot ?? (await db.fetchSnapshot());
  if (!state.days.some((d) => d.num === day)) day = state.days[0]?.num ?? 1;
  $('event-name').textContent = state.event.eventName;
  renderDayPicker();
  renderDriverCard();
  renderRecent();
  renderEntrants();
  renderClassSelect();
  renderSetup();
  renderSettings();
}

// ---------- auth ----------
// message undefined = keep whatever is shown (e.g. the "not on the admin list" note survives
// the sign-out that follows it).
function showLogin(message) {
  $('login-view').hidden = false;
  $('app-view').hidden = true;
  $('logout').hidden = true;
  if (message !== undefined) $('login-error').textContent = message;
  stopWatching?.();
  stopWatching = null;
  $('email').focus();
}

async function showApp() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  $('logout').hidden = false;
  if (stopWatching) return;
  // Every change (from this screen or another official's) refreshes the page.
  stopWatching = db.watch((snap) => refresh(snap), setLiveBadge);
  renderAdmins();
  $('run-car').focus();
}

// Signed in is not enough: the email must be on the admin list (ls_admins).
async function checkAccess() {
  const email = await db.currentEmail();
  $('who').textContent = email ?? '';
  if (!email) return showLogin();
  let ok = false;
  try {
    ok = await db.isAdmin();
  } catch (err) {
    return showLogin(err.message);
  }
  if (ok) return showApp();
  await db.signOut();
  showLogin(`${email} isn't on the admin list. Ask an existing admin to add it under Settings.`);
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await db.signInWithPassword($('email').value.trim(), $('password').value);
    $('password').value = ''; // the auth listener below takes it from here
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('send-link').addEventListener('click', async () => {
  const email = $('email').value.trim();
  if (!email) return ($('login-error').textContent = 'Enter your email first');
  try {
    await db.sendLoginLink(email);
    $('login-error').textContent = '';
    $('login-info').textContent = `Sign-in link sent to ${email}. Open it on this device.`;
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await db.signOut();
  showLogin('');
});

// ---------- tabs ----------
document.querySelector('.tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tab]');
  if (!btn) return;
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.setAttribute('aria-selected', b === btn);
  for (const p of document.querySelectorAll('.tab-panel')) p.hidden = p.dataset.panel !== btn.dataset.tab;
  if (btn.dataset.tab === 'times') $('run-car').focus();
});

// ---------- time entry ----------
function renderDayPicker() {
  $('day-picker').innerHTML = state.days
    .map((d) => `<button type="button" role="radio" aria-checked="${d.num === day}" data-day="${d.num}"><b>Day ${d.num}</b><span>${esc(d.location)}</span></button>`)
    .join('');
}

$('day-picker').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-day]');
  if (!btn) return;
  day = Number(btn.dataset.day);
  store.set('ls.admin.day', day);
  renderDayPicker();
  renderDriverCard();
  $('run-car').focus();
});

function renderDriverCard() {
  const card = $('run-driver');
  const car = $('run-car').value.trim();
  const e = car && entrantByCar(car);
  const submit = $('run-submit');
  const penalty = $('run-penalty');
  if (!car) {
    card.className = 'driver-card muted';
    card.textContent = 'Type a car number';
    submit.disabled = penalty.disabled = false;
    return;
  }
  if (!e) {
    card.className = 'driver-card muted';
    card.innerHTML = `No entrant with car #${esc(car)}. <a href="#" data-goto="entrants">Add one</a>`;
    submit.disabled = penalty.disabled = true;
    return;
  }
  const cls = classOf(e.class_code);
  const waived = cls?.waivedDays.includes(day);
  const existing = state.runs.find((r) => r.entrant_id === e.id && r.day === day);
  card.className = 'driver-card found';
  card.innerHTML = `<div class="name">#${esc(e.car_number)} ${esc(fullName(e))}${e.out ? ' <span class="tag out">OUT</span>' : ''}</div>
    <div>${esc(cls ? `${cls.code} · ${cls.name}` : e.class_code)}</div>
    <div class="muted">${esc(vehicle(e))}</div>
    ${e.out ? '<div class="existing">This driver is marked OUT. Their times still save but they stay unranked.</div>' : ''}
    ${waived ? `<div class="existing">Class ${esc(cls.code)} waives day ${day} — no time needed.</div>` : ''}
    ${existing ? `<div class="existing">Day ${day} already has ${existing.penalty ? 'a NO TIME penalty' : `${fmt(existing.et, 3)} @ ${fmt(existing.mph, 2)}`} — submitting will replace it.</div>` : ''}`;
  submit.disabled = penalty.disabled = !!waived;
}

$('run-car').addEventListener('input', renderDriverCard);

// Enter jumps to the next field; Enter in MPH submits.
const order = ['run-car', 'run-rt', 'run-et', 'run-mph'];
for (const id of order.slice(0, -1)) {
  $(id).addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    $(order[order.indexOf(id) + 1]).focus();
  });
}

function resetRunForm() {
  for (const id of order) $(id).value = '';
  renderDriverCard();
  $('run-car').focus();
}

async function submitRun(penalty) {
  const carNumber = $('run-car').value.trim();
  const body = { carNumber, day, penalty, rt: $('run-rt').value.trim(), et: $('run-et').value.trim(), mph: $('run-mph').value.trim() };
  if (penalty) {
    const e = entrantByCar(carNumber);
    if (!confirm(`Record NO TIME penalty for #${carNumber} ${e ? fullName(e) : ''} on day ${day}?`)) return;
  }
  const entrant = entrantByCar(carNumber);
  const previous = entrant && state.runs.find((r) => r.entrant_id === entrant.id && r.day === day);
  try {
    await db.saveRun(body);
    showSaved(entrant, day, body, previous ? { ...previous } : null);
    resetRunForm();
    await refresh();
  } catch (err) {
    flashMsg('run-msg', err.message, false);
  }
}

// Confirmation card for the last save, with Undo (restores the old time, or removes a new one).
let undoTimer = null;
function showSaved(entrant, savedDay, body, previous) {
  const el = $('run-saved');
  const what = body.penalty ? 'NO TIME penalty' : `${body.et}${body.mph ? ` @ ${body.mph}` : ''}${body.rt ? ` · RT ${body.rt}` : ''}`;
  el.innerHTML = `<div><b>Saved #${esc(entrant.car_number)} ${esc(fullName(entrant))}</b> · Day ${savedDay}<br>
    <span class="num">${esc(what)}</span>${previous ? ' <span class="muted">(replaced an earlier time)</span>' : ''}</div>
    <button type="button" class="btn small ghost" id="undo-run">Undo</button>`;
  el.hidden = false;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => (el.hidden = true), 20_000);
  $('undo-run').onclick = async () => {
    try {
      if (previous) {
        await db.saveRun({ carNumber: entrant.car_number, day: savedDay, rt: previous.rt, et: previous.et, mph: previous.mph, penalty: previous.penalty });
      } else {
        await db.deleteRun(entrant.id, savedDay);
      }
      el.hidden = true;
      flashMsg('run-msg', `Undone: #${entrant.car_number} day ${savedDay} ${previous ? 'restored' : 'removed'}`);
      await refresh();
    } catch (err) {
      flashMsg('run-msg', err.message, false);
    }
  };
}

$('run-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitRun(false);
});
$('run-penalty').addEventListener('click', () => submitRun(true));

function renderRecent() {
  const rows = state.recent.slice(0, 40);
  $('recent-table').innerHTML = rows.length
    ? `<thead><tr><th>Car</th><th>Driver</th><th>Day</th><th class="r">RT</th><th class="r">ET</th><th class="r">MPH</th><th>When</th><th></th></tr></thead><tbody>
      ${rows
        .map(
          (r) => `<tr><td><b>#${esc(r.carNumber)}</b> <span class="muted">${esc(r.classCode)}</span></td>
          <td>${esc(r.name)}</td><td>${r.day}</td>
          <td class="r num">${fmt(r.rt, 3)}</td><td class="r num">${fmt(r.et, 3)}${r.penalty ? ' <span class="tag pen">NO TIME</span>' : ''}</td><td class="r num">${fmt(r.mph, 2)}</td>
          <td class="muted nowrap">${timeAgo(r.at)}</td>
          <td class="nowrap"><button class="btn small ghost" data-edit-run="${r.entrantId}:${r.day}">Edit</button>
            <button class="btn small danger" data-del-run="${r.entrantId}:${r.day}">Delete</button></td></tr>`,
        )
        .join('')}</tbody>`
    : '<tbody><tr><td class="muted">No times entered yet.</td></tr></tbody>';
}

$('recent-table').addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-edit-run]');
  const del = e.target.closest('[data-del-run]');
  if (edit) {
    const [id, d] = edit.dataset.editRun.split(':').map(Number);
    const run = state.runs.find((r) => r.entrant_id === id && r.day === d);
    const ent = state.entrants.find((x) => x.id === id);
    day = d;
    store.set('ls.admin.day', day);
    $('run-car').value = ent.car_number;
    $('run-rt').value = run.rt ?? '';
    $('run-et').value = run.et ?? '';
    $('run-mph').value = run.mph ?? '';
    renderDayPicker();
    renderDriverCard();
    $('run-et').focus();
  } else if (del) {
    const [id, d] = del.dataset.delRun.split(':').map(Number);
    const ent = state.entrants.find((x) => x.id === id);
    if (!confirm(`Delete day ${d} time for #${ent.car_number} ${fullName(ent)}?`)) return;
    try {
      await db.deleteRun(id, d);
      await refresh();
    } catch (err) {
      flashMsg('run-msg', err.message, false);
    }
  }
});

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-goto]');
  if (!link) return;
  e.preventDefault();
  document.querySelector(`.tabs [data-tab="${link.dataset.goto}"]`).click();
  if (link.dataset.goto === 'entrants') {
    $('entrant-form').elements.car_number.value = $('run-car').value.trim();
    $('entrant-form').elements.first_name.focus();
  }
});

// ---------- entrants ----------
function renderClassSelect() {
  const sel = $('entrant-form').elements.class_code;
  const keep = sel.value;
  sel.innerHTML = state.classes.map((c) => `<option value="${esc(c.code)}">${esc(c.code)} · ${esc(c.name)}</option>`).join('');
  if (keep) sel.value = keep;
}

function renderEntrants() {
  const q = $('entrant-search').value.trim().toLowerCase();
  const list = state.entrants
    .filter((e) => !q || `${e.car_number} ${e.first_name} ${e.last_name} ${e.class_code} ${e.make} ${e.model}`.toLowerCase().includes(q))
    .sort((a, b) => a.class_code.localeCompare(b.class_code) || a.car_number.localeCompare(b.car_number, undefined, { numeric: true }));
  $('entrant-count').textContent = `(${state.entrants.length})`;
  const daysDone = (id) => state.runs.filter((r) => r.entrant_id === id).length;
  $('entrant-table').innerHTML = list.length
    ? `<thead><tr><th>Car</th><th>Class</th><th>Driver</th><th>Vehicle</th><th class="r">Times</th><th>Out</th><th></th></tr></thead><tbody>
      ${list
        .map(
          (e) => `<tr><td><b>#${esc(e.car_number)}</b></td><td>${esc(e.class_code)}</td><td>${esc(fullName(e))}</td>
          <td class="muted">${esc(vehicle(e))}</td><td class="r">${daysDone(e.id)}</td>
          <td><input type="checkbox" data-out="${e.id}" ${e.out ? 'checked' : ''} aria-label="Out of competition" /></td>
          <td class="nowrap"><button class="btn small ghost" data-edit="${e.id}">Edit</button>
            <button class="btn small danger" data-del="${e.id}">Delete</button></td></tr>`,
        )
        .join('')}</tbody>`
    : `<tbody><tr><td class="muted">${state.entrants.length ? 'No matches.' : 'No entrants yet — add one above or import a CSV.'}</td></tr></tbody>`;
}

$('entrant-search').addEventListener('input', renderEntrants);

function setEntrantForm(e) {
  const f = $('entrant-form');
  editingEntrantId = e?.id ?? null;
  for (const name of ['car_number', 'first_name', 'last_name', 'year', 'make', 'model', 'color']) f.elements[name].value = e?.[name] ?? '';
  if (e) f.elements.class_code.value = e.class_code;
  f.elements.out.checked = !!e?.out;
  $('entrant-form-title').textContent = e ? `Edit #${e.car_number}` : 'Add entrant';
  $('entrant-save').textContent = e ? 'Save changes' : 'Add entrant';
  $('entrant-cancel').hidden = !e;
}

$('entrant-cancel').addEventListener('click', () => setEntrantForm(null));

$('entrant-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const body = Object.fromEntries(['car_number', 'class_code', 'first_name', 'last_name', 'year', 'make', 'model', 'color'].map((n) => [n, f.elements[n].value]));
  body.out = f.elements.out.checked;
  try {
    await db.saveEntrant(body, editingEntrantId);
    flashMsg('entrant-msg', `${editingEntrantId ? 'Updated' : 'Added'} #${body.car_number}`);
    const cls = body.class_code;
    setEntrantForm(null);
    f.elements.class_code.value = cls; // keep class for quick entry of the next car
    f.elements.car_number.focus();
    await refresh();
  } catch (err) {
    flashMsg('entrant-msg', err.message, false);
  }
});

$('entrant-table').addEventListener('click', async (ev) => {
  const edit = ev.target.closest('[data-edit]');
  const del = ev.target.closest('[data-del]');
  if (edit) {
    setEntrantForm(state.entrants.find((e) => e.id === Number(edit.dataset.edit)));
    $('entrant-form').scrollIntoView({ behavior: 'smooth' });
  } else if (del) {
    const e = state.entrants.find((x) => x.id === Number(del.dataset.del));
    if (!confirm(`Delete #${e.car_number} ${fullName(e)} and all of their times?`)) return;
    try {
      await db.deleteEntrant(e.id);
      await refresh();
    } catch (err) {
      flashMsg('entrant-msg', err.message, false);
    }
  }
});

$('entrant-table').addEventListener('change', async (ev) => {
  const box = ev.target.closest('[data-out]');
  if (!box) return;
  try {
    await db.setOut(Number(box.dataset.out), box.checked);
    await refresh();
  } catch (err) {
    box.checked = !box.checked;
    flashMsg('entrant-msg', err.message, false);
  }
});

$('import-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (file) $('import-text').value = await file.text();
});

$('import-go').addEventListener('click', async () => {
  try {
    const r = await db.importEntrants(csvToEntrants($('import-text').value));
    flashMsg('import-msg', `Imported: ${r.added} added, ${r.updated} updated`);
    $('import-text').value = '';
    await refresh();
  } catch (err) {
    flashMsg('import-msg', err.message, false);
  }
});

// ---------- classes & days ----------
// Day edits are kept in a draft until "Save days", so live refreshes don't wipe them.
let draftDays = null;
let daysDirty = false;

function renderSetup() {
  renderDaysTable();
  renderClassesTable();
}

function renderDaysTable() {
  if (!daysDirty) draftDays = state.days.map((d) => ({ ...d }));
  $('days-table').innerHTML = `<thead><tr><th>Day #</th><th>Location / track</th><th>Date</th><th></th></tr></thead><tbody>
    ${draftDays
      .map(
        (d, i) => `<tr><td><input class="w-num" data-day-field="num" data-i="${i}" value="${esc(d.num)}" inputmode="numeric" /></td>
        <td><input data-day-field="location" data-i="${i}" value="${esc(d.location)}" /></td>
        <td><input type="date" data-day-field="date" data-i="${i}" value="${esc(d.date)}" /></td>
        <td><button class="btn small danger" data-day-del="${i}">Remove</button></td></tr>`,
      )
      .join('')}</tbody>`;
}

function renderClassesTable() {
  if (document.activeElement?.closest('#classes-table')) return; // don't clobber an edit in progress
  const dayNums = state.days.map((d) => d.num);
  $('classes-table').innerHTML = `<thead><tr><th>Code</th><th>Name</th><th>Waived days</th><th class="r">Entrants</th><th></th></tr></thead><tbody>
    ${[...state.classes, { code: '', name: '', waivedDays: [], isNew: true }]
      .map((c) => {
        const count = state.entrants.filter((e) => e.class_code === c.code).length;
        return `<tr data-class="${esc(c.code)}">
          <td><input class="w-code" name="code" value="${esc(c.code)}" placeholder="${c.isNew ? 'New' : ''}" /></td>
          <td><input name="name" value="${esc(c.name)}" placeholder="${c.isNew ? 'Class name' : ''}" /></td>
          <td><div class="waive-boxes">${dayNums.map((n) => `<label><input type="checkbox" name="waive" value="${n}" ${c.waivedDays.includes(n) ? 'checked' : ''} />${n}</label>`).join('')}</div></td>
          <td class="r">${c.isNew ? '' : count}</td>
          <td class="nowrap">${c.isNew ? '<button class="btn small primary" data-class-save>Add class</button>' : `<button class="btn small ghost" data-class-save>Save</button> <button class="btn small danger" data-class-del>Delete</button>`}</td></tr>`;
      })
      .join('')}</tbody>`;
}

$('days-table').addEventListener('input', (e) => {
  const el = e.target.closest('[data-day-field]');
  if (!el) return;
  draftDays[Number(el.dataset.i)][el.dataset.dayField] = el.value;
  daysDirty = true;
});
$('days-table').addEventListener('click', (e) => {
  const del = e.target.closest('[data-day-del]');
  if (!del) return;
  draftDays.splice(Number(del.dataset.dayDel), 1);
  daysDirty = true;
  renderDaysTable();
});
$('day-add').addEventListener('click', () => {
  const next = Math.max(0, ...draftDays.map((d) => Number(d.num) || 0)) + 1;
  draftDays.push({ num: next, location: '', date: '' });
  daysDirty = true;
  renderDaysTable();
});
$('days-save').addEventListener('click', async () => {
  const removed = state.days.filter((d) => !draftDays.some((x) => Number(x.num) === d.num));
  const lost = state.runs.filter((r) => removed.some((d) => d.num === r.day)).length;
  if (lost && !confirm(`Removing day(s) ${removed.map((d) => d.num).join(', ')} will delete ${lost} entered time(s). Continue?`)) return;
  try {
    await db.saveDays(draftDays);
    daysDirty = false;
    flashMsg('days-msg', 'Days saved');
    await refresh();
  } catch (err) {
    flashMsg('days-msg', err.message, false);
  }
});

$('classes-table').addEventListener('click', async (e) => {
  const row = e.target.closest('tr[data-class]');
  if (!row) return;
  const original = row.dataset.class;
  if (e.target.closest('[data-class-save]')) {
    const body = {
      code: row.querySelector('[name=code]').value,
      name: row.querySelector('[name=name]').value,
      waivedDays: [...row.querySelectorAll('[name=waive]:checked')].map((b) => Number(b.value)),
    };
    try {
      await db.saveClass({ ...body, sort: state.classes.length }, original);
      document.activeElement.blur();
      flashMsg('classes-msg', `Saved class ${body.code.toUpperCase()}`);
      await refresh();
    } catch (err) {
      flashMsg('classes-msg', err.message, false);
    }
  } else if (e.target.closest('[data-class-del]')) {
    if (!confirm(`Delete class ${original}?`)) return;
    try {
      await db.deleteClass(original);
      document.activeElement.blur();
      await refresh();
    } catch (err) {
      flashMsg('classes-msg', err.message, false);
    }
  }
});

// ---------- settings ----------
function renderSettings() {
  const f = $('settings-form');
  if (f.contains(document.activeElement)) return;
  f.elements.eventName.value = state.event.eventName;
  f.elements.penaltyRt.value = fmt(state.event.penaltyRt, 3);
  f.elements.penaltyEt.value = fmt(state.event.penaltyEt, 3);
  f.elements.penaltyMph.value = fmt(state.event.penaltyMph, 2);
}

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await db.saveSettings({
      eventName: f.elements.eventName.value,
      penaltyRt: f.elements.penaltyRt.value,
      penaltyEt: f.elements.penaltyEt.value,
      penaltyMph: f.elements.penaltyMph.value,
    });
    document.activeElement.blur();
    flashMsg('settings-msg', 'Settings saved');
    await refresh();
  } catch (err) {
    flashMsg('settings-msg', err.message, false);
  }
});

// ---------- daily spreadsheet upload ----------
// SheetJS reads .xlsx/.xls/.csv in the browser; loaded only when someone uploads a file.
const SHEETJS_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';
let sheetJs = null;
function loadSheetJs() {
  sheetJs ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src: SHEETJS_URL, onload: () => resolve(window.XLSX) });
    s.onerror = () => {
      sheetJs = null;
      reject(new Error('Could not load the spreadsheet reader. Check the internet connection and try again.'));
    };
    document.head.append(s);
  });
  return sheetJs;
}

let pendingSheet = null;

function resetSheet() {
  pendingSheet = null;
  $('sheet-preview').hidden = true;
  $('sheet-file').value = '';
  $('sheet-name').textContent = '';
}

async function readSheet(file) {
  resetSheet();
  $('sheet-result').innerHTML = '';
  $('sheet-name').textContent = file.name;
  flashMsg('sheet-msg', 'Reading spreadsheet…');
  try {
    const XLSX = await loadSheetJs();
    const wb = XLSX.read(await file.arrayBuffer());
    // Use the first sheet that has a recognisable header row.
    let parsed = null;
    let lastError = null;
    for (const name of wb.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
      try {
        parsed = { ...parseResultsSheet(grid), sheetName: name };
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (!parsed) throw lastError ?? new Error('The file has no sheets');
    if (!parsed.entrants.length) throw new Error('No driver rows found under the header row.');
    pendingSheet = parsed;
    renderSheetPreview(parsed);
    $('sheet-msg').textContent = '';
  } catch (err) {
    flashMsg('sheet-msg', err.message, false);
  }
}

function renderSheetPreview(p) {
  const known = new Set(state.classes.map((c) => c.code));
  const existing = new Set(state.entrants.map((e) => e.car_number));
  const newCars = p.entrants.filter((e) => !existing.has(e.car_number)).length;
  const stats = [
    [p.entrants.length, 'drivers'],
    [newCars, 'new drivers'],
    [p.runCount, 'times'],
    [p.outCount, 'marked out'],
    [p.days.length ? `${p.days[0]}–${p.days.at(-1)}` : '—', 'days'],
  ];
  $('sheet-stats').innerHTML = stats.map(([n, l]) => `<div class="stat"><b>${esc(n)}</b><span>${esc(l)}</span></div>`).join('');
  $('sheet-classes').innerHTML = `<thead><tr><th>Class</th><th class="r">Drivers</th>${p.days.map((d) => `<th class="r">Day ${d}</th>`).join('')}</tr></thead><tbody>
    ${p.classes
      .map((code) => {
        const rows = p.entrants.filter((e) => e.class_code === code);
        const name = rows.find((e) => e.class_name)?.class_name ?? '';
        const perDay = p.days.map((d) => rows.filter((e) => e.runs.some((r) => r.day === d)).length);
        return `<tr><td><b>${esc(code)}</b> ${esc(name)}${known.has(code) ? '' : ' <span class="tag new">NEW CLASS</span>'}</td>
          <td class="r">${rows.length}</td>${perDay.map((n) => `<td class="r">${n || '—'}</td>`).join('')}</tr>`;
      })
      .join('')}</tbody>`;
  const notes = [...p.warnings];
  const unknown = p.classes.filter((c) => !known.has(c));
  if (unknown.length) notes.unshift(`New class${unknown.length > 1 ? 'es' : ''} ${unknown.join(', ')} will be created. Set waived days on the Classes & days tab afterwards.`);
  const dayNums = new Set(state.days.map((d) => d.num));
  const missingDays = p.days.filter((d) => !dayNums.has(d));
  if (missingDays.length) notes.unshift(`Day ${missingDays.join(', ')} isn't set up as an event day, so those times will be skipped.`);
  $('sheet-warnings').innerHTML = notes.length
    ? `<div class="notice"><b>Check before importing</b><ul>${notes.slice(0, 50).map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`
    : '';
  $('sheet-preview').hidden = false;
}

$('sheet-file').addEventListener('change', (e) => e.target.files[0] && readSheet(e.target.files[0]));
const drop = $('sheet-drop');
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  drop.classList.add('over');
});
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  if (e.dataTransfer.files[0]) readSheet(e.dataTransfer.files[0]);
});
$('sheet-cancel').addEventListener('click', () => {
  resetSheet();
  $('sheet-msg').textContent = '';
});

$('sheet-import').addEventListener('click', async () => {
  if (!pendingSheet) return;
  const btn = $('sheet-import');
  btn.disabled = true;
  flashMsg('sheet-msg', `Importing ${pendingSheet.entrants.length} drivers…`);
  try {
    const r = await db.importResults(pendingSheet.entrants);
    const skipped = r.skipped ?? [];
    $('sheet-msg').textContent = '';
    $('sheet-result').innerHTML = `<div class="saved-card"><div><b>Imported ${esc(pendingSheet.sheetName)}</b><br>
      ${r.added} new and ${r.updated} updated drivers · ${r.runs} times saved${r.classesAdded ? ` · ${r.classesAdded} new classes` : ''}${skipped.length ? ` · ${skipped.length} times skipped` : ''}.
      The public standings are already updated.</div></div>
      ${skipped.length ? `<div class="notice"><b>Skipped times</b><ul>${skipped.slice(0, 100).map((s) => `<li>Car #${esc(s.car)} day ${esc(s.day)}: ${esc(s.reason)}</li>`).join('')}</ul></div>` : ''}`;
    resetSheet();
    await refresh();
  } catch (err) {
    flashMsg('sheet-msg', err.message, false);
  } finally {
    btn.disabled = false;
  }
});

// ---------- clear results ----------
async function clearResults(kind) {
  const drivers = state.entrants.length;
  const times = state.runs.length;
  const what = kind === 'all' ? `all ${drivers} drivers and ${times} times` : `all ${times} times (drivers are kept)`;
  const typed = prompt(`This permanently deletes ${what} from the live results.\n\nType CLEAR to confirm.`);
  if (typed?.trim().toUpperCase() !== 'CLEAR') return flashMsg('clear-msg', 'Nothing was deleted', false);
  try {
    await (kind === 'all' ? db.clearDriversAndTimes() : db.clearTimes());
    flashMsg('clear-msg', kind === 'all' ? 'All drivers and times cleared' : 'All times cleared');
    await refresh();
  } catch (err) {
    flashMsg('clear-msg', err.message, false);
  }
}
$('clear-times').addEventListener('click', () => clearResults('times'));
$('clear-all').addEventListener('click', () => clearResults('all'));

// ---------- your password ----------
$('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pw = $('new-password').value;
  if (pw !== $('new-password-2').value) return flashMsg('password-msg', "Passwords don't match", false);
  try {
    await db.changePassword(pw);
    e.target.reset();
    flashMsg('password-msg', 'Password changed');
  } catch (err) {
    flashMsg('password-msg', err.message, false);
  }
});

// ---------- admins ----------
async function renderAdmins() {
  try {
    const admins = await db.listAdmins();
    $('admins-table').innerHTML = `<tbody>${admins
      .map((a) => `<tr><td>${esc(a.email)}</td><td class="r"><button class="btn small danger" data-admin-del="${esc(a.email)}">Remove</button></td></tr>`)
      .join('')}</tbody>`;
  } catch (err) {
    flashMsg('admins-msg', err.message, false);
  }
}

$('admin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('admin-email').value;
  try {
    await db.addAdmin(email);
    $('admin-email').value = '';
    flashMsg('admins-msg', `Added ${email.trim().toLowerCase()}`);
    renderAdmins();
  } catch (err) {
    flashMsg('admins-msg', err.message, false);
  }
});

$('admins-table').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-admin-del]');
  if (!btn || !confirm(`Remove ${btn.dataset.adminDel} from admins?`)) return;
  try {
    await db.removeAdmin(btn.dataset.adminDel);
    renderAdmins();
  } catch (err) {
    flashMsg('admins-msg', err.message, false);
  }
});

$('csv').addEventListener('click', () => {
  downloadFile(`${state.event.eventName.replace(/[^\w-]+/g, '_')}_standings.csv`, standingsToCsv(state.days, state.standings));
});

// ---------- boot ----------
// Fires once on load with the saved session, then on every sign-in/out. Deferred because
// supabase-js must not be called from inside its own auth callback.
let lastEmail;
db.onAuthChange((email) => {
  if (email === lastEmail) return; // token refreshes
  lastEmail = email;
  setTimeout(checkAccess, 0);
});
