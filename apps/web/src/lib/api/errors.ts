/**
 * The single frontend error model (frontend.md#api-client) — every non-2xx response from the
 * backend is normalized into one `ApiError` the UI layer can branch on by `status`/`code`.
 *
 * The backend's error envelope is fixed by `apps/api/src/common/filters/http-exception.filter.ts`
 * (`packages/types`' `ApiErrorShape`): `{ statusCode, code, message, correlationId? }`. No other
 * fields are invented here — `details` is only ever populated from a `details` array the backend
 * actually sends (none do today; the field is kept typed so a future validation-detail contract
 * has a home without another refactor).
 */

/** The backend error envelope, exactly as `HttpExceptionFilter` serializes it. */
export interface ApiErrorShape {
  statusCode: number;
  code: string;
  message: string;
  correlationId?: string;
  details?: unknown;
}

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    /** HTTP status. `0` means the request never got a response (network/DNS/TLS failure, abort). */
    readonly status: number,
    /** The backend's stable machine code (`UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, …) or
     * `NETWORK_ERROR` / `UNKNOWN_ERROR` when the response carried no usable envelope. */
    readonly code: string,
    message: string,
    readonly correlationId: string | undefined,
    readonly details?: unknown,
  ) {
    super(message);
  }

  /** True when the request failed before any HTTP response was received. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** 401 — the session is missing/expired. Distinct from {@link isForbidden}: the api client only
 * ever attempts a token refresh for this, never for a 403 (frontend.md / Prompt 016 §8). */
export function isAuthError(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 401;
}

/** 403 — authenticated but not allowed. Never treated as an authentication problem. */
export function isForbidden(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 403;
}

export function isNotFound(error: unknown): error is ApiError {
  return isApiError(error) && error.status === 404;
}

/**
 * A short, user-facing sentence for an error — never a stack trace or raw backend message for a
 * 5xx. For 4xx the backend's own message is safe and specific (it is written for end users), so it
 * is preferred when present; the status-based text is the fallback.
 */
export function httpErrorMessage(error: unknown): string {
  if (!isApiError(error)) {
    return 'Algo salió mal. Inténtalo de nuevo.';
  }
  if (error.isNetworkError) {
    return 'No se pudo contactar al servidor. Revisa tu conexión e inténtalo de nuevo.';
  }
  switch (error.status) {
    case 400:
    case 422:
      // OUI-001 / GAP-BACKEND-MESSAGES-EN: error.message viene del backend (apps/api), que hoy
      // devuelve sus mensajes en inglés — traducir esa cadena está fuera de alcance de esta fase
      // (no se toca apps/api). El fallback (sin mensaje del backend) sí está en español.
      return error.message || 'Parte de la información ingresada no es válida.';
    case 401:
      return 'Tu sesión expiró. Inicia sesión de nuevo.';
    case 403:
      return 'No tienes permiso para hacer eso.';
    case 404:
      return 'No se encontró ese elemento.';
    case 409:
      return error.message || 'Esa acción entra en conflicto con el estado actual.';
    case 429:
      return 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.';
    default:
      return error.status >= 500
        ? 'Algo salió mal de nuestro lado. Inténtalo de nuevo.'
        : error.message || 'Algo salió mal. Inténtalo de nuevo.';
  }
}
