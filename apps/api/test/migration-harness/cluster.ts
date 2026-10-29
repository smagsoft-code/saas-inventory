import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import postgres, { type Sql } from 'postgres';

/**
 * A disposable PostgreSQL server for the migration-wrapper harness (ADR-0041, D-7.2 / D-8E). Two ways to get one:
 *
 * 1. `MIGRATION_HARNESS_PG_BIN` — the `bin` directory of a PostgreSQL install (reference: 16.15). The harness builds a cluster with
 *    `initdb`/`pg_ctl` in a NEW directory under the OS temp folder, on a port it chooses (never a protected one, only if nothing
 *    answers), scram authentication, a random superuser password kept in memory; `stop()` stops and deletes only that directory.
 * 2. `MIGRATION_HARNESS_SERVER_URL` — a server somebody else started *for this run* (CI starts a `postgres:16.15@sha256:…` container
 *    with a random password and publishes it on 127.0.0.1 only). The harness does not start, stop or delete it. Because the tests
 *    create databases and ROLES, this mode is guarded: loopback host only, never a protected port, and the server must be FRESH —
 *    no database other than the template ones and `postgres`, no table outside the system schemas, no role besides the connecting
 *    superuser and the built-in `pg_*` ones. A server that has ever held anything is refused, so it can never be a real one.
 *
 * Setting both is an error. Nothing here reads `.env`, touches the installed service, or acts on anything it did not create.
 */

/** Ports that belong to other work and must never be used or touched. */
export const PROTECTED_PORTS: readonly number[] = [5432, 55432, 55433, 55440];
const PORT_RANGE = { from: 55461, to: 55499 };

export const PG_BIN = process.env['MIGRATION_HARNESS_PG_BIN'];
export const SERVER_URL = process.env['MIGRATION_HARNESS_SERVER_URL'];
export const harnessEnabled = (PG_BIN !== undefined && PG_BIN !== '') || (SERVER_URL !== undefined && SERVER_URL !== '');

const EXE = process.platform === 'win32' ? '.exe' : '';

function pgExe(name: string): string {
  if (PG_BIN === undefined || PG_BIN === '') throw new Error('MIGRATION_HARNESS_PG_BIN is not set.');
  return join(PG_BIN, `${name}${EXE}`);
}

/** The PG* variables of the caller must not steer initdb/pg_ctl towards another server. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('PG') && value !== undefined) env[key] = value;
  }
  return env;
}

function run(exe: string, args: string[], detached = false): { status: number | null; out: string } {
  // `pg_ctl start` leaves the server running with the pipes it inherited; with piped stdio spawnSync would
  // wait for them to close (that is, for the server to exit). The server logs to a file instead (-l).
  const result = spawnSync(exe, args, { env: cleanEnv(), encoding: 'utf8', windowsHide: true, ...(detached ? { stdio: 'ignore' } : {}) });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.on('error', () => resolve(false));
    server.on('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function pickPort(): Promise<number> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const port = PORT_RANGE.from + Math.floor(Math.random() * (PORT_RANGE.to - PORT_RANGE.from + 1));
    if (PROTECTED_PORTS.includes(port)) continue;
    if (await portFree(port)) return port;
  }
  throw new Error('No free port found in the harness range.');
}

interface Endpoint {
  readonly host: string;
  readonly port: number;
  readonly user: string;
  readonly password: string;
}

/** Validates the URL of an external server and returns its endpoint. Never echoes the URL (it carries a password). */
export function parseExternalEndpoint(raw: string): Endpoint {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('MIGRATION_HARNESS_SERVER_URL is not a valid URL.');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') throw new Error('MIGRATION_HARNESS_SERVER_URL must be a postgres:// URL.');
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('MIGRATION_HARNESS_SERVER_URL must point to the loopback interface: the harness is destructive and only runs on a server this machine owns.');
  }
  const port = Number(url.port === '' ? 5432 : url.port);
  if (!Number.isInteger(port) || PROTECTED_PORTS.includes(port)) {
    throw new Error('MIGRATION_HARNESS_SERVER_URL uses a protected port (5432, 55432, 55433, 55440) or an invalid one; refusing.');
  }
  const user = decodeURIComponent(url.username);
  if (user === '' || url.password === '') throw new Error('MIGRATION_HARNESS_SERVER_URL needs a user and a password.');
  return { host: '127.0.0.1', port, user, password: decodeURIComponent(url.password) };
}

export class Pg16Cluster {
  private stopped = false;

  private constructor(
    /** The directory this harness created (own cluster) — empty string for an external server, where nothing was created. */
    readonly root: string,
    readonly dataDir: string,
    private readonly endpoint: Endpoint,
    readonly external: boolean,
  ) {}

  get port(): number {
    return this.endpoint.port;
  }

