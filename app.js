// Launch a Day: the whole front end. No framework, no build step.
// h() builds DOM nodes and never parses HTML, so user text can't inject markup.
// All data goes through js/store.js (Firebase).

import * as store from '/js/store.js';
import { dayIn, addDays, streaks, validTz } from '/js/days.js';
import { ideaFor } from '/js/ideas.js';

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

let profile = null; // the signed-in maker's profile, or null
let clockTimer = null;

// ---- helpers ---------------------------------------------------------------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    // via the CSSOM: the CSP blocks inline style attributes
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = Boolean(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), 2600);
}

function friendly(e) {
  if (e?.code === 'permission-denied') return 'That isn’t allowed. Try signing in again.';
  if (e?.code === 'unavailable') return 'Can’t reach the server. Check your connection.';
  return e?.message || 'Something went wrong';
}

function go(path) {
  history.pushState(null, '', path);
  render();
}

const link = (href, text, cls) => h('a', { href, class: cls, 'data-link': true }, text);
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function field(name, label, { type = 'text', value = '', hint, textarea, ...rest } = {}) {
  const id = `f-${name}`;
  const input = textarea
    ? h('textarea', { id, name, ...rest }, value)
    : h('input', { id, name, type, value, ...rest });
  return h('div', { class: 'field' }, h('label', { for: id }, label, hint ? h('span', { class: 'hint' }, ` ${hint}`) : null), input);
}

