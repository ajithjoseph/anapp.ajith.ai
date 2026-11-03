# Launch a Day

A web app that helps people ship one small app every day.

It runs at **https://anapp.ajith.ai**.

## What it does

- **Today:** each signed-in maker gets a page for their own day (in their own time zone), with a countdown to midnight and four steps:
  1. **Pick the idea.** An idea of the day (the same for everyone, so people can compare takes), "Show me another", or their own.
  2. **Cut it to one thing.** One sentence: the single thing the app does.
  3. **Build it.** A suggested timebox, and a tick for "it works and it's online".
  4. **Launch.** Name, tagline, live link, optional code link, tags, notes. It can be edited or taken down until midnight.
- **Streaks:** the current streak counts back from today, or from yesterday if today's launch isn't in yet (it isn't broken until midnight). Best streak and total are kept too. A banner warns when a streak is about to end.
- **Launches feed:** latest launches (with "Show more") and top this week, with upvotes (not on your own).
- **Profiles** at `/u/<username>`: streaks, a six-month grid of launch days, every launch.
- **Streaks leaderboard**, **Settings** (name, bio, time zone), sharing to X and LinkedIn.

> **Important**
> - **It is not a business yet.** There are no payments, plans, email, password reset or moderation. "SaaS" today means a hosted multi-user web app; see "Not built yet".
> - One launch per maker per day, and only *today's* can be edited. There's no way to backfill a missed day, on purpose.
> - The leaderboard computes streaks in memory from every launch. Fine for thousands of makers; past that, store streaks in a table.

## Run it

Needs Node 22.13 or newer (it uses the built-in `node:sqlite`). No `npm install`: there are no dependencies.

```bash
cd launchaday
npm start          # http://127.0.0.1:3300
npm test           # 14 tests: days, streaks, API, security checks
```

Settings (environment variables):

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `3300` | Port to listen on |
| `HOST` | `127.0.0.1` | Address to listen on. Use `0.0.0.0` in a container |
| `DATABASE_PATH` | `launchaday/data/launchaday.db` | SQLite file (the folder is created; `data/` is gitignored) |
| `SECURE_COOKIES` | off | Set to `1` when served over HTTPS, which any real deployment should be |
| `TRUST_PROXY` | off | Set to `1` behind Caddy or a host's proxy, so rate limits count visitors, not the proxy. Never set it when the app is reachable directly |

## Deploy at anapp.ajith.ai

It's one Node process and one SQLite file, so it needs a host with a **persistent disk** (not a static host like GitHub Pages, Netlify or Vercel's static plan). Two ways that work:

- **A small server with Caddy** (any VPS, Lightsail, DigitalOcean): copy the repo, run it with `systemd` or `docker run`, and use [`deploy/Caddyfile`](deploy/Caddyfile), which gets the HTTPS certificate for anapp.ajith.ai by itself.
- **A container host with a volume** (Fly.io, Render, Railway): build the [`Dockerfile`](Dockerfile), mount a volume at `/data`, and add anapp.ajith.ai as a custom domain in that host's dashboard.

Either way, point DNS at it: an `A` record for `anapp` (to the server's IP) or a `CNAME` for `anapp` (to the host's name), in wherever ajith.ai's DNS lives. Keep `SECURE_COOKIES=1` and `TRUST_PROXY=1`, which the Dockerfile already sets.

Back up the SQLite file (`/data/launchaday.db`): copy it with `sqlite3 /data/launchaday.db ".backup /backups/launchaday.db"` rather than `cp`, so a write in progress can't corrupt the copy.

## How it works

- `server.js`: starts the HTTP server and prunes expired sessions.
- `lib/app.js`: every route, input checks and static files. `createApp(db, options)` is what tests use.
- `lib/db.js`: the SQLite schema (`users`, `sessions`, `plans`, `launches`, `votes`). `launches` is unique on `(user_id, day)`.
- `lib/days.js`: days are `YYYY-MM-DD` strings in the maker's time zone (`Intl`), and the streak math.
- `lib/ideas.js`: the idea list and the idea of the day (a hash of the date).
- `public/`: the whole front end, plain JavaScript with no build step. `h()` builds DOM nodes and never parses HTML, so user text can't inject markup.

### Security

- Passwords: scrypt with a random salt; a wrong email takes as long as a wrong password.
- Sessions: a random 32-byte token in an HttpOnly, SameSite=Lax cookie (30 days); only its SHA-256 is stored.
- Changes must be JSON from the same origin (a cross-site form can't send JSON; a cross-site `Origin` is refused).
- Rate limits per visitor address (from the proxy's `X-Forwarded-For` with `TRUST_PROXY=1`): 20 sign-ups an hour, 10 sign-in tries per email every 15 minutes (in memory, so per process).
- Launch links must be `http(s)`; `javascript:` and the like are refused. Outbound links use `rel="noopener noreferrer ugc"`.
- A strict Content Security Policy (`default-src 'self'`, no inline styles or scripts).

## Not built yet

Password reset and email verification, payments and plans, email or push reminders before midnight, comments, reporting and moderation, images or screenshots on launches, sign-in with GitHub or Google, and an "idea backlog" per maker.
