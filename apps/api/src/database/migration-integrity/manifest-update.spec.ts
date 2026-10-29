import { describe, expect, it } from 'vitest';
import type { EntryDecision } from './history-manifest';
import { decisionsFor, historyManifestFor, makeFiles, makeJournal, must, privilegedManifestFor, TEST_REVIEW } from './fixtures';
import { parseDecisionArgs, planManifestAppend } from './manifest-update';
import type { PrivilegedManifest } from './privileged-manifest';

const ORDINARY: EntryDecision = { classification: 'ordinary', reviewedIn: TEST_REVIEW };
const PRIVILEGED: EntryDecision = { classification: 'privileged', reviewedIn: TEST_REVIEW };

/** A journal of 25 migrations where only the first 24 are recorded in the history manifest. */
function scenario(newSql: string, decisions?: Record<string, EntryDecision>) {
  const journal = makeJournal(25);
  const newTag = must(journal[24]).tag;
  const files = makeFiles(journal, { [newTag]: newSql });
  return {
    journal,
    newTag,
    files,
    input: {
      historyManifest: historyManifestFor(journal.slice(0, 24), files),
      privilegedManifest: privilegedManifestFor(files),
      journal,
      fileHashes: files.fileHashes,
      sqlByTag: files.sqlByTag,
      decisions: decisions ?? { [newTag]: ORDINARY },
    },
  };
}
type Input = ReturnType<typeof scenario>['input'];
const codes = (input: Input) => planManifestAppend(input).refusals.map((d) => d.code);