const prettyDay = (day) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
const shortDay = (day) =>
  new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function untilMidnight() {
  const now = new Date();
  const end = new Date(now);
  end.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((end - now) / 1000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

function skeleton(lines = 3) {
  return h('div', { class: 'stack', 'aria-busy': 'true', 'aria-label': 'Loading' },
    h('div', { class: 'sk', style: 'height:44px;width:55%' }),
    Array.from({ length: lines }, () => h('div', { class: 'sk', style: 'height:120px' })));
}

function notSetUp() {
  return h('div', { class: 'card empty' }, 'Sign-in isn’t switched on yet, so there’s nothing to show here. ',
    'It starts working once Firebase is connected (see the README).');
}

function cleanUrl(value, label, required) {
  const s = String(value ?? '').trim();
  if (!s) {
    if (required) throw new Error(`${label} is required`);
    return '';
  }
  let u;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`${label} must be a full link, like https://example.com`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`${label} must start with https:// or http://`);
  if (u.toString().length > 300) throw new Error(`${label} is too long`);
  return u.toString();
}

function cleanTags(value) {
  const list = String(value ?? '').split(',')
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9+#.-]/g, '').slice(0, 20))
    .filter(Boolean);
  return [...new Set(list)].slice(0, 5);
}

// ---- nav -------------------------------------------------------------------

function renderNav() {
  const path = location.pathname;
  const on = (p) => (path === p ? 'on' : '');
  $nav.replaceChildren(
    ...(profile
      ? [
          link('/', 'Today', on('/')),
          link('/feed', 'Launches', on('/feed')),
          link('/leaderboard', 'Streaks', on('/leaderboard')),
          link(`/u/${profile.handle}`, 'Me', on(`/u/${profile.handle}`)),
          link('/settings', 'Settings', on('/settings')),
        ]
      : [
          link('/feed', 'Launches', on('/feed')),
          link('/leaderboard', 'Streaks', on('/leaderboard')),
          link('/signin', 'Start', 'cta'),
        ]),
  );
}

// ---- launch card -----------------------------------------------------------

function launchCard(l, voted, { showMaker = true } = {}) {
  const mine = profile && store.user() && l.uid === store.user().uid;
  const count = h('span', {}, l.votes ?? 0);
  const vote = h('button', {
    class: `vote ${voted ? 'on' : ''}`,
    'aria-pressed': String(voted),
    'aria-label': `Upvote ${l.title}`,
    disabled: mine || undefined,
    title: mine ? 'Your launch' : 'Upvote',
    onclick: async () => {
      if (!profile) return go('/signin');
      vote.disabled = true;
      try {
        const r = await store.toggleVote(l);
        l.votes = r.votes;
        vote.classList.toggle('on', r.voted);
        vote.setAttribute('aria-pressed', String(r.voted));
        count.textContent = r.votes;
      } catch (e) {
        toast(friendly(e));
      }
      vote.disabled = false;
    },
  }, h('span', { class: 'arrow', 'aria-hidden': 'true' }, '▲'), count);

  return h('article', { class: 'card launch' },
    h('div', {},
      h('h3', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer ugc' }, l.title)),
      h('p', { class: 'tagline' }, l.tagline),
      l.notes ? h('p', { class: 'notes muted' }, l.notes) : null,
      h('div', { class: 'meta' },
        showMaker && l.handle ? link(`/u/${l.handle}`, `@${l.handle}`) : null,
        h('span', {}, shortDay(l.day)),
        l.repoUrl ? h('a', { href: l.repoUrl, target: '_blank', rel: 'noopener noreferrer ugc' }, 'code') : null,
        (l.tags ?? []).map((t) => h('span', { class: 'tag' }, t)),
      ),
    ),
    vote,
  );
}

async function cards(list, opts) {
  const mine = await store.myVotes();
  return list.map((l) => launchCard(l, mine.has(l.id), opts));
}

// ---- pages -----------------------------------------------------------------

async function landing() {
  $app.replaceChildren(skeleton(2));
  const yesterday = addDays(dayIn('UTC'), -1);
  const [stats, feed] = await Promise.all([store.stats(yesterday), store.latest(null, 5)]);
  const stat = (n, label) => h('div', { class: 'stat' }, h('b', {}, n ?? '–'), h('span', {}, label));
  $app.replaceChildren(
    h('section', { class: 'hero' },
      h('span', { class: 'pill' }, 'A daily shipping habit'),
      h('h1', {}, 'Ship one app. ', h('em', {}, 'Every day.')),
      h('p', { class: 'lead' }, 'Every morning you get an idea, a four-step plan and a clock that runs out at midnight. Build something tiny, put it online, and keep your streak alive.'),
      h('div', { class: 'row' }, link('/signin', 'Start today’s launch', 'btn primary'), link('/feed', 'See what people shipped', 'btn')),
      h('div', { class: 'stats' },
        stat(stats?.makers, 'makers'),
        stat(stats?.launches, 'apps launched'),
        stat(stats?.recent, 'in the last day'),
      ),
    ),
    h('section', { class: 'how' }, [
      ['Pick the idea', 'Use the idea of the day, or bring your own.'],
      ['Cut it to one thing', 'Write the single thing it does. Everything else waits for tomorrow.'],
      ['Build', 'A suggested timebox keeps you honest: plan, build, polish.'],
      ['Launch', 'Post the live link. It lands on the feed and your streak goes up.'],
    ].map(([t, d], i) => h('div', { class: 'card' }, h('b', { class: 'num' }, `STEP ${i + 1}`), h('h3', {}, t), h('p', { class: 'muted' }, d)))),
    h('h2', {}, 'Latest launches'),
    !store.isConfigured()
      ? notSetUp()
      : feed.launches.length
        ? h('div', { class: 'list' }, await cards(feed.launches))
        : h('div', { class: 'card empty' }, 'Nobody has launched yet. Be the first.'),
  );
}

async function today() {
  $app.replaceChildren(skeleton(4));
  const day = dayIn(profile.tz);
  const [plan0, launch, mine] = await Promise.all([
    store.getPlan(day),
    store.getLaunch(day),
    store.profileByHandle(profile.handle),
  ]);
  const plan = plan0 ?? { idea: '', scope: '', steps: {} };
  const steps = plan.steps ?? {};
  const launched = Boolean(launch);
  const streak = streaks((mine?.launches ?? []).map((l) => l.day), day);
  let offset = 0;

  const clock = h('div', { class: 'clock mono' }, untilMidnight());
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    if (!document.body.contains(clock)) return clearInterval(clockTimer);
    clock.textContent = untilMidnight();
  }, 1000);

  async function savePlan(patch) {
    try {
      await store.savePlan(day, { idea: plan.idea, scope: plan.scope, steps, ...patch });
      return true;
    } catch (e) {
      toast(friendly(e));
      return false;
    }
  }

  // Step 1: the idea
  const ideaOfDay = h('div', { class: 'idea' }, ideaFor(day));
  const ideaInput = h('input', { id: 'idea', name: 'idea', value: plan.idea, placeholder: 'Or type your own idea', maxlength: 200 });
  const step1 = h('section', { class: `card step ${steps.idea ? 'done' : ''}` },
    h('div', { class: 'step-head' }, h('h3', {}, 'Pick the idea'), steps.idea ? h('span', { class: 'pill done' }, 'Picked') : null),
    h('p', { class: 'muted' }, 'Idea of the day:'),
    ideaOfDay,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { ideaInput.value = ideaOfDay.textContent; } }, 'Use this one'),
      h('button', { class: 'btn small', onclick: () => { offset += 1; ideaOfDay.textContent = ideaFor(day, offset); } }, 'Show me another'),
    ),
    h('div', { class: 'field', style: 'margin-top:14px' }, h('label', { for: 'idea' }, 'Today I’m building'), ideaInput),
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn ink', onclick: async () => {
        const idea = ideaInput.value.trim();
        if (!idea) return toast('Write the idea first');
        if (await savePlan({ idea, steps: { ...steps, idea: true } })) today();
      } }, steps.idea ? 'Save' : 'Lock it in'),
    ),
  );

  // Step 2: scope
  const scopeInput = h('textarea', { id: 'scope', maxlength: 280, placeholder: 'It lets you … (one sentence)' }, plan.scope);
  const step2 = h('section', { class: `card step ${steps.scope ? 'done' : ''}` },
    h('div', { class: 'step-head' }, h('h3', {}, 'Cut it to one thing'), steps.scope ? h('span', { class: 'pill done' }, 'Scoped') : null),
    h('p', { class: 'muted' }, 'What is the one thing it does? No sign-up, no settings, no second feature. If it doesn’t fit in a sentence, it doesn’t fit in a day.'),
    h('div', { class: 'field' }, h('label', { for: 'scope' }, 'The one thing'), scopeInput),
    h('div', { class: 'row', style: 'margin-top:12px' },
      h('button', { class: 'btn ink', onclick: async () => {
        const scope = scopeInput.value.trim();
        if (!scope) return toast('Write the one thing first');
        if (await savePlan({ scope, steps: { ...steps, scope: true } })) today();
      } }, steps.scope ? 'Save' : 'That’s the scope'),
    ),
  );

  // Step 3: build
  const step3 = h('section', { class: `card step ${steps.build ? 'done' : ''}` },
    h('div', { class: 'step-head' }, h('h3', {}, 'Build it'), steps.build ? h('span', { class: 'pill done' }, 'Works') : null),
    h('p', { class: 'muted' }, 'A day that works for most people:'),
    h('ol', { class: 'timebox' },
      h('li', {}, '30 min: sketch the one screen'),
      h('li', {}, '3–4 hours: make the one thing work'),
      h('li', {}, '1 hour: make it look decent on a phone'),
      h('li', {}, '30 min: put it online (GitHub Pages, Netlify, Vercel …)'),
    ),
    h('label', { class: 'check', style: 'margin-top:14px' },
      h('input', { type: 'checkbox', checked: steps.build, onchange: async (e) => {
        if (await savePlan({ steps: { ...steps, build: e.target.checked } })) today();
      } }),
      'It works and it’s online'),
  );

  // Step 4: launch
  const L = launch ?? {};
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const d = formData(form);
      const fields = {
        title: d.title.trim().slice(0, 60),
        tagline: d.tagline.trim().slice(0, 120),
        url: cleanUrl(d.url, 'Live link', true),
        repoUrl: cleanUrl(d.repoUrl, 'Code link', false),
        notes: (d.notes ?? '').trim().slice(0, 1000),
        tags: cleanTags(d.tags),
      };
      if (!fields.title) throw new Error('Name is required');
      if (!fields.tagline) throw new Error('Tagline is required');
      await store.saveLaunch(day, profile, fields);
      await store.savePlan(day, { idea: plan.idea, scope: plan.scope, steps: { ...steps, ship: true } }).catch(() => {});
      toast(launched ? 'Launch updated' : 'Launched! Your streak is up.');
      today();
    } catch (ex) {
      err.textContent = friendly(ex);
      btn.disabled = false;
    }
  } },
    field('title', 'Name', { value: L.title ?? '', required: true, maxlength: 60, placeholder: 'Splitty' }),
    field('tagline', 'Tagline', { value: L.tagline ?? plan.scope, required: true, maxlength: 120, placeholder: 'Split the bill by what each person ordered' }),
    field('url', 'Live link', { type: 'url', value: L.url ?? '', required: true, placeholder: 'https://' }),
    field('repoUrl', 'Code link', { type: 'url', value: L.repoUrl ?? '', hint: '(optional)', placeholder: 'https://github.com/…' }),
    field('tags', 'Tags', { value: (L.tags ?? []).join(', '), hint: '(up to 5, commas)', placeholder: 'tool, finance' }),
    field('notes', 'How it went', { textarea: true, value: L.notes ?? '', hint: '(optional)', maxlength: 1000, placeholder: 'What you learned, what you’d do tomorrow' }),
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, launched ? 'Update launch' : 'Launch it'),
      launched ? h('button', { class: 'btn small', type: 'button', onclick: async () => {
        if (!confirm('Take down today’s launch? Your streak won’t count today.')) return;
        try {
          await store.deleteLaunch(day);
          toast('Launch removed');
          today();
        } catch (e) {
          toast(friendly(e));
        }
      } }, 'Take it down') : null,
    ),
  );

  const current = streak.current;
  const shareText = launched ? `Day ${current} of launching an app a day: ${L.title}, ${L.tagline}` : '';
  const profileUrl = `${location.origin}/u/${profile.handle}`;
  const step4 = h('section', { class: `card step ${launched ? 'done launched' : ''}` },
    h('div', { class: 'step-head' }, h('h3', {}, 'Launch'), launched ? h('span', { class: 'pill done' }, 'Launched') : null),
    launched
      ? h('div', {},
          h('p', {}, 'You shipped today. Tell people:'),
          h('div', { class: 'share' },
            h('a', { class: 'btn small', target: '_blank', rel: 'noopener noreferrer', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(L.url)}` }, 'Post on X'),
            h('a', { class: 'btn small', target: '_blank', rel: 'noopener noreferrer', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(L.url)}` }, 'Share on LinkedIn'),
            h('button', { class: 'btn small', onclick: async () => {
              try { await navigator.clipboard.writeText(profileUrl); toast('Profile link copied'); } catch { toast(profileUrl); }
            } }, 'Copy my profile link'),
          ),
          h('details', { style: 'margin-top:16px' }, h('summary', {}, 'Edit today’s launch'), h('div', { style: 'margin-top:12px' }, form)),
        )
      : h('div', {}, h('p', { class: 'muted' }, 'Post the live link. It goes on the feed and counts for today.'), form),
  );

  const doneCount = ['idea', 'scope', 'build'].filter((k) => steps[k]).length + (launched ? 1 : 0);
  $app.replaceChildren(
    h('div', { class: 'today-head' },
      h('div', {},
        h('span', { class: `pill ${launched ? 'done' : ''}` }, launched ? 'Shipped today' : `${doneCount} of 4 steps done`),
        h('h1', { style: 'margin-top:10px' }, prettyDay(day)),
        h('div', { class: 'row muted' }, 'Time left today', clock),
      ),
      h('div', { class: 'streak' },
        h('div', { class: 'stat' }, h('b', {}, `${current} 🔥`), h('span', {}, 'day streak')),
        h('div', { class: 'stat' }, h('b', {}, streak.longest), h('span', {}, 'best')),
        h('div', { class: 'stat' }, h('b', {}, streak.total), h('span', {}, 'launched')),
      ),
    ),
    ...(!launched && current > 0
      ? [h('p', { class: 'card', style: 'border-color:var(--accent)' }, `Your ${current}-day streak ends at midnight unless you launch today.`)]
      : []),
    h('div', { class: 'stack steps' }, step1, step2, step3, step4),
  );
}

