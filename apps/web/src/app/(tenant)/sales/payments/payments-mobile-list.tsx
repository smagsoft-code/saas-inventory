import Link from 'next/link';

/** One payment, already formatted server-side (names, dates, labels) — this component only lays it out. */
export interface MobilePayment {
  id: string;
  orderId: string;
  orderNumber: string;
  paidAtLabel: string;
  customerName: string;
  paymentMethodLabel: string;
  amountLabel: string;
  sellerName: string;
  locationLabel: string;
  documentLabel: string;
  /** Set when the order has a return — the amount is then shown on red with this note. */
  returnNote: string | null;
}

/**
 * Phone layout of the payment report (shown below `md`; the table keeps `md` and up): one card per
 * payment. The column filters live in the table header, which only exists from `md` up — on a phone
 * the date range and the export links at the top of the page are the available controls.
 */
export function PaymentsMobileList({ payments, empty }: { payments: MobilePayment[]; empty: string }): React.JSX.Element {
  if (payments.length === 0) {
    return <p className="rounded-lg border border-slate-200 bg-white p-6 text-center text-sm text-slate-500">{empty}</p>;
  }
  return (
    <ul className="flex flex-col gap-2">
      {payments.map((p) => (
        <li key={p.id} className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/sales/${p.orderId}`} className="text-sm font-medium text-slate-900 underline-offset-2 hover:underline">
                {p.orderNumber}
              </Link>
              <p className="truncate text-sm text-slate-700">{p.customerName}</p>
              <p className="text-xs text-slate-500">{p.paidAtLabel}</p>
            </div>
            <div className="shrink-0 text-right">
              <p
                title={p.returnNote ?? undefined}
                className={`rounded px-1.5 py-0.5 text-sm font-semibold tabular-nums ${p.returnNote ? 'bg-red-600 text-white' : 'text-slate-900'}`}
              >
                {p.amountLabel}
              </p>
              <p className="mt-1 text-xs text-slate-500">{p.paymentMethodLabel}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {p.sellerName} · {p.locationLabel} · {p.documentLabel}
          </p>
          {p.returnNote && <p className="mt-1 text-xs font-medium text-red-700">{p.returnNote}</p>}
        </li>
      ))}
    </ul>
  );
}
