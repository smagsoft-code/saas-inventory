import { diagnostic, type Diagnostic } from './types';

/**
 * Owner and RLS invariants of the database a migration batch leaves behind (ADR-0041, D-8B).
 *
 * Pure: it compares two snapshots (taken by `migration-runner/invariants.ts`) and returns diagnostics.
 *
 * What is audited — and ONLY this; nothing is silently extended to other objects:
 *  - Objects in schema `public`: tables, partitioned tables, sequences, views, materialized views, foreign tables,
 *    functions, enum / domain / standalone composite types, and the schema itself. Each must be owned by
 *    `app_migrator`. Not audited: objects that belong to an extension, array / table-row types, and things that have
 *    no owner of their own (indexes, constraints, triggers, policies, columns) — they follow their table.
 *  - Tables in schema `public`: if RLS is enabled, `FORCE ROW LEVEL SECURITY` must be on (the project contract: the
 *    owner `app_migrator` must be subject to the policies), and RLS enabled at the start must still be enabled.
 *  - Objects of schema `drizzle` must NOT be owned by `app_migrator` (the history stays under the bootstrap owner).
 *
 * Baseline rule: a violation that already existed before the batch is NOT blocking — it is reported as pre-existing
 * (for a database with mixed owners, see MIG-OWNERSHIP-AUDIT) — so that a legacy database is not locked out of every
 * future migration. A violation that the batch creates or introduces IS blocking. A table that was already unforced
 * and stays unforced is therefore pre-existing, not new.
 */

export const INVARIANT_EXPECTED_OWNER = 'app_migrator';

export type ObjectKind =
  | 'table'
  | 'partitioned table'
  | 'sequence'
  | 'view'
  | 'materialized view'
  | 'foreign table'
  | 'function'
  | 'type'
  | 'schema';

export interface OwnedObject {
  readonly kind: ObjectKind;
  /** The catalogue oid as text (stable for the life of the object). */
  readonly id: string;
  readonly name: string;
  readonly owner: string;
}

export interface RlsTable {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly forced: boolean;
}

export interface InvariantSnapshot {
  readonly publicObjects: readonly OwnedObject[];
  readonly drizzleObjects: readonly OwnedObject[];
  readonly tables: readonly RlsTable[];
}

export interface InvariantEvaluation {
  /** Violations introduced by the batch. */
  readonly blocking: readonly Diagnostic[];
  /** Violations already present before it (not blocking). */
  readonly preExisting: { readonly owner: number; readonly notForced: number };
}

const key = (o: { kind?: string; id: string }) => `${o.kind ?? 'table'}:${o.id}`;
const MAX_LISTED = 10;

function listed(names: readonly string[]): string {
  const shown = names.slice(0, MAX_LISTED).join(', ');
  return names.length > MAX_LISTED ? `${shown} and ${names.length - MAX_LISTED} more` : shown;
}

export function evaluateInvariants(
  before: InvariantSnapshot,
  after: InvariantSnapshot,
  expectedOwner: string = INVARIANT_EXPECTED_OWNER,
): InvariantEvaluation {
  const blocking: Diagnostic[] = [];

  // 1. owners in public
  const wrongBefore = new Set(before.publicObjects.filter((o) => o.owner !== expectedOwner).map(key));
  const wrongAfter = after.publicObjects.filter((o) => o.owner !== expectedOwner);
  const newWrong = wrongAfter.filter((o) => !wrongBefore.has(key(o)));
  if (newWrong.length > 0) {
    blocking.push(
      diagnostic(
        'INVARIANT_OWNER_MISMATCH',
        `${newWrong.length} object(s) in schema "public" are not owned by "${expectedOwner}" after the batch: ${listed(newWrong.map((o) => `${o.kind} ${o.name} (owner ${o.owner})`))}.`,
        { details: { count: newWrong.length, expectedOwner } },
      ),
    );
  }

  // 2. the history stays under the bootstrap owner
  const drizzleBefore = new Set(before.drizzleObjects.filter((o) => o.owner === expectedOwner).map(key));
  const newDrizzle = after.drizzleObjects.filter((o) => o.owner === expectedOwner && !drizzleBefore.has(key(o)));
  if (newDrizzle.length > 0) {
    blocking.push(
      diagnostic(
        'INVARIANT_DRIZZLE_OWNER',
        `${newDrizzle.length} object(s) of schema "drizzle" are owned by "${expectedOwner}", which must not own the migration history: ${listed(newDrizzle.map((o) => `${o.kind} ${o.name}`))}.`,
        { details: { count: newDrizzle.length } },
      ),
    );
  }

  // 3. RLS enabled without FORCE
  const unforcedBefore = new Set(before.tables.filter((t) => t.enabled && !t.forced).map((t) => t.id));
  const unforcedAfter = after.tables.filter((t) => t.enabled && !t.forced);
  const newUnforced = unforcedAfter.filter((t) => !unforcedBefore.has(t.id));
  if (newUnforced.length > 0) {
    blocking.push(
      diagnostic(
        'INVARIANT_RLS_NOT_FORCED',
        `${newUnforced.length} table(s) have row-level security enabled but not FORCEd after the batch: ${listed(newUnforced.map((t) => t.name))}.`,
        { details: { count: newUnforced.length } },
      ),
    );
  }

  // 4. RLS enabled before and no longer enabled
  const enabledBefore = new Map(before.tables.filter((t) => t.enabled).map((t) => [t.id, t]));
  const disabled = after.tables.filter((t) => !t.enabled && enabledBefore.has(t.id));
  if (disabled.length > 0) {
    blocking.push(
      diagnostic(
        'INVARIANT_RLS_DISABLED',
        `${disabled.length} table(s) had row-level security enabled before the batch and have it disabled after: ${listed(disabled.map((t) => t.name))}.`,
        { details: { count: disabled.length } },
      ),
    );
  }

  return { blocking, preExisting: { owner: wrongBefore.size, notForced: unforcedBefore.size } };
}