async function feed() {
  const sort = new URLSearchParams(location.search).get('sort') === 'top' ? 'top' : 'latest';
  $app.replaceChildren(skeleton(4));
  const tabs = h('div', { class: 'feed-tabs' },
    link('/feed', 'Latest', `btn small ${sort === 'latest' ? 'ink' : ''}`),
    link('/feed?sort=top', 'Top this week', `btn small ${sort === 'top' ? 'ink' : ''}`),
  );
  if (!store.isConfigured()) return $app.replaceChildren(h('h1', {}, 'Launches'), tabs, notSetUp());

  let launches;
  let next = null;
  if (sort === 'top') {
    launches = (await store.since(addDays(dayIn('UTC'), -7)))
      .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
      .slice(0, 30);
  } else {
    ({ launches, next } = await store.latest());
  }
  const list = h('div', { class: 'list' }, await cards(launches));
  const more = h('button', { class: 'btn', style: 'margin-top:16px', hidden: !next || undefined, onclick: async () => {
    more.disabled = true;
    const page = await store.latest(next);
    list.append(...(await cards(page.launches)));
    next = page.next;
    more.disabled = false;
    more.hidden = !next;
  } }, 'Show more');
  $app.replaceChildren(
    h('h1', {}, 'Launches'),
    tabs,
    launches.length ? list : h('div', { class: 'card empty' }, 'Nothing here yet. ', link(profile ? '/' : '/signin', 'Launch the first one'), '.'),
    more,
  );
}

