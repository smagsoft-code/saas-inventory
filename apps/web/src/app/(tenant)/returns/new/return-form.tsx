'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../../lib/api/errors';
import type { Order, Return } from '../../../../lib/types/sales';
import { Alert } from '../../../../components/ui/alert';
import { Button } from '../../../../components/ui/button';
import { Card, CardBody } from '../../../../components/ui/card';
import { Field } from '../../../../components/ui/field';
import { Input, Select, Textarea } from '../../../../components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '../../../../components/ui/table';

export interface OrderOption {
  id: string;
  orderNumber: string;
  customerName: string;
}
export interface LocationOption {
  id: string;
  name: string;
}

interface LineState {
  orderItemId: string;
  sku: string;
  productName: string;
  sold: number;
  returnable: number;
  include: boolean;
  quantity: string;
}

/** A distinct idempotency key per logical "file this return" attempt — reused across retries of the
 * same attempt, regenerated for a fresh one (matches `newIdempotencyKey` in New Sale / transfers). */
function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `web-return-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * `POST /api/v1/sales-returns { orderId, locationId, reason, items:[{ orderItemId, quantity }] }`
 * with a required `Idempotency-Key` header. The `returnable` column is a **hint** computed from the
 * order's lines minus its non-cancelled returns (`GET /orders/:id` + `GET /sales-returns?orderId=`);
 * the backend re-validates every quantity under a row lock and is the authority (`409` on
 * over-return). No money, no inventory math here.
 */
export function ReturnForm({
  orders,
  locations,
  preselectOrderId,
}: {
  orders: OrderOption[];
  locations: LocationOption[];
  preselectOrderId?: string;
}): React.JSX.Element {
  const router = useRouter();
  const initialOrder = preselectOrderId && orders.some((o) => o.id === preselectOrderId) ? preselectOrderId : '';

  const [orderId, setOrderId] = useState(initialOrder);
  const [locationId, setLocationId] = useState(locations[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<LineState[]>([]);
  const [linesLoading, setLinesLoading] = useState(false);
  const [linesError, setLinesError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // Load the preselected order's lines once on mount (arriving from an order detail's "Start a return").
  const didPreload = useRef(false);
  useEffect(() => {
    if (initialOrder && !didPreload.current) {
      didPreload.current = true;
      void loadLines(initialOrder);
    }
  }, [initialOrder]);

  async function loadLines(nextOrderId: string): Promise<void> {
    setOrderId(nextOrderId);
    setLines([]);
    setLinesError(null);
    if (!nextOrderId) {
      return;
    }
    setLinesLoading(true);
    try {
      const [order, returns] = await Promise.all([
        apiFetch<Order>(`/api/v1/orders/${nextOrderId}`),
        apiFetch<{ data: Return[] }>('/api/v1/sales-returns', { query: { orderId: nextOrderId, pageSize: 100 } }),
      ]);
      const returnedByItem = new Map<string, number>();
      for (const ret of returns.data) {
        if (ret.status === 'cancelled') {
          continue;
        }
        for (const item of ret.items) {
          returnedByItem.set(item.orderItemId, (returnedByItem.get(item.orderItemId) ?? 0) + item.quantityReturned);
        }
      }
      setLines(
        order.items.map((item) => {
          const returnable = Math.max(0, item.quantity - (returnedByItem.get(item.id) ?? 0));
          return {
            orderItemId: item.id,
            sku: item.sku,
            productName: item.productName,
            sold: item.quantity,
            returnable,
            include: false,
            quantity: returnable > 0 ? String(returnable) : '',
          };
        }),
      );
    } catch (err) {
      setLinesError(httpErrorMessage(err));
    } finally {
      setLinesLoading(false);
    }
  }

  function updateLine(orderItemId: string, patch: Partial<LineState>): void {
    setLines((cur) => cur.map((line) => (line.orderItemId === orderItemId ? { ...line, ...patch } : line)));
  }

  const selectedLines = lines.filter((line) => line.include);
  const canSubmit =
    orderId !== '' &&
    locationId !== '' &&
    reason.trim().length >= 3 &&
    selectedLines.length > 0 &&
    selectedLines.every((line) => {
      const qty = Number(line.quantity);
      return Number.isFinite(qty) && qty > 0 && qty <= line.returnable;
    }) &&
    !busy;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!canSubmit) {
      return;
    }
    const key = idempotencyKey || newIdempotencyKey();
    if (!idempotencyKey) {
      setIdempotencyKey(key);
    }
    setBusy(true);
    setError(null);
    try {
      const created = await apiFetch<Return>('/api/v1/sales-returns', {
        method: 'POST',
        body: {
          orderId,
          locationId,
          reason: reason.trim(),
          items: selectedLines.map((line) => ({ orderItemId: line.orderItemId, quantity: Number(line.quantity) })),
        },
        headers: { 'Idempotency-Key': key },
      });
      router.push(`/returns/${created.id}`);
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('You are not authorized to file a return for this order.');
      } else {
        setError(httpErrorMessage(err));
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <CardBody className="flex flex-col gap-4">
          <Field label="Order" required hint="Only confirmed orders can be returned.">
            <Select value={orderId} disabled={busy} onChange={(e) => void loadLines(e.target.value)}>
              <option value="">Choose an order…</option>
              {orders.map((order) => (
                <option key={order.id} value={order.id}>
                  {order.orderNumber} — {order.customerName}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Receiving location" required hint="Where the returned goods are physically received.">
            <Select value={locationId} disabled={busy} onChange={(e) => setLocationId(e.target.value)}>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Reason" required hint="3–500 characters.">
            <Textarea maxLength={500} value={reason} disabled={busy} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Lines to return</h2>
          {linesError && <Alert tone="error">{linesError}</Alert>}
          {!orderId ? (
            <p className="text-sm text-slate-500">Choose an order to see its lines.</p>
          ) : linesLoading ? (
            <p className="text-sm text-slate-500">Loading lines…</p>
          ) : lines.length === 0 ? (
            <p className="text-sm text-slate-500">This order has no returnable lines.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-0">
                    <span className="sr-only">Include</span>
                  </TH>
                  <TH>Item</TH>
                  <TH className="text-right">Sold</TH>
                  <TH className="text-right">Returnable</TH>
                  <TH className="text-right">Return qty</TH>
                </TR>
              </THead>
              <TBody>
                {lines.map((line) => (
                  <TR key={line.orderItemId}>
                    <TD>
                      <input
                        type="checkbox"
                        aria-label={`Include ${line.sku}`}
                        checked={line.include}
                        disabled={busy || line.returnable <= 0}
                        onChange={(e) => updateLine(line.orderItemId, { include: e.target.checked })}
                        className="h-4 w-4"
                      />
                    </TD>
                    <TD>
                      <span className="font-medium">{line.sku}</span>
                      <span className="text-slate-500"> · {line.productName}</span>
                      {line.returnable <= 0 && (
                        <span className="ml-2 text-xs text-slate-500">fully returned</span>
                      )}
                    </TD>
                    <TD className="text-right text-slate-500">{line.sold}</TD>
                    <TD className="text-right text-slate-500">{line.returnable}</TD>
                    <TD className="text-right">
                      <label className="sr-only" htmlFor={`qty-${line.orderItemId}`}>
                        Return quantity for {line.sku}
                      </label>
                      <Input
                        id={`qty-${line.orderItemId}`}
                        type="number"
                        min={0}
                        max={line.returnable}
                        step="any"
                        value={line.quantity}
                        disabled={busy || !line.include || line.returnable <= 0}
                        onChange={(e) => updateLine(line.orderItemId, { quantity: e.target.value })}
                        className="w-24 text-right"
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <div className="flex gap-2">
        <Button type="submit" loading={busy} disabled={!canSubmit}>
          File return
        </Button>
      </div>
    </form>
  );
}
