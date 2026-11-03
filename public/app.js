// Launch a Day: the whole front end. No framework; h() builds DOM nodes
// and never parses HTML, so user text can't inject markup.

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

let session = { user: null };
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

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), 2600);
}

function go(path) {
  history.pushState(null, '', path);
  render();
}

function link(href, text, cls) {
  return h('a', { href, class: cls, 'data-link': true }, text);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function field(name, label, { type = 'text', value = '', hint, textarea, ...rest } = {}) {
  const id = `f-${name}`;
  const input = textarea
    ? h('textarea', { id, name, ...rest }, value)
    : h('input', { id, name, type, value, ...rest });
  return h('div', { class: 'field' }, h('label', { for: id }, label, hint ? h('span', { class: 'hint' }, ` ${hint}`) : null), input);
}

function prettyDay(day) {
  const d = new Date(day + 'T12:00:00Z');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function shortDay(day) {
  return new Date(day + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

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

function profileUrl(handle) {
  return `${location.origin}/u/${handle}`;
}

// ---- nav -------------------------------------------------------------------

function renderNav() {
  const path = location.pathname;
  const on = (p) => (path === p ? 'on' : '');
  $nav.replaceChildren(
    ...(session.user
      ? [
          link('/', 'Today', on('/')),
          link('/feed', 'Launches', on('/feed')),
          link('/leaderboard', 'Streaks', on('/leaderboard')),
          link(`/u/${session.user.handle}`, 'Me', on(`/u/${session.user.handle}`)),
          link('/settings', 'Settings', on('/settings')),
        ]
      : [
          link('/feed', 'Launches', on('/feed')),
          link('/leaderboard', 'Streaks', on('/leaderboard')),
          link('/signin', 'Sign in', on('/signin')),
          link('/signup', 'Start', 'cta'),
        ]),
  );
}

// ---- launch card -----------------------------------------------------------

function launchCard(l, { showMaker = true } = {}) {
  const mine = session.user && l.maker && l.maker.handle === session.user.handle;
  const vote = h('button', {
    class: `vote ${l.voted ? 'on' : ''}`,
    'aria-pressed': String(l.voted),
    'aria-label': `Upvote ${l.title}`,
    disabled: mine || undefined,
    title: mine ? 'Your launch' : 'Upvote',
    onclick: async () => {
      if (!session.user) return go('/signup');
      try {
        const r = await api(`/api/launches/${l.id}/vote`, { method: 'POST', body: {} });
        l.voted = r.voted;
        l.votes = r.votes;
        vote.classList.toggle('on', r.voted);
        vote.setAttribute('aria-pressed', String(r.voted));
        count.textContent = r.votes;
      } catch (e) {
        toast(e.message);
      }
    },
  }, h('span', { class: 'arrow', 'aria-hidden': 'true' }, '▲'));
  const count = h('span', {}, l.votes);
  vote.append(count);

  return h('article', { class: 'card launch' },
    h('div', {},
      h('h3', {}, h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer ugc' }, l.title)),
      h('p', { class: 'tagline' }, l.tagline),
      l.notes ? h('p', { class: 'notes muted' }, l.notes) : null,
      h('div', { class: 'meta' },
        showMaker && l.maker ? link(`/u/${l.maker.handle}`, `@${l.maker.handle}`) : null,
        h('span', {}, shortDay(l.day)),
        l.repo_url ? h('a', { href: l.repo_url, target: '_blank', rel: 'noopener noreferrer ugc' }, 'code') : null,
        l.tags.map((t) => h('span', { class: 'tag' }, t)),
      ),
    ),
    vote,
  );
}

// ---- pages -----------------------------------------------------------------

async function landing() {
  $app.replaceChildren(skeleton(2));
  const [stats, feed] = await Promise.all([api('/api/stats'), api('/api/feed')]);
  $app.replaceChildren(
    h('section', { class: 'hero' },
      h('span', { class: 'pill' }, 'A daily shipping habit'),
      h('h1', {}, 'Ship one app. ', h('em', {}, 'Every day.')),
      h('p', { class: 'lead' }, 'Every morning you get an idea, a four-step plan and a clock that runs out at midnight. Build something tiny, put it online, and keep your streak alive.'),
      h('div', { class: 'row' }, link('/signup', 'Start today’s launch', 'btn primary'), link('/feed', 'See what people shipped', 'btn')),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('b', {}, stats.makers), h('span', {}, 'makers')),
        h('div', { class: 'stat' }, h('b', {}, stats.launches), h('span', {}, 'apps launched')),
        h('div', { class: 'stat' }, h('b', {}, stats.today), h('span', {}, 'in the last day')),
      ),
    ),
    h('section', { class: 'how' }, [
      ['Pick the idea', 'Use the idea of the day, or bring your own.'],
      ['Cut it to one thing', 'Write the single thing it does. Everything else waits for tomorrow.'],
      ['Build', 'A suggested timebox keeps you honest: plan, build, polish.'],
      ['Launch', 'Post the live link. It lands on the feed and your streak goes up.'],
    ].map(([t, d], i) => h('div', { class: 'card' }, h('b', { class: 'num' }, `STEP ${i + 1}`), h('h3', {}, t), h('p', { class: 'muted' }, d)))),
    h('h2', {}, 'Latest launches'),
    feed.launches.length
      ? h('div', { class: 'list' }, feed.launches.slice(0, 5).map((l) => launchCard(l)))
      : h('div', { class: 'card empty' }, 'Nobody has launched yet. Be the first.'),
  );
}

async function today() {
  $app.replaceChildren(skeleton(4));
  const s = await api('/api/me');
  if (!s.user) return go('/signin');
  session = s;
  renderNav();
  let offset = 0;
  let draftIdea = s.plan.idea || '';

  const clock = h('div', { class: 'clock mono' }, untilMidnight());
  clearInterval(clockTimer);
  clockTimer = setInterval(() => {
    if (!document.body.contains(clock)) return clearInterval(clockTimer);
    clock.textContent = untilMidnight();
  }, 1000);

  async function savePlan(patch) {
    try {
      const next = await api('/api/plan', {
        method: 'PUT',
        body: { idea: s.plan.idea, scope: s.plan.scope, steps: s.plan.steps, ...patch },
      });
      Object.assign(s, next);
      return true;
    } catch (e) {
      toast(e.message);
      return false;
    }
  }

  const steps = s.plan.steps;
  const launched = Boolean(s.launch);

  // Step 1: the idea
  const ideaOfDay = h('div', { class: 'idea' }, s.idea_of_the_day);
  const ideaInput = h('input', { id: 'idea', name: 'idea', value: draftIdea, placeholder: 'Or type your own idea', maxlength: 200 });
  const step1 = h('section', { class: `card step ${steps.idea ? 'done' : ''}` },
    h('div', { class: 'step-head' }, h('h3', {}, 'Pick the idea'), steps.idea ? h('span', { class: 'pill done' }, 'Picked') : null),
    h('p', { class: 'muted' }, 'Idea of the day:'),
    ideaOfDay,
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => { ideaInput.value = ideaOfDay.textContent; } }, 'Use this one'),
      h('button', { class: 'btn small', onclick: async () => {
        offset += 1;
        ideaOfDay.textContent = await ideaAt(s.today, offset);
      } }, 'Show me another'),
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
  const scopeInput = h('textarea', { id: 'scope', maxlength: 280, placeholder: 'It lets you … (one sentence)' }, s.plan.scope);
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
      h('li', {}, '30 min: put it online (Vercel, Netlify, GitHub Pages, Glitch …)'),
    ),
    h('label', { class: 'check', style: 'margin-top:14px' },
      h('input', { type: 'checkbox', checked: steps.build, onchange: async (e) => {
        if (await savePlan({ steps: { ...steps, build: e.target.checked } })) today();
      } }),
      'It works and it’s online'),
  );

  // Step 4: launch
  const L = s.launch ?? {};
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { class: 'stack', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      const data = formData(form);
      await api('/api/launch', { method: 'PUT', body: data });
      toast(launched ? 'Launch updated' : 'Launched! Your streak is up.');
      today();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  } },
    field('title', 'Name', { value: L.title ?? '', required: true, maxlength: 60, placeholder: 'Splitty' }),
    field('tagline', 'Tagline', { value: L.tagline ?? (s.plan.scope || ''), required: true, maxlength: 120, placeholder: 'Split the bill by what each person ordered' }),
    field('url', 'Live link', { type: 'url', value: L.url ?? '', required: true, placeholder: 'https://' }),
    field('repo_url', 'Code link', { type: 'url', value: L.repo_url ?? '', hint: '(optional)', placeholder: 'https://github.com/…' }),
    field('tags', 'Tags', { value: (L.tags ?? []).join(', '), hint: '(up to 5, commas)', placeholder: 'tool, finance' }),
    field('notes', 'How it went', { textarea: true, value: L.notes ?? '', hint: '(optional)', maxlength: 1000, placeholder: 'What you learned, what you’d do tomorrow' }),
    err,
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, launched ? 'Update launch' : 'Launch it'),
      launched ? h('button', { class: 'btn small', type: 'button', onclick: async () => {
        if (!confirm('Take down today’s launch? Your streak won’t count today.')) return;
        await api('/api/launch', { method: 'DELETE', body: {} });
        toast('Launch removed');
        today();
      } }, 'Take it down') : null,
    ),
  );

  const shareText = launched ? `Day ${s.streak.current} of launching an app a day: ${L.title}, ${L.tagline}` : '';
  const step4 = h('section', { class: `card step ${launched ? 'done launched' : ''}` },
    h('div', { class: 'step-head' }, h('h3', {}, 'Launch'), launched ? h('span', { class: 'pill done' }, 'Launched') : null),
    launched
      ? h('div', {},
          h('p', {}, 'You shipped today. Tell people:'),
          h('div', { class: 'share' },
            h('a', { class: 'btn small', target: '_blank', rel: 'noopener noreferrer', href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(L.url)}` }, 'Post on X'),
            h('a', { class: 'btn small', target: '_blank', rel: 'noopener noreferrer', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(L.url)}` }, 'Share on LinkedIn'),
            h('button', { class: 'btn small', onclick: async () => {
              try { await navigator.clipboard.writeText(profileUrl(s.user.handle)); toast('Profile link copied'); } catch { toast(profileUrl(s.user.handle)); }
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
        h('h1', { style: 'margin-top:10px' }, prettyDay(s.today)),
        h('div', { class: 'row muted' }, 'Time left today', clock),
      ),
      h('div', { class: 'streak' },
        h('div', { class: 'stat' }, h('b', {}, `${s.streak.current} 🔥`), h('span', {}, 'day streak')),
        h('div', { class: 'stat' }, h('b', {}, s.streak.longest), h('span', {}, 'best')),
        h('div', { class: 'stat' }, h('b', {}, s.streak.total), h('span', {}, 'launched')),
      ),
    ),
    ...(!launched && s.streak.current > 0
      ? [h('p', { class: 'card', style: 'border-color:var(--accent)' }, `Your ${s.streak.current}-day streak ends at midnight unless you launch today.`)]
      : []),
    h('div', { class: 'stack steps' }, step1, step2, step3, step4),
  );
}

// The idea list lives on the server; this asks for the next one without
// shipping the whole list to the page.
async function ideaAt(day, offset) {
  const r = await api(`/api/idea?day=${day}&offset=${offset}`);
  return r.idea;
}

async function feed() {
  const params = new URLSearchParams(location.search);
  const sort = params.get('sort') === 'top' ? 'top' : 'latest';
  $app.replaceChildren(skeleton(4));
  const data = await api(`/api/feed?sort=${sort}`);
  const list = h('div', { class: 'list' }, data.launches.map((l) => launchCard(l)));
  let next = data.next;
  const more = h('button', { class: 'btn', style: 'margin-top:16px', hidden: !next || undefined, onclick: async () => {
    more.disabled = true;
    const page = await api(`/api/feed?before=${next}`);
    list.append(...page.launches.map((l) => launchCard(l)));
    next = page.next;
    more.disabled = false;
    more.hidden = !next;
  } }, 'Show more');
  $app.replaceChildren(
    h('h1', {}, 'Launches'),
    h('div', { class: 'feed-tabs' },
      link('/feed', 'Latest', `btn small ${sort === 'latest' ? 'ink' : ''}`),
      link('/feed?sort=top', 'Top this week', `btn small ${sort === 'top' ? 'ink' : ''}`),
    ),
    data.launches.length ? list : h('div', { class: 'card empty' }, 'Nothing here yet. ', link(session.user ? '/' : '/signup', 'Launch the first one'), '.'),
    more,
  );
}

function heatmap(days, todayStr) {
  const set = new Set(days);
  const end = new Date(todayStr + 'T00:00:00Z');
  const weeks = 26;
  // start on the Sunday 25 weeks before this week's Sunday
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

async function profile(handle) {
  $app.replaceChildren(skeleton(3));
  let p;
  try {
    p = await api(`/api/users/${encodeURIComponent(handle)}`);
  } catch (e) {
    $app.replaceChildren(h('div', { class: 'card empty' }, e.message));
    return;
  }
  document.title = `${p.maker.name} · Launch a Day`;
  $app.replaceChildren(
    h('div', { class: 'today-head' },
      h('div', {},
        h('h1', {}, p.maker.name),
        h('p', { class: 'muted' }, `@${p.maker.handle} · making since ${shortDay(p.maker.joined)}`),
        p.maker.bio ? h('p', {}, p.maker.bio) : null,
      ),
      h('div', { class: 'streak' },
        h('div', { class: 'stat' }, h('b', {}, `${p.streak.current} 🔥`), h('span', {}, 'day streak')),
        h('div', { class: 'stat' }, h('b', {}, p.streak.longest), h('span', {}, 'best')),
        h('div', { class: 'stat' }, h('b', {}, p.streak.total), h('span', {}, 'launched')),
      ),
    ),
    h('section', { class: 'card', style: 'margin-bottom:20px' }, h('h3', {}, 'Last six months'), heatmap(p.days, p.today)),
    h('h2', {}, 'Launches'),
    p.launches.length
      ? h('div', { class: 'list' }, p.launches.map((l) => launchCard(l, { showMaker: false })))
      : h('div', { class: 'card empty' }, 'No launches yet.'),
  );
}

async function leaderboard() {
  $app.replaceChildren(skeleton(1));
  const { makers } = await api('/api/leaderboard');
  $app.replaceChildren(
    h('h1', {}, 'Streaks'),
    h('p', { class: 'muted' }, 'Who has launched the most days in a row, right now.'),
    makers.length
      ? h('div', { class: 'card', style: 'padding:6px 12px;overflow-x:auto' },
          h('table', {},
            h('thead', {}, h('tr', {}, h('th', {}, '#'), h('th', {}, 'Maker'), h('th', { class: 'n' }, 'Streak'), h('th', { class: 'n' }, 'Best'), h('th', { class: 'n' }, 'Launched'))),
            h('tbody', {}, makers.map((m, i) => h('tr', {},
              h('td', { class: 'muted' }, i + 1),
              h('td', {}, link(`/u/${m.maker.handle}`, m.maker.name), h('span', { class: 'muted' }, ` @${m.maker.handle}`)),
              h('td', { class: 'n' }, m.current ? `${m.current} 🔥` : '0'),
              h('td', { class: 'n' }, m.longest),
              h('td', { class: 'n' }, m.total),
            ))),
          ))
      : h('div', { class: 'card empty' }, 'No streaks yet.'),
  );
}

function authPage(mode) {
  const signup = mode === 'signup';
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      session = await api(signup ? '/api/signup' : '/api/login', { method: 'POST', body: { ...formData(form), tz: TZ } });
      go('/');
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  } },
    signup ? field('name', 'Your name', { autocomplete: 'name', maxlength: 60 }) : null,
    signup ? field('handle', 'Username', { required: true, minlength: 3, maxlength: 20, pattern: '[A-Za-z0-9_\\-]+', autocomplete: 'username', hint: '(your page: /u/username)' }) : null,
    field('email', 'Email', { type: 'email', required: true, autocomplete: 'email' }),
    field('password', 'Password', { type: 'password', required: true, minlength: signup ? 8 : undefined, autocomplete: signup ? 'new-password' : 'current-password', hint: signup ? '(8 or more characters)' : null }),
    err,
    h('button', { class: 'btn primary', type: 'submit', style: 'width:100%;justify-content:center;margin-top:6px' }, signup ? 'Start my streak' : 'Sign in'),
  );
  $app.replaceChildren(h('div', { class: 'auth' },
    h('h1', {}, signup ? 'Start launching' : 'Welcome back'),
    h('p', { class: 'muted' }, signup ? 'One small app a day. Your first launch can be today.' : 'Your streak is waiting.'),
    h('div', { class: 'card' }, form),
    h('p', { class: 'muted', style: 'margin-top:14px' },
      signup ? ['Already launching? ', link('/signin', 'Sign in')] : ['New here? ', link('/signup', 'Create an account')]),
  ));
}