function heatmap(days, todayStr) {
  const set = new Set(days);
  const end = new Date(todayStr + 'T00:00:00Z');
  const weeks = 26;
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - end.getUTCDay() - (weeks - 1) * 7);
  const cells = [];
  for (let i = 0; i < weeks * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const future = d > end;
    cells.push(h('i', { class: future ? 'future' : set.has(key) ? 'on' : '', title: future ? null : `${shortDay(key)}${set.has(key) ? ': launched' : ''}` }));
  }
  const grid = h('div', { class: 'heat', role: 'img', 'aria-label': `${days.length} launches in the last six months` }, cells);
  // On narrow screens the grid scrolls; open it on the current week.
  requestAnimationFrame(() => { grid.scrollLeft = grid.scrollWidth; });
  return grid;
}

async function profilePage(handle) {
  $app.replaceChildren(skeleton(3));
  if (!store.isConfigured()) return $app.replaceChildren(notSetUp());
  const p = await store.profileByHandle(handle.toLowerCase());
  if (!p) return $app.replaceChildren(h('div', { class: 'card empty' }, 'No maker with that username.'));
  const day = dayIn(p.user.tz);
  const days = p.launches.map((l) => l.day);
  const s = streaks(days, day);
  document.title = `${p.user.name} · Launch a Day`;
  $app.replaceChildren(
    h('div', { class: 'today-head' },
      h('div', {},
        h('h1', {}, p.user.name),
        h('p', { class: 'muted' }, `@${p.user.handle}`),
        p.user.bio ? h('p', {}, p.user.bio) : null,
      ),
      h('div', { class: 'streak' },
        h('div', { class: 'stat' }, h('b', {}, `${s.current} 🔥`), h('span', {}, 'day streak')),
        h('div', { class: 'stat' }, h('b', {}, s.longest), h('span', {}, 'best')),
        h('div', { class: 'stat' }, h('b', {}, s.total), h('span', {}, 'launched')),
      ),
    ),
    h('section', { class: 'card', style: 'margin-bottom:20px' }, h('h3', {}, 'Last six months'), heatmap(days, day)),
    h('h2', {}, 'Launches'),
    p.launches.length
      ? h('div', { class: 'list' }, await cards(p.launches, { showMaker: false }))
      : h('div', { class: 'card empty' }, 'No launches yet.'),
  );
}

