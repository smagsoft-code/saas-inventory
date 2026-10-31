import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import {
  assertDevTarget,
  assertPortFree,
  assertServerDataDirectory,
  assertTestingTarget,
  classifyDataDir,
  DEFAULT_TESTING_PORT,
  devInitializedMarker,
  devInitializingMarker,
  EnvironmentGuardError,
  PERSISTENT_MARKER,
  PROTECTED_PORTS,
  removeDisposableDir,
  resolveDevDataDir,
} from './env-guard';

const root = mkdtempSync(path.join(tmpdir(), 'pgv-guard-'));
after(() => rmSync(root, { recursive: true, force: true }));
const dev = path.join(root, 'scratchpad', '.dev-pgdata');
const verify = path.join(root, 'tools', '.verify-pgdata');
const target = (over: Partial<{ port: number; dataDir: string; dbName: string }> = {}) => ({ port: DEFAULT_TESTING_PORT, dataDir: verify, dbName: 'saas_inventory_verify', ...over });

describe('assertTestingTarget', () => {
  it('accepts the disposable testing target', () => {
    assert.doesNotThrow(() => assertTestingTarget(target(), dev));
  });
  it('rejects every protected port, including the development one', () => {
    for (const port of PROTECTED_PORTS) assert.throws(() => assertTestingTarget(target({ port }), dev), EnvironmentGuardError);
  });
  it('rejects a database that is not a testing database', () => {
    for (const dbName of ['saas_inventory_dev', 'saas_inventory', 'postgres', 'saas_inventory_verify; drop']) {
      assert.throws(() => assertTestingTarget(target({ dbName }), dev), EnvironmentGuardError);
    }
  });
  it('rejects the development data directory and anything inside or around it', () => {
    for (const dataDir of [dev, path.join(dev, '.verify-pgdata'), path.join(root, 'scratchpad')]) {
      assert.throws(() => assertTestingTarget(target({ dataDir }), dev), EnvironmentGuardError);
    }
  });
  it('rejects a directory that is not named like the disposable one, whatever its location', () => {
    assert.throws(() => assertTestingTarget(target({ dataDir: path.join(root, 'tools', 'pgdata') }), dev), EnvironmentGuardError);
  });
  it('rejects a directory marked as persistent', () => {
    mkdirSync(verify, { recursive: true });
    writeFileSync(path.join(verify, PERSISTENT_MARKER), '');
    assert.throws(() => assertTestingTarget(target(), dev), EnvironmentGuardError);
    rmSync(verify, { recursive: true, force: true });
  });
});

describe('removeDisposableDir', () => {
  it('removes the disposable directory and reports it', () => {
    mkdirSync(verify, { recursive: true });
    writeFileSync(path.join(verify, 'PG_VERSION'), '18');
    assert.equal(removeDisposableDir(verify, dev), true);
    assert.equal(existsSync(verify), false);
    assert.equal(removeDisposableDir(verify, dev), false);
  });
  it('never removes the development directory, even if it looks right', () => {
    mkdirSync(dev, { recursive: true });
    writeFileSync(path.join(dev, 'PG_VERSION'), '18');
    assert.throws(() => removeDisposableDir(dev, dev), EnvironmentGuardError);
    assert.equal(existsSync(path.join(dev, 'PG_VERSION')), true);
  });
  it('never removes a directory named like the disposable one when it lies inside the development directory', () => {
    const inside = path.join(dev, '.verify-pgdata');
    mkdirSync(inside, { recursive: true });
    assert.throws(() => removeDisposableDir(inside, dev), EnvironmentGuardError);
    assert.equal(existsSync(inside), true);
  });
  it('refuses a marked directory and an arbitrary name', () => {
    const marked = path.join(root, 'x', '.verify-pgdata');
    mkdirSync(marked, { recursive: true });
    writeFileSync(path.join(marked, PERSISTENT_MARKER), '');
    assert.throws(() => removeDisposableDir(marked, dev), EnvironmentGuardError);
    assert.throws(() => removeDisposableDir(path.join(root, 'x'), dev), EnvironmentGuardError);
    assert.equal(existsSync(marked), true);
  });
});

describe('classifyDataDir / resolveDevDataDir', () => {
  it('tells missing, empty, postgres and unknown directories apart', () => {
    const base = path.join(root, 'classify');
    assert.equal(classifyDataDir(path.join(base, 'a')), 'missing');
    mkdirSync(path.join(base, 'b'), { recursive: true });
    assert.equal(classifyDataDir(path.join(base, 'b')), 'empty');
    mkdirSync(path.join(base, 'c'), { recursive: true });
    writeFileSync(path.join(base, 'c', 'PG_VERSION'), '18');
    assert.equal(classifyDataDir(path.join(base, 'c')), 'postgres');
    mkdirSync(path.join(base, 'd'), { recursive: true });
    writeFileSync(path.join(base, 'd', 'notes.txt'), 'x');
    assert.equal(classifyDataDir(path.join(base, 'd')), 'unknown');
  });
  it('defaults to scratchpad/.dev-pgdata and honours DEV_PGDATA_DIR', () => {
    assert.equal(resolveDevDataDir('/repo', {}), path.join('/repo', 'scratchpad', '.dev-pgdata'));
    assert.equal(resolveDevDataDir('/repo', { DEV_PGDATA_DIR: path.join(root, 'elsewhere') }), path.join(root, 'elsewhere'));
  });
});

describe('assertPortFree', () => {
  it('accepts a free port and rejects a busy one without touching anything', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const busy = (server.address() as net.AddressInfo).port;
    await assert.rejects(assertPortFree(busy), EnvironmentGuardError);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await assert.doesNotReject(assertPortFree(busy));
  });
});

describe('development markers protect a directory from the testing side', () => {
  it('refuses to treat as disposable, or delete, a directory a development marker points to', () => {
    const marked = path.join(root, 'm', '.verify-pgdata');
    mkdirSync(marked, { recursive: true });
    for (const marker of [devInitializingMarker(marked), devInitializedMarker(marked)]) {
      writeFileSync(marker, '{}');
      assert.throws(() => assertTestingTarget(target({ dataDir: marked }), dev), EnvironmentGuardError);
      assert.throws(() => removeDisposableDir(marked, dev), EnvironmentGuardError);
      assert.equal(existsSync(marked), true);
      rmSync(marker, { force: true });
    }
    assert.equal(removeDisposableDir(marked, dev), true);
  });
});

describe('assertDevTarget', () => {
  it('accepts a normal development target', () => {
    assert.doesNotThrow(() => assertDevTarget(dev, 55432));
  });
  it('rejects the testing directory name and the default testing port', () => {
    assert.throws(() => assertDevTarget(verify, 55432), EnvironmentGuardError);
    assert.throws(() => assertDevTarget(dev, DEFAULT_TESTING_PORT), EnvironmentGuardError);
    assert.throws(() => assertDevTarget(dev, 80), EnvironmentGuardError);
  });
});

describe('assertServerDataDirectory', () => {
  it('accepts the same directory in the spellings PostgreSQL and Node use', () => {
    assert.doesNotThrow(() => assertServerDataDirectory(dev.replaceAll('\\', '/'), dev));
    assert.doesNotThrow(() => assertServerDataDirectory(dev, dev));
  });
  it('rejects a server that owns a different directory, or none', () => {
    assert.throws(() => assertServerDataDirectory(path.join(root, 'other'), dev), EnvironmentGuardError);
    assert.throws(() => assertServerDataDirectory('', dev), EnvironmentGuardError);
  });
});