  static async start(): Promise<Pg16Cluster> {
    const wantsExternal = SERVER_URL !== undefined && SERVER_URL !== '';
    const wantsOwn = PG_BIN !== undefined && PG_BIN !== '';
    if (wantsExternal && wantsOwn) throw new Error('Set either MIGRATION_HARNESS_PG_BIN or MIGRATION_HARNESS_SERVER_URL, not both.');
    if (wantsExternal) return Pg16Cluster.attach(parseExternalEndpoint(SERVER_URL as string));

    const root = mkdtempSync(join(tmpdir(), 'saas-mig-harness-'));
    const dataDir = join(root, 'data');
    const pwFile = join(root, 'su.pw');
    const password = randomBytes(18).toString('base64url');
    writeFileSync(pwFile, password, { mode: 0o600 });
    try {
      const init = run(pgExe('initdb'), ['-D', dataDir, '-U', 'postgres', '-A', 'scram-sha-256', `--pwfile=${pwFile}`, '-E', 'UTF8', '--locale=C', '--no-sync']);
      if (init.status !== 0) throw new Error(`initdb failed: ${init.out.slice(-400)}`);
    } finally {
      rmSync(pwFile, { force: true });
    }
    const port = await pickPort();
    const options = `-p ${port} -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c max_connections=60`;
    const started = run(pgExe('pg_ctl'), ['-D', dataDir, '-o', options, '-l', join(root, 'server.log'), '-w', '-t', '60', 'start'], true);
    if (started.status !== 0) {
      rmSync(root, { recursive: true, force: true });
      throw new Error(`pg_ctl start failed: ${started.out.slice(-400)}`);
    }
    return new Pg16Cluster(root, dataDir, { host: '127.0.0.1', port, user: 'postgres', password }, false);
  }

  /** Attaches to an external server after proving it is a fresh, disposable one. */
  private static async attach(endpoint: Endpoint): Promise<Pg16Cluster> {
    const cluster = new Pg16Cluster('', '', endpoint, true);
    const sql = cluster.admin();
    try {
      const superuser = await sql.unsafe<{ rolsuper: boolean }[]>('SELECT rolsuper FROM pg_roles WHERE rolname = current_user');
      if (superuser[0]?.rolsuper !== true) throw new Error('The external server login must be a superuser.');
      const databases = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres'`);
      const roles = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_roles WHERE rolname !~ '^pg_' AND rolname <> current_user`);
      const tables = await sql.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`);
      if ((databases[0]?.n ?? 1) !== 0 || (roles[0]?.n ?? 1) !== 0 || (tables[0]?.n ?? 1) !== 0) {
        throw new Error('Refusing to run: the external server is not fresh (it has databases, roles or tables of its own). The harness only runs on a server created for this run.');
      }
    } finally {
      await sql.end({ timeout: 5 });
    }
    return cluster;
  }

  /** Connection URL (a secret: keep it out of logs). */
  url(login: string, password: string, database: string): string {
    return `postgresql://${encodeURIComponent(login)}:${encodeURIComponent(password)}@${this.endpoint.host}:${this.endpoint.port}/${encodeURIComponent(database)}`;
  }

  superuserUrl(database = 'postgres'): string {
    return this.url(this.endpoint.user, this.endpoint.password, database);
  }

  /** A single-connection client as the cluster superuser. */
  admin(database = 'postgres'): Sql {
    return postgres(this.superuserUrl(database), { max: 1, onnotice: () => undefined });
  }

  async createDatabase(name: string, template?: string): Promise<void> {
    if (!/^[a-z][a-z0-9_]*$/.test(name) || (template !== undefined && !/^[a-z][a-z0-9_]*$/.test(template))) throw new Error('Unsafe database name.');
    const sql = this.admin();
    try {
      await sql.unsafe(`CREATE DATABASE ${name}${template !== undefined ? ` TEMPLATE ${template}` : ''}`);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  async serverVersion(): Promise<string> {
    const sql = this.admin();
    try {
      const rows = await sql.unsafe<{ v: string }[]>("SELECT current_setting('server_version') AS v");
      return rows[0]?.v ?? '';
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  /** `server_version_num` (160015 for 16.15): the exact version, as the server itself reports it. */
  async serverVersionNum(): Promise<number> {
    const sql = this.admin();
    try {
      const rows = await sql.unsafe<{ v: string }[]>("SELECT current_setting('server_version_num') AS v");
      return Number(rows[0]?.v ?? 0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }

  /**
   * Own cluster: stops the server this object started and deletes its directory. External server: does NOTHING (it is not ours to
   * stop; whoever created it destroys it).
   */
  async stop(): Promise<{ stopped: boolean; removed: boolean }> {
    if (this.external) return { stopped: false, removed: false };
    if (this.stopped) return { stopped: true, removed: !existsSync(this.root) };
    this.stopped = true;
    // Only ever act on the directory this instance created.
    const pidFile = join(this.dataDir, 'postmaster.pid');
    if (existsSync(pidFile)) {
      const firstLine = readFileSync(pidFile, 'utf8').split(/\r?\n/)[0];
      if (firstLine !== undefined && /^\d+$/.test(firstLine)) {
        run(pgExe('pg_ctl'), ['-D', this.dataDir, '-m', 'immediate', '-w', '-t', '60', 'stop']);
      }
    }
    for (let attempt = 0; attempt < 20 && existsSync(this.root); attempt += 1) {
      try {
        rmSync(this.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    return { stopped: !existsSync(join(this.dataDir, 'postmaster.pid')), removed: !existsSync(this.root) };
  }
}
