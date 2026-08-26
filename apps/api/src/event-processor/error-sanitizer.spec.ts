import { describe, expect, it } from 'vitest';
import { sanitizeError } from './error-sanitizer';

describe('sanitizeError', () => {
  it('takes the message off an Error', () => {
    expect(sanitizeError(new Error('boom'))).toBe('boom');
  });

  it('accepts a bare string', () => {
    expect(sanitizeError('plain failure')).toBe('plain failure');
  });

  it('falls back for empty / non-error input', () => {
    expect(sanitizeError(undefined)).toBe('unknown error');
    expect(sanitizeError(null)).toBe('unknown error');
    expect(sanitizeError({})).toBe('unknown error');
    expect(sanitizeError(new Error(''))).toBe('unknown error');
  });

  it('redacts bearer tokens / api keys / passwords (§95)', () => {
    expect(sanitizeError(new Error('request failed: Authorization: Bearer abc123def456'))).not.toContain('abc123def456');
    expect(sanitizeError(new Error('api_key=sk-supersecret rejected'))).not.toContain('sk-supersecret');
    expect(sanitizeError(new Error('bad password=hunter2'))).not.toContain('hunter2');
  });

  it('redacts credentials embedded in a URL', () => {
    const out = sanitizeError(new Error('connect postgres://app_tenant:s3cr3t@db:5432/x failed'));
    expect(out).not.toContain('s3cr3t');
    expect(out).toContain('[redacted]@');
  });

  it('redacts a JWT-looking string', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.QW5vdGhlclNlZ21lbnQ';
    expect(sanitizeError(new Error(`token was ${jwt}`))).not.toContain(jwt);
  });

  it('truncates a very long message', () => {
    const out = sanitizeError(new Error('x'.repeat(2000)));
    expect(out.length).toBeLessThan(600);
    expect(out.endsWith('[truncated]')).toBe(true);
  });
});