async function settings() {
  const s = await api('/api/me');
  if (!s.user) return go('/signin');
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    try {
      session = await api('/api/me', { method: 'PUT', body: formData(form) });
      toast('Saved');
    } catch (ex) {
      err.textContent = ex.message;
    }
  } },
    field('name', 'Name', { value: s.user.name, maxlength: 60 }),
    field('bio', 'Bio', { value: s.user.bio, maxlength: 160, hint: '(shows on your page)' }),
    field('tz', 'Time zone', { value: s.user.tz, hint: `(your day ends at midnight here; this browser says ${TZ})` }),
    err,
    h('div', { class: 'row', style: 'margin-top:6px' }, h('button', { class: 'btn primary', type: 'submit' }, 'Save')),
  );
  $app.replaceChildren(h('div', { class: 'auth' },
    h('h1', {}, 'Settings'),
    h('p', { class: 'muted' }, `Signed in as ${s.user.email}`),
    h('div', { class: 'card' }, form),
    h('button', { class: 'btn', style: 'margin-top:16px', onclick: async () => {
      await api('/api/logout', { method: 'POST', body: {} });
      session = { user: null };
      go('/');
    } }, 'Sign out'),
  ));
}

// ---- router ----------------------------------------------------------------

async function render() {
  document.title = 'Launch a Day';
  renderNav();
  const path = location.pathname.replace(/\/+$/, '') || '/';
  try {
    if (path === '/') await (session.user ? today() : landing());
    else if (path === '/feed') await feed();
    else if (path === '/leaderboard') await leaderboard();
    else if (path === '/signin') session.user ? go('/') : authPage('signin');
    else if (path === '/signup') session.user ? go('/') : authPage('signup');
    else if (path === '/settings') await settings();
    else if (path.startsWith('/u/')) await profile(decodeURIComponent(path.slice(3)));
    else $app.replaceChildren(h('div', { class: 'card empty' }, 'That page doesn’t exist. ', link('/', 'Go home'), '.'));
  } catch (e) {
    $app.replaceChildren(h('div', { class: 'card empty' }, e.message || 'Something went wrong. Try again.'));
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
  try {
    session = await api('/api/me');
  } catch {
    session = { user: null };
  }
  render();
})();