describe('planManifestAppend', () => {
  it('appends a new ordinary migration with the decision given', () => {
    const s = scenario('CREATE TABLE t (id int);');
    const plan = planManifestAppend(s.input);
    expect(plan.refusals).toEqual([]);
    expect(plan.added).toEqual([s.newTag]);
    expect(plan.manifest.entries).toHaveLength(25);
    expect(plan.manifest.entries[24]).toMatchObject({ tag: s.newTag, classification: 'ordinary', reviewedIn: TEST_REVIEW });
  });

  it('has nothing to add when the manifest already lists everything', () => {
    const s = scenario('SELECT 1;', {});
    const plan = planManifestAppend({ ...s.input, historyManifest: historyManifestFor(s.journal, s.files) });
    expect(plan).toMatchObject({ added: [], refusals: [] });
  });

  it('refuses a new migration without a decision: a hash alone is not an approval', () => {
    const s = scenario('SELECT 1;', {});
    const plan = planManifestAppend(s.input);
    expect(plan.added).toEqual([]);
    expect(plan.manifest).toBe(s.input.historyManifest);
    expect(plan.refusals.map((d) => d.code)).toEqual(['CLASSIFICATION_MISSING']);
  });

  it('refuses a malformed review reference', () => {
    const s = scenario('SELECT 1;');
    const input = { ...s.input, decisions: { [s.newTag]: { classification: 'ordinary', reviewedIn: 'looks fine' } satisfies EntryDecision } };
    expect(codes(input)).toEqual(['REVIEW_EVIDENCE_INVALID']);
  });

  it.each(['CREATE ROLE x', 'ALTER ROLE x SET y = 1', 'DROP ROLE x', 'CREATE EXTENSION foo', 'RESET ROLE', 'SET ROLE app_migrator', 'SET SESSION AUTHORIZATION x'])(
    'refuses to record "%s" as ordinary and records nothing',
    (statement) => {
      const s = scenario(`${statement};`);
      const plan = planManifestAppend(s.input);
      expect(plan.added).toEqual([]);
      expect(plan.manifest).toBe(s.input.historyManifest);
      expect(plan.refusals.map((d) => d.code)).toContain('PRIVILEGED_STATEMENT_UNDECLARED');
    },
  );

  it('refuses "privileged" when the privileged manifest does not declare it yet', () => {
    const s = scenario('CREATE ROLE x;');
    // two true findings: the classification disagrees with the declaration, and the statement is undeclared
    expect(codes({ ...s.input, decisions: { [s.newTag]: PRIVILEGED } })).toEqual(['CLASSIFICATION_MISMATCH', 'PRIVILEGED_STATEMENT_UNDECLARED']);
  });

  it('records a privileged migration once it is declared in the privileged manifest', () => {
    const s = scenario('CREATE ROLE x;');
    const declared: PrivilegedManifest = {
      manifestVersion: 1,
      entries: [...s.input.privilegedManifest.entries, { tag: s.newTag, sha256: must(s.files.fileHashes[s.newTag]), reason: 'creates a role' }],
    };
    const plan = planManifestAppend({ ...s.input, privilegedManifest: declared, decisions: { [s.newTag]: PRIVILEGED } });
    expect(plan.refusals).toEqual([]);
    expect(plan.manifest.entries[24]).toMatchObject({ classification: 'privileged' });
  });

  it('refuses to record as ordinary a migration the privileged manifest declares', () => {
    const s = scenario('SELECT 1;');
    const declared: PrivilegedManifest = {
      manifestVersion: 1,
      entries: [...s.input.privilegedManifest.entries, { tag: s.newTag, sha256: must(s.files.fileHashes[s.newTag]), reason: 'x' }],
    };
    expect(codes({ ...s.input, privilegedManifest: declared })).toEqual(['CLASSIFICATION_MISMATCH']);
  });

  it('never reclassifies or re-reviews an already-recorded migration', () => {
    const s = scenario('SELECT 1;');
    const input = { ...s.input, decisions: { ...s.input.decisions, [must(s.journal[3]).tag]: ORDINARY } };
    expect(codes(input)).toEqual(['CLASSIFICATION_MISMATCH']);
  });

  it('refuses a decision for a tag that is not in the journal', () => {
    const s = scenario('SELECT 1;');
    expect(codes({ ...s.input, decisions: { ...s.input.decisions, '0099_ghost': ORDINARY } })).toEqual(['MANIFEST_ENTRY_EXTRA']);
  });

  it('refuses when an already-recorded migration changed, and records nothing', () => {
    const journal = makeJournal(25);
    const original = makeFiles(journal);
    const edited = makeFiles(journal, { [must(journal[3]).tag]: 'SELECT 2;' });
    const plan = planManifestAppend({
      historyManifest: historyManifestFor(journal.slice(0, 24), original),
      privilegedManifest: privilegedManifestFor(edited),
      journal,
      fileHashes: edited.fileHashes,
      sqlByTag: edited.sqlByTag,
      decisions: decisionsFor(journal.slice(24)),
    });
    expect(plan.added).toEqual([]);
    expect(plan.refusals.map((d) => d.code)).toContain('MANIFEST_HASH_MISMATCH');
  });

  it('refuses to extend a manifest whose existing entries are not classified', () => {
    const s = scenario('SELECT 1;');
    const broken = { ...s.input.historyManifest, entries: s.input.historyManifest.entries.map((e, i) => (i === 7 ? { ...e, classification: null } : e)) };
    const plan = planManifestAppend({ ...s.input, historyManifest: broken });
    expect(plan.added).toEqual([]);
    expect(plan.refusals.map((d) => d.code)).toEqual(['CLASSIFICATION_MISSING']);
  });

  it('does not let an old recorded privileged statement block a later ordinary migration', () => {
    const journal = makeJournal(25);
    const files = makeFiles(journal, { [must(journal[5]).tag]: 'CREATE ROLE old_one;' });
    const plan = planManifestAppend({
      historyManifest: historyManifestFor(journal.slice(0, 24), files),
      privilegedManifest: privilegedManifestFor(files),
      journal,
      fileHashes: files.fileHashes,
      sqlByTag: files.sqlByTag,
      decisions: { [must(journal[24]).tag]: ORDINARY },
    });
    expect(plan.refusals).toEqual([]);
  });

  it('refuses when the privileged manifest is itself inconsistent (required migration missing)', () => {
    const s = scenario('SELECT 1;');
    const plan = planManifestAppend({ ...s.input, privilegedManifest: { manifestVersion: 1, entries: [] } });
    expect(plan.added).toEqual([]);
    expect(plan.refusals.map((d) => d.code)).toContain('PRIVILEGED_MANIFEST_REQUIRED_MISSING');
  });
});

describe('parseDecisionArgs', () => {
  it('reads repeatable --classify with one --reviewed-in', () => {
    const r = parseDecisionArgs(['--write', '--classify', '0051_a=ordinary', '--classify', '0052_b=privileged', '--reviewed-in', 'pr:7']);
    expect(r.problems).toEqual([]);
    expect(r.decisions).toEqual({
      '0051_a': { classification: 'ordinary', reviewedIn: 'pr:7' },
      '0052_b': { classification: 'privileged', reviewedIn: 'pr:7' },
    });
  });

  it.each([
    [['--classify', '0051_a=maybe', '--reviewed-in', 'pr:7']],
    [['--classify', '0051_a', '--reviewed-in', 'pr:7']],
    [['--classify', '0051_a=ordinary']],
    [['--classify', '0051_a=ordinary', '--reviewed-in', '--write']],
  ])('reports an unusable argument list %j', (argv) => {
    expect(parseDecisionArgs(argv).problems.length).toBeGreaterThan(0);
  });
});
