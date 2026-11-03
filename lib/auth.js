import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

const SESSION_DAYS = 30;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return ['scrypt', salt.toString('base64'), key.toString('base64')].join('$');
}

export function checkPassword(password, stored) {
  const [kind, salt, key] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64');
  const got = scryptSync(password, Buffer.from(salt, 'base64'), want.length);
  return timingSafeEqual(want, got);
}

// A real hash to compare against when the email is unknown, so a wrong
// email takes as long as a wrong password.
export const DUMMY_HASH = hashPassword(randomBytes(12).toString('hex'));

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function createSession(db, userId) {
  const token = randomBytes(32).toString('base64url');
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
    sha256(token),
    userId,
    expires,
  );
  return { token, maxAge: SESSION_DAYS * 86400 };
}

export function userForToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), Date.now());
  return row ?? null;
}

export function endSession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
}

export function pruneSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

// A small in-memory limiter for sign-in attempts: per key, max per window.
export function limiter(max, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    const ok = list.length < max;
    if (ok) list.push(now);
    hits.set(key, list);
    if (hits.size > 10_000) hits.clear();
    return ok;
  };
}
