import { diagnostic, type Diagnostic, type FileHashes, type JournalEntry } from './types';

/**
 * The versioned reference for every migration: `database/migrations/history-manifest.json`.
 *
 * Comparing the registry only to the files on disk catches a file edited after it was applied, but
 * not a coordinated change (file and registry rewritten together). This manifest is a third,
 * independent record, reviewed in version control, so any change to an applied migration shows up
 * as a diff to a file reviewers look at.
 *
 * Version 2 (ADR-0041, D-7.2) adds, per entry, an EXPLICIT `classification` (`ordinary` |
 * `privileged`) and the evidence of the review that decided it (`reviewedIn`). Recording a hash is
 * not approving a migration: an entry without a valid classification and review reference blocks the
 * run (`CLASSIFICATION_MISSING`, `REVIEW_EVIDENCE_*`), and absence from the privileged manifest is
 * never read as "reviewed and ordinary".
 *
 * It describes the real historical files; it is never used to rewrite them.
 */

export const CLASSIFICATIONS = ['ordinary', 'privileged'] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

export interface HistoryManifestEntry {
  readonly idx: number;
  readonly tag: string;
  readonly when: number;
  readonly sha256: string;
  /** `null` when the file lacks a valid value; `validateClassifications` then blocks the run. */
  readonly classification: Classification | null;
  /** Reference to the review that decided the classification; `null` when absent. */
  readonly reviewedIn: string | null;
}

export interface HistoryManifest {
  readonly manifestVersion: 2;
  readonly hashAlgorithm: 'sha256';
  /** Documents what is hashed so the manifest is self-explanatory. */
  readonly hashInput: string;
  readonly entries: readonly HistoryManifestEntry[];
}

/** The classification and review that a human decided for one migration. */
export interface EntryDecision {
  readonly classification: Classification;
  readonly reviewedIn: string;
}

export const HISTORY_MANIFEST_FILE = 'history-manifest.json';
export const HASH_INPUT_DESCRIPTION =
  'SHA-256 (hex) of the .sql file text with CRLF normalised to LF (so it does not depend on the git checkout line endings); for LF files it equals the hash drizzle-orm registers in drizzle.__drizzle_migrations';

/**
 * Accepted shapes of `reviewedIn`. The FORMAT is validated; whether the commit or PR exists cannot be
 * verified offline, so reviewers must check it. `retroactive-review` marks a classification made
 * later, by reading the SQL, and claims no historic approval.
 *   commit:<7-40 hex>                       a commit that records the review
 *   pr:<number>                             a pull request
 *   review:<id>:<YYYY-MM-DD>                a review record (document, ADR, ticket)
 *   retroactive-review:<id>:<YYYY-MM-DD>    a classification applied afterwards to an already existing migration
 */
const REVIEW_REFERENCE = /^(?:commit:[0-9a-f]{7,40}|pr:[1-9][0-9]*|(?:review|retroactive-review):[A-Za-z0-9._-]+:[0-9]{4}-[0-9]{2}-[0-9]{2})$/;
export function isValidReviewReference(value: string): boolean {
  return REVIEW_REFERENCE.test(value);
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function parseHistoryManifest(text: string): { manifest: HistoryManifest | null; diagnostics: Diagnostic[] } {
  const bad = (message: string): { manifest: null; diagnostics: Diagnostic[] } => ({
    manifest: null,
    diagnostics: [diagnostic('MANIFEST_MALFORMED', message)],
  });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return bad('The history manifest is not valid JSON.');
  }
  const m = raw as Partial<Record<keyof HistoryManifest, unknown>> | null;
  if (typeof m !== 'object' || m === null || m.manifestVersion !== 2 || m.hashAlgorithm !== 'sha256' || !Array.isArray(m.entries)) {
    return bad('The history manifest must have manifestVersion 2 (explicit classification), hashAlgorithm "sha256" and an "entries" array.');
  }
  const entries: HistoryManifestEntry[] = [];
  for (const [position, item] of (m.entries as unknown[]).entries()) {
    const e = item as Partial<Record<keyof HistoryManifestEntry, unknown>> | null;
    if (
      typeof e !== 'object' ||
      e === null ||
      typeof e.idx !== 'number' ||
      typeof e.tag !== 'string' ||
      typeof e.when !== 'number' ||
      typeof e.sha256 !== 'string' ||
      !SHA256_HEX.test(e.sha256)
    ) {
      return bad(`History manifest entry at position ${position} does not have idx, tag, when and a 64-hex sha256.`);
    }
    entries.push({
      idx: e.idx,
      tag: e.tag,
      when: e.when,
      sha256: e.sha256,
      classification: e.classification === 'ordinary' || e.classification === 'privileged' ? e.classification : null,
      reviewedIn: typeof e.reviewedIn === 'string' ? e.reviewedIn : null,
    });
  }
  return {
    manifest: {
      manifestVersion: 2,
      hashAlgorithm: 'sha256',
      hashInput: typeof m.hashInput === 'string' ? m.hashInput : HASH_INPUT_DESCRIPTION,
      entries,
    },
    diagnostics: [],
  };
}

