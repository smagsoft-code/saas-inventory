import type { LintFinding } from './lint-migration';
import type { LintSeverity } from './rules';

/** Presentation and exit codes of the linter (ADR-0041, D-8D). */

const ORDER: Record<LintSeverity, number> = { ERROR: 0, WARNING: 1, INFO: 2 };

/** A finding that still counts: not accepted by an exception. */
export const isOpen = (f: LintFinding): boolean => f.accepted === undefined;

export function countBySeverity(findings: readonly LintFinding[]): Record<LintSeverity, number> {
  const out: Record<LintSeverity, number> = { ERROR: 0, WARNING: 0, INFO: 0 };
  for (const f of findings) if (isOpen(f)) out[f.severity] += 1;
  return out;
}

/**
 * Exit code: 0 = no open ERROR (and, with `strict`, no open WARNING); 1 = an open ERROR, or an open WARNING under `strict`.
 * (2 is used by the CLI for unusable input.) INFO never affects it.
 */
export function exitCodeFor(findings: readonly LintFinding[], strict = false): 0 | 1 {
  const c = countBySeverity(findings);
  return c.ERROR > 0 || (strict && c.WARNING > 0) ? 1 : 0;
}

export function sortFindings(findings: readonly LintFinding[]): LintFinding[] {
  return [...findings].sort(
    (a, b) => a.tag.localeCompare(b.tag) || (a.line ?? 0) - (b.line ?? 0) || ORDER[a.severity] - ORDER[b.severity] || a.ruleId.localeCompare(b.ruleId),
  );
}

export function formatFinding(f: LintFinding): string {
  const where = `${f.tag}.sql${f.line !== null ? `:${f.line}` : ''}`;
  const accepted = f.accepted !== undefined ? ` [ACCEPTED by ${f.accepted.reviewedIn}: ${f.accepted.reason}]` : '';
  const confirmed = f.certainty === 'low' ? ' [NOT confirmed by the syntax tree]' : '';
  return `${f.severity.padEnd(7)} ${f.ruleId} ${where} — ${f.message}${confirmed}${accepted}`;
}

export function formatTable(findings: readonly LintFinding[]): string {
  const rows = sortFindings(findings).map((f) => [
    `${f.tag}${f.line !== null ? `:${f.line}` : ''}`,
    f.ruleId,
    f.severity,
    f.certainty,
    f.bootstrapRelated ? 'bootstrap' : '-',
    f.accepted !== undefined ? 'accepted' : 'open',
    f.operation,
  ]);
  const header = ['file:line', 'rule', 'severity', 'certainty', 'scope', 'status', 'operation'];
  const widths = header.map((h, i) => Math.min(70, Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length))));
  const fit = (cells: readonly string[]) => cells.map((c, i) => (c.length > (widths[i] ?? 0) ? `${c.slice(0, (widths[i] ?? 1) - 1)}…` : c.padEnd(widths[i] ?? 0))).join('  ');
  return [fit(header), fit(widths.map((w) => '-'.repeat(w))), ...rows.map(fit)].join('\n');
}

/** Open findings the syntax tree did NOT confirm: the construct could not be analysed (PL/pgSQL, …). */
export const lowCertaintyCount = (findings: readonly LintFinding[]): number => findings.filter((f) => isOpen(f) && f.certainty === 'low').length;

export function summary(findings: readonly LintFinding[]): string {
  const c = countBySeverity(findings);
  const accepted = findings.filter((f) => !isOpen(f)).length;
  const low = lowCertaintyCount(findings);
  return `${c.ERROR} error(s), ${c.WARNING} warning(s), ${c.INFO} info${accepted > 0 ? `, ${accepted} accepted by exception` : ''}${low > 0 ? `; ${low} of low certainty (not confirmed by the syntax tree: unanalysed PL/pgSQL)` : ''}`;
}
