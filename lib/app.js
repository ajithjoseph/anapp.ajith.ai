import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  hashPassword,
  checkPassword,
  createSession,
  userForToken,
  endSession,
  limiter,
  DUMMY_HASH,
} from './auth.js';
import { dayIn, validTz, isDay, addDays, streaks } from './days.js';
import { ideaFor } from './ideas.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MAX_BODY = 32 * 1024;
const COOKIE = 'lad_session';
const STEPS = ['idea', 'scope', 'build', 'ship'];

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

// ---- validation -----------------------------------------------------------

function text(value, field, { min = 0, max = 200, required = false } = {}) {
  const s = typeof value === 'string' ? value.trim() : '';
  if (required && !s) throw bad(`${field} is required`);
  if (s.length < min) throw bad(`${field} must be at least ${min} characters`);
  if (s.length > max) throw bad(`${field} must be ${max} characters or fewer`);
  return s;
}

function url(value, field, { required = false } = {}) {
  const s = text(value, field, { max: 300, required });
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch {
    throw bad(`${field} must be a full link, like https://example.com`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw bad(`${field} must start with https:// or http://`);
  }
  return u.toString();
}

function tags(value) {
  const list = (Array.isArray(value) ? value : String(value ?? '').split(','))
    .map((t) => String(t).trim().toLowerCase().replace(/[^a-z0-9+#.-]/g, ''))
    .filter(Boolean);
  return [...new Set(list)].slice(0, 5).map((t) => t.slice(0, 20)).join(',');
}

// ---- shaping rows for the client ------------------------------------------

function publicUser(u) {
  return { handle: u.handle, name: u.name, bio: u.bio };
}

function launchOut(row) {
  return {
    id: row.id,
    day: row.day,
    title: row.title,
    tagline: row.tagline,
    url: row.url,
    repo_url: row.repo_url,
    notes: row.notes,
    tags: row.tags ? row.tags.split(',') : [],
    created_at: row.created_at,
    votes: row.votes ?? 0,
    voted: Boolean(row.voted),
    maker: row.handle ? { handle: row.handle, name: row.name } : undefined,
  };
}

const LAUNCH_SELECT = `
  SELECT l.*, u.handle, u.name,
    (SELECT COUNT(*) FROM votes v WHERE v.launch_id = l.id) AS votes,
    EXISTS (SELECT 1 FROM votes v WHERE v.launch_id = l.id AND v.user_id = ?) AS voted
  FROM launches l JOIN users u ON u.id = l.user_id`;

function launchDays(db, userId) {
  return db
    .prepare('SELECT day FROM launches WHERE user_id = ? ORDER BY day')
    .all(userId)
    .map((r) => r.day);
}

// ---- the app --------------------------------------------------------------

export function createApp(db, { secureCookies = false, trustProxy = false, signupsPerHour = 20, loginsPer15Min = 10 } = {}) {
  const loginLimit = limiter(loginsPer15Min, 15 * 60_000);
  const signupLimit = limiter(signupsPerHour, 60 * 60_000);

  function me(user) {
    const today = dayIn(user.tz);
    const plan = db.prepare('SELECT * FROM plans WHERE user_id = ? AND day = ?').get(user.id, today);
    const launch = db
      .prepare(`${LAUNCH_SELECT} WHERE l.user_id = ? AND l.day = ?`)
      .get(user.id, user.id, today);
    return {
      user: { ...publicUser(user), email: user.email, tz: user.tz },
      today,
      idea_of_the_day: ideaFor(today),
      plan: plan
        ? { idea: plan.idea, scope: plan.scope, steps: JSON.parse(plan.steps) }
        : { idea: '', scope: '', steps: {} },
      launch: launch ? launchOut(launch) : null,
      streak: streaks(launchDays(db, user.id), today),
    };
  }

  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],

    ['POST', /^\/api\/signup$/, ({ body, ip, res }) => {
      if (!signupLimit(ip)) throw new HttpError(429, 'Too many sign-ups from here. Try again later.');
      const email = text(body.email, 'Email', { max: 200, required: true }).toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('That email does not look right');
      const handle = text(body.handle, 'Username', { min: 3, max: 20, required: true }).toLowerCase();
      if (!/^[a-z0-9_-]+$/.test(handle)) throw bad('Username can use letters, numbers, - and _');
      const name = text(body.name, 'Name', { max: 60 }) || handle;
      const password = typeof body.password === 'string' ? body.password : '';
      if (password.length < 8) throw bad('Password must be at least 8 characters');
      if (password.length > 200) throw bad('Password is too long');
      const tz = validTz(body.tz) ? body.tz : 'UTC';
      const taken = db
        .prepare('SELECT email = ? AS same_email FROM users WHERE email = ? OR handle = ?')
        .get(email, email, handle);
      if (taken) {
        throw new HttpError(409, taken.same_email ? 'That email already has an account' : 'That username is taken');
      }
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (email, handle, name, password_hash, tz) VALUES (?, ?, ?, ?, ?)')
        .run(email, handle, name, hashPassword(password), tz);
      setSession(res, createSession(db, Number(lastInsertRowid)));
      return me(db.prepare('SELECT * FROM users WHERE id = ?').get(lastInsertRowid));
    }],

    ['POST', /^\/api\/login$/, ({ body, ip, res }) => {
      const email = text(body.email, 'Email', { max: 200, required: true }).toLowerCase();
      if (!loginLimit(`${ip}|${email}`)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
      const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const ok = checkPassword(password, user?.password_hash ?? DUMMY_HASH) && user;
      if (!ok) throw new HttpError(401, 'Email or password is wrong');
      if (validTz(body.tz) && body.tz !== user.tz) {
        db.prepare('UPDATE users SET tz = ? WHERE id = ?').run(body.tz, user.id);
        user.tz = body.tz;
      }
      setSession(res, createSession(db, user.id));
      return me(user);
    }],

    ['POST', /^\/api\/logout$/, ({ token, res }) => {
      endSession(db, token);
      res.setHeader('Set-Cookie', cookie('', 0));
      return { ok: true };
    }],

    ['GET', /^\/api\/idea$/, ({ query }) => {
      const day = query.get('day') ?? dayIn('UTC');
      if (!isDay(day)) throw bad('day must be YYYY-MM-DD');
      const offset = Math.trunc(Number(query.get('offset')) || 0) % 1000;
      return { idea: ideaFor(day, offset) };
    }],

    ['GET', /^\/api\/me$/, ({ user }) => (user ? me(user) : { user: null })],

    ['PUT', /^\/api\/me$/, ({ user, body }) => {
      need(user);
      const name = text(body.name, 'Name', { max: 60 }) || user.handle;
      const bio = text(body.bio, 'Bio', { max: 160 });
      if (body.tz !== undefined && !validTz(body.tz)) {
        throw bad('That time zone isn’t one we know. Use a name like America/New_York or Europe/London.');
      }
      const tz = body.tz ?? user.tz;
      db.prepare('UPDATE users SET name = ?, bio = ?, tz = ? WHERE id = ?').run(name, bio, tz, user.id);
      return me({ ...user, name, bio, tz });
    }],

    ['PUT', /^\/api\/plan$/, ({ user, body }) => {
      need(user);
      const today = dayIn(user.tz);
      const idea = text(body.idea, 'Idea', { max: 200 });
      const scope = text(body.scope, 'The one thing it does', { max: 280 });
      const steps = {};
      for (const s of STEPS) if (body.steps?.[s]) steps[s] = true;
      db.prepare(
        `INSERT INTO plans (user_id, day, idea, scope, steps) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET idea = excluded.idea, scope = excluded.scope, steps = excluded.steps`,
      ).run(user.id, today, idea, scope, JSON.stringify(steps));
      return me(user);
    }],

    // Today's launch: create it, or edit it until midnight.
    ['PUT', /^\/api\/launch$/, ({ user, body }) => {
      need(user);
      const today = dayIn(user.tz);
      const row = {
        title: text(body.title, 'Name', { max: 60, required: true }),
        tagline: text(body.tagline, 'Tagline', { max: 120, required: true }),
        url: url(body.url, 'Live link', { required: true }),
        repo_url: url(body.repo_url, 'Code link'),
        notes: text(body.notes, 'Notes', { max: 1000 }),
        tags: tags(body.tags),
      };
      db.prepare(
        `INSERT INTO launches (user_id, day, title, tagline, url, repo_url, notes, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET title = excluded.title, tagline = excluded.tagline,
           url = excluded.url, repo_url = excluded.repo_url, notes = excluded.notes, tags = excluded.tags,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      ).run(user.id, today, row.title, row.tagline, row.url, row.repo_url, row.notes, row.tags);
      // Launching ticks off "ship" on today's plan.
      const plan = db.prepare('SELECT steps FROM plans WHERE user_id = ? AND day = ?').get(user.id, today);
      const steps = { ...(plan ? JSON.parse(plan.steps) : {}), ship: true };
      db.prepare(
        `INSERT INTO plans (user_id, day, steps) VALUES (?, ?, ?)
         ON CONFLICT (user_id, day) DO UPDATE SET steps = excluded.steps`,
      ).run(user.id, today, JSON.stringify(steps));
      return me(user);
    }],

    ['DELETE', /^\/api\/launch$/, ({ user }) => {
      need(user);
      db.prepare('DELETE FROM launches WHERE user_id = ? AND day = ?').run(user.id, dayIn(user.tz));
      return me(user);
    }],

    ['GET', /^\/api\/feed$/, ({ user, query }) => {
      const viewer = user?.id ?? 0;
      const sort = query.get('sort') === 'top' ? 'top' : 'latest';
      const day = query.get('day');
      if (day !== null && !isDay(day)) throw bad('day must be YYYY-MM-DD');
      const before = Number(query.get('before')) || 0;
      let rows;
      if (sort === 'top') {
        const since = addDays(dayIn('UTC'), -7);
        rows = db
          .prepare(`${LAUNCH_SELECT} WHERE l.day >= ? ORDER BY votes DESC, l.id DESC LIMIT 30`)
          .all(viewer, since);
      } else if (day) {
        rows = db.prepare(`${LAUNCH_SELECT} WHERE l.day = ? ORDER BY l.id DESC LIMIT 100`).all(viewer, day);
      } else {
        rows = db
          .prepare(`${LAUNCH_SELECT} WHERE (? = 0 OR l.id < ?) ORDER BY l.id DESC LIMIT 30`)
          .all(viewer, before, before);
      }
      const launches = rows.map(launchOut);
      const next = sort === 'latest' && !day && launches.length === 30 ? launches.at(-1).id : null;
      return { launches, next };
    }],

    ['POST', /^\/api\/launches\/(\d+)\/vote$/, ({ user, params }) => {
      need(user);
      const id = Number(params[0]);
      const launch = db.prepare('SELECT user_id FROM launches WHERE id = ?').get(id);
      if (!launch) throw new HttpError(404, 'That launch is gone');
      if (launch.user_id === user.id) throw bad('You can’t upvote your own launch');
      const had = db.prepare('DELETE FROM votes WHERE user_id = ? AND launch_id = ?').run(user.id, id);
      if (had.changes === 0) db.prepare('INSERT INTO votes (user_id, launch_id) VALUES (?, ?)').run(user.id, id);
      const { votes } = db.prepare('SELECT COUNT(*) AS votes FROM votes WHERE launch_id = ?').get(id);
      return { votes, voted: had.changes === 0 };
    }],

    ['GET', /^\/api\/users\/([a-z0-9_-]{1,20})$/i, ({ user, params }) => {
      const maker = db.prepare('SELECT * FROM users WHERE handle = ?').get(params[0]);
      if (!maker) throw new HttpError(404, 'No maker with that username');
      const days = launchDays(db, maker.id);
      const launches = db
        .prepare(`${LAUNCH_SELECT} WHERE l.user_id = ? ORDER BY l.day DESC LIMIT 400`)
        .all(user?.id ?? 0, maker.id)
        .map(launchOut);
      return {
        maker: { ...publicUser(maker), joined: maker.created_at.slice(0, 10) },
        today: dayIn(maker.tz),
        streak: streaks(days, dayIn(maker.tz)),
        days,
        launches,
      };
    }],

    // Fine for thousands of makers; move streaks into a table past that.
    ['GET', /^\/api\/leaderboard$/, () => {
      const rows = db.prepare('SELECT l.day, u.id, u.handle, u.name, u.tz FROM launches l JOIN users u ON u.id = l.user_id').all();
      const byUser = new Map();
      for (const r of rows) {
        const e = byUser.get(r.id) ?? { maker: { handle: r.handle, name: r.name }, tz: r.tz, days: [] };
        e.days.push(r.day);
        byUser.set(r.id, e);
      }
      const makers = [...byUser.values()]
        .map((e) => ({ maker: e.maker, ...streaks(e.days, dayIn(e.tz)) }))
        .sort((a, b) => b.current - a.current || b.longest - a.longest || b.total - a.total)
        .slice(0, 50);
      return { makers };
    }],

    ['GET', /^\/api\/stats$/, () => {
      const today = dayIn('UTC');
      const one = (sql, ...a) => Object.values(db.prepare(sql).get(...a))[0];
      return {
        makers: one('SELECT COUNT(*) FROM users'),
        launches: one('SELECT COUNT(*) FROM launches'),
        today: one('SELECT COUNT(*) FROM launches WHERE day >= ?', addDays(today, -1)),
      };
    }],
  ];

  function need(user) {
    if (!user) throw new HttpError(401, 'Sign in first');
  }

  function cookie(value, maxAge) {
    return [
      `${COOKIE}=${value}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAge}`,
      secureCookies ? 'Secure' : '',
    ].filter(Boolean).join('; ');
  }

  function setSession(res, { token, maxAge }) {
    res.setHeader('Set-Cookie', cookie(token, maxAge));
  }

  async function serveStatic(pathname, res) {
    let rel;
    try {
      rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, '');
    } catch {
      return send(res, 400, { error: 'Bad path' });
    }
    if (!rel || rel.endsWith(sep) || !extname(rel)) rel = 'index.html';
    const file = join(PUBLIC_DIR, rel);
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, { error: 'Not found' });
    try {
      const data = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Cache-Control': rel === 'index.html' ? 'no-cache' : 'public, max-age=300',
      });
      res.end(data);
    } catch {
      send(res, 404, { error: 'Not found' });
    }
  }

  return async function handle(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );

    const { pathname, searchParams } = new URL(req.url, 'http://local');
    if (!pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      return serveStatic(pathname, res);
    }

    try {
      const route = routes.find(([m, re]) => m === req.method && re.test(pathname));
      if (!route) throw new HttpError(404, 'Not found');

      let body = {};
      if (req.method !== 'GET') {
        // Changes need a JSON body from this site: a cross-site form can't
        // send application/json, and a cross-site fetch carries its Origin.
        if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
          throw new HttpError(415, 'Send JSON');
        }
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Wrong origin');
        body = await readJson(req);
      }

      const token = parseCookies(req.headers.cookie)[COOKIE];
      const user = userForToken(db, token);
      // Behind a proxy every request comes from the proxy; the visitor is the
      // last address the proxy added (earlier ones are whatever the client sent).
      const forwarded = trustProxy ? String(req.headers['x-forwarded-for'] ?? '').split(',').at(-1).trim() : '';
      const ip = forwarded || req.socket.remoteAddress || '';
      const params = pathname.match(route[1]).slice(1);
      const out = await route[2]({ req, res, body, query: searchParams, params, user, token, ip });
      send(res, 200, out);
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      send(res, 500, { error: 'Something went wrong on our side' });
    }
  };
}

function send(res, status, obj) {
  if (res.headersSent) return res.end();
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'That is too much text'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch {
        reject(bad('That was not valid JSON'));
      }
    });
    req.on('error', reject);
  });
}
