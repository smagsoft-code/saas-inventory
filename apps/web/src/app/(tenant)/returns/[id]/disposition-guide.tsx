/**
 * Plain-language explanation of the four return dispositions (ADR-0021) shown on the inspection
 * form. All four write the same movement (`RETURN`, entry) at the chosen location; what differs is
 * the *kind* of location — a sellable one makes the stock available to Ventas again, a non-sellable
 * one keeps it out of every sale. Collapsed by default so it never crowds the form.
 */
export function DispositionGuide(): React.JSX.Element {
  return (
    <details className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
      <summary className="cursor-pointer font-medium text-slate-700">¿Qué significa cada disposición?</summary>
      <dl className="mt-2 flex flex-col gap-2">
        <div>
          <dt className="font-medium text-slate-700">Reingreso a stock</dt>
          <dd>
            La mercancía está en buen estado. Vuelve a un almacén vendible: Inventario la suma como entrada y Ventas
            puede volver a venderla.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Cuarentena</dt>
          <dd>
            Queda retenida en un almacén no vendible mientras se revisa o repara. Aparece en Inventario, pero no se
            puede vender.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Dañado</dt>
          <dd>
            Mercancía con defecto que no está en condiciones de venta. Funciona igual que cuarentena (almacén no
            vendible); se distingue en el reporte de devoluciones por disposición.
          </dd>
        </div>
        <div>
          <dt className="font-medium text-slate-700">Descarte</dt>
          <dd>
            Mercancía que no se recuperará. Igual que las anteriores, queda en un almacén no vendible: el sistema no
            da de baja las unidades, siguen contadas como stock hasta que se registre un ajuste de salida en
            Inventario.
          </dd>
        </div>
      </dl>
      <p className="mt-2">
        Ninguna opción devuelve dinero ni modifica el pedido original: la devolución solo afecta al producto.
      </p>
    </details>
  );
}
