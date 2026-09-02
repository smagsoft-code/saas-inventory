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
    expect(screen.queryByLabelText(/minimum/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'number' } });
    expect(screen.getByLabelText(/minimum/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^unit/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'select' } });
    expect(screen.queryByLabelText(/minimum/i)).not.toBeInTheDocument();
  });

  it('create: POSTs the real DTO shape and never a tenantId', async () => {
    mockedFetch.mockResolvedValueOnce({ ...NUMERIC_DEF, id: 'new' });
    render(<AttributeForm mode="create" units={UNITS} />);

    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'voltage' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Voltage' } });
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'decimal' } });
    fireEvent.change(screen.getByLabelText(/applies to/i), { target: { value: 'variant' } });
    fireEvent.change(screen.getByLabelText(/minimum/i), { target: { value: '110' } });
    fireEvent.click(screen.getByRole('button', { name: /create attribute/i }));

    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('/attributes/new'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/attribute-definitions', {
      method: 'POST',
      body: { code: 'voltage', name: 'Voltage', dataType: 'decimal', appliesTo: 'variant', minValue: 110 },
    });
    expect(JSON.stringify(mockedFetch.mock.calls.at(-1))).not.toMatch(/tenantId/i);
  });

  it('create: blocks min > max client-side', () => {
    render(<AttributeForm mode="create" units={UNITS} />);
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/^type/i), { target: { value: 'number' } });
    fireEvent.change(screen.getByLabelText(/minimum/i), { target: { value: '50' } });
    fireEvent.change(screen.getByLabelText(/maximum/i), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: /create attribute/i }));
    expect(screen.getByText(/must be less than or equal to the maximum/i)).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('edit: code / type / applies-to render disabled; PATCH sends only changed fields', async () => {
    mockedFetch.mockResolvedValueOnce(NUMERIC_DEF);
    render(<AttributeForm mode="edit" definition={NUMERIC_DEF} units={UNITS} />);

    expect(screen.getByLabelText(/^code/i)).toBeDisabled();
    expect(screen.getByLabelText(/^type/i)).toBeDisabled();
    expect(screen.getByLabelText(/applies to/i)).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Power draw' } });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(screen.getByText(/attribute saved/i)).toBeInTheDocument());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/attribute-definitions/d1', {
      method: 'PATCH',
      body: { name: 'Power draw' },
    });
  });

  it('surfaces a 403 with a permission message and does not redirect', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'Forbidden', undefined));
    render(<AttributeForm mode="create" units={UNITS} />);
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /create attribute/i }));
    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('does not fire a second request on a double submit', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(<AttributeForm mode="create" units={UNITS} />);
    fireEvent.change(screen.getByLabelText(/^code/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'X' } });
    const btn = screen.getByRole('button', { name: /create attribute/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch.mock.calls).toHaveLength(1);
    resolve({ id: 'x', code: 'x', name: 'X', dataType: 'text', appliesTo: 'product', isRequiredDefault: false, status: 'active' });
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
  });
});
