import { esc, fmt, timeAgo, store, subscribe } from './common.js';

const $ = (id) => document.getElementById(id);
let data = null;
let selected = store.get('ls.class', 'ALL');
let query = '';
const openRows = new Set();
// Signature of each driver's results, used to flash rows that just changed.
let lastSigs = null;

const rowSig = (r) => JSON.stringify([r.results, r.out, r.rank]);

function dayCell(res) {
  if (res === null || res === undefined) return '<td class="day-cell day-col"></td>';
  if (res.waived) return '<td class="day-cell day-col waived">Waiver</td>';
  return `<td class="day-cell day-col num${res.penalty ? ' pen' : ''}">
    <span class="et">${fmt(res.et, 3)}</span>
    <span class="small">${fmt(res.rt, 3)} · ${fmt(res.mph, 2)}</span></td>`;
}

function detailGrid(row, days) {
  return days
    .map((d) => {
      const r = row.results[d.num];
      const body = !r ? '<i>—</i>' : r.waived ? '<i>Waiver</i>' : `<b>${fmt(r.et, 3)}</b><br>${fmt(r.rt, 3)} RT<br>${fmt(r.mph, 2)} mph`;
      return `<div><span class="section-label">Day ${d.num}</span><br>${body}</div>`;
    })
    .join('');
}

function matches(row) {
  if (!query) return true;
  const hay = `${row.carNumber} ${row.firstName} ${row.lastName} ${row.make} ${row.model}`.toLowerCase();
  return query.split(/\s+/).every((q) => hay.includes(q));
}

function renderChips() {
  const opts = [{ code: 'ALL', label: 'All classes' }, ...data.standings.map((c) => ({ code: c.code, label: `${c.code} · ${c.name}` }))];
  if (!opts.some((o) => o.code === selected)) selected = 'ALL';
  $('chips').innerHTML = opts
    .map((o) => `<button class="chip" data-code="${esc(o.code)}" aria-pressed="${o.code === selected}">${esc(o.label)}</button>`)
    .join('');
}

function renderTicker(fresh) {
  $('ticker').innerHTML = data.recent
    .map(
      (r, i) => `<div class="tick${fresh && i === 0 ? ' fresh' : ''}">
        <b>#${esc(r.carNumber)}</b> ${esc(r.name)} <span class="class-meta">${esc(r.classCode)} · Day ${r.day}</span>
        — <span class="et num">${fmt(r.et, 3)}</span> <span class="num">@ ${fmt(r.mph, 2)}</span>${r.penalty ? '<span class="tag pen">NO TIME</span>' : ''}
        <span class="class-meta">${timeAgo(r.at)}</span></div>`,
    )
    .join('');
}

function renderClasses(changed) {
  const days = data.days;
  const classes = data.standings.filter((c) => selected === 'ALL' || c.code === selected);
  const html = classes
    .map((cls) => {
      const rows = cls.rows.filter(matches);
      if (query && rows.length === 0) return '';
      if (selected === 'ALL' && cls.rows.length === 0) return ''; // skip classes nobody entered
      const waived = cls.waivedDays.length ? ` · Day ${cls.waivedDays.join(', ')} waived` : '';
      const head = `<tr><th>Pos</th><th>Car</th><th>Driver</th><th class="vehicle-col">Vehicle</th>
        ${days.map((d) => `<th class="r day-col" title="${esc(d.location)}">Day ${d.num}<br><span style="text-transform:none;font-weight:400">${esc(d.location)}</span></th>`).join('')}
        <th class="r">Avg ET</th><th class="r">Avg MPH</th><th class="r avg-rt-col">Avg RT</th></tr>`;
      const body = rows.length
        ? rows
            .map((r) => {
              const key = `${cls.code}:${r.entrantId}`;
              const flash = changed.has(r.entrantId) ? ' flash' : '';
              return `<tr class="main-row ${r.out ? 'out' : ''} ${r.rank ? `pos-${r.rank}` : ''}${flash}" data-key="${esc(key)}">
                <td class="pos num">${r.rank ?? ''}</td>
                <td class="car-no num">${esc(r.carNumber)}</td>
                <td><span class="driver">${esc(r.firstName)} ${esc(r.lastName)}</span>${r.out ? '<span class="tag out">OUT</span>' : ''}
                  <div class="vehicle">${r.completed}/${r.required} days</div></td>
                <td class="vehicle-col vehicle">${esc([r.year, r.make, r.model].filter(Boolean).join(' '))}<br>${esc(r.color)}</td>
                ${days.map((d) => dayCell(r.results[d.num])).join('')}
                <td class="r avg avg-et num">${fmt(r.avgEt, 3)}</td>
                <td class="r avg num">${fmt(r.avgMph, 2)}</td>
                <td class="r avg avg-rt-col num">${fmt(r.avgRt, 3)}</td>
              </tr>
              <tr class="details-row${openRows.has(key) ? ' open' : ''}"><td colspan="${days.length + 7}">
                <div class="vehicle">${esc([r.year, r.make, r.model, r.color].filter(Boolean).join(' · '))} · Avg RT ${fmt(r.avgRt, 3)}</div>
                <div class="day-grid">${detailGrid(r, days)}</div></td></tr>`;
            })
            .join('')
        : `<tr><td colspan="${days.length + 7}" class="empty">No entrants yet</td></tr>`;
      return `<section class="class-card">
        <div class="class-head"><h2><span class="class-code">${esc(cls.code)}</span>${esc(cls.name)}</h2>
          <span class="class-meta">${cls.rows.length} entrants${waived}</span></div>
        <div class="table-wrap"><table class="standings"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      </section>`;
    })
    .join('');
  $('classes').innerHTML = html || '<p class="empty">No matching drivers.</p>';
}

function render(changed = new Set(), fresh = false) {
  if (!data) return;
  document.title = `${data.event.eventName} · Live Results`;
  $('event-name').textContent = data.event.eventName;
  $('updated').textContent = `Updated ${new Date(data.updatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}`;
  renderChips();
  renderTicker(fresh);
  renderClasses(changed);
}

function onData(next) {
  const sigs = new Map();
  const changed = new Set();
  for (const cls of next.standings) {
    for (const r of cls.rows) {
      const sig = rowSig(r);
      sigs.set(r.entrantId, sig);
      if (lastSigs && lastSigs.get(r.entrantId) !== sig) changed.add(r.entrantId);
    }
  }
  const fresh = !!lastSigs && next.recent[0]?.at !== data?.recent[0]?.at;
  lastSigs = sigs;
  data = next;
  render(changed, fresh);
}

function onStatus(ok) {
  $('live').className = `live ${ok ? 'on' : 'off'}`;
  $('live-text').textContent = ok ? 'LIVE' : 'Reconnecting…';
}

$('chips').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  selected = btn.dataset.code;
  store.set('ls.class', selected);
  render();
});
$('search').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  render();
});
$('classes').addEventListener('click', (e) => {
  const row = e.target.closest('tr.main-row');
  if (!row) return;
  const key = row.dataset.key;
  openRows.has(key) ? openRows.delete(key) : openRows.add(key);
  row.nextElementSibling.classList.toggle('open', openRows.has(key));
});
// Keep "x seconds ago" labels current between updates.
setInterval(() => data && renderTicker(false), 30_000);

subscribe(onData, onStatus);
