import {
  appendMissingEntries,
  isValidReviewReference,
  validateAgainstHistoryManifest,
  validateClassifications,
  type EntryDecision,
  type HistoryManifest,
} from './history-manifest';
import { findUndeclaredPrivileged, privilegedTags, validatePrivilegedManifest, type PrivilegedManifest } from './privileged-manifest';
import { diagnostic, type Diagnostic, type FileHashes, type JournalEntry } from './types';

/**
 * What `history-manifest.cli.ts --write` is allowed to do, decided and validated BEFORE anything is
 * written.
 *
 * Recording a hash in the history manifest says "this file is what it is"; it is NOT an approval to
 * run it. The approval is the explicit decision a human gives for each NEW migration — its
 * classification (`ordinary` | `privileged`) and the reference to the review that decided it. The plan
 * refuses (and writes nothing) when:
 *  - the existing manifests are inconsistent, or an already-recorded migration changed;
 *  - a new migration has no decision, or its review reference is malformed;
 *  - a decision targets a migration that is already recorded (recorded entries are never reclassified);
 *  - the planned manifest would disagree with the privileged manifest (classification vs declaration), or
 *    a new `ordinary` migration contains a privileged statement.
 *
 * Pure: the caller writes the file only when `refusals` is empty and `added` is not.
 */
export interface ManifestUpdateInput {
  readonly historyManifest: HistoryManifest;
  readonly privilegedManifest: PrivilegedManifest;
  readonly journal: readonly JournalEntry[];
  readonly fileHashes: FileHashes;
  readonly sqlByTag: Readonly<Record<string, string | undefined>>;
  /** Decisions given by the author, keyed by tag; only for migrations the manifest does not list yet. */
  readonly decisions: Readonly<Record<string, EntryDecision | undefined>>;
}

export interface ManifestUpdatePlan {
  readonly manifest: HistoryManifest;
  /** Tags that would be appended; empty when refused or when there is nothing to add. */
  readonly added: readonly string[];
  /** Why nothing may be written. Empty means the plan can be applied. */
  readonly refusals: readonly Diagnostic[];
}

export function planManifestAppend(input: ManifestUpdateInput): ManifestUpdatePlan {
  const { historyManifest, privilegedManifest, journal, fileHashes, sqlByTag, decisions } = input;
  const refuse = (refusals: readonly Diagnostic[]): ManifestUpdatePlan => ({ manifest: historyManifest, added: [], refusals });
  const declared = privilegedTags(privilegedManifest);

  // 1. The references we start from must already be sound.
  const initial = [...validatePrivilegedManifest(privilegedManifest, journal, fileHashes), ...validateClassifications(historyManifest, declared)];
  if (initial.length > 0) return refuse(initial);

  // 2. Already-recorded migrations must not have changed.
  const appended = appendMissingEntries(historyManifest, journal, fileHashes, decisions);
  if (appended.conflicts.length > 0) return refuse(appended.conflicts);

  // 3. Every new migration needs a well-formed decision; no decision may touch a recorded one.
  const recorded = new Set(historyManifest.entries.map((e) => e.tag));
  const newTags = journal.filter((e) => !recorded.has(e.tag)).map((e) => e.tag);
  const decisionProblems: Diagnostic[] = [];
  for (const tag of newTags) {
    const decision = decisions[tag];
    if (decision === undefined) {
      decisionProblems.push(
        diagnostic('CLASSIFICATION_MISSING', `New migration "${tag}" needs an explicit classification and review reference (--classify ${tag}=ordinary|privileged and --reviewed-in <ref>).`, {
          migration: tag,
        }),
      );
    } else if (!isValidReviewReference(decision.reviewedIn)) {
      decisionProblems.push(
        diagnostic('REVIEW_EVIDENCE_INVALID', `The review reference given for "${tag}" is not commit:<sha>, pr:<n>, review:<id>:<date> or retroactive-review:<id>:<date>.`, {
          migration: tag,
        }),
      );
    }
  }
  for (const tag of Object.keys(decisions)) {
    if (decisions[tag] !== undefined && recorded.has(tag)) {
      decisionProblems.push(
        diagnostic('CLASSIFICATION_MISMATCH', `"${tag}" is already recorded; a recorded migration is never reclassified or re-reviewed by the generator.`, { migration: tag }),
      );
    } else if (decisions[tag] !== undefined && !newTags.includes(tag)) {
      decisionProblems.push(diagnostic('MANIFEST_ENTRY_EXTRA', `A decision was given for "${tag}", which is not in the journal.`, { migration: tag }));
    }
  }
  if (decisionProblems.length > 0) return refuse(decisionProblems);

  // 4. The manifest that would be written must be fully valid.
  const planned = appended.manifest;
  const newSet = new Set(newTags);
  const finalProblems = [
    ...validateAgainstHistoryManifest(journal, fileHashes, planned),
    ...validateClassifications(planned, declared),
    ...findUndeclaredPrivileged(
      privilegedManifest,
      journal.filter((entry) => newSet.has(entry.tag)),
      sqlByTag,
    ),
  ];
  if (finalProblems.length > 0) return refuse(finalProblems);

  return { manifest: planned, added: appended.added, refusals: [] };
}

/**
 * `--classify <tag>=ordinary|privileged` (repeatable) and `--reviewed-in <ref>` from the CLI's
 * arguments. Returns the decisions and any problem with the arguments themselves.
 */
export function parseDecisionArgs(argv: readonly string[]): { decisions: Record<string, EntryDecision>; problems: string[] } {
  const problems: string[] = [];
  const reviewedAt = argv.indexOf('--reviewed-in');
  const reviewedIn = reviewedAt >= 0 ? argv[reviewedAt + 1] : undefined;
  const decisions: Record<string, EntryDecision> = {};
  for (const [i, arg] of argv.entries()) {
    if (arg !== '--classify') continue;
    const value = argv[i + 1] ?? '';
    const [tag, classification, ...rest] = value.split('=');
    if (tag === undefined || tag === '' || rest.length > 0 || (classification !== 'ordinary' && classification !== 'privileged')) {
      problems.push(`--classify expects <tag>=ordinary|privileged; got "${value}".`);
      continue;
    }
    if (reviewedIn === undefined || reviewedIn.startsWith('--')) {
      problems.push('--classify needs --reviewed-in <ref>.');
      continue;
    }
    decisions[tag] = { classification, reviewedIn };
  }
  return { decisions, problems };
}
