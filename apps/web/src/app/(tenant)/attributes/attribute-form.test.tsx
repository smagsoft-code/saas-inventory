import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../lib/api/errors';
import { apiFetch } from '../../../lib/api/client';
import { AttributeForm } from './attribute-form';

const replaceMock = vi.fn();
const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: replaceMock, refresh: refreshMock, push: vi.fn() }) }));
vi.mock('../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const UNITS = [{ id: 'u1', code: 'W', label: 'Watt', dimension: 'power' }];
const NUMERIC_DEF = {
  id: 'd1', code: 'power', name: 'Power',
  dataType: 'number', appliesTo: 'product', unitId: 'u1',
  isRequiredDefault: false, minValue: 0, maxValue: 100, status: 'active',
};

describe('AttributeForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => cleanup());

  it('create: shows unit / min / max only for number & decimal types', () => {
    render(<AttributeForm mode="create" units={UNITS} />);
    expect(screen.queryByLabelText(/mínimo/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^tipo/i), { target: { value: 'number' } });
    expect(screen.getByLabelText(/mínimo/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^unidad/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^tipo/i), { target: { value: 'select' } });
    expect(screen.queryByLabelText(/mínimo/i)).not.toBeInTheDocument();
  });

  it('create: POSTs the real DTO shape and never a tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({ ...NUMERIC_DEF, id: 'new' });
    render(<AttributeForm mode="create" units={UNITS} />);

    fireEvent.change(screen.getByLabelText(/^código/i), { target: { value: 'voltage' } });
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Voltage' } });
    fireEvent.change(screen.getByLabelText(/^tipo/i), { target: { value: 'decimal' } });
    fireEvent.change(screen.getByLabelText(/aplica a/i), { target: { value: 'variant' } });
    fireEvent.change(screen.getByLabelText(/mínimo/i), { target: { value: '110' } });
    fireEvent.click(screen.getByRole('button', { name: /crear atributo/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/attributes/new'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/attribute-definitions', {
      method: 'POST',
      body: { code: 'voltage', name: 'Voltage', dataType: 'decimal', appliesTo: 'variant', minValue: 110 },
    });
    expect(JSON.stringify(mockedFetch.mock.calls.at(-1))).not.toMatch(/tenantId/i);
  });

  it('create: blocks min > max client-side', () => {
    render(<AttributeForm mode="create" units={UNITS} />);
    fireEvent.change(screen.getByLabelText(/^código/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/^tipo/i), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText(/mínimo/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/máximo/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /crear atributo/i }));
    expect(screen.getByText(/menor o igual que el máximo/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('edit: code / type / applies-to render disabled; PATCH sends only changed fields', async () => {
    mockedFetch.mockResolvedValueOnce(NUMERIC_DEF);
    render(<AttributeForm mode="edit" definition={NUMERIC_DEF} units={UNITS} />);

    expect(screen.getByLabelText(/^código/i)).toBeDisabled();
    expect(screen.getByLabelText(/^tipo/i)).toBeDisabled();
    expect(screen.getByLabelText(/aplica a/i)).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'Power draw' } });
    fireEvent.click(screen.getByRole('button', { name: /guardar cambios/i }));

    await waitFor(() => expect(screen.getByText(/atributo guardado/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/attribute-definitions/d1', {
      method: 'PATCH',
      body: { name: 'Power draw' },
    });
  });

  it('surfaces a 403 with a permission message and does not redirect', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Forbidden', undefined));
    render(<AttributeForm mode="create" units={UNITS} />);
    fireEvent.change(screen.getByLabelText(/^código/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /crear atributo/i }));
    expect(await screen.findByText(/permiso/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<AttributeForm mode="create" units={UNITS} />);
    fireEvent.change(screen.getByLabelText(/^código/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^nombre/i), { target: { value: 'X' } });
    const btn = screen.getByRole('button', { name: /crear atributo/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls).toHaveLength(1);
    resolve({ id: 'x', code: 'x', name: 'X', dataType: 'text', appliesTo: 'product', isRequiredDefault: false, status: 'active' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });
});
