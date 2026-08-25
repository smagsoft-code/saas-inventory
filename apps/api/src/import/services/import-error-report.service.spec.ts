import { describe, expect, it } from 'vitest';
import { sanitizeForSpreadsheet } from './import-error-report.service';

/** §15/security.md#file-upload-security — CSV/Excel formula-injection sanitization applied to
 * every value echoed back into the generated error report. */
describe('sanitizeForSpreadsheet', () => {
  it.each(['=cmd|/c calc', '+1+1', '-1+1', '@SUM(A1:A2)'])('neutralizes a leading formula-injection character: %s', (input) => {
    const result = sanitizeForSpreadsheet(input);
    expect(result.startsWith("'")).toBe(true);
    expect(result).toBe(`'${input}`);
  });

  it('leaves an ordinary value untouched', () => {
    expect(sanitizeForSpreadsheet('SKU-123')).toBe('SKU-123');
    expect(sanitizeForSpreadsheet(42)).toBe('42');
  });

  it('returns an empty string for null/undefined', () => {
    expect(sanitizeForSpreadsheet(null)).toBe('');
    expect(sanitizeForSpreadsheet(undefined)).toBe('');
  });
});
