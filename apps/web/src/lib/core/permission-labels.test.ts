import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES } from '../auth/permission-codes';
import { describePermission, PERMISSION_LABELS, PERMISSION_MODULE_LABELS } from './permission-labels';

describe('permission labels', () => {
  it('every permission code the app knows has a plain-language label and help', () => {
    const missing = PERMISSION_CODES.filter((code) => !PERMISSION_LABELS[code]);
    expect(missing).toEqual([]);
  });

  it('labels stay short, help is a single sentence, and neither exposes technical words', () => {
    for (const [code, { label, help }] of Object.entries(PERMISSION_LABELS)) {
      expect(label.length, code).toBeLessThanOrEqual(45);
      expect(help.length, code).toBeGreaterThan(20);
      expect(`${label} ${help}`, code).not.toMatch(/tenant|_|ledger|RLS|UUID|ADR/i);
    }
  });

  it('every module has a Spanish group title', () => {
    for (const module of ['core', 'administration', 'catalog', 'pricing', 'inventory', 'import', 'sales']) {
      expect(PERMISSION_MODULE_LABELS[module]).toBeTruthy();
    }
  });

  it('an unknown (newly added) code falls back to the API description instead of disappearing', () => {
    expect(describePermission('new.thing.do', 'Hacer algo nuevo')).toEqual({ label: 'Hacer algo nuevo', help: 'Hacer algo nuevo' });
  });
});
