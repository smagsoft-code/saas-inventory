import { diagnostic, type Diagnostic, type FileHashes, type JournalEntry } from './types';

/**
 * Structural checks of the Drizzle journal, before anything is read from the database.
 *
 * Why this exists: `drizzle-orm`'s `migrate()` trusts the journal. It reads only the registry row
 * with the highest `created_at` and applies every journal entry whose `when` is greater than it
 * (see ADR-0041), so a gap, a duplicate or a non-increasing `when` is not an error to it — a
 * migration is just silently skipped. These checks refuse such a journal instead.
 *
 * The validator never repairs or rewrites anything; it returns diagnostics and the caller aborts.
 */

const TAG_PREFIX = /^(\d{4})_/;

/** Parses the text of `_journal.json`. Malformed input yields diagnostics, never an exception. */
export function parseJournal(text: string): { entries: JournalEntry[]; diagnostics: Diagnostic[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { entries: [], diagnostics: [diagnostic('JOURNAL_MALFORMED', 'The journal is not valid JSON.')] };
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { entries?: unknown }).entries)) {
    return { entries: [], diagnostics: [diagnostic('JOURNAL_MALFORMED', 'The journal has no "entries" array.')] };
  }
  const entries: JournalEntry[] = [];
  const diagnostics: Diagnostic[] = [];
  (raw as { entries: unknown[] }).entries.forEach((item, position) => {
    const e = item as Partial<Record<keyof JournalEntry, unknown>> | null;
    if (
      typeof e !== 'object' ||
      e === null ||
      typeof e.idx !== 'number' ||
      typeof e.version !== 'string' ||
      typeof e.when !== 'number' ||
      typeof e.tag !== 'string' ||
      typeof e.breakpoints !== 'boolean'
    ) {
      diagnostics.push(
        diagnostic('JOURNAL_MALFORMED', `Journal entry at position ${position} does not have the expected fields.`, {
          details: { position },
        }),
      );
      return;
    }
    entries.push({ idx: e.idx, version: e.version, when: e.when, tag: e.tag, breakpoints: e.breakpoints });
  });
  return { entries, diagnostics };
}

export function validateJournal(entries: readonly JournalEntry[], fileHashes: FileHashes): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (entries.length === 0) {
    out.push(diagnostic('JOURNAL_EMPTY', 'The journal has no entries.'));
    return out;
  }

  const seenIdx = new Set<number>();
  const seenTags = new Set<string>();
  entries.forEach((entry, position) => {
    if (seenIdx.has(entry.idx)) {
      out.push(
        diagnostic('JOURNAL_IDX_DUPLICATE', `Journal index ${entry.idx} appears more than once.`, {
          migration: entry.tag,
          details: { idx: entry.idx },
        }),
      );
    }
    seenIdx.add(entry.idx);

    if (entry.idx !== position) {
      out.push(
        diagnostic(
          'JOURNAL_IDX_NOT_CONTIGUOUS',
          `Journal entry at position ${position} has idx ${entry.idx}; indexes must be 0..n-1 in order.`,
          { migration: entry.tag, details: { position, idx: entry.idx } },
        ),
      );
    }

    if (seenTags.has(entry.tag)) {
      out.push(diagnostic('JOURNAL_TAG_DUPLICATE', `Journal tag "${entry.tag}" appears more than once.`, { migration: entry.tag }));
    }
    seenTags.add(entry.tag);

    const prefix = TAG_PREFIX.exec(entry.tag);
    if (prefix === null || Number(prefix[1]) !== entry.idx) {
      out.push(
        diagnostic('JOURNAL_TAG_INDEX_MISMATCH', `Tag "${entry.tag}" does not start with its index ${String(entry.idx).padStart(4, '0')}_.`, {
          migration: entry.tag,
          details: { idx: entry.idx },
        }),
      );
    }

    if (!Number.isSafeInteger(entry.when) || entry.when <= 0) {
      out.push(
        diagnostic('JOURNAL_WHEN_INVALID', `Entry "${entry.tag}" has an invalid "when" (${String(entry.when)}).`, { migration: entry.tag }),
      );
    }
    const previous = position > 0 ? entries[position - 1] : undefined;
    if (previous !== undefined && !(entry.when > previous.when)) {
      out.push(
        diagnostic(
          'JOURNAL_WHEN_NOT_INCREASING',
          `Entry "${entry.tag}" has when ${entry.when}, not greater than the previous entry's ${previous.when}. Drizzle would skip it silently.`,
          { migration: entry.tag, details: { when: entry.when, previousWhen: previous.when } },
        ),
      );
    }

    if (fileHashes[entry.tag] === null || fileHashes[entry.tag] === undefined) {
      out.push(diagnostic('SQL_FILE_MISSING', `The SQL file for "${entry.tag}" does not exist.`, { migration: entry.tag }));
    }
  });
  return out;
}
