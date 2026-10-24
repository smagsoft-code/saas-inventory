import { ApiError } from '../api/errors';

/**
 * User-facing, Spanish warnings of the public auth screens (login, platform login, company
 * selection, invitation, registration). The backend answers these flows in English and — on purpose —
 * generically (it never says which credential was wrong, security.md §6), so the text is decided here
 * from the HTTP status alone; the backend's own message and any 5xx body are never shown.
 */
const NETWORK = 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.';
const TOO_MANY = 'Demasiados intentos. Espera un momento e inténtalo de nuevo.';
const SERVER = 'Algo salió mal de nuestro lado. Inténtalo de nuevo.';

function common(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  if (err.isNetworkError) return NETWORK;
  if (err.status === 429) return TOO_MANY;
  if (err.status >= 500) return SERVER;
  return undefined;
}

/** Wrong user or password (401), or a malformed/empty submission (400). */
export function loginErrorMessage(err: unknown): string {
  const shared = common(err);
  if (shared) return shared;
  if (err instanceof ApiError) {
    if (err.status === 401) return 'Usuario o contraseña incorrectos.';
    if (err.status === 400 || err.status === 422) return 'Ingresa tu usuario y tu contraseña.';
    if (err.status === 403) return 'Tu cuenta no tiene acceso. Contacta al administrador.';
  }
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.';
}

/** Choosing a company after a valid login. */
export function selectionErrorMessage(err: unknown): string {
  const shared = common(err);
  if (shared) return shared;
  if (err instanceof ApiError && err.status === 401) {
    return 'Tu inicio de sesión expiró antes de elegir una empresa. Inicia sesión de nuevo.';
  }
  return 'No se pudo abrir esa empresa. Inicia sesión de nuevo.';
}

/** Activating an account from an invitation link. */
export function invitationErrorMessage(err: unknown): string {
  const shared = common(err);
  if (shared) return shared;
  if (err instanceof ApiError) {
    if (err.status === 401 || err.status === 409 || err.status === 404) {
      return 'La invitación no es válida o ya venció. Pide una nueva al administrador.';
    }
    if (err.status === 400 || err.status === 422) return 'Ingresa una contraseña.';
  }
  return 'No se pudo activar la cuenta. Inténtalo de nuevo.';
}

/** Creating a company (self-registration). */
export function registerErrorMessage(err: unknown): string {
  const shared = common(err);
  if (shared) return shared;
  if (err instanceof ApiError) {
    if (err.status === 409) return 'Ya existe una cuenta con esos datos. Usa otro usuario o correo.';
    if (err.status === 400 || err.status === 422) return 'Revisa los datos: completa todos los campos y usa un correo válido.';
  }
  return 'No se pudo crear tu empresa. Inténtalo de nuevo.';
}
