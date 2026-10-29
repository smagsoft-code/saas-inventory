export * from './types';
export { canonicalMigrationHash, hashMigrationSql, registryHashCandidates } from './hash';
export { parseJournal, validateJournal } from './journal-validator';
export {
  CLASSIFICATIONS,
  HISTORY_MANIFEST_FILE,
  appendMissingEntries,
  buildHistoryManifest,
  parseHistoryManifest,
  isValidReviewReference,
  validateAgainstHistoryManifest,
  validateClassifications,
  type Classification,
  type EntryDecision,
  type HistoryManifest,
  type HistoryManifestEntry,
} from './history-manifest';
export { parseDecisionArgs, planManifestAppend, type ManifestUpdateInput, type ManifestUpdatePlan } from './manifest-update';
export {
  PRIVILEGED_MANIFEST_FILE,
  REQUIRED_PRIVILEGED_TAGS,
  findPrivilegedStatements,
  findUndeclaredPrivileged,
  parsePrivilegedManifest,
  privilegedTags,
  validatePrivilegedManifest,
  type PrivilegedEntry,
  type PrivilegedManifest,
} from './privileged-manifest';
export { MIGRATE_USAGE, parseMigrateArgs, type MigrateArgs } from './cli-args';
export { INVARIANT_EXPECTED_OWNER, evaluateInvariants, type InvariantEvaluation, type InvariantSnapshot, type OwnedObject, type RlsTable } from './invariants';
export { classifyHistory, parseCreatedAt, type ClassificationInput, type HistoryClassification, type HistoryState } from './history-classifier';
export {
  APP_MIGRATOR_ROLE,
  assessExecution,
  evaluateIdentity,
  expectedStartingRole,
  formatDiagnostics,
  type ExecutionAssessment,
  type ExecutionConfig,
  type ExecutionInput,
  type ExecutionMode,
  type IdentityFacts,
} from './execution-guard';
export { DEFAULT_MIGRATIONS_DIR, readMigrationsFolder, type MigrationsFolder } from './migration-files';