async function leaderboard() {
  $app.replaceChildren(skeleton(1));
  if (!store.isConfigured()) return $app.replaceChildren(h('h1', {}, 'Streaks'), notSetUp());
  const rows = await store.allLaunchDays();
  const byMaker = new Map();
  for (const l of rows) {
    const e = byMaker.get(l.uid) ?? { handle: l.handle, name: l.name, days: [] };
    e.days.push(l.day);
    byMaker.set(l.uid, e);
  }
  // Each maker's own "today" isn't known here without reading every profile;
  // the UTC date is within a day of it, which is close enough for a ranking.
  const today = dayIn('UTC');
  const makers = [...byMaker.values()]
    .map((e) => ({ ...e, ...streaks(e.days, today) }))
    .sort((a, b) => b.current - a.current || b.longest - a.longest || b.total - a.total)
    .slice(0, 50);
  $app.replaceChildren(
    h('h1', {}, 'Streaks'),
    h('p', { class: 'muted' }, 'Who has launched the most days in a row, right now.'),
    makers.length
      ? h('div', { class: 'card', style: 'padding:6px 12px;overflow-x:auto' },
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Maker'), h('th', { class: 'n' }, 'Streak'), h('th', { class: 'n' }, 'Best'), h('th', { class: 'n' }, 'Launched'))),
            h('tbody', {}, makers.map((m, i) => h('tr', {},
              h('td', { class: 'muted' }, i + 1),
              h('td', {}, link(`/u/${m.handle}`, m.name), h('span', { class: 'muted' }, ` @${m.handle}`)),
              h('td', { class: 'n' }, m.current ? `${m.current} 🔥` : '0'),
              h('td', { class: 'n' }, m.longest),
              h('td', { class: 'n' }, m.total),
            ))),
          ))
      : h('div', { class: 'card empty' }, 'No streaks yet.'),
  );
}

