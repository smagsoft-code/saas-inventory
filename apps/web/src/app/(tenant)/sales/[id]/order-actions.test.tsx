import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../lib/api/errors';
import { apiFetch } from '../../../../lib/api/client';
import { OrderActions, type ExceptionalLine } from './order-actions';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: refreshMock, push: vi.fn() }) }));
vi.mock('../../../../lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const ORDER = 'order-1';
const NAME = 'Jane Requester';
const EXC: ExceptionalLine[] = [{ orderItemId: 'oi-1', sku: 'SKU-1', productName: 'Widget' }];

describe('OrderActions', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it('renders nothing for a confirmed order', () => {
    const { container } = render(
      <OrderActions orderId={ORDER} status="confirmed" total={100} canConfirm canCancel canRequestApproval exceptionalLines={[]} requesterName={NAME} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('only shows actions the status AND permission allow', () => {
    render(
      <OrderActions
        orderId={ORDER}
        status="pending"
        total={100}
        canConfirm
        canCancel={false}
        canRequestApproval={false}
        exceptionalLines={[]}
        requesterName={NAME}
      />,
    );
    expect(screen.getByRole('button', { name: /confirmar pedido/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancelar pedido/i })).not.toBeInTheDocument();
  });

  it('defaults to Efectivo for the full total, and confirm sends it in the body', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(
      <OrderActions orderId={ORDER} status="pending" total={150} canConfirm canCancel canRequestApproval exceptionalLines={[]} requesterName={NAME} />,
    );
    expect(screen.getByLabelText('Efectivo')).toBeChecked();
    expect(screen.getByLabelText(/monto en efectivo/i)).toHaveValue(150);
    fireEvent.click(screen.getByRole('button', { name: /confirmar pedido/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/orders/order-1/confirm', {
      method: 'POST',
      body: { payments: [{ paymentMethod: 'cash', amount: 150 }] },
    });
    expect(JSON.stringify(mockedFetch.mock.calls)).not.toMatch(/tenantId/i);
  });

  it('blocks confirm until a split payment sums to the total', async () => {
    render(
      <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={[]} requesterName={NAME} />,
    );
    fireEvent.click(screen.getByLabelText('Tarjeta'));
    expect(screen.getByRole('button', { name: /confirmar pedido/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/monto en efectivo/i), { target: { value: '60' } });
    fireEvent.change(screen.getByLabelText(/monto en tarjeta/i), { target: { value: '40' } });
    expect(screen.getByRole('button', { name: /confirmar pedido/i })).toBeEnabled();
  });

  it('shows "Pedido Confirmado" after a successful confirm', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(
      <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={[]} requesterName={NAME} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /confirmar pedido/i }));
    expect(await screen.findByText('Pedido Confirmado')).toBeInTheDocument();
  });

  it('keeps the toast mounted for its own lifetime even once the order leaves every other reason to render', async () => {
    mockedFetch.mockResolvedValueOnce({});
    const { rerender } = render(
      <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={[]} requesterName={NAME} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /confirmar pedido/i }));
    await screen.findByText('Pedido Confirmado');
    // Simulates the parent's `router.refresh()` handing back fresh props — the order is no longer
    // `pending`, so every OTHER reason to render (`showConfirm`/`showCancel`/...) is now false.
    rerender(
      <OrderActions orderId={ORDER} status="confirmed" total={100} canConfirm canCancel canRequestApproval exceptionalLines={[]} requesterName={NAME} />,
    );
    expect(screen.getByText('Pedido Confirmado')).toBeInTheDocument();
  });

  it('does not double-submit confirm', async () => {
    let resolve: (v: unknown) => void = () => {};
    mockedFetch.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    render(
      <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={[]} requesterName={NAME} />,
    );
    const btn = screen.getByRole('button', { name: /confirmar pedido/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    resolve({});
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it('surfaces the backend 409 (approval still pending) in place', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ApiError(409, 'CONFLICT', 'This order has an exceptional-discount request still awaiting approval', undefined),
    );
    render(
      <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={[]} requesterName={NAME} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /confirmar pedido/i }));
    expect(await screen.findByText(/awaiting approval/i)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('cancel asks for confirmation before calling the endpoint (no body)', async () => {
    mockedFetch.mockResolvedValueOnce({});
    render(
      <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={[]} requesterName={NAME} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancelar pedido/i }));
    expect(mockedFetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /confirmar cancelación/i }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/orders/order-1/cancel', { method: 'POST' });
  });

  describe('an exceptional line needing approval', () => {
    it('shows the shorter "Uno o más productos necesitan Aprobación" message, hides Confirmar/Cancelar and the payment method', () => {
      render(
        <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={EXC} requesterName={NAME} />,
      );
      expect(screen.getByText('Uno o más productos necesitan Aprobación')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /confirmar pedido/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /cancelar pedido/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Efectivo')).not.toBeInTheDocument();
    });

    it('"Solicitar aprobación" files the request with the caller\'s own name in the fixed reason — no form — and flips to "Solicitud enviada"', async () => {
      mockedFetch.mockResolvedValueOnce({});
      render(
        <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={EXC} requesterName={NAME} />,
      );
      expect(screen.queryByLabelText(/motivo/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: /solicitar aprobación/i }));
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/price-approvals', {
        method: 'POST',
        body: { orderItemId: 'oi-1', reason: `Descuento solicitado por ${NAME}.` },
      });
      expect(screen.getByText('Solicitud enviada')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /solicitar aprobación/i })).not.toBeInTheDocument();
    });

    it('falls back to a generic "el vendedor" when no requesterName is known', async () => {
      mockedFetch.mockResolvedValueOnce({});
      render(
        <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={EXC} requesterName="" />,
      );
      fireEvent.click(screen.getByRole('button', { name: /solicitar aprobación/i }));
      await waitFor(() =>
        expect(mockedFetch).toHaveBeenCalledWith('/api/v1/price-approvals', {
          method: 'POST',
          body: { orderItemId: 'oi-1', reason: 'Descuento solicitado por el vendedor.' },
        }),
      );
    });

    it('a `pending` line shows a waiting notice instead of a button', () => {
      render(
        <OrderActions
          orderId={ORDER}
          status="pending"
          total={100}
          canConfirm
          canCancel
          canRequestApproval
          exceptionalLines={[{ ...EXC[0]!, latestStatus: 'pending' }]}
          requesterName={NAME}
        />,
      );
      expect(screen.queryByRole('button', { name: /solicitar aprobación/i })).not.toBeInTheDocument();
      expect(screen.getByText(/esperando que un supervisor/i)).toBeInTheDocument();
    });

    it('a `rejected` line can file a new request again', () => {
      render(
        <OrderActions
          orderId={ORDER}
          status="pending"
          total={100}
          canConfirm
          canCancel
          canRequestApproval
          exceptionalLines={[{ ...EXC[0]!, latestStatus: 'rejected' }]}
          requesterName={NAME}
        />,
      );
      expect(screen.getByRole('button', { name: /solicitar aprobación/i })).toBeInTheDocument();
      expect(screen.getByText(/rechazada/i)).toBeInTheDocument();
    });

    it('only a `rejected` line offers "Editar precio"', () => {
      render(
        <OrderActions orderId={ORDER} status="pending" total={100} canConfirm canCancel canRequestApproval exceptionalLines={EXC} requesterName={NAME} />,
      );
      expect(screen.queryByRole('button', { name: /editar precio/i })).not.toBeInTheDocument();
    });

    it('owner redesign: "Editar precio" on a rejected line resubmits with newPrice', async () => {
      mockedFetch.mockResolvedValueOnce({});
      render(
        <OrderActions
          orderId={ORDER}
          status="pending"
          total={100}
          canConfirm
          canCancel
          canRequestApproval
          exceptionalLines={[{ ...EXC[0]!, latestStatus: 'rejected', unitPrice: 70, maxPrice: 120 }]}
          requesterName={NAME}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /editar precio/i }));
      const input = screen.getByLabelText(/nuevo precio para sku-1/i);
      expect(input).toHaveValue(70);
      fireEvent.change(input, { target: { value: '85' } });
      fireEvent.click(screen.getByRole('button', { name: /enviar con nuevo precio/i }));
      await waitFor(() => expect(refreshMock).toHaveBeenCalled());
      expect(mockedFetch).toHaveBeenCalledWith('/api/v1/price-approvals', {
        method: 'POST',
        body: { orderItemId: 'oi-1', reason: `Descuento solicitado por ${NAME}.`, newPrice: 85 },
      });
      expect(screen.getByText('Solicitud enviada')).toBeInTheDocument();
    });

    it('once every exceptional line is `approved`, Confirmar/Cancelar and the payment method reappear', () => {
      render(
        <OrderActions
          orderId={ORDER}
          status="pending"
          total={100}
          canConfirm
          canCancel
          canRequestApproval
          exceptionalLines={[{ ...EXC[0]!, latestStatus: 'approved' }]}
          requesterName={NAME}
        />,
      );
      expect(screen.getByRole('button', { name: /confirmar pedido/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancelar pedido/i })).toBeInTheDocument();
      expect(screen.getByLabelText('Efectivo')).toBeInTheDocument();
    });

    it('without canRequestApproval, shows a permission notice instead of the request form', () => {
      render(
        <OrderActions
          orderId={ORDER}
          status="pending"
          total={100}
          canConfirm
          canCancel
          canRequestApproval={false}
          exceptionalLines={EXC}
          requesterName={NAME}
        />,
      );
      expect(screen.getByText(/no tienes permiso para solicitar/i)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /solicitar aprobación/i })).not.toBeInTheDocument();
    });
  });
});