/**
 * Builds a manifest from the journal, the file hashes and the human decisions. Throws if a file is
 * missing or a decision is absent: a manifest cannot describe a migration that does not exist, and a
 * migration is never recorded without an explicit classification (validate the journal first).
 */
export function buildHistoryManifest(
  entries: readonly JournalEntry[],
  fileHashes: FileHashes,
  decisions: Readonly<Record<string, EntryDecision | undefined>>,
): HistoryManifest {
  return {
    manifestVersion: 2,
    hashAlgorithm: 'sha256',
    hashInput: HASH_INPUT_DESCRIPTION,
    entries: entries.map((entry) => {
      const sha256 = fileHashes[entry.tag];
      if (sha256 === null || sha256 === undefined) {
        throw new Error(`Cannot describe "${entry.tag}" in the history manifest: its SQL file is missing.`);
      }
      const decision = decisions[entry.tag];
      if (decision === undefined) {
        throw new Error(`Cannot describe "${entry.tag}" in the history manifest: no classification and review were given.`);
      }
      return { idx: entry.idx, tag: entry.tag, when: entry.when, sha256, classification: decision.classification, reviewedIn: decision.reviewedIn };
    }),
  };
}

/**
 * Journal and files against the manifest, entry by entry and in both directions: a journal entry the
 * manifest does not list (a new migration nobody recorded) and a manifest entry the journal lacks
 * (a migration removed) both refuse the run.
 */
export function validateAgainstHistoryManifest(
  entries: readonly JournalEntry[],
  fileHashes: FileHashes,
  manifest: HistoryManifest,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  const byTag = new Map(manifest.entries.map((e) => [e.tag, e]));
  const journalTags = new Set(entries.map((e) => e.tag));

  for (const entry of entries) {
    const recorded = byTag.get(entry.tag);
    if (recorded === undefined) {
      out.push(
        diagnostic('MANIFEST_ENTRY_MISSING', `Migration "${entry.tag}" is in the journal but not in the history manifest.`, {
          migration: entry.tag,
        }),
      );
      continue;
    }
    if (recorded.idx !== entry.idx) {
      out.push(fieldMismatch(entry.tag, 'idx', recorded.idx, entry.idx));
    }
    if (recorded.when !== entry.when) {
      out.push(fieldMismatch(entry.tag, 'when', recorded.when, entry.when));
    }
    const actual = fileHashes[entry.tag];
    if (actual !== null && actual !== undefined && actual !== recorded.sha256) {
      out.push(
        diagnostic('MANIFEST_HASH_MISMATCH', `The SQL file of "${entry.tag}" no longer matches the hash in the history manifest.`, {
          migration: entry.tag,
          details: { manifestSha256: recorded.sha256, fileSha256: actual },
        }),
      );
    }
  }
  for (const recorded of manifest.entries) {
    if (!journalTags.has(recorded.tag)) {
      out.push(
        diagnostic('MANIFEST_ENTRY_EXTRA', `History manifest lists "${recorded.tag}", which is not in the journal.`, { migration: recorded.tag }),
      );
    }
  }
  const tags = manifest.entries.map((e) => e.tag);
  if (new Set(tags).size !== tags.length) {
    out.push(diagnostic('MANIFEST_MALFORMED', 'The history manifest lists the same tag more than once.'));
  }
  return out;
}

