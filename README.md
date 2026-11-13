# Launch a Day

Ship one small app every day. Live at **https://anapp.ajith.ai**.

Plain HTML, CSS and JavaScript on GitHub Pages. No server, no framework, no build step. Sign-in and data are Firebase (Google sign-in and Firestore), the same setup as FamilyTube (tube.ajith.ai).

## What it does

- **Today:** each signed-in maker gets a page for their own day (in their own time zone), with a countdown to midnight and four steps:
  1. **Pick the idea.** An idea of the day (the same for everyone), "Show me another", or their own.
  2. **Cut it to one thing.** One sentence: the single thing the app does.
  3. **Build it.** A suggested timebox, and a tick for "it works and it's online".
  4. **Launch.** Name, tagline, live link, optional code link, tags, notes. It can be edited or taken down until midnight.
- **Streaks:** current, best and total. A banner warns when a streak is about to end.
- **Launches feed:** latest (with "Show more") and top this week, with upvotes (not on your own).
- **Profiles** at `/u/<username>`: streaks, a six-month grid of launch days, every launch.
- **Streaks leaderboard** and **Settings** (name, bio, time zone).

> **Important**
> - **Until Firebase is connected, the site is read-only** and says "Sign-in isn't switched on yet". Fill in `config.json` (below) to switch it on.
> - Only today's launch can be written, and the Firestore rules enforce it (the day must be within a day of the server's clock). Missed days can't be backfilled.
> - The leaderboard and "top this week" read launches in the browser. Fine for a few thousand launches; past that, keep streak counts on the user documents.
> - No payments, reminders, comments or moderation yet.

## One-time setup (about 15 minutes)

### 1. Firebase (sign-in and data)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project (for example `launchaday`). Analytics can stay off.
2. **Authentication** → Get started → Sign-in method → **Google** → Enable. Then Settings → Authorized domains → add `anapp.ajith.ai`.
3. **Firestore Database** → Create database (production mode, a region near you). Open the **Rules** tab, paste [`firestore.rules`](firestore.rules), Publish.
4. Project settings → General → Your apps → add a **Web** app. Copy `apiKey`, `authDomain`, `projectId` and `appId` into `config.json`.

The Firebase web key is meant to be public: it only names the project. What anyone can read or write is decided by `firestore.rules`.

### 2. GitHub Pages (hosting)

1. Repository **Settings → Pages → Source: GitHub Actions**.
2. DNS for ajith.ai: add a `CNAME` record **`anapp` → `ajithjoseph.github.io`**.
3. Settings → Pages → Custom domain: `anapp.ajith.ai`, then tick **Enforce HTTPS** (it can take a few minutes after DNS).
4. Every push to `main` runs the tests and publishes the site ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)). Actions → "Test and deploy" → Run workflow does it by hand.

## Run locally

```bash
npm start      # http://127.0.0.1:8000 (any app path, like /u/ana, loads the app)
npm test       # day, streak and idea tests
```

Needs Node 22. There are no packages to install. To sign in locally, add `localhost` to Firebase's authorized domains (it's there by default) and open http://localhost:8000.

## How it works

- `index.html`, `app.js`, `styles.css`: the whole front end. `h()` builds DOM nodes and never parses HTML, so user text can't inject markup. A Content Security Policy in `index.html` allows only this site and Firebase's Google hosts.
- `js/store.js`: every Firebase call. The rest of the app only uses its functions.
- `js/days.js`: days are `YYYY-MM-DD` strings in the maker's time zone, plus the streak math.
- `js/ideas.js`: the idea list and the idea of the day (a hash of the date).
- `firestore.rules`: who may read and write what. There's no server, so this is the security.
- `config.json`: the Firebase project's public web settings.
- `CNAME`, `.nojekyll`: GitHub Pages' custom domain and "serve files as they are".
- The deploy copies `index.html` to `404.html`, so a link like `/u/ana` loads the app instead of GitHub's 404 page.

### Data (Firestore)

| Collection | Document id | What | Who can write |
|---|---|---|---|
| `users` | uid | handle, name, bio, time zone (no email) | the user; the handle never changes |
| `handles` | username | `{ uid }`, keeps usernames unique | created once, with the profile |
| `plans` | `uid_day` | that day's idea, scope, ticked steps (private) | the user |
| `launches` | `uid_day` | the launch, plus `votes` | the maker, only on their current day; others only move `votes` by one |
| `votes` | `launchId_uid` | one upvote | the voter, never on their own launch |

## Not built yet

Payments and plans, reminder emails before midnight, comments, reporting and moderation, screenshots on launches, changing your username.
