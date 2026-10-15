'use client';

/**
 * The two "tracking" switches of a variant, with what each one means (plain language) and the
 * practical consequence today: a serialized or lot-tracked variant cannot be sold yet — the cart and
 * the order reject it (there is no sales model for individual serial numbers or lots) — so it
 * is flagged right where the choice is made. Shared by the product and variant create forms.
 */
export function TrackingOptions({
  isSerialized,
  isLotTracked,
  onSerializedChange,
  onLotTrackedChange,
}: {
  isSerialized: boolean;
  isLotTracked: boolean;
  onSerializedChange: (value: boolean) => void;
  onLotTrackedChange: (value: boolean) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={isSerialized}
            onChange={(e) => onSerializedChange(e.target.checked)}
          />
          Serializado
        </label>
        <p className="pl-6 text-xs text-slate-500">
          Cada unidad lleva su propio número de serie (por ejemplo, un celular o un electrodoméstico con garantía por unidad).
        </p>
      </div>
      <div className="flex flex-col gap-0.5">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300"
            checked={isLotTracked}
            onChange={(e) => onLotTrackedChange(e.target.checked)}
          />
          Con seguimiento de lote
        </label>
        <p className="pl-6 text-xs text-slate-500">
          Las unidades se controlan por lote, con su fecha de producción o vencimiento (por ejemplo, medicamentos o alimentos).
        </p>
      </div>
      {(isSerialized || isLotTracked) && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800" role="note">
          Atención: por ahora una variante serializada o con seguimiento de lote no se puede vender. No aparecerá
          disponible en Nueva venta. Déjalo sin marcar si el producto debe venderse.
        </p>
      )}
    </div>
  );
}
