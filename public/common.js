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
