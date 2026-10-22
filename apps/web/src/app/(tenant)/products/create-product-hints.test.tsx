import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAttributeFields } from '../../../lib/catalog/product-attributes';
import type { AttributeDefinition, CategoryAttribute, MeasurementUnit } from '../../../lib/types/catalog';
import { ProductForm } from './product-form';
import { TrackingOptions } from './tracking-options';
import { fieldLabel } from './attribute-fields';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));

afterEach(() => cleanup());

describe('TrackingOptions', () => {
  function setup(isSerialized: boolean, isLotTracked: boolean) {
    const onSerializedChange = vi.fn();
    const onLotTrackedChange = vi.fn();
    render(
      <TrackingOptions
        isSerialized={isSerialized}
        isLotTracked={isLotTracked}
        onSerializedChange={onSerializedChange}
        onLotTrackedChange={onLotTrackedChange}
      />,
    );
    return { onSerializedChange, onLotTrackedChange };
  }

  it('explains what each option does', () => {
    setup(false, false);
    // The explanations live behind "?" icons — hidden until asked for, then shown on click.
    expect(screen.queryByText(/número de serie/)).not.toBeInTheDocument();
    const [serializedHelp, lotHelp] = screen.getAllByRole('button', { name: 'Ayuda' });
    fireEvent.click(serializedHelp!);
    expect(screen.getByText(/número de serie/)).toBeInTheDocument();
    fireEvent.click(lotHelp!);
    expect(screen.getByText(/se controlan por lote/)).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('warns that a serialized or lot-tracked variant cannot be sold yet', () => {
    setup(true, false);
    expect(screen.getByRole('note')).toHaveTextContent(/no se puede vender/);
    cleanup();
    setup(false, true);
    expect(screen.getByRole('note')).toHaveTextContent(/no se puede vender/);
  });

  it('reports changes', () => {
    const { onSerializedChange, onLotTrackedChange } = setup(false, false);
    fireEvent.click(screen.getByLabelText('Serializado'));
    fireEvent.click(screen.getByLabelText('Con seguimiento de lote'));
    expect(onSerializedChange).toHaveBeenCalledWith(true);
    expect(onLotTrackedChange).toHaveBeenCalledWith(true);
  });
});

describe('Precio base / mínimo legends', () => {
  it('puts the "needs approval" legend on the base price, not on the minimum', () => {
    render(<ProductForm mode="create" categories={[]} definitions={[]} initialFieldSets={{ product: [], variant: [], options: {} }} />);
    const base = screen.getByLabelText(/precio base/i);
    const min = screen.getByLabelText(/precio mínimo/i);
    const helpOf = (input: HTMLElement) => within(input.closest('div')!).getByRole('button', { name: 'Ayuda' });
    fireEvent.click(helpOf(base));
    expect(base.closest('div')).toHaveTextContent('Por debajo de este precio se necesita aprobación.');
    expect(min.closest('div')).not.toHaveTextContent(/necesita aprobación/);
    fireEvent.click(helpOf(min));
    expect(min.closest('div')).toHaveTextContent('Piso de referencia del precio.');
  });
});

describe('attribute unit of measure', () => {
  const definitions: AttributeDefinition[] = [
    { id: 'd1', code: 'ATR002', name: 'Medidas', dataType: 'number', appliesTo: 'product', unitId: 'u1', isRequiredDefault: false, status: 'active' },
    { id: 'd2', code: 'ATR003', name: 'Capacidad', dataType: 'number', appliesTo: 'product', isRequiredDefault: false, status: 'active' },
  ];
  const assignments: CategoryAttribute[] = [
    { attributeDefinitionId: 'd1', code: 'ATR002', name: 'Medidas', dataType: 'number', isRequired: false, displayOrder: 0 },
    { attributeDefinitionId: 'd2', code: 'ATR003', name: 'Capacidad', dataType: 'number', isRequired: false, displayOrder: 1 },
  ];
  const units: MeasurementUnit[] = [{ id: 'u1', code: 'cm', label: 'Centímetros', dimension: 'length' }];

  it('resolves the unit code onto the field and shows it next to the label', () => {
    const fields = resolveAttributeFields(assignments, definitions, 'product', units);
    expect(fields[0]?.unit).toBe('cm');
    expect(fieldLabel(fields[0]!)).toBe('Medidas (cm)');
    expect(fields[1]?.unit).toBeUndefined();
    expect(fieldLabel(fields[1]!)).toBe('Capacidad');
  });

  it('works without a units list (unit simply not shown)', () => {
    const fields = resolveAttributeFields(assignments, definitions, 'product');
    expect(fieldLabel(fields[0]!)).toBe('Medidas');
  });
});
