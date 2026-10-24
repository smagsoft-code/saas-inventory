import Link from 'next/link';
import { cn } from '../../../../lib/cn';
import { mobileBadgeClass, PRODUCTS_MOBILE_THEMES } from '../../products/products-mobile-theme';

/**
 * The phone layout of "Transferencias" (`md:hidden` on the page; the table keeps `md` and up): one
 * card per transfer with exactly the table's columns — Transferencia, Estado, Origen, Destino,
 * Líneas, En tránsito, Creada — and the same "Ver" link to its detail. Pure presentation: the page
 * resolves names and formats dates on the server.
 */
export interface MobileTransfer {
  id: string;
  code: string;
  statusLabel: string;
  statusTone: 'neutral' | 'success' | 'warning' | 'danger';
  sourceLabel: string;
  destinationLabel: string;
  lineCount: number;
  inTransit: number;
  createdLabel: string;
}

const T = PRODUCTS_MOBILE_THEMES.light;

export function TransfersMobileList({ transfers }: { transfers: MobileTransfer[] }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3" aria-label="Transferencias">
      {transfers.map((transfer) => (
        <li key={transfer.id} className={cn(T.card, 'flex flex-col gap-2 p-4')}>
          <span className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <span className={T.code}>{transfer.code}</span>
              <span className={T.dot} aria-hidden="true">
                •
              </span>
              <span className={T.stockLine}>{transfer.createdLabel}</span>
            </span>
            <span className={mobileBadgeClass(T, transfer.statusTone)}>{transfer.statusLabel}</span>
          </span>
          <span className={T.meta}>
            Origen: <span className="font-medium text-slate-700">{transfer.sourceLabel}</span>
          </span>
          <span className={T.meta}>
            Destino: <span className="font-medium text-slate-700">{transfer.destinationLabel}</span>
          </span>
          <dl className={cn('grid grid-cols-2 gap-2 border-t pt-2', T.divider)}>
            <div className={cn(T.tile, 'p-2.5')}>
              <dt className={T.tileLabel}>Líneas</dt>
              <dd className={cn(T.tileValueMono, 'font-semibold')}>{transfer.lineCount}</dd>
            </div>
            <div className={cn(T.tile, 'p-2.5')}>
              <dt className={T.tileLabel}>En tránsito</dt>
              <dd className={cn(T.tileValueMono, 'font-semibold')}>{transfer.inTransit}</dd>
            </div>
          </dl>
          <Link href={`/inventory/transfers/${transfer.id}`} className={T.primaryButton}>
            Ver
          </Link>
        </li>
      ))}
    </ul>
  );
}
