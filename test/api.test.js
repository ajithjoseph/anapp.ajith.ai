import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { openDb } from '../lib/db.js';
import { createApp } from '../lib/app.js';

let server;
let base;

before(async () => {
  server = createServer(createApp(openDb(':memory:'), { signupsPerHour: 1000 }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
  };
}

const LAUNCH = { title: 'Splitty', tagline: 'Split the bill', url: 'https://splitty.example', tags: 'Tool, finance, tool' };

test('sign up, plan, launch, streak', async () => {
  const ana = client();
  const up = await ana('/api/signup', { method: 'POST', body: { email: 'ana@example.com', handle: 'ana', password: 'longenough', tz: 'UTC' } });
  assert.equal(up.status, 200);
  assert.equal(up.data.user.handle, 'ana');
  assert.equal(up.data.streak.current, 0);
  assert.ok(up.data.idea_of_the_day);

  const plan = await ana('/api/plan', { method: 'PUT', body: { idea: 'Bill splitter', steps: { idea: true, bogus: true } } });
  assert.deepEqual(plan.data.plan.steps, { idea: true });

  const l = await ana('/api/launch', { method: 'PUT', body: LAUNCH });
  assert.equal(l.status, 200);
  assert.equal(l.data.launch.title, 'Splitty');
  assert.deepEqual(l.data.launch.tags, ['tool', 'finance']);
  assert.equal(l.data.streak.current, 1);
  assert.equal(l.data.plan.steps.ship, true);

  // editing keeps one launch for the day
  await ana('/api/launch', { method: 'PUT', body: { ...LAUNCH, title: 'Splitty 2' } });
  const prof = await ana('/api/users/ana');
  assert.equal(prof.data.launches.length, 1);
  assert.equal(prof.data.launches[0].title, 'Splitty 2');
  assert.equal(prof.data.maker.email, undefined);
});

test('launch input is checked', async () => {
  const c = client();
  await c('/api/signup', { method: 'POST', body: { email: 'bo@example.com', handle: 'bob', password: 'longenough' } });
  const js = await c('/api/launch', { method: 'PUT', body: { ...LAUNCH, url: 'javascript:alert(1)' } });
  assert.equal(js.status, 400);
  const noTitle = await c('/api/launch', { method: 'PUT', body: { ...LAUNCH, title: ' ' } });
  assert.equal(noTitle.status, 400);
});

test('voting toggles, and not on your own launch', async () => {
  const cy = client();
  await cy('/api/signup', { method: 'POST', body: { email: 'cy@example.com', handle: 'cyd', password: 'longenough' } });
  const mine = await cy('/api/launch', { method: 'PUT', body: LAUNCH });
  const id = mine.data.launch.id;
  assert.equal((await cy(`/api/launches/${id}/vote`, { method: 'POST', body: {} })).status, 400);

  const di = client();
  await di('/api/signup', { method: 'POST', body: { email: 'di@example.com', handle: 'dia', password: 'longenough' } });
  const v1 = await di(`/api/launches/${id}/vote`, { method: 'POST', body: {} });
  assert.deepEqual(v1.data, { votes: 1, voted: true });
  const feed = await di('/api/feed?sort=top');
  assert.equal(feed.data.launches[0].id, id);
  assert.equal(feed.data.launches[0].voted, true);
  const v2 = await di(`/api/launches/${id}/vote`, { method: 'POST', body: {} });
  assert.deepEqual(v2.data, { votes: 0, voted: false });
});

test('accounts: duplicates, wrong password, sign out', async () => {
  const e = client();
  await e('/api/signup', { method: 'POST', body: { email: 'ed@example.com', handle: 'eddy', password: 'longenough' } });
  const dupe = await client()('/api/signup', { method: 'POST', body: { email: 'ED@example.com', handle: 'eddy2', password: 'longenough' } });
  assert.equal(dupe.status, 409);
  const dupeHandle = await client()('/api/signup', { method: 'POST', body: { email: 'x@example.com', handle: 'EDDY', password: 'longenough' } });
  assert.equal(dupeHandle.status, 409);

  const wrong = await client()('/api/login', { method: 'POST', body: { email: 'ed@example.com', password: 'nope-nope' } });
  assert.equal(wrong.status, 401);
  const nobody = await client()('/api/login', { method: 'POST', body: { email: 'ghost@example.com', password: 'nope-nope' } });
  assert.equal(nobody.status, 401);

  const f = client();
  const ok = await f('/api/login', { method: 'POST', body: { email: 'ed@example.com', password: 'longenough' } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  await f('/api/logout', { method: 'POST', body: {} });
  assert.equal((await f('/api/me')).data.user, null);
});

test('changes need JSON from this site', async () => {
  const form = await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'a=b' });
  assert.equal(form.status, 415);
  const c = client();
  const cross = await c('/api/signup', { method: 'POST', body: {}, headers: { Origin: 'https://evil.example' } });
  assert.equal(cross.status, 403);
  assert.equal((await client()('/api/launch', { method: 'PUT', body: LAUNCH })).status, 401);
});

test('pages and files are served, nothing outside public/', async () => {
  const page = await fetch(base + '/u/ana');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Launch a Day/);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/..%2fpackage.json')).status, 404);
  assert.equal((await fetch(base + '/%E0%A4%A')).status, 400);
});

test('sign-ups are rate limited', async () => {
  const s2 = createServer(createApp(openDb(':memory:'), { signupsPerHour: 1 }));
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s2.address().port}/api/signup`;
  const post = (n) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `r${n}@example.com`, handle: `rr${n}`, password: 'longenough' }) });
  assert.equal((await post(1)).status, 200);
  assert.equal((await post(2)).status, 429);
  s2.close();
});

test('behind a proxy, limits count each visitor', async () => {
  const s3 = createServer(createApp(openDb(':memory:'), { signupsPerHour: 1, trustProxy: true }));
  await new Promise((r) => s3.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${s3.address().port}/api/signup`;
  const post = (n, xff) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff }, body: JSON.stringify({ email: `p${n}@example.com`, handle: `pp${n}`, password: 'longenough' }) });
  assert.equal((await post(1, '203.0.113.1')).status, 200);
  assert.equal((await post(2, '203.0.113.2')).status, 200);
  // a client can't dodge the limit by sending its own header first
  assert.equal((await post(3, '198.51.100.9, 203.0.113.2')).status, 429);
  s3.close();
});

test('leaderboard and stats', async () => {
  const lb = await client()('/api/leaderboard');
  assert.ok(lb.data.makers.length >= 1);
  assert.equal(lb.data.makers[0].current, 1);
  const st = await client()('/api/stats');
  assert.ok(st.data.launches >= 2);
});
