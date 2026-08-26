import { describe, expect, it } from 'vitest';
import { classifyHttpStatus, isPermanentDeliveryError, PermanentDeliveryError } from './delivery-failure';

describe('classifyHttpStatus (§33/§34)', () => {
  it.each([408, 425, 429, 500, 502, 503, 504])('classifies %s as retryable', (status) => {
    expect(classifyHttpStatus(status)).toBe('retryable');
  });

  it.each([400, 401, 403, 404, 405, 410, 415, 422])('classifies %s as permanent', (status) => {
    expect(classifyHttpStatus(status)).toBe('permanent');
  });

  it('classifies a stray 3xx as permanent (redirects are never followed, §24)', () => {
    expect(classifyHttpStatus(301)).toBe('permanent');
    expect(classifyHttpStatus(302)).toBe('permanent');
  });
});

describe('PermanentDeliveryError (§34/§126)', () => {
  it('is detected by isPermanentDeliveryError', () => {
    expect(isPermanentDeliveryError(new PermanentDeliveryError('nope'))).toBe(true);
  });

  it('does not match an ordinary Error (retryable default)', () => {
    expect(isPermanentDeliveryError(new Error('transient'))).toBe(false);
    expect(isPermanentDeliveryError('string')).toBe(false);
    expect(isPermanentDeliveryError(null)).toBe(false);
  });

  it('matches a structurally-tagged object even across realms', () => {
    expect(isPermanentDeliveryError({ permanent: true, message: 'x' })).toBe(true);
  });
});