/**
 * Every entry needs an explicit classification and a valid review reference, and the classification
 * must agree with the privileged manifest in BOTH directions (`declaredPrivileged` = its tags):
 * `privileged` without a declaration, or a declaration on an `ordinary` entry, is a mismatch. This
 * checks declarations against each other; it does not prove the SQL is what the classification says
 * (see the text scan and the future linter).
 */
export function validateClassifications(manifest: HistoryManifest, declaredPrivileged: ReadonlySet<string>): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const entry of manifest.entries) {
    if (entry.classification === null) {
      out.push(
        diagnostic('CLASSIFICATION_MISSING', `"${entry.tag}" has no explicit classification ("ordinary" or "privileged") in the history manifest.`, {
          migration: entry.tag,
        }),
      );
    } else if ((entry.classification === 'privileged') !== declaredPrivileged.has(entry.tag)) {
      out.push(
        diagnostic(
          'CLASSIFICATION_MISMATCH',
          `"${entry.tag}" is classified "${entry.classification}" in the history manifest but ${declaredPrivileged.has(entry.tag) ? 'is' : 'is not'} declared in the privileged manifest.`,
          { migration: entry.tag, details: { classification: entry.classification, declaredPrivileged: declaredPrivileged.has(entry.tag) } },
        ),
      );
    }
    if (entry.reviewedIn === null || entry.reviewedIn.trim() === '') {
      out.push(diagnostic('REVIEW_EVIDENCE_MISSING', `"${entry.tag}" has no "reviewedIn" reference in the history manifest.`, { migration: entry.tag }));
    } else if (!isValidReviewReference(entry.reviewedIn)) {
      out.push(
        diagnostic('REVIEW_EVIDENCE_INVALID', `"${entry.tag}" has a "reviewedIn" that is not commit:<sha>, pr:<n>, review:<id>:<date> or retroactive-review:<id>:<date>.`, {
          migration: entry.tag,
        }),
      );
    }
  }
  return out;
}

function fieldMismatch(tag: string, field: string, recorded: number, actual: number): Diagnostic {
  return diagnostic('MANIFEST_FIELD_MISMATCH', `"${tag}": ${field} is ${actual} in the journal but ${recorded} in the history manifest.`, {
    migration: tag,
    details: { field, manifest: recorded, journal: actual },
  });
}

/**
 * Appends the entries the manifest does not list yet, with the given decisions. Existing entries are
 * never modified: a mismatch on an already-recorded migration is an error to investigate, not
 * something to regenerate (the generator would otherwise bless a tampered file). A new migration
 * without a decision is not appended (see `planManifestAppend`, which reports it).
 */
export function appendMissingEntries(
  existing: HistoryManifest,
  entries: readonly JournalEntry[],
  fileHashes: FileHashes,
  decisions: Readonly<Record<string, EntryDecision | undefined>> = {},
): { manifest: HistoryManifest; added: readonly string[]; conflicts: readonly Diagnostic[] } {
  const conflicts = validateAgainstHistoryManifest(entries, fileHashes, existing).filter((d) => d.code !== 'MANIFEST_ENTRY_MISSING');
  if (conflicts.length > 0) {
    return { manifest: existing, added: [], conflicts };
  }
  const known = new Set(existing.entries.map((e) => e.tag));
  const toAdd = entries.filter((e) => !known.has(e.tag) && decisions[e.tag] !== undefined);
  const fresh = buildHistoryManifest(toAdd, fileHashes, decisions);
  return {
    manifest: { ...existing, entries: [...existing.entries, ...fresh.entries].sort((a, b) => a.idx - b.idx) },
    added: toAdd.map((e) => e.tag),
    conflicts: [],
  };
}
