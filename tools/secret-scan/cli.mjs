#!/usr/bin/env node
// Command line of the secret scanner (B4.11.5.7). Usage:
//   node tools/secret-scan/cli.mjs --mode working-tree [--paths tools,apps,docs] [--strict]
//   node tools/secret-scan/cli.mjs --mode staged                       (the pre-commit hook)
//   node tools/secret-scan/cli.mjs --mode range --from <rev> --to <rev>  (CI: every added line of every commit in from..to)
// Exit codes: 0 clean (or only suspects), 1 a confirmed finding (or any finding with --strict), 2 usage / configuration / internal error.
// The output never contains a matched value: path, line, rule and severity only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigError, scanRepository } from './scan.mjs';

function parseArgs(argv) {
  const args = { mode: undefined, root: undefined, from: undefined, to: undefined, paths: undefined, strict: false, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new ConfigError(`${a} needs a value`);
      i += 1;
      return v;
    };
    if (a === '--mode') args.mode = next();
    else if (a === '--root') args.root = next();
    else if (a === '--from') args.from = next();
    else if (a === '--to') args.to = next();
    else if (a === '--paths') args.paths = next().split(',').map((s) => s.trim().replace(/\\/g, '/')).filter(Boolean);
    else if (a === '--strict') args.strict = true;
    else if (a === '--quiet') args.quiet = true;
    else throw new ConfigError(`unknown option "${a.slice(0, 40)}"`);
  }
  if (!['working-tree', 'staged', 'range'].includes(args.mode ?? '')) throw new ConfigError('--mode must be working-tree, staged or range');
  return args;
}

export function run(argv, out = (line) => process.stdout.write(`${line}\n`), err = (line) => process.stderr.write(`${line}\n`)) {
  let args;
  try {
    args = parseArgs(argv);
    const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const result = scanRepository({ root: args.root ?? defaultRoot, mode: args.mode, from: args.from, to: args.to, prefixes: args.paths });
    const confirmed = result.findings.filter((f) => f.confidence === 'confirmed');
    const suspects = result.findings.filter((f) => f.confidence === 'suspect');
    for (const f of result.findings) {
      out(`${f.confidence === 'confirmed' ? 'CONFIRMED' : 'suspect  '}  ${f.severity.padEnd(8)}  ${f.rule.padEnd(24)}  ${f.path}${f.line > 0 ? `:${String(f.line)}` : ''}`);
    }
    for (const m of result.markersWithoutReason) out(`note       ${ 'allow-marker-without-reason'.padEnd(34)}  ${m.path}:${String(m.line)}  (needs a reason of 10+ characters; the finding stays)`);
    for (const s of result.stale) out(`ERROR      stale-allowlist-entry                ${s.path} ${s.rule}${s.line !== undefined ? `:${String(s.line)}` : ''}  (matches nothing; remove it or fix it)`);
    if (!args.quiet || confirmed.length > 0 || result.stale.length > 0) {
      const sk = result.totals.skipped;
      out(
        `secret-scan [${args.mode}]: ${String(result.totals.filesScanned)} file(s) scanned; skipped: ${String(sk['excluded-directory'])} excluded dir, ${String(sk.generated)} generated, ${String(sk['binary-extension'] + sk.binary)} binary, ${String(sk['too-large'])} too large, ${String(sk.unreadable)} unreadable; ` +
          `${String(confirmed.length)} confirmed, ${String(suspects.length)} suspect, ${String(result.allowedByAllowlist + result.totals.allowedInline)} allowed with a reason.`,
      );
    }
    if (result.stale.length > 0) return 2;
    if (confirmed.length > 0 || (args.strict && suspects.length > 0)) {
      err('secret-scan: FAILED. Values are never printed; open the listed lines. A false positive needs a reasoned `secret-scan:allow <reason>` comment or an entry in .secret-scan-allow.json (docs/security/secret-scanning.md).');
      return 1;
    }
    return 0;
  } catch (error) {
    // Never echo a message that could carry content: type and system code only.
    const kind = error instanceof ConfigError ? 'configuration' : 'internal';
    const detail = error instanceof ConfigError ? `: ${error.message}` : error && error.code ? ` (${String(error.code)})` : '';
    err(`secret-scan: ${kind} error${detail}`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2));
}
