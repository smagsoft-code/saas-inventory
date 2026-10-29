import { diagnostic, type Diagnostic } from './types';

/**
 * Strict parsing of the arguments of `db:migrate` (`migrate.ts`), done BEFORE any configuration is
 * resolved and before anything connects. A mistyped flag must never be read as "no flags": that would
 * run a full migration when the author meant `--provision-only`.
 *
 * Accepted: `--mode <bootstrap|incremental>` or `--mode=<…>`, and `--provision-only`, each at most once.
 * pnpm 9 forwards the literal `--` of `pnpm run db:migrate -- --mode x` to the script, so exactly ONE
 * leading `--` is tolerated; the documented form is `pnpm … db:migrate --mode x`. Anything else — an unknown
 * flag, a positional argument, a repeated or valueless flag, `--provision-only` with `--mode incremental` —
 * is refused.
 *
 * Messages never echo an argument's text (a mistaken positional could be a connection string): they give
 * its position and, only for something shaped like a plain flag, its name.
 */

export interface MigrateArgs {
  readonly mode: 'bootstrap' | 'incremental' | undefined;
  readonly provisionOnly: boolean;
}

export const MIGRATE_USAGE =
  'Usage: db:migrate [--mode bootstrap|incremental] [--provision-only]  (--provision-only is bootstrap mode only). With pnpm write it without "--": pnpm --filter @saas-inventory/api db:migrate --mode bootstrap';

const PLAIN_FLAG = /^--[a-z][a-z-]{0,30}$/;

export function parseMigrateArgs(argv: readonly string[]): { args: MigrateArgs | null; diagnostics: Diagnostic[] } {
  const problems: Diagnostic[] = [];
  const bad = (message: string) => problems.push(diagnostic('CLI_ARGUMENT_INVALID', message));
  const tokens = argv[0] === '--' ? argv.slice(1) : [...argv];

  let mode: string | undefined;
  let modeSeen = false;
  let provisionOnly = false;
  let provisionSeen = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i] ?? '';
    const position = i + 1;
    if (token === '--mode' || token.startsWith('--mode=')) {
      if (modeSeen) {
        bad('--mode was given more than once.');
        continue;
      }
      modeSeen = true;
      if (token === '--mode') {
        const next = tokens[i + 1];
        if (next === undefined || next.startsWith('-')) {
          bad('--mode needs a value: bootstrap or incremental.');
        } else {
          mode = next;
          i += 1;
        }
      } else {
        mode = token.slice('--mode='.length);
      }
      if (mode !== undefined && mode !== 'bootstrap' && mode !== 'incremental') {
        bad('--mode must be "bootstrap" or "incremental".');
        mode = undefined;
      }
    } else if (token === '--provision-only') {
      if (provisionSeen) bad('--provision-only was given more than once.');
      provisionSeen = true;
      provisionOnly = true;
    } else if (PLAIN_FLAG.test(token)) {
      bad(`Unknown option "${token}" (argument ${position}).`);
    } else {
      bad(`Unexpected argument ${position}: only --mode and --provision-only are accepted.`);
    }
  }

  if (provisionOnly && mode === 'incremental') {
    bad('--provision-only cannot be combined with --mode incremental: it is a bootstrap-mode operation.');
  }
  if (problems.length > 0) return { args: null, diagnostics: problems };
  return { args: { mode: mode === 'bootstrap' || mode === 'incremental' ? mode : undefined, provisionOnly }, diagnostics: [] };
}
