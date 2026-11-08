// Local preview server, like GitHub Pages: serves the repo's files, and
// index.html for any app path (/u/ana, /feed). Only for development.
//   node scripts/serve.mjs   ->  http://127.0.0.1:8000
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 8000);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  let path;
  try {
    path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  } catch {
    res.writeHead(400).end();
    return;
  }
  const file = join(ROOT, extname(path) ? path : 'index.html');
  if (!file.startsWith(ROOT) || file.includes(`${ROOT}.git`)) {
    res.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Launch a Day: http://127.0.0.1:${PORT}`));
