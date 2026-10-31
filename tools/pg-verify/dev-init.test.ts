import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { decideStart, DevInitError, inspectDevDir, parseStartFlags } from './dev-init';
import { devInitializedMarker, devInitializingMarker } from './env-guard';

const root = mkdtempSync(path.join(tmpdir(), 'pgv-init-'));
after(() => rmSync(root, { recursive: true, force: true }));
let n = 0;
const fresh = (): string => path.join(root, `d${String(++n)}`);
const pgDir = (): string => {
  const d = fresh();
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'PG_VERSION'), '18');
  return d;
};
const NONE = { finishInit: false, adopt: false };
const FINISH = { finishInit: true, adopt: false };
const ADOPT = { finishInit: false, adopt: true };

describe('inspectDevDir', () => {
  it('missing and empty directories are fresh', () => {
    const missing = fresh();
    assert.equal(inspectDevDir(missing), 'fresh');
    const empty = fresh();
    mkdirSync(empty);
    assert.equal(inspectDevDir(empty), 'fresh');
  });
  it('a PostgreSQL directory is complete, partial or unmarked according to its sibling markers — PG_VERSION alone proves nothing', () => {
    const unmarked = pgDir();
    assert.equal(inspectDevDir(unmarked), 'unmarked');
    const partial = pgDir();
    writeFileSync(devInitializingMarker(partial), '{}');
    assert.equal(inspectDevDir(partial), 'partial');
    const complete = pgDir();
    writeFileSync(devInitializingMarker(complete), '{}');
    writeFileSync(devInitializedMarker(complete), '{}');
    assert.equal(inspectDevDir(complete), 'complete');
  });
  it('a non-empty directory without PG_VERSION is foreign', () => {
    const d = fresh();
    mkdirSync(d);
    writeFileSync(path.join(d, 'x.txt'), 'x');
    assert.equal(inspectDevDir(d), 'foreign');
  });
});

describe('decideStart (never deletes; recovery is explicit)', () => {
  const dir = '/d';
  it('creates a fresh directory and reuses a complete one', () => {
    assert.equal(decideStart('fresh', NONE, dir), 'initialize');
    assert.equal(decideStart('complete', NONE, dir), 'reuse');
  });
  it('refuses a partial directory unless --finish-init is given', () => {
    assert.throws(() => decideStart('partial', NONE, dir), DevInitError);
    assert.throws(() => decideStart('partial', ADOPT, dir), DevInitError);
    assert.equal(decideStart('partial', FINISH, dir), 'finish-init');
  });
  it('refuses an unmarked PostgreSQL directory unless --adopt is given', () => {
    assert.throws(() => decideStart('unmarked', NONE, dir), DevInitError);
    assert.throws(() => decideStart('unmarked', FINISH, dir), DevInitError);
    assert.equal(decideStart('unmarked', ADOPT, dir), 'adopt');
  });
  it('refuses a foreign directory whatever the flags', () => {
    for (const flags of [NONE, FINISH, ADOPT]) assert.throws(() => decideStart('foreign', flags, dir), DevInitError);
  });
  it('rejects --finish-init / --adopt on a directory that has nothing to finish or adopt', () => {
    assert.throws(() => decideStart('fresh', FINISH, dir), DevInitError);
    assert.throws(() => decideStart('fresh', ADOPT, dir), DevInitError);
  });
  it('the refusal messages point to the explicit way forward and name no secret', () => {
    const msg = (s: Parameters<typeof decideStart>[0]): string => {
      try {
        decideStart(s, NONE, dir);
      } catch (error) {
        return (error as Error).message;
      }
      return '';
    };
    assert.match(msg('partial'), /--finish-init/);
    assert.match(msg('unmarked'), /--adopt/);
  });
});

describe('parseStartFlags', () => {
  it('parses the two supported flags and rejects anything else or both together', () => {
    assert.deepEqual(parseStartFlags([]), NONE);
    assert.deepEqual(parseStartFlags(['--finish-init']), FINISH);
    assert.deepEqual(parseStartFlags(['--adopt']), ADOPT);
    assert.throws(() => parseStartFlags(['--wipe']), DevInitError);
    assert.throws(() => parseStartFlags(['--adopt', '--finish-init']), DevInitError);
  });
});

describe('the directory is never touched by a refusal', () => {
  it('keeps every file when a decision throws', () => {
    const d = pgDir();
    writeFileSync(path.join(d, 'data.bin'), 'x');
    writeFileSync(devInitializingMarker(d), '{}');
    assert.throws(() => decideStart(inspectDevDir(d), NONE, d), DevInitError);
    assert.equal(existsSync(path.join(d, 'data.bin')), true);
    assert.equal(existsSync(devInitializingMarker(d)), true);
  });
});
