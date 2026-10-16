import { esc, fmt, timeAgo, store, subscribe } from './common.js';

const $ = (id) => document.getElementById(id);
let state = null;
let day = store.get('ls.admin.day', 1);
let editingEntrantId = null;
let stream = null;

// ---------- helpers ----------
async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 && path.startsWith('/api/admin')) showLogin();
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

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

async function refresh() {
  state = await api('GET', '/api/admin/state');
  if (!state.days.some((d) => d.num === day)) day = state.days[0]?.num ?? 1;
  $('event-name').textContent = `${state.event.eventName} · Admin`;
  renderDayPicker();
  renderDriverCard();
  renderRecent();
  renderEntrants();
  renderClassSelect();
  renderSetup();
  renderSettings();
}

// ---------- auth ----------
function showLogin() {
  $('login-view').hidden = false;
  $('app-view').hidden = true;
  $('logout').hidden = true;
  stream?.close();
  stream = null;
  $('password').focus();
}

async function showApp() {
  $('login-view').hidden = true;
  $('app-view').hidden = false;
  $('logout').hidden = false;
  await refresh();
  $('run-car').focus();
  // Another admin (or another tab) saving a time refreshes this screen too.
  stream = subscribe(
    () => refresh().catch(() => {}),
    (ok) => {
      $('live').className = `live ${ok ? 'on' : 'off'}`;
      $('live-text').textContent = ok ? 'LIVE' : 'Reconnecting…';
    },
  );
}

$('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('login-error').textContent = '';
  try {
    await api('POST', '/api/login', { password: $('password').value });
    $('password').value = '';
    await showApp();
  } catch (err) {
    $('login-error').textContent = err.message;
  }
});

$('logout').addEventListener('click', async () => {
  await api('POST', '/api/logout');
  showLogin();
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
  try {
    await api('PUT', '/api/admin/runs', body);
    flashMsg('run-msg', penalty ? `Penalty saved for #${carNumber}` : `Saved #${carNumber}: ${body.et} @ ${body.mph || '—'}`);
    resetRunForm();
    await refresh();
  } catch (err) {
    flashMsg('run-msg', err.message, false);
  }
}

$('run-form').addEventListener('submit', (e) => {
  e.preventDefault();
  submitRun(false);
});
$('run-penalty').addEventListener('click', () => submitRun(true));

function renderRecent() {
  const rows = state.recent;
  $('recent-table').innerHTML = rows.length
    ? `<thead><tr><th>Car</th><th>Driver</th><th>Day</th><th class="r">RT</th><th class="r">ET</th><th class="r">MPH</th><th>When</th><th></th></tr></thead><tbody>
      ${rows
        .map(
          (r) => `<tr><td><b>#${esc(r.car_number)}</b> <span class="muted">${esc(r.class_code)}</span></td>
          <td>${esc(`${r.first_name} ${r.last_name}`)}</td><td>${r.day}</td>
          <td class="r num">${fmt(r.rt, 3)}</td><td class="r num">${fmt(r.et, 3)}${r.penalty ? ' <span class="tag pen">NO TIME</span>' : ''}</td><td class="r num">${fmt(r.mph, 2)}</td>
          <td class="muted nowrap">${timeAgo(r.updated_at)}</td>
          <td class="nowrap"><button class="btn small ghost" data-edit-run="${r.entrant_id}:${r.day}">Edit</button>
            <button class="btn small danger" data-del-run="${r.entrant_id}:${r.day}">Delete</button></td></tr>`,
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
      await api('DELETE', `/api/admin/runs/${id}/${d}`);
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
    if (editingEntrantId) await api('PUT', `/api/admin/entrants/${editingEntrantId}`, body);
    else await api('POST', '/api/admin/entrants', body);
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
      await api('DELETE', `/api/admin/entrants/${e.id}`);
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
    await api('PUT', `/api/admin/entrants/${box.dataset.out}/out`, { out: box.checked });
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
    const r = await api('POST', '/api/admin/entrants/import', { csv: $('import-text').value });
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
    await api('PUT', '/api/admin/days', { days: draftDays });
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
      if (original) await api('PUT', `/api/admin/classes/${encodeURIComponent(original)}`, body);
      else await api('POST', '/api/admin/classes', body);
      document.activeElement.blur();
      flashMsg('classes-msg', `Saved class ${body.code.toUpperCase()}`);
      await refresh();
    } catch (err) {
      flashMsg('classes-msg', err.message, false);
    }
  } else if (e.target.closest('[data-class-del]')) {
    if (!confirm(`Delete class ${original}?`)) return;
    try {
      await api('DELETE', `/api/admin/classes/${encodeURIComponent(original)}`);
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
  f.elements.penaltyRt.value = state.event.penaltyRt;
  f.elements.penaltyEt.value = state.event.penaltyEt;
  f.elements.penaltyMph.value = state.event.penaltyMph;
}

$('settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  try {
    await api('PUT', '/api/admin/settings', {
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

// ---------- boot ----------
const { authed } = await api('GET', '/api/session');
authed ? showApp() : showLogin();
