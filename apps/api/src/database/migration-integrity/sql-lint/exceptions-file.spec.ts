import { describe, expect, it } from 'vitest';
import { parseLintExceptions } from './exceptions-file';

const entry = {
  ruleId: 'PRIV-GRANT-PUBLIC',
  tag: '0051_example',
  sha256: 'a'.repeat(64),
  line: 3,
  reason: 'Reviewed: this grant is intended and was approved in the linked review.',
  reviewedIn: 'review:ADR-0099:2026-10-29',
};
const file = (over: Record<string, unknown> = {}) => JSON.stringify({ schemaVersion: 1, exceptions: [], ...over });
const messages = (text: string) => parseLintExceptions(text).problems.map((p) => p.message).join('\n');

describe('parseLintExceptions — accepted', () => {
  it('an empty collection is valid (the shipped state)', () => {
    expect(parseLintExceptions(file())).toEqual({ exceptions: [], problems: [] });
  });

  it('a well-formed entry round-trips', () => {
    const r = parseLintExceptions(file({ exceptions: [entry] }));
    expect(r.problems).toEqual([]);
    expect(r.exceptions).toEqual([entry]);
  });

  it('two entries on the same migration at different lines or rules are fine', () => {
    const r = parseLintExceptions(file({ exceptions: [entry, { ...entry, line: 9 }, { ...entry, ruleId: 'PRIV-GRANT-BROAD' }] }));
    expect(r.exceptions).toHaveLength(3);
  });
});

describe('parseLintExceptions — the whole file is refused', () => {
  it.each([
    ['malformed JSON', '{ "schemaVersion": 1, ', /not valid JSON/],
    ['an empty file', '', /not valid JSON/],
    ['a JSON array at the top', '[]', /top level must be an object/],
    ['a wrong schema version', file({ schemaVersion: 2 }), /schemaVersion/],
    ['a missing schema version', JSON.stringify({ exceptions: [] }), /schemaVersion/],
    ['a missing collection', JSON.stringify({ schemaVersion: 1 }), /"exceptions" must be an array/],
    ['a collection that is not an array', file({ exceptions: {} }), /"exceptions" must be an array/],
    ['an unknown top-level field', file({ note: 'x' }), /unknown top-level field "note"/],
    ['an entry that is not an object', file({ exceptions: ['x'] }), /must be an object/],
    ['an unknown field in an entry', file({ exceptions: [{ ...entry, severity: 'ERROR' }] }), /unknown field "severity"/],
    ['an omitted rule', file({ exceptions: [{ ...entry, ruleId: undefined }] }), /missing field "ruleId"/],
    ['an omitted hash', file({ exceptions: [{ ...entry, sha256: undefined }] }), /missing field "sha256"/],
    ['an omitted line', file({ exceptions: [{ ...entry, line: undefined }] }), /missing field "line"/],
    ['an empty rule', file({ exceptions: [{ ...entry, ruleId: '' }] }), /one exact rule id/],
    ['a wildcard rule', file({ exceptions: [{ ...entry, ruleId: '*' }] }), /no wildcard/],
    ['a partial wildcard rule', file({ exceptions: [{ ...entry, ruleId: 'PRIV-*' }] }), /no wildcard/],
    ['a wildcard migration', file({ exceptions: [{ ...entry, tag: '*' }] }), /one exact migration tag/],
    ['a global exception (no migration)', file({ exceptions: [{ ...entry, tag: '' }] }), /one exact migration tag/],
    ['a short hash', file({ exceptions: [{ ...entry, sha256: 'abc' }] }), /64 lowercase hex/],
    ['an upper-case hash', file({ exceptions: [{ ...entry, sha256: 'A'.repeat(64) }] }), /64 lowercase hex/],
    ['line 0 (a whole-file exception)', file({ exceptions: [{ ...entry, line: 0 }] }), /integer ≥ 1/],
    ['a fractional line', file({ exceptions: [{ ...entry, line: 2.5 }] }), /integer ≥ 1/],
    ['a line given as text', file({ exceptions: [{ ...entry, line: '3' }] }), /integer ≥ 1/],
    ['a reason that is too short', file({ exceptions: [{ ...entry, reason: 'fine' }] }), /at least 30 characters/],
    ['a reason of only spaces', file({ exceptions: [{ ...entry, reason: ' '.repeat(40) }] }), /at least 30 characters/],
    ['an invalid review reference', file({ exceptions: [{ ...entry, reviewedIn: 'approved' }] }), /reviewedIn/],
    ['a duplicate (same rule, migration and line)', file({ exceptions: [entry, { ...entry, reason: 'A different reason, but the same finding again.' }] }), /duplicate/],
  ])('%s', (_name, text, expected) => {
    const r = parseLintExceptions(text);
    expect(r.exceptions).toBeNull(); // nothing is partly applied
    expect(r.problems.length).toBeGreaterThan(0);
    expect(r.problems.every((p) => p.code === 'LINT_EXCEPTION_INVALID')).toBe(true);
    expect(messages(text)).toMatch(expected);
  });

  it('one bad entry among good ones refuses the whole file', () => {
    const r = parseLintExceptions(file({ exceptions: [entry, { ...entry, line: 5, reason: 'short' }] }));
    expect(r.exceptions).toBeNull();
    expect(r.problems).toHaveLength(1);
  });

  it('messages never repeat the content of a reason or a hash', () => {
    const text = messages(file({ exceptions: [{ ...entry, reason: 'secret-looking text that is long enough but the entry is otherwise wrong', line: 0 }] }));
    expect(text).not.toContain('secret-looking');
  });
});