function signInPage() {
  const err = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary', style: 'width:100%;justify-content:center', onclick: async () => {
    err.textContent = '';
    btn.disabled = true;
    try {
      await store.signIn();
      profile = await store.myProfile();
      go(profile ? '/' : '/welcome');
    } catch (e) {
      if (e?.code !== 'auth/popup-closed-by-user') err.textContent = friendly(e);
      btn.disabled = false;
    }
  } }, 'Continue with Google');
  $app.replaceChildren(h('div', { class: 'auth' },
    h('h1', {}, 'Start launching'),
    h('p', { class: 'muted' }, 'One small app a day. Your first launch can be today.'),
    h('div', { class: 'card' },
      store.isConfigured() ? btn : h('p', { class: 'muted' }, 'Sign-in isn’t switched on yet. It starts working once Firebase is connected.'),
      err,
      h('p', { class: 'muted', style: 'font-size:0.88rem;margin:8px 0 0' }, 'We only use your Google account to sign you in. Your email is never shown.'),
    ),
  ));
}

// After the first Google sign-in: pick the username for /u/<username>.
function welcomePage() {
  const u = store.user();
  if (!u) return go('/signin');
  const err = h('p', { class: 'error', role: 'alert' });
  const suggested = (u.email ?? '').split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const d = formData(form);
    const handle = d.handle.trim().toLowerCase();
    if (!/^[a-z0-9_-]{3,20}$/.test(handle)) {
      err.textContent = 'Username: 3 to 20 letters, numbers, - or _';
      return;
    }
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      await store.createProfile({ handle, name: d.name.trim().slice(0, 60) || handle, tz: TZ });
      profile = await store.myProfile();
      go('/');
    } catch (ex) {
      err.textContent = friendly(ex);
      btn.disabled = false;
    }
  } },
    field('name', 'Your name', { value: u.displayName ?? '', maxlength: 60, autocomplete: 'name' }),
    field('handle', 'Username', { value: suggested, required: true, minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_\\-]+', hint: '(your page: /u/username)' }),
    err,
    h('button', { class: 'btn primary', type: 'submit', style: 'width:100%;justify-content:center;margin-top:6px' }, 'Start my streak'),
  );
  $app.replaceChildren(h('div', { class: 'auth' },
    h('h1', {}, 'One more thing'),
    h('p', { class: 'muted' }, 'Pick the name people see on your launches.'),
    h('div', { class: 'card' }, form),
  ));
}

