import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { ApprovalActions } from './approval-actions';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

describe('ApprovalActions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders nothing once the request is resolved', () => {
    const { container } = render(
      <ApprovalActions approvalId="a-1" status="approved" canResolve isOwnRequest={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a caller without pricing.discount.approve', () => {
    const { container } = render(
      <ApprovalActions approvalId="a-1" status="pending" canResolve={false} isOwnRequest={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('hides approve/reject for the requester’s own request', () => {
    render(<ApprovalActions approvalId="a-1" status="pending" canResolve isOwnRequest />);
    expect(screen.queryByRole('button', { name: /aprobar/i })).not.toBeInTheDocument();
    expect(screen.getByText(/otro usuario con el permiso de aprobación/i)).toBeInTheDocument();
  });

  it('approve confirms then POSTs /approve with no body', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(<ApprovalActions approvalId="a-1" status="pending" canResolve isOwnRequest={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^aprobar$/i }));
    expect(mockedFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirmar aprobación/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/price-approvals/a-1/approve', { method: 'POST' });
  });

  it('reject POSTs /reject', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(<ApprovalActions approvalId="a-1" status="pending" canResolve isOwnRequest={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^rechazar$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar rechazo/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/price-approvals/a-1/reject', { method: 'POST' });
  });

  it('surfaces a 403 in place and does not refresh', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError(403, 'FORBIDDEN', 'nope', undefined));
    render(<ApprovalActions approvalId="a-1" status="pending" canResolve isOwnRequest={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^aprobar$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar aprobación/i }));
    expect(await screen.findByText(/no tienes autorización para resolver/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not offer "Editar precio" without requestedPrice/maxPriceAtRequest', () => {
    render(<ApprovalActions approvalId="a-1" status="pending" canResolve isOwnRequest={false} />);
    fireEvent.click(screen.getByRole('button', { name: /^aprobar$/i }));
    expect(screen.queryByRole('button', { name: /editar precio/i })).not.toBeInTheDocument();
  });

  it('owner redesign: editing the price sends it in the approve body (editing = approving with that price)', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(
      <ApprovalActions
        approvalId="a-1"
        status="pending"
        canResolve
        isOwnRequest={false}
        requestedPrice={70}
        maxPriceAtRequest={120}
        minPriceAtRequest={80}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^aprobar$/i }));
    fireEvent.click(screen.getByRole('button', { name: /editar precio/i }));
    const input = screen.getByRole('spinbutton');
    fireEvent.change(input, { target: { value: '90' } });
    fireEvent.click(screen.getByRole('button', { name: /confirmar aprobación/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/price-approvals/a-1/approve', {
      method: 'POST',
      body: { price: 90 },
    });
  });

  it('approving without touching "Editar precio" still sends no body, even when the price could be edited', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(
      <ApprovalActions
        approvalId="a-1"
        status="pending"
        canResolve
        isOwnRequest={false}
        requestedPrice={70}
        maxPriceAtRequest={120}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^aprobar$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirmar aprobación/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/price-approvals/a-1/approve', { method: 'POST' });
  });
});
