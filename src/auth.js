import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'ls_admin';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

function sign(secret, payload) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function checkPassword(expected, given) {
  return typeof given === 'string' && safeEqual(sign('pw', expected), sign('pw', given));
}

export function sessionCookie(secret, secure) {
  const issued = Math.floor(Date.now() / 1000).toString();
  const token = `${issued}.${sign(secret, issued)}`;
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}${secure ? '; Secure' : ''}`;
}

export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}

export function isAuthed(req, secret) {
  const cookies = Object.fromEntries(
    (req.headers.cookie ?? '').split(';').map((c) => {
      const i = c.indexOf('=');
      return [c.slice(0, i).trim(), c.slice(i + 1).trim()];
    }),
  );
  const token = cookies[COOKIE];
  if (!token) return false;
  const [issued, sig] = token.split('.');
  if (!issued || !sig || !safeEqual(sig, sign(secret, issued))) return false;
  return Date.now() / 1000 - Number(issued) < MAX_AGE_SECONDS;
}
