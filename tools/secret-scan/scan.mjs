// Secret scanner (B4.11.5.7). Zero dependencies: plain Node >= 20, so it runs in CI and in a Git hook without `pnpm install`.
//
// WHAT IT DOES: reads text files of the repository (working tree, the Git index, or the lines added by a range of commits), applies a fixed set of rules, and reports
// WHERE a probable credential is: path, line, rule and severity. THE MATCHED TEXT IS NEVER PRINTED, LOGGED, STORED OR PUT IN AN ERROR: findings do not even carry it
// (a rule returns a verdict, the value is dropped before a finding object exists), so there is nothing to leak through a stack trace or a JSON dump.
//
// WHAT IT DOES NOT DO: it is a pattern scanner, not an entropy scanner and not a proof of absence. It misses a secret that matches no rule (for example a low-entropy
// password in prose, or one split over several lines) and it reports some harmless literals as "suspect". See docs/security/secret-scanning.md.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export const MAX_FILE_BYTES = 1_000_000;
export const MAX_LINE_CHARS = 5_000;
export const ALLOW_MARKER = 'secret-scan:allow';
export const ALLOWLIST_FILE = '.secret-scan-allow.json';

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Exclusions. They are decided from the PATH ALONE, before any content is opened or requested from Git.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

/** Directories whose content is never read: dependencies, VCS internals, build output, data directories, backups, scratch space. */
const EXCLUDED_DIRS = /(^|\/)(node_modules|\.git|\.turbo|\.next|dist|coverage|\.pnpm-store|\.dev-pgdata|\.verify-pgdata|s3data|scratchpad|Backups|backups|restore-test|DevData)(\/|$)/;
/** Generated or machine-written files (large, no human-written secrets). */
const EXCLUDED_GENERATED = /^database\/migrations\/meta\/.*_snapshot\.json$/;
const BINARY_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|ico|bmp|pdf|zip|gz|tgz|bz2|7z|xlsx?|docx?|pptx?|woff2?|ttf|otf|eot|mp[34]|mov|webm|wasm|bin|exe|dll|so|dylib|class|jar|sqlite3?|db)$/i;
/** Files that must never be committed. Their NAME is the finding; their content is not opened. `.env.example` is the documented exception. */
const SENSITIVE_FILENAMES = [
  { rule: 'sensitive-file-env', test: (base) => /^\.env(\..+)?$/.test(base) && base !== '.env.example' },
  { rule: 'sensitive-file-password', test: (base) => /\.pw$/i.test(base) },
  { rule: 'sensitive-file-key', test: (base) => /\.(pem|key|p12|pfx|jks|keystore)$/i.test(base) || /^id_(rsa|dsa|ecdsa|ed25519)$/.test(base) },
  { rule: 'sensitive-file-dump', test: (base) => /\.(dump|bak|backup)$/i.test(base) || /\.sql\.gz$/i.test(base) },
];

/** @returns {{ skip: boolean, reason?: string, sensitive?: string }} */
export function classifyPath(relPath) {
  const p = relPath.replace(/\\/g, '/');
  const base = p.slice(p.lastIndexOf('/') + 1);
  for (const { rule, test } of SENSITIVE_FILENAMES) {
    if (test(base)) return { skip: true, reason: 'sensitive-name', sensitive: rule };
  }
  if (EXCLUDED_DIRS.test(p)) return { skip: true, reason: 'excluded-directory' };
  if (EXCLUDED_GENERATED.test(p)) return { skip: true, reason: 'generated' };
  if (BINARY_EXTENSIONS.test(base)) return { skip: true, reason: 'binary-extension' };
  return { skip: false };
}

export function looksBinary(buffer) {
  const n = Math.min(buffer.length, 8000);
  for (let i = 0; i < n; i += 1) if (buffer[i] === 0) return true;
  return false;
}

const TEST_PATH = /(^|\/)(test|tests|__tests__|fixtures?|__mocks__)\/|\.(test|spec)\.[cm]?[jt]sx?$|\.test\.mjs$/;
export const isTestPath = (p) => TEST_PATH.test(p.replace(/\\/g, '/'));

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Rules. A rule inspects one line and answers with verdicts only: { rule, severity, confidence }. It never returns the text it matched.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

