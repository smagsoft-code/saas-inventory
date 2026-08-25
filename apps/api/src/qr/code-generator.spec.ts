import { describe, expect, it } from 'vitest';
import { generateQrCode } from './code-generator';

describe('generateQrCode', () => {
  it('generates a URL-safe, opaque token of sufficient length', () => {
    const code = generateQrCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code.length).toBeGreaterThan(20);
  });

  it('generates unique codes across many calls', () => {
    const codes = Array.from({ length: 200 }, () => generateQrCode());
    expect(new Set(codes).size).toBe(codes.length);
  });
});
