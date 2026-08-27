import { describe, expect, it } from 'vitest';
import {
  ApiError,
  httpErrorMessage,
  isApiError,
  isAuthError,
  isForbidden,
  isNotFound,
} from './errors';

describe('ApiError predicates', () => {
  it('classifies by status', () => {
    expect(isApiError(new ApiError(500, 'X', 'm', undefined))).toBe(true);
    expect(isApiError(new Error('plain'))).toBe(false);
    expect(isAuthError(new ApiError(401, 'UNAUTHORIZED', 'm', undefined))).toBe(true);
    expect(isAuthError(new ApiError(403, 'FORBIDDEN', 'm', undefined))).toBe(false);
    expect(isForbidden(new ApiError(403, 'FORBIDDEN', 'm', undefined))).toBe(true);
    expect(isNotFound(new ApiError(404, 'NOT_FOUND', 'm', undefined))).toBe(true);
  });

  it('marks a status-0 error as a network error', () => {
    expect(new ApiError(0, 'NETWORK_ERROR', 'm', undefined).isNetworkError).toBe(true);
    expect(new ApiError(500, 'X', 'm', undefined).isNetworkError).toBe(false);
  });
});

describe('httpErrorMessage', () => {
  it('never echoes a 5xx backend message', () => {
    const msg = httpErrorMessage(
      new ApiError(500, 'INTERNAL_ERROR', 'TypeError: undefined is not a function', undefined),
    );
    expect(msg).toBe('Something went wrong on our end. Please try again.');
  });

  it('prefers the backend message for a 4xx validation error', () => {
    expect(
      httpErrorMessage(new ApiError(422, 'ERROR', 'Quantity must be positive.', undefined)),
    ).toBe('Quantity must be positive.');
  });

  it('uses a fixed sentence for 401/403/429', () => {
    expect(httpErrorMessage(new ApiError(401, 'UNAUTHORIZED', 'x', undefined))).toMatch(
      /session has expired/i,
    );
    expect(httpErrorMessage(new ApiError(403, 'FORBIDDEN', 'x', undefined))).toMatch(/permission/i);
    expect(httpErrorMessage(new ApiError(429, 'TOO_MANY_REQUESTS', 'x', undefined))).toMatch(
      /too many/i,
    );
  });

  it('has a message for a network failure and for a non-ApiError', () => {
    expect(httpErrorMessage(new ApiError(0, 'NETWORK_ERROR', 'x', undefined))).toMatch(
      /could not reach/i,
    );
    expect(httpErrorMessage('boom')).toBe('Something went wrong. Please try again.');
  });
});
