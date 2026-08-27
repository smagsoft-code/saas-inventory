import { describe, expect, it } from 'vitest';
import { createPermissionChecker } from './permissions';

describe('createPermissionChecker', () => {
  const checker = createPermissionChecker(['core.users.read', 'core.users.create']);

  it('can() is an exact membership test', () => {
    expect(checker.can('core.users.read')).toBe(true);
    expect(checker.can('core.users.update')).toBe(false);
  });

  it('canAny() is true when at least one is held, and for the empty list', () => {
    expect(checker.canAny(['core.users.update', 'core.users.create'])).toBe(true);
    expect(checker.canAny(['core.users.update'])).toBe(false);
    expect(checker.canAny([])).toBe(true);
  });

  it('canAll() requires every code, and is true for the empty list', () => {
    expect(checker.canAll(['core.users.read', 'core.users.create'])).toBe(true);
    expect(checker.canAll(['core.users.read', 'core.users.update'])).toBe(false);
    expect(checker.canAll([])).toBe(true);
  });

  it('a user with no permissions is denied everything', () => {
    const none = createPermissionChecker([]);
    expect(none.can('core.users.read')).toBe(false);
    expect(none.canAll(['core.users.read'])).toBe(false);
  });
});
