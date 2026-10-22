/* global URL, console, setInterval */
// Starts the EXISTING dev Postgres data dir (scratchpad/.dev-pgdata) WITHOUT wiping it, and idles.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const env = {};
for (const line of readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}
const u = new URL(env.MIGRATOR_DATABASE_URL);
const pg = new EmbeddedPostgres({
  databaseDir: path.join(ROOT, 'scratchpad', '.dev-pgdata'),
  port: Number(u.port),
  user: decodeURIComponent(u.username),
  password: decodeURIComponent(u.password),
  persistent: true,
});
await pg.start();
console.log('postgres up on', u.port);
setInterval(() => {}, 1 << 30);
