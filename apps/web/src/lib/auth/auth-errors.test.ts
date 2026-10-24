import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { invitationErrorMessage, loginErrorMessage, registerErrorMessage, selectionErrorMessage } from './auth-errors';

const err = (status: number, message = 'English backend message') => new ApiError(status, 'X', message, undefined);

describe('auth warnings are Spanish and never echo the backend text', () => {
  it('login: wrong credentials, empty form, rate limit, server, network', () => {
    expect(loginErrorMessage(err(401, 'Invalid email or password.'))).toBe('Usuario o contraseña incorrectos.');
    expect(loginErrorMessage(err(400))).toBe('Ingresa tu usuario y tu contraseña.');
    expect(loginErrorMessage(err(429))).toContain('Demasiados intentos');
    expect(loginErrorMessage(err(500, 'stack trace'))).not.toMatch(/stack/);
    expect(loginErrorMessage(new ApiError(0, 'NETWORK_ERROR', 'fetch failed', undefined))).toContain('No se pudo contactar');
    expect(loginErrorMessage(new Error('boom'))).toBe('No se pudo iniciar sesión. Inténtalo de nuevo.');
  });

  it('company selection, invitation and registration', () => {
    expect(selectionErrorMessage(err(401, 'Invalid or expired selection.'))).toContain('Inicia sesión de nuevo');
    expect(invitationErrorMessage(err(401, 'Invalid or expired invitation.'))).toContain('invitación no es válida o ya venció');
    expect(invitationErrorMessage(err(400))).toBe('Ingresa una contraseña.');
    expect(registerErrorMessage(err(409))).toContain('Ya existe una cuenta');
    expect(registerErrorMessage(err(400))).toContain('Revisa los datos');
  });

  it.each([loginErrorMessage, selectionErrorMessage, invitationErrorMessage, registerErrorMessage])('no message is the English backend text', (fn) => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500]) {
      expect(fn(err(status))).not.toContain('English backend message');
    }
  });
});
