import { esc, fmt, timeAgo, store, setLiveBadge, downloadFile, initThemeToggle } from './common.js';

import { watch } from './data.js';
import { standingsToCsv } from './csv.js';

const $ = (id) => document.getElementById(id);
initThemeToggle($('theme-toggle'));
let data = null;
let receivedAt = 0;
let selected = store.get('ls.class', 'ALL');
let query = '';
const openRows = new Set();
// Signature of each driver's results, used to flash rows that just changed.
let lastSigs = null;

const rowSig = (r) => JSON.stringify([r.results, r.out, r.rank]);
const fullName = (r) => `${r.firstName} ${r.lastName}`.trim();

function dayCell(res) {
  if (res === null || res === undefined) return '<td class="day-cell day-col empty-day">—</td>';
  if (res.waived) return '<td class="day-cell day-col waived">Waiver</td>';
  return `<td class="day-cell day-col num${res.penalty ? ' pen' : ''}"${res.penalty ? ' title="No time recorded (penalty)"' : ''}>
    <span class="et">${fmt(res.et, 3)}</span>
    <span class="small">${fmt(res.rt, 3)} · ${fmt(res.mph, 2)}</span></td>`;
}

function detailGrid(row, days) {
  return days
    .map((d) => {
      const r = row.results[d.num];
      const body = !r ? '<span class="sub-line">No time yet</span>' : r.waived ? '<span class="sub-line">Waiver</span>'
        : `<b>${fmt(r.et, 3)}</b>${r.penalty ? '<span class="tag pen">NO TIME</span>' : ''}<br>${fmt(r.rt, 3)} RT · ${fmt(r.mph, 2)} mph`;
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
  const classes = data.standings.filter((c) => c.rows.length > 0 || c.code === selected);
  if (selected !== 'ALL' && !data.standings.some((c) => c.code === selected)) selected = 'ALL';
  $('chips').innerHTML =
    `<button class="chip all" data-code="ALL" aria-pressed="${selected === 'ALL'}">All classes</button>` +
    classes
      .map((c) => `<button class="chip" data-code="${esc(c.code)}" aria-pressed="${c.code === selected}"><span class="code">${esc(c.code)}</span>${esc(c.name)}</button>`)
      .join('');
}

function renderTicker(fresh) {
  $('ticker').innerHTML = data.recent
    .slice(0, 12)
    .map(
      (r, i) => `<div class="tick${fresh && i === 0 ? ' fresh' : ''}">
        <div class="who"><b>#${esc(r.carNumber)}</b> ${esc(r.name)}</div>
        <div><span class="res num">${r.penalty ? 'No time' : `${fmt(r.et, 3)} @ ${fmt(r.mph, 2)}`}</span>
          <span class="meta">· ${esc(r.classCode)} · Day ${r.day} · ${timeAgo(r.at)}</span></div></div>`,
    )
    .join('');
}

function renderUpdated() {
  if (receivedAt) $('updated').textContent = `Updated ${timeAgo(new Date(receivedAt).toISOString())}`;
}

function renderClasses(changed) {
  const days = data.days;
  const cols = days.length + 8;
  const classes = data.standings.filter((c) => selected === 'ALL' || c.code === selected);
  const html = classes
    .map((cls) => {
      const rows = cls.rows.filter(matches);
      if (query && rows.length === 0) return '';
      if (selected === 'ALL' && cls.rows.length === 0) return ''; // skip classes nobody entered
      const leader = cls.rows.find((r) => r.rank === 1);
      const waived = cls.waivedDays.length ? ` · Day ${cls.waivedDays.join(', ')} waived` : '';
      const head = `<tr><th>Pos</th><th>Car</th><th>Driver</th><th class="vehicle-col">Vehicle</th>
        ${days.map((d) => `<th class="r day-col">Day ${d.num}<span class="loc">${esc(d.location)}</span></th>`).join('')}
        <th class="r">Avg ET</th><th class="r gap-col">Gap</th><th class="r">Avg MPH</th><th class="r avg-rt-col">Avg RT</th></tr>`;
      let outShown = false;
      const body = rows.length
        ? rows
            .map((r) => {
              const key = `${cls.code}:${r.entrantId}`;
              const open = openRows.has(key);
              const flash = changed.has(r.entrantId) ? ' flash' : '';
              // Gap to the leader only means something when both have run the same number of days.
              const gap = r.rank > 1 && leader && r.completed === leader.completed ? `+${(r.avgEt - leader.avgEt).toFixed(3)}` : '';
              const divider = r.out && !outShown ? ((outShown = true), `<tr class="out-divider"><td colspan="${cols}">Out of competition</td></tr>`) : '';
              return `${divider}<tr class="main-row${r.out ? ' out' : ''}${r.rank ? ` pos-${r.rank}` : ''}${flash}${open ? ' open' : ''}" data-key="${esc(key)}">
                <td class="pos num">${r.rank ? `<span class="pos-pill">${r.rank}</span>` : ''}</td>
                <td class="car-no num">${esc(r.carNumber)}</td>
                <td><span class="driver">${esc(fullName(r))}${r.out ? '<span class="tag out">OUT</span>' : ''}<span class="chev">›</span></span>
                  <div class="sub-line">${r.completed} of ${r.required} days</div></td>
                <td class="vehicle-col vehicle">${esc([r.year, r.make, r.model].filter(Boolean).join(' '))}<div class="sub-line">${esc(r.color)}</div></td>
                ${days.map((d) => dayCell(r.results[d.num])).join('')}
                <td class="r avg avg-et num">${fmt(r.avgEt, 3)}</td>
                <td class="r gap gap-col num">${gap}</td>
                <td class="r avg num">${fmt(r.avgMph, 2)}</td>
                <td class="r avg avg-rt-col num">${fmt(r.avgRt, 3)}</td>
              </tr>
              <tr class="details-row${open ? ' open' : ''}"><td colspan="${cols}">
                <div class="vehicle">${esc([r.year, r.make, r.model, r.color].filter(Boolean).join(' · '))}</div>
                <div class="sub-line">Avg RT ${fmt(r.avgRt, 3)}${gap ? ` · ${gap} behind the leader` : ''}</div>
                <div class="day-grid">${detailGrid(r, days)}</div></td></tr>`;
            })
            .join('')
        : `<tr><td colspan="${cols}" class="empty">No entrants yet</td></tr>`;
      return `<section class="class-card">
        <div class="class-head"><span class="class-code">${esc(cls.code)}</span><h2>${esc(cls.name)}</h2>
          <span class="class-meta">${cls.rows.length} entrants${waived}</span></div>
        <div class="table-wrap"><table class="standings"><thead>${head}</thead><tbody>${body}</tbody></table></div>
      </section>`;
    })
    .join('');
  $('classes').innerHTML =
    html || `<p class="empty">${query ? `No drivers match “${esc(query)}”.` : 'No entrants yet. Standings appear here as soon as times are entered.'}</p>`;
}

function render(changed = new Set(), fresh = false) {
  if (!data) return;
  document.title = `${data.event.eventName} · Live Results`;
  $('event-name').textContent = data.event.eventName;
  renderUpdated();
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
  receivedAt = Date.now();
  render(changed, fresh);
}


$('chips').addEventListener('click', (e) => {
  const btn = e.target.closest('.chip');
  if (!btn) return;
  selected = btn.dataset.code;
  store.set('ls.class', selected);
  render();
  // The filter bar is pinned, so bring the newly picked class into view if we're scrolled past it.
  const pinned = document.querySelector('.topbar').offsetHeight + document.querySelector('.filters').offsetHeight;
  const top = $('classes').getBoundingClientRect().top + window.scrollY - pinned - 8;
  if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
});

// Pin the filter bar directly under the header, whatever height the header wraps to.
const setTopbarHeight = () =>
  document.documentElement.style.setProperty('--topbar-h', `${document.querySelector('.topbar').offsetHeight}px`);
setTopbarHeight();
window.addEventListener('resize', setTopbarHeight);

// Mouse wheels only scroll up/down; let them scroll sideways rows (phone-width class bar, latest results).
for (const el of [$('chips'), $('ticker')]) {
  el.addEventListener(
    'wheel',
    (e) => {
      if (el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
}
$('search').addEventListener('input', (e) => {
  query = e.target.value.trim().toLowerCase();
  render();
});
$('classes').addEventListener('click', (e) => {
  const row = e.target.closest('tr.main-row');
  if (!row) return;
  const key = row.dataset.key;
  openRows.has(key) ? openRows.delete(key) : openRows.add(key);
  row.classList.toggle('open', openRows.has(key));
  row.nextElementSibling.classList.toggle('open', openRows.has(key));
});
// Keep "x seconds ago" labels current between updates.
setInterval(renderUpdated, 5_000);
setInterval(() => data && renderTicker(false), 30_000);

$('csv').addEventListener('click', (e) => {
  e.preventDefault();
  if (!data) return;
  downloadFile(`${data.event.eventName.replace(/[^\w-]+/g, '_')}_standings.csv`, standingsToCsv(data.days, data.standings));
});

watch(onData, setLiveBadge);
