import { cn } from '../../../../lib/cn';
import { PRODUCTS_MOBILE_THEMES } from '../../products/products-mobile-theme';

/**
 * The phone layout of "Movimientos de inventario" (`md:hidden` on the page; the table keeps `md` and
 * up): one card per movement with exactly the table's seven columns — Cuándo, Tipo, Almacén,
 * Cantidad, Saldo después, Motivo / referencia, Usuario — in the type and colours of the other phone
 * screens. Pure presentation: the page formats every value (dates, names, labels) on the server.
 */
export interface MobileMovement {
  id: string;
  whenLabel: string;
  typeLabel: string;
  quantity: number;
  balanceAfter: number;
  locationLabel: string;
  referenceLabel: string;
  userLabel: string;
}

const T = PRODUCTS_MOBILE_THEMES.light;

export function MovementsMobileList({ movements }: { movements: MobileMovement[] }): React.JSX.Element {
  return (
    <ul className="flex flex-col gap-3" aria-label="Movimientos">
      {movements.map((movement) => (
        <li key={movement.id} className={cn(T.card, 'flex flex-col gap-2 p-4')}>
          <span className="flex items-start justify-between gap-3">
            <span className={cn(T.stockLine, 'min-w-0')}>{movement.whenLabel}</span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-lg font-bold tabular-nums text-blue-700">{movement.balanceAfter}</span>
              <span className={T.currency}>Saldo después</span>
            </span>
          </span>
          <span className={T.title}>{movement.referenceLabel}</span>
          <span className={T.meta}>
            Almacén: <span className="font-medium text-slate-700">{movement.locationLabel}</span>
          </span>
          <span className={T.meta}>
            Usuario: <span className="font-medium text-slate-700">{movement.userLabel}</span>
          </span>
          <span className={cn('flex flex-wrap items-center gap-2 border-t pt-2', T.divider)}>
            <span className={T.badgeNeutral}>{movement.typeLabel}</span>
            <span className={movement.quantity >= 0 ? T.badgeStock : T.badgeOut}>
              {movement.quantity >= 0 ? `+${movement.quantity}` : movement.quantity}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
