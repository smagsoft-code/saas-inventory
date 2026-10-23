import { describe, expect, it } from 'vitest';
import {
  STANDARD_TEMPLATE_MAPPING,
  columnMappingProblem,
  importHasErrorReport,
  importJobStatusTone,
  importPipelineActions,
  isImportJobProcessing,
  isImportJobTerminal,
} from './imports';

describe('columnMappingProblem (mirror of assertValidColumnMapping)', () => {
  it('rejects an empty map', () => {
    expect(columnMappingProblem({})).toMatch(/al menos una/i);
  });

  it('requires a column mapped to sku', () => {
    expect(columnMappingProblem({ Nombre: 'name' })).toMatch(/código/i);
  });

  it('rejects an unknown target field', () => {
    expect(columnMappingProblem({ A: 'sku', B: 'totallyMadeUp' })).toMatch(/destino desconocido/i);
  });

  it('rejects the same non-attr target used twice', () => {
    expect(columnMappingProblem({ A: 'sku', B: 'name', C: 'name' })).toMatch(/más de una vez/i);
  });

  it('accepts standard fields and attr:<code> targets, and multiple attr targets', () => {
    expect(
      columnMappingProblem({ CODIGO: 'sku', DESC: 'name', CC: 'attr:cilindraje', COLOR: 'attr:color' }),
    ).toBeNull();
  });

  it('accepts the built-in standard template layout (backend template-generator output)', () => {
    expect(columnMappingProblem(STANDARD_TEMPLATE_MAPPING)).toBeNull();
    expect(Object.values(STANDARD_TEMPLATE_MAPPING)).toContain('sku');
  });
});

describe('importPipelineActions (mirror of import-job-state-machine)', () => {
  it('mapping → validate only', () => {
    expect(importPipelineActions({ status: 'mapping', totalRows: undefined })).toEqual({
      setMapping: true,
      validate: true,
      confirm: false,
      cancel: true,
    });
  });

  it('ready → confirm + cancel, not validate', () => {
    const a = importPipelineActions({ status: 'ready', totalRows: 10 });
    expect(a.confirm).toBe(true);
    expect(a.validate).toBe(false);
    expect(a.cancel).toBe(true);
  });

  it('uploaded → setMapping + cancel only', () => {
    const a = importPipelineActions({ status: 'uploaded', totalRows: undefined });
    expect(a).toEqual({ setMapping: true, validate: false, confirm: false, cancel: true });
  });

  it('failed with no totalRows retries via validate; failed with totalRows retries via confirm', () => {
    expect(importPipelineActions({ status: 'failed', totalRows: undefined }).validate).toBe(true);
    expect(importPipelineActions({ status: 'failed', totalRows: undefined }).confirm).toBe(false);
    expect(importPipelineActions({ status: 'failed', totalRows: 5 }).confirm).toBe(true);
    expect(importPipelineActions({ status: 'failed', totalRows: 5 }).validate).toBe(false);
  });

  it('terminal states expose no actions', () => {
    for (const status of ['completed', 'completed_with_errors', 'cancelled']) {
      expect(importPipelineActions({ status, totalRows: 1 })).toEqual({
        setMapping: false,
        validate: false,
        confirm: false,
        cancel: false,
      });
    }
  });
});

describe('status helpers', () => {
  it('isImportJobProcessing is true only for validating/importing', () => {
    expect(isImportJobProcessing('validating')).toBe(true);
    expect(isImportJobProcessing('importing')).toBe(true);
    expect(isImportJobProcessing('ready')).toBe(false);
    expect(isImportJobProcessing('completed')).toBe(false);
  });

  it('isImportJobTerminal covers the three terminal statuses', () => {
    expect(isImportJobTerminal('completed')).toBe(true);
    expect(isImportJobTerminal('completed_with_errors')).toBe(true);
    expect(isImportJobTerminal('cancelled')).toBe(true);
    expect(isImportJobTerminal('failed')).toBe(false);
  });

  it('an unknown status maps to a neutral tone, never danger', () => {
    expect(importJobStatusTone('some_future_status')).toBe('neutral');
  });

  it('importHasErrorReport keys off real counters / end states', () => {
    expect(importHasErrorReport({ status: 'ready', invalidRows: 0, warningRows: 0 })).toBe(false);
    expect(importHasErrorReport({ status: 'ready', invalidRows: 2, warningRows: 0 })).toBe(true);
    expect(importHasErrorReport({ status: 'completed_with_errors', invalidRows: 0, warningRows: 0 })).toBe(true);
  });
});
