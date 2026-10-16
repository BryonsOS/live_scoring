export const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const fmt = (n, places) => (n == null || n === '' ? '—' : Number(n).toFixed(places));

export const timeAgo = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};

export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* private mode etc. */
    }
  },
};

export function setLiveBadge(status) {
  const el = document.getElementById('live');
  const text = document.getElementById('live-text');
  el.className = `live ${status === 'live' ? 'on' : 'off'}`;
  text.textContent = { live: 'LIVE', polling: 'Auto-refresh', offline: 'Reconnecting…' }[status];
  el.title = {
    live: 'Updates appear the moment a time is entered',
    polling: 'Live connection unavailable; refreshing every few seconds',
    offline: 'Cannot reach the results server; retrying',
  }[status];
}

export function downloadFile(name, text, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Day/Night switch. Day is the default; the choice is remembered per device.
const ICONS = {
  light: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
};
export function initThemeToggle(button) {
  const paint = () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    // The button shows the mode you'd switch to.
    const next = theme === 'dark' ? 'light' : 'dark';
    button.innerHTML = `${ICONS[next]}<span>${next === 'dark' ? 'Night' : 'Day'}</span>`;
    button.setAttribute('aria-label', `Switch to ${next === 'dark' ? 'night' : 'day'} mode`);
  };
  button.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('ls.theme', next);
    paint();
  });
  paint();
}
