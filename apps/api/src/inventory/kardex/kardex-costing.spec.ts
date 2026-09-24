import { describe, expect, it } from 'vitest';
import { computeClosingBalance, foldKardexLedger, isInboundPhysicalMovementType, isPhysicalMovementType, ZERO_BALANCE, type KardexSourceMovement } from './kardex-costing';

function movement(partial: Partial<KardexSourceMovement> & Pick<KardexSourceMovement, 'movementType' | 'quantity'>): KardexSourceMovement {
  return {
    id: partial.id ?? `mv-${Math.random()}`,
    occurredAt: partial.occurredAt ?? new Date('2026-01-01T00:00:00Z'),
    unitCost: partial.unitCost ?? null,
    ...partial,
  };
}

describe('foldKardexLedger', () => {
  it('caso 1 — stock inicial 0, entrada de 10 a $5: promedio y valor quedan en $5 / $50', () => {
    const result = foldKardexLedger(
      [movement({ movementType: 'RECEIPT', quantity: 10, unitCost: 5 })],
      ZERO_BALANCE,
      null,
    );
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.entrada).toBe(10);
    expect(row.salida).toBe(0);
    expect(row.unitCost).toBe(5);
    expect(row.unitCostEstimated).toBe(false);
    expect(row.averageCostAfter).toBe(5);
    expect(row.stockAfter).toBe(10);
    expect(row.stockValueAfter).toBe(50);
    expect(result.closing).toEqual({ stock: 10, averageCost: 5, estimated: false });
  });

  it('caso 2 — 10 a $5 ya en stock, entra 10 a $7: promedio ponderado = $6', () => {
    const result = foldKardexLedger(
      [movement({ movementType: 'RECEIPT', quantity: 10, unitCost: 7 })],
      { stock: 10, averageCost: 5, estimated: false },
      null,
    );
    const row = result.rows[0]!;
    expect(row.averageCostAfter).toBe(6);
    expect(row.stockAfter).toBe(20);
    expect(row.stockValueAfter).toBe(120);
  });

  it('caso 3 — con promedio vigente $6, una salida de 5 usa el promedio anterior y no lo modifica', () => {
    const result = foldKardexLedger(
      [movement({ movementType: 'SALE', quantity: -5 })],
      { stock: 20, averageCost: 6, estimated: false },
      null,
    );
    const row = result.rows[0]!;
    expect(row.entrada).toBe(0);
    expect(row.salida).toBe(5);
    expect(row.unitCost).toBe(6);
    expect(row.averageCostAfter).toBe(6);
    expect(row.stockAfter).toBe(15);
    expect(row.stockValueAfter).toBe(90);
  });

  it('encadena entradas y salidas mixtas en orden cronológico', () => {
    const result = foldKardexLedger(
      [
        movement({ movementType: 'RECEIPT', quantity: 10, unitCost: 5 }),
        movement({ movementType: 'RECEIPT', quantity: 10, unitCost: 7 }),
        movement({ movementType: 'SALE', quantity: -5 }),
        movement({ movementType: 'ADJUSTMENT_OUT', quantity: -3 }),
        movement({ movementType: 'RETURN', quantity: 2, unitCost: 6 }),
      ],
      ZERO_BALANCE,
      null,
    );
    expect(result.closing.stock).toBe(14); // 10+10-5-3+2
    // avg stays 6 through both outflows, then a return at exactly the prevailing average (6) keeps it at 6
    expect(result.closing.averageCost).toBe(6);
    expect(result.closing.stock * result.closing.averageCost).toBe(84);
  });

  it('usa el costo del producto como respaldo y lo marca como estimado cuando el movimiento no trae unitCost', () => {
    const result = foldKardexLedger(
      [movement({ movementType: 'ADJUSTMENT_IN', quantity: 4, unitCost: null })],
      ZERO_BALANCE,
      9,
    );
    const row = result.rows[0]!;
    expect(row.unitCost).toBe(9);
    expect(row.unitCostEstimated).toBe(true);
    expect(result.closing.estimated).toBe(true);
  });

  it('sin costo real ni de respaldo, cae a 0 y queda marcado como estimado en vez de fallar', () => {
    const result = foldKardexLedger(
      [movement({ movementType: 'RECEIPT', quantity: 4, unitCost: null })],
      ZERO_BALANCE,
      null,
    );
    const row = result.rows[0]!;
    expect(row.unitCost).toBe(0);
    expect(row.unitCostEstimated).toBe(true);
  });

  it('la marca de estimado persiste en salidas posteriores mientras el lote estimado siga mezclado', () => {
    const result = foldKardexLedger(
      [
        movement({ movementType: 'RECEIPT', quantity: 10, unitCost: null }),
        movement({ movementType: 'SALE', quantity: -2 }),
      ],
      ZERO_BALANCE,
      8,
    );
    expect(result.rows[1]!.unitCostEstimated).toBe(true);
  });

  it('ignora movimientos de reserva/compromiso — no pertenecen al kardex físico', () => {
    const result = foldKardexLedger(
      [
        movement({ movementType: 'RECEIPT', quantity: 10, unitCost: 5 }),
        movement({ movementType: 'RESERVATION', quantity: 4 }),
        movement({ movementType: 'COMMITMENT', quantity: 2 }),
      ],
      ZERO_BALANCE,
      null,
    );
    expect(result.rows).toHaveLength(1);
    expect(result.closing.stock).toBe(10);
  });

  it('computeClosingBalance calcula el estado final sin exponer filas intermedias', () => {
    const closing = computeClosingBalance(
      [
        movement({ movementType: 'RECEIPT', quantity: 10, unitCost: 5 }),
        movement({ movementType: 'RECEIPT', quantity: 10, unitCost: 7 }),
      ],
      null,
    );
    expect(closing).toEqual({ stock: 20, averageCost: 6, estimated: false });
  });
});

describe('movement type classification', () => {
  it('clasifica correctamente tipos físicos de entrada/salida y excluye reserva/compromiso', () => {
    expect(isPhysicalMovementType('RECEIPT')).toBe(true);
    expect(isPhysicalMovementType('SALE')).toBe(true);
    expect(isPhysicalMovementType('TRANSFER_OUT')).toBe(true);
    expect(isPhysicalMovementType('RESERVATION')).toBe(false);
    expect(isPhysicalMovementType('COMMITMENT_RELEASE')).toBe(false);
    expect(isInboundPhysicalMovementType('TRANSFER_IN')).toBe(true);
    expect(isInboundPhysicalMovementType('TRANSFER_OUT')).toBe(false);
  });
});
