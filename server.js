import { createServer } from 'node:http';
import { openDb } from './lib/db.js';
import { createApp } from './lib/app.js';
import { pruneSessions } from './lib/auth.js';

const PORT = Number(process.env.PORT ?? 3300);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.DATABASE_PATH ?? new URL('./data/launchaday.db', import.meta.url).pathname;
// Set SECURE_COOKIES=1 when serving over HTTPS (any real deployment).
const secureCookies = process.env.SECURE_COOKIES === '1';
// Set TRUST_PROXY=1 when behind Caddy or a host's proxy, so rate limits see visitors, not the proxy.
const trustProxy = process.env.TRUST_PROXY === '1';

const db = openDb(DB_PATH);
pruneSessions(db);
setInterval(() => pruneSessions(db), 6 * 3600_000).unref();

const server = createServer(createApp(db, { secureCookies, trustProxy }));
server.listen(PORT, HOST, () => {
  console.log(`Launch a Day is running at http://${HOST}:${PORT}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
