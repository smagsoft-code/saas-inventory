/**
 * `event_outbox.last_error` and every processor log line must never accidentally persist a secret
 * or a full PII payload (§33, §95, §194). This redacts the obvious credential shapes and truncates
 * — it is a safety net, not a guarantee that a handler can't log something sensitive itself
 * (handlers are reviewed separately).
 */
const MAX_LENGTH = 500;

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  // a JWT-looking triple-segment base64url string (do this first — before the key:value rule can
  // partially eat it)
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, '[redacted-jwt]'],
  // "Bearer <token>" anywhere
  [/\bbearer\s+[^\s,;)"']+/gi, 'bearer [redacted]'],
  // key: value / key=value for common secret-ish keys — the value can be a whole `Bearer x` pair
  [/\b(authorization|token|api[-_]?key|apikey|password|passwd|pwd|secret|client[-_]?secret)\b\s*[:=]\s*(?:bearer\s+)?[^\s,;)"']+/gi, '$1=[redacted]'],
  // credentials embedded in a URL (scheme://user:pass@host)
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)[^\s@/]+@/gi, '$1[redacted]@'],
];

export function sanitizeError(error: unknown): string {
  let message =
    error instanceof Error && typeof error.message === 'string' && error.message.length > 0
      ? error.message
      : typeof error === 'string' && error.length > 0
        ? error
        : 'unknown error';

  for (const [pattern, replacement] of REDACTIONS) {
    message = message.replace(pattern, replacement);
  }
  if (message.length > MAX_LENGTH) {
    message = `${message.slice(0, MAX_LENGTH)}… [truncated]`;
  }
  return message;
}
