import Link from 'next/link';
import { cn } from '../../../../lib/cn';
import { mobileBadgeClass, PRODUCTS_MOBILE_THEMES } from '../../products/products-mobile-theme';
import { TransferTimeline } from './transfers-mobile-list';

/**
 * The phone layout of one transfer (`md:hidden` on the page; the cards keep `md` and up): a summary
 * card — code, estado, origen → destino, who did what and when, notes — and one card per product
 * with its four quantities. Exactly the data the desktop detail shows; the lifecycle actions
 * (`TransferActions`) stay below, unchanged. Pure presentation: the page resolves names and dates.
 */
export interface MobileTransferDetail {
  code: string;
  status: string;
  statusLabel: string;
  statusTone: 'neutral' | 'success' | 'warning' | 'danger';
  source: { name: string; warehouse: string };
  destination: { name: string; warehouse: string };
  /** Solicitada por / Aprobada por / Despachada por — only the ones that exist. */
  people: { label: string; value: string }[];
  notes?: string | undefined;
  /** Creada / Aprobada / Despachada / Recibida / Cancelada / Actualizada — only the ones that exist. */
  events: { label: string; value: string }[];
  items: {
    id: string;
    label: string;
    href?: string | undefined;
    requested: number;
    dispatched: number;
    received: number;
    inTransit: number;
  }[];
}

const T = PRODUCTS_MOBILE_THEMES.light;

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 text-right font-medium text-slate-700">{value}</dd>
    </div>
  );
}

export function TransferDetailMobile({
  detail,
}: {
  detail: MobileTransferDetail;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 md:hidden">
      <section
        className={cn(T.card, 'flex flex-col gap-3 p-4')}
        aria-label="Resumen de la transferencia"
      >
        <span className="flex items-center justify-between gap-3">
          <span className={cn(T.code, 'min-w-0 truncate text-sm')}>{detail.code}</span>
          <span className={cn(mobileBadgeClass(T, detail.statusTone), 'shrink-0')}>
            {detail.statusLabel}
          </span>
        </span>
        <div className="grid grid-cols-2 gap-2">
          <div className={cn(T.tile, 'min-w-0 bg-slate-50 p-2.5')}>
            <p className={T.tileLabel}>Origen</p>
            <p className="mt-1 truncate text-sm font-semibold text-slate-900">
              {detail.source.name}
            </p>
            <p className="truncate text-xs text-slate-500">{detail.source.warehouse}</p>
          </div>
          <div className={cn(T.tile, 'min-w-0 bg-slate-50 p-2.5')}>
            <p className={T.tileLabel}>Destino</p>
            <p className="mt-1 truncate text-sm font-semibold text-blue-700">
              {detail.destination.name}
            </p>
            <p className="truncate text-xs text-slate-500">{detail.destination.warehouse}</p>
          </div>
        </div>
        <TransferTimeline status={detail.status} />
        <dl className={cn('flex flex-col gap-1.5 border-t pt-3', T.divider)}>
          {detail.people.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
          {detail.events.map((row) => (
            <Row key={row.label} label={row.label} value={row.value} />
          ))}
        </dl>
        {detail.notes && (
          <p className={cn('whitespace-pre-wrap border-t pt-3 text-xs text-slate-600', T.divider)}>
            <span className="font-semibold text-slate-500">Notas: </span>
            {detail.notes}
          </p>
        )}
      </section>

      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        Productos ({detail.items.length})
      </h2>
      <ul className="flex flex-col gap-3" aria-label="Productos de la transferencia">
        {detail.items.map((item) => (
          <li key={item.id} className={cn(T.card, 'flex flex-col gap-2 p-4')}>
            {item.href ? (
              <Link href={item.href} className={cn(T.title, 'underline-offset-2 hover:underline')}>
                {item.label}
              </Link>
            ) : (
              <span className={T.title}>{item.label}</span>
            )}
            <dl className="flex flex-col divide-y divide-slate-100">
              {(
                [
                  ['Solicitado', item.requested],
                  ['Despachado', item.dispatched],
                  ['Recibido', item.received],
                  ['En tránsito', item.inTransit],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-3 py-1.5">
                  <dt className="text-sm font-semibold text-slate-900">{label}</dt>
                  <dd className="font-mono text-sm tabular-nums text-emerald-700">{value}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}