function settingsPage() {
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const d = formData(form);
    const tz = d.tz.trim();
    if (!validTz(tz)) {
      err.textContent = 'That time zone isn’t one we know. Use a name like America/New_York or Europe/London.';
      return;
    }
    try {
      const next = { name: d.name.trim().slice(0, 60) || profile.handle, bio: d.bio.trim().slice(0, 160), tz };
      await store.updateProfile(next);
      Object.assign(profile, next);
      toast('Saved');
    } catch (ex) {
      err.textContent = friendly(ex);
    }
  } },
    field('name', 'Name', { value: profile.name, maxlength: 60 }),
    field('bio', 'Bio', { value: profile.bio, maxlength: 160, hint: '(shows on your page)' }),
    field('tz', 'Time zone', { value: profile.tz, hint: `(your day ends at midnight here; this browser says ${TZ})` }),
    err,
    h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save')),
  );
  $app.replaceChildren(h('div', { class: 'auth' },
    h('h1', {}, 'Settings'),
    h('p', { class: 'muted' }, `Signed in as @${profile.handle}`),
    h('div', { class: 'card' }, form),
    h('button', { class: 'btn', style: 'margin-top:16px', onclick: async () => {
      await store.signOut();
      profile = null;
      go('/');
    } }, 'Sign out'),
  ));
}

// ---- router ----------------------------------------------------------------

async function render() {
  document.title = 'Launch a Day';
  renderNav();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  const signedIn = Boolean(store.user());
  try {
    if (signedIn && !profile && path !== '/welcome') return go('/welcome');
    if (path === '/') await (profile ? today() : landing());
    else if (path === '/feed') await feed();
    else if (path === '/leaderboard') await leaderboard();
    else if (path === '/signin') profile ? go('/') : signInPage();
    else if (path === '/welcome') profile ? go('/') : welcomePage();
    else if (path === '/settings') profile ? settingsPage() : go('/signin');
    else if (path.startsWith('/u/')) await profilePage(decodeURIComponent(path.slice(3)));
    else $app.replaceChildren(h('div', { class: 'card empty' }, 'That page doesn’t exist. ', link('/', 'Go home'), '.'));
  } catch (e) {
    console.error(e);
    $app.replaceChildren(h('div', { class: 'card empty' }, friendly(e)));
  }
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || a.target) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});
window.addEventListener('popstate', render);

(async () => {
  $app.replaceChildren(skeleton(2));
  try {
    await store.ready;
    profile = await store.myProfile();
  } catch (e) {
    console.error(e);
  }
  render();
})();
