import Link from 'next/link';
import { cn } from '../../../../lib/cn';
import { mobileBadgeClass, PRODUCTS_MOBILE_THEMES } from '../../products/products-mobile-theme';

/**
 * The phone layout of "Transferencias" (`md:hidden` on the page; the table keeps `md` and up): one
 * card per transfer with exactly the table's data — code, estado, origen → destino, productos
 * (lines), en tránsito, creada — a four-step timeline derived from the estado, and the same "Ver"
 * link to its detail. Pure presentation: the page resolves names and formats dates on the server.
 */
export interface MobileTransfer {
  id: string;
  code: string;
  /** The raw transfer status — drives the timeline. */
  status: string;
  statusLabel: string;
  statusTone: 'neutral' | 'success' | 'warning' | 'danger';
  sourceLabel: string;
  destinationLabel: string;
  lineCount: number;
  inTransit: number;
  createdLabel: string;
}

const T = PRODUCTS_MOBILE_THEMES.light;

const TIMELINE = ['Creado', 'Aprobado', 'Despachado', 'Recibido'] as const;

/** How many timeline steps a status has reached (−1 = none, e.g. cancelled). */
export function timelineStep(status: string): number {
  switch (status) {
    case 'draft':
      return 0;
    case 'approved':
    case 'preparing':
      return 1;
    case 'dispatched':
    case 'partially_received':
      return 2;
    case 'received':
      return 3;
    default:
      return -1;
  }
}

function CheckIcon({ className }: { className: string }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className={cn('h-4 w-4 shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="m8 12.5 2.8 2.8L16 9.8" />
    </svg>
  );
}

export function TransferTimeline({ status }: { status: string }): React.JSX.Element | null {
  const reached = timelineStep(status);
  if (reached < 0) return null;
  return (
    <ol className="flex items-center" aria-label="Avance de la transferencia">
      {TIMELINE.map((label, index) => {
        const done = index <= reached;
        return (
          <li
            key={label}
            className={cn('flex items-center', index < TIMELINE.length - 1 && 'flex-1')}
            aria-current={index === reached ? 'step' : undefined}
          >
            <span
              className={cn(
                'flex items-center gap-1 text-[11px] font-semibold',
                done ? 'text-emerald-700' : 'text-slate-400',
              )}
            >
              <CheckIcon className={done ? 'text-emerald-600' : 'text-slate-300'} />
              {label}
            </span>
            {index < TIMELINE.length - 1 && (
              <span
                className={cn(
                  'mx-1 h-px flex-1',
                  index < reached ? 'bg-emerald-300' : 'bg-slate-200',
                )}
                aria-hidden="true"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function TransfersMobileList({
  transfers,
}: {
  transfers: MobileTransfer[];
}): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3" aria-label="Transferencias">
      {transfers.map((transfer) => (
        <li key={transfer.id} className={cn(T.card, 'flex flex-col gap-3 p-4')}>
          <span className="flex items-center justify-between gap-3">
            <span className={cn(T.code, 'min-w-0 truncate text-sm')}>{transfer.code}</span>
            <span className={cn(mobileBadgeClass(T, transfer.statusTone), 'shrink-0')}>
              {transfer.statusLabel}
            </span>
          </span>
          <span
            className={cn(
              T.tile,
              'flex items-center gap-2 bg-slate-50 py-2 text-sm text-slate-700',
            )}
          >
            <span className="min-w-0 truncate font-medium">{transfer.sourceLabel}</span>
            <span aria-hidden="true" className="text-slate-400">
              →
            </span>
            <span className="min-w-0 truncate font-medium text-blue-700">
              {transfer.destinationLabel}
            </span>
          </span>
          <dl className="grid grid-cols-3 gap-2">
            <div className={cn(T.tile, 'p-2.5')}>
              <dt className={T.tileLabel}>Productos</dt>
              <dd className={cn(T.tileValueMono, 'font-semibold')}>{transfer.lineCount}</dd>
            </div>
            <div className={cn(T.tile, 'p-2.5')}>
              <dt className={T.tileLabel}>En tránsito</dt>
              <dd className={cn(T.tileValueMono, 'font-semibold')}>{transfer.inTransit}</dd>
            </div>
            <div className={cn(T.tile, 'p-2.5')}>
              <dt className={T.tileLabel}>Creada</dt>
              <dd className={cn(T.tileValueMono, 'font-semibold')}>{transfer.createdLabel}</dd>
            </div>
          </dl>
          <TransferTimeline status={transfer.status} />
          <Link href={`/inventory/transfers/${transfer.id}`} className={T.primaryButton}>
            Ver
          </Link>
        </li>
      ))}
    </ul>
  );
}