const PLACEHOLDER_WORDS = /(change[-_ ]?me|replace[-_ ]?me|your[-_ ]|<.*>|example|placeholder|dummy|fake|sample|redacted|todo|tbd|not[-_ ]?a[-_ ]?secret|synthetic|fixture|secret[-_ ]here|insert[-_ ]|xxxx|\*{3,}|\.{3,}|unused|none|null|undefined|process\.env|import\.meta)/i;
const COMMON_WEAK_PLACEHOLDERS = new Set(['password', 'passwd', 'secret', 'token', 'changeit', 'changeme', 'test', 'testing', 'admin', 'user', 'username', 'pass', 'string', 'value', 'default', 'local', 'localhost', 'minioadmin', 'postgres']);

/** True when the value is clearly not a real credential (variable reference, template, marker, repeated character, sentence). */
export function isPlaceholder(rawValue) {
  const v = rawValue.trim().replace(/^["'`]|["'`]$/g, '');
  if (v === '') return true;
  if (/^\$\{.*\}$|^\$[A-Za-z_][A-Za-z0-9_]*$|^%[A-Za-z_]+%$|^\{\{.*\}\}$|^<[^>]*>$|^\$\(.*\)$/.test(v)) return true;
  if (/\$\{|\{\{|<[A-Za-z_]+>/.test(v)) return true; // contains an interpolation
  if (COMMON_WEAK_PLACEHOLDERS.has(v.toLowerCase())) return true;
  if (PLACEHOLDER_WORDS.test(v)) return true;
  if (/^(.)\1+$/.test(v)) return true; // aaaaaaaa, ********
  if (/\s/.test(v)) return true; // prose or a message, not a token
  return false;
}

const characterClasses = (v) => (/[a-z]/.test(v) ? 1 : 0) + (/[A-Z]/.test(v) ? 1 : 0) + (/[0-9]/.test(v) ? 1 : 0) + (/[^A-Za-z0-9]/.test(v) ? 1 : 0);
/** snake_case / kebab-case / dotted lower-case words: a name or a path, not a password. */
const identifierLike = (v) => /^[a-z][a-z0-9]*(?:[._:/-][a-z0-9]+)+$/.test(v) || /^[A-Za-z]+$/.test(v);

/**
 * @param {string} value a literal that is assigned to a secret-looking key
 * @returns {'confirmed' | 'suspect' | null}
 */
export function judgeLiteral(value) {
  const v = value.trim();
  if (v.length < 8 || isPlaceholder(v)) return null;
  if (/^[A-Z][A-Z0-9_]{5,}$/.test(v)) return null; // an environment-variable NAME (N8N_EVENTS_AUTH_TOKEN), not a value
  const classes = characterClasses(v);
  if (classes >= 3) return 'confirmed';
  if (v.length >= 24 && classes >= 2 && !identifierLike(v)) return 'confirmed';
  if (identifierLike(v)) return null;
  return 'suspect';
}

const KEY_WORD = String.raw`(?:password|passwd|pwd|passphrase|secret|token|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|private[_-]?key|auth[_-]?key|credentials?)`;
// <identifier ending in a secret word> [quote] <: | = | =>> <quoted literal>
const QUOTED_ASSIGNMENT = new RegExp(String.raw`[A-Za-z0-9_.-]*${KEY_WORD}["']?\s*(?::|=>|=)\s*(["'\x60])((?:(?!\1)[^\r\n]){8,}?)\1`, 'i');
// KEY=value / KEY: value with no quotes, only for ALL_CAPS names (env files, shell, yaml)
const BARE_ASSIGNMENT = new RegExp(String.raw`(?:^|[\s"'])[A-Z][A-Z0-9_]*${KEY_WORD.toUpperCase().replace(/\[_-\]\?/g, '_?')}\s*[:=]\s*([^\s"'#]{8,})\s*$`);
// documentation prose: "Login: `user` / `value`" (the shape of a credential pasted into a document)
const LOGIN_PAIR = /\b(?:login|credentials?|credenciales|usuario)\s*:\s*`[^`\r\n]+`\s*\/\s*`([^`\r\n]{8,})`/i;
const URL_CREDENTIALS = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:/@'"`<>]+):([^\s@'"`/<>]{3,})@/i;
const BEARER = /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})/;
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/;
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
const PROVIDER_TOKENS = [
  ['aws-access-key-id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b/],
  ['slack-token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['stripe-live-key', /\b[sr]k_live_[0-9A-Za-z]{16,}\b/],
  ['generic-sk-key', /\bsk-[A-Za-z0-9]{32,}\b/],
  ['npm-token', /\bnpm_[A-Za-z0-9]{36}\b/],
];
const BARE_ALLOWED_EXT = /(^|\/)(\.env\.example|[^/]*\.(env|ini|properties|sh|bash|yml|yaml|toml|md|mdx|txt))$/i;

/**
 * @param {string} line
 * @param {{ path: string }} ctx
 * @returns {Array<{ rule: string, severity: 'critical'|'high'|'medium'|'low', confidence: 'confirmed'|'suspect', hardTokenRule: boolean }>}
 */
export function applyRules(line, ctx) {
  const out = [];
  const text = line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line;
  if (PRIVATE_KEY.test(text)) out.push({ rule: 'private-key', severity: 'critical', confidence: 'confirmed', hardTokenRule: true });
  for (const [rule, re] of PROVIDER_TOKENS) {
    if (re.test(text)) out.push({ rule, severity: 'critical', confidence: 'confirmed', hardTokenRule: true });
  }
  if (JWT.test(text)) out.push({ rule: 'jwt', severity: 'high', confidence: 'confirmed', hardTokenRule: true });

  const quoted = QUOTED_ASSIGNMENT.exec(text);
  if (quoted !== null) {
    const verdict = judgeLiteral(quoted[2] ?? '');
    if (verdict !== null) out.push({ rule: 'secret-assignment', severity: verdict === 'confirmed' ? 'high' : 'low', confidence: verdict, hardTokenRule: false });
  } else if (BARE_ALLOWED_EXT.test(ctx.path)) {
    const bare = BARE_ASSIGNMENT.exec(text);
    if (bare !== null) {
      const verdict = judgeLiteral(bare[1] ?? '');
      if (verdict !== null) out.push({ rule: 'secret-assignment-bare', severity: verdict === 'confirmed' ? 'high' : 'low', confidence: verdict, hardTokenRule: false });
    }
  }
  const pair = LOGIN_PAIR.exec(text);
  if (pair !== null) {
    const verdict = judgeLiteral(pair[1] ?? '');
    if (verdict !== null) out.push({ rule: 'login-pair', severity: verdict === 'confirmed' ? 'high' : 'low', confidence: verdict, hardTokenRule: false });
  }
  const url = URL_CREDENTIALS.exec(text);
  if (url !== null && !isPlaceholder(url[2] ?? '')) out.push({ rule: 'url-credentials', severity: 'high', confidence: 'confirmed', hardTokenRule: false });
  const bearer = BEARER.exec(text);
  if (bearer !== null && !isPlaceholder(bearer[1] ?? '')) out.push({ rule: 'bearer-token', severity: 'high', confidence: 'confirmed', hardTokenRule: false });
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Scanning a text.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {{ path: string, line: number, rule: string, severity: string, confidence: 'confirmed'|'suspect' }} Finding
 */

/**
 * Scans one text. `onlyLines` (a Set of 1-based numbers) restricts the lines examined (used for the added lines of a commit range).
 * @returns {{ findings: Finding[], allowedInline: number, markersWithoutReason: Array<{ path: string, line: number }> }}
 */
export function scanText(relPath, text, onlyLines) {
  const findings = [];
  const markersWithoutReason = [];
  let allowedInline = 0;
  const lines = text.split(/\r?\n/);
  const testFile = isTestPath(relPath);
  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    if (onlyLines !== undefined && !onlyLines.has(lineNo)) continue;
    const line = lines[i] ?? '';
    const verdicts = applyRules(line, { path: relPath });
    if (verdicts.length === 0) continue;
    const marker = inlineAllowance(line, i > 0 ? lines[i - 1] ?? '' : '');
    if (marker === 'reasoned') {
      allowedInline += verdicts.length;
      continue;
    }
    if (marker === 'no-reason') markersWithoutReason.push({ path: relPath, line: lineNo });
    for (const v of verdicts) {
      // Test code carries synthetic credentials by design: assignments, URLs and bearer values found in test files are reported as suspect, never as confirmed.
      // Real key material and provider-token shapes stay confirmed everywhere.
      const downgraded = testFile && !v.hardTokenRule && v.confidence === 'confirmed';
      findings.push({ path: relPath, line: lineNo, rule: v.rule, severity: downgraded ? 'low' : v.severity, confidence: downgraded ? 'suspect' : v.confidence });
    }
  }
  return { findings, allowedInline, markersWithoutReason };
}

/** `secret-scan:allow <reason>` on the line or the one above. A marker without a reason of at least 10 characters does not count. */
function inlineAllowance(line, previous) {
  for (const candidate of [line, previous]) {
    const at = candidate.indexOf(ALLOW_MARKER);
    if (at === -1) continue;
    const reason = candidate.slice(at + ALLOW_MARKER.length).replace(/^[\s:*/-]+/, '').replace(/[*/\s]+$/, '');
    return reason.length >= 10 ? 'reasoned' : 'no-reason';
  }
  return 'none';
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Allowlist file: path + rule (+ optional line) + reason + reviewedIn. No value field exists; unknown fields are refused.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

export class ConfigError extends Error {}

export function loadAllowlist(root) {
  let raw;
  try {
    raw = readFileSync(path.join(root, ALLOWLIST_FILE), 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw new ConfigError('cannot read the allowlist file');
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ConfigError('the allowlist file is not valid JSON');
  }
  if (data === null || typeof data !== 'object' || data.version !== 1 || !Array.isArray(data.entries)) throw new ConfigError('the allowlist must be { "version": 1, "entries": [...] }');
  const allowedKeys = new Set(['path', 'rule', 'line', 'reason', 'reviewedIn']);
  return data.entries.map((entry, index) => {
    if (entry === null || typeof entry !== 'object') throw new ConfigError(`allowlist entry ${index} is not an object`);
    for (const key of Object.keys(entry)) if (!allowedKeys.has(key)) throw new ConfigError(`allowlist entry ${index} has an unknown field "${key}" (a value must never be recorded)`);
    if (typeof entry.path !== 'string' || typeof entry.rule !== 'string') throw new ConfigError(`allowlist entry ${index} needs "path" and "rule"`);
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 15) throw new ConfigError(`allowlist entry ${index} needs a "reason" of at least 15 characters`);
    if (typeof entry.reviewedIn !== 'string' || entry.reviewedIn.trim() === '') throw new ConfigError(`allowlist entry ${index} needs "reviewedIn"`);
    if (entry.line !== undefined && !Number.isInteger(entry.line)) throw new ConfigError(`allowlist entry ${index}: "line" must be an integer`);
    return { path: entry.path.replace(/\\/g, '/'), rule: entry.rule, line: entry.line, matched: false };
  });
}

function applyAllowlist(findings, allowlist) {
  const kept = [];
  let allowed = 0;
  for (const f of findings) {
    const hit = allowlist.find((e) => e.path === f.path && e.rule === f.rule && (e.line === undefined || e.line === f.line));
    if (hit !== undefined) {
      hit.matched = true;
      allowed += 1;
    } else kept.push(f);
  }
  return { kept, allowed };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------
// Git plumbing. Arguments are passed as an array (no shell). Paths come from NUL-separated output, so spaces and non-ASCII names are safe.
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------

function git(root, args, options = {}) {
  return execFileSync('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options });
}
const splitNul = (buffer) => buffer.toString('utf8').split('\0').filter((s) => s !== '');

/** @returns {string[]} repository-relative paths, forward slashes */
export function listWorkingTree(root, prefixes) {
  const out = splitNul(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']));
  const unique = [...new Set(out)];
  return prefixes === undefined ? unique : unique.filter((p) => prefixes.some((x) => p === x || p.startsWith(x.endsWith('/') ? x : `${x}/`)));
}
export function listStaged(root) {
  return splitNul(git(root, ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']));
}

function emptyTotals() {
  return { filesScanned: 0, skipped: { 'excluded-directory': 0, generated: 0, 'binary-extension': 0, binary: 0, 'too-large': 0, 'sensitive-name': 0, unreadable: 0 }, allowedInline: 0 };
}

function scanOne(relPath, readContent, totals, findings, markers, onRead) {
  const c = classifyPath(relPath);
  if (c.skip) {
    totals.skipped[c.reason] += 1;
    if (c.sensitive) findings.push({ path: relPath, line: 0, rule: c.sensitive, severity: 'high', confidence: 'confirmed' });
    return;
  }
  let buffer;
  try {
    if (onRead !== undefined) onRead(relPath); // test hook: proves which paths were opened (never called for an excluded path)
    buffer = readContent(relPath);
  } catch {
    totals.skipped.unreadable += 1;
    return;
  }
  if (buffer === null) {
    totals.skipped['too-large'] += 1;
    return;
  }
  if (looksBinary(buffer)) {
    totals.skipped.binary += 1;
    return;
  }
  totals.filesScanned += 1;
  const r = scanText(relPath, buffer.toString('utf8'));
  findings.push(...r.findings);
  markers.push(...r.markersWithoutReason);
  totals.allowedInline += r.allowedInline;
}

/**
 * @param {{ root: string, mode: 'working-tree'|'staged'|'range', from?: string, to?: string, prefixes?: string[], onRead?: (relPath: string) => void }} options
 */
export function scanRepository(options) {
  const root = path.resolve(options.root);
  const allowlist = loadAllowlist(root);
  const totals = emptyTotals();
  const findings = [];
  const markers = [];

  if (options.mode === 'working-tree') {
    for (const rel of listWorkingTree(root, options.prefixes)) {
      scanOne(
        rel,
        (p) => {
          const full = path.join(root, p);
          const stat = statSync(full);
          if (!stat.isFile()) throw new Error('not a file');
          return stat.size > MAX_FILE_BYTES ? null : readFileSync(full);
        },
        totals,
        findings,
        markers,
        options.onRead,
      );
    }
  } else if (options.mode === 'staged') {
    for (const rel of listStaged(root)) {
      // The blob in the INDEX, not the file in the working directory.
      scanOne(
        rel,
        (p) => {
          const size = Number(git(root, ['cat-file', '-s', `:0:${p}`]).toString('utf8').trim());
          return size > MAX_FILE_BYTES ? null : git(root, ['cat-file', 'blob', `:0:${p}`]);
        },
        totals,
        findings,
        markers,
        options.onRead,
      );
    }
  } else if (options.mode === 'range') {
    if (!options.from || !options.to) throw new ConfigError('range mode needs --from and --to');
    scanRange(root, options.from, options.to, totals, findings, markers);
  } else throw new ConfigError(`unknown mode "${String(options.mode)}"`);

  const { kept, allowed } = applyAllowlist(findings, allowlist);
  // Staleness is only meaningful when the whole tree was scanned.
  const stale = options.mode === 'working-tree' && options.prefixes === undefined ? allowlist.filter((e) => !e.matched).map((e) => ({ path: e.path, rule: e.rule, line: e.line })) : [];
  kept.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
  return { findings: kept, allowedByAllowlist: allowed, stale, markersWithoutReason: markers, totals };
}

/** Every added line of every commit in from..to (so a secret added by an early commit and removed by a later one is still seen). */
function scanRange(root, from, to, totals, findings, markers) {
  const commits = splitNul(git(root, ['log', '-z', '--reverse', '--format=%H', `${from}..${to}`]));
  const pathspec = ['--', '.', ':(exclude).git', ...excludePathspecs()];
  for (const commit of commits) {
    // Names first: a committed `.env` or key file is a finding by NAME, and its content is excluded from the diff below.
    const names = splitNul(git(root, ['diff-tree', '-r', '-z', '--no-commit-id', '--name-only', '--diff-filter=ACMR', '-m', '--first-parent', '--root', commit]));
    for (const name of [...new Set(names)]) {
      const c = classifyPath(name);
      if (c.sensitive) findings.push({ path: name, line: 0, rule: c.sensitive, severity: 'high', confidence: 'confirmed' });
    }
    const diff = git(root, ['show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', '--diff-filter=ACMR', '-M', '-m', '--first-parent', commit, ...pathspec]).toString('utf8');
    let current = null;
    let lineNo = 0;
    const perFile = new Map();
    for (const raw of diff.split('\n')) {
      if (raw.startsWith('+++ ')) {
        const m = /^\+\+\+ b\/(.+)$/.exec(raw.replace(/\r$/, ''));
        current = m ? m[1] : null;
        if (current !== null && !perFile.has(current)) perFile.set(current, []);
        continue;
      }
      if (raw.startsWith('--- ') || raw.startsWith('diff --git') || raw.startsWith('index ')) continue;
      const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      if (h) {
        lineNo = Number(h[1]);
        continue;
      }
      if (current === null) continue;
      if (raw.startsWith('+')) {
        perFile.get(current).push({ n: lineNo, text: raw.slice(1) });
        lineNo += 1;
      }
    }
    for (const [file, added] of perFile) {
      const c = classifyPath(file);
      if (c.skip) {
        totals.skipped[c.reason] += 1;
        continue;
      }
      totals.filesScanned += 1;
      // scan the added lines only, with their real line numbers
      const text = added.map((a) => a.text).join('\n');
      const r = scanText(file, text);
      for (const f of r.findings) findings.push({ ...f, line: added[f.line - 1].n });
      for (const m of r.markersWithoutReason) markers.push({ path: file, line: added[m.line - 1].n });
      totals.allowedInline += r.allowedInline;
    }
  }
}

function excludePathspecs() {
  return [':(exclude)**/node_modules/**', ':(exclude)**/.env', ':(exclude)**/.env.*', ':(exclude)**/*.pw', ':(exclude)scratchpad/**', ':(exclude)database/migrations/meta/*_snapshot.json'];
}
