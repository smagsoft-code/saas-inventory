/**
 * Open-redirect prevention (Prompt 016 §30 / §51). A `returnTo` value that came from a query
 * string is attacker-controllable, so only a same-origin *path* is ever honoured — anything that
 * could send the browser to another origin (absolute URL, protocol-relative "//host",
 * backslash tricks, embedded whitespace/newlines) falls back to the default.
 */

// Whitespace (incl. CR/LF/TAB) or a backslash disqualifies the value: a backslash can be folded
// to "/" by the browser, a newline can smuggle a second header/target.
const UNSAFE_CHARS = /[\s\\]/;

export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
  if (!value) {
    return fallback;
  }
  const candidate = value.trim();

  // Must be a rooted path, and not a network-path reference ("//host", "/\host").
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.startsWith('/\\')) {
    return fallback;
  }
  if (UNSAFE_CHARS.test(candidate)) {
    return fallback;
  }
  // Never bounce back to an auth route — that just loops the user.
  const path = candidate.split(/[?#]/)[0] ?? candidate;
  if (path === '/login' || path === '/register' || path === '/platform/login') {
    return fallback;
  }
  return candidate;
}
