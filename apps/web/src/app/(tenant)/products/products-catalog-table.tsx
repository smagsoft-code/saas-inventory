'use client';

import Link from 'next/link';
import { Fragment, useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage } from '../../../lib/api/errors';
import { Badge } from '../../../components/ui/badge';
import { Spinner } from '../../../components/ui/spinner';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { QrThumbnailModal } from '../../../components/qr-thumbnail-modal';
import { VARIANT_STATUS_LABELS, type VariantStatus } from '../../../lib/types/products';
import type { InventoryBalance } from '../../../lib/types/inventory';
import type { ProductCatalogRow } from '../../../lib/types/product-catalog';

function money(value: number): string {
  return value.toFixed(2);
}

/** A generic placeholder square — every row shows the same one until a real thumbnail is uploaded
 * for that product (`product_images`, OUI-006). Never a broken `<img>`, never a fabricated URL. */
function ThumbnailPlaceholder({ src }: { src?: string }): React.JSX.Element {
  if (src) {
    // A tiny fixed-size table thumbnail; next/image's remote-loader config is unwarranted for a
    // same-origin asset endpoint this small (this project's eslint config has no next/image rule).
    return (
      <img
        src={src}
        alt=""
        className="h-10 w-10 shrink-0 rounded-md border border-slate-200 object-cover"
      />
    );
  }
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-slate-300"
      aria-hidden
    >
      <svg
        viewBox="0 0 24 24"
        className="h-5 w-5"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5-9 9" />
      </svg>
    </div>
  );
}

interface BalancesState {
  status: 'loading' | 'ready' | 'error';
  rows: InventoryBalance[];
  error?: string;
}

/**
 * The "Existencias" card inside a row's expanded panel — matches the reference screenshot exactly:
 * one row per (Almacén, Sucursal) the variant has a balance at, DISPONIBLE/FÍSICO/RESERVADO/
 * COMPROMETIDO columns, "Movimientos"/"Ajustar" header actions. Sourced from the real
 * `GET /inventory/balances?productVariantId=` (already existed — no backend change needed here),
 * fetched lazily on first expand and cached per variant so re-collapsing/re-expanding never
 * re-fetches. GL-1: "Almacén" = `locations` (the row grain here), "Sucursal" = `warehouses`.
 */
function ExistenciasCard({
  variantId,
  balances,
  locationNames,
  locationWarehouseNames,
}: {
  variantId: string;
  balances: BalancesState | undefined;
  locationNames: Map<string, string>;
  locationWarehouseNames: Map<string, string>;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Existencias</h3>
        <div className="flex gap-4 text-sm font-medium text-slate-600">
          <Link
            href={`/inventory/movements?productVariantId=${variantId}`}
            className="hover:underline"
          >
            Movimientos
          </Link>
          <Link
            href={`/inventory/adjust?productVariantId=${variantId}`}
            className="hover:underline"
          >
            Ajustar
          </Link>
        </div>
      </div>

      {!balances || balances.status === 'loading' ? (
        <p className="flex items-center gap-2 px-4 py-4 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Cargando existencias…
        </p>
      ) : balances.status === 'error' ? (
        <p className="px-4 py-4 text-sm text-red-700">{balances.error}</p>
      ) : balances.rows.length === 0 ? (
        <p className="px-4 py-4 text-sm text-slate-500">
          Sin existencias registradas para esta variante.
        </p>
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Almacén</TH>
              <TH>Sucursal</TH>
              <TH className="text-right">Disponible</TH>
              <TH className="text-right">Físico</TH>
              <TH className="text-right">Reservado</TH>
              <TH className="text-right">Comprometido</TH>
            </TR>
          </THead>
          <TBody>
            {balances.rows.map((balance) => (
              <TR key={balance.id}>
                <TD>
                  <Link
                    href={`/inventory/${balance.id}`}
                    className="font-medium text-slate-700 underline-offset-2 hover:underline"
                  >
                    {locationNames.get(balance.locationId) ?? balance.locationId}
                  </Link>
                </TD>
                <TD className="text-slate-500">
                  {locationWarehouseNames.get(balance.locationId) ?? '—'}
                </TD>
                <TD className="text-right font-semibold text-slate-900">
                  {balance.quantityAvailable}
                </TD>
                <TD className="text-right text-slate-500">{balance.quantityPhysical}</TD>
                <TD className="text-right text-slate-500">{balance.quantityReserved}</TD>
                <TD className="text-right text-slate-500">{balance.quantityCommitted}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}

/**
 * The `/products` table body (OUI-004/OUI-006) — a Client Component because the expand/collapse
 * affordance and the per-variant "Existencias" fetch are genuinely per-row interaction; everything
 * else here is a plain link, the same navigate-and-refetch pattern the rest of the app uses. One
 * row is one variant (`ProductCatalogRow` — SKU/prices/stock are all variant-grain), not one
 * product.
 */
export function ProductsCatalogTable({
  rows,
  categoryNames,
  qrValueByVariant,
  canManage,
  canViewInventory,
  locationNames,
  locationWarehouseNames,
}: {
  rows: ProductCatalogRow[];
  categoryNames: Map<string, string>;
  /** `variantId -> {apiPublicUrl}/q/:code` (OUI-008) — the QR's real scannable value, precomputed
   * server-side (never a function, never crosses the RSC boundary — see `locationNames`'s own note
   * below). Bounded to the first 100 QR codes tenant-wide (`GET /qr-codes?targetType=product_variant`,
   * the same bounded-list convention used elsewhere) — a tenant with more is untested range. */
  qrValueByVariant: Map<string, string>;
  canManage: boolean;
  /** Gates the "Existencias" fetch — a caller without `inventory.view` never sees a guaranteed 403. */
  canViewInventory: boolean;
  /** Plain `Map`s, never the function-bearing `LocationIndex` — a Server Component can pass a
   * `Map` across the RSC boundary into a Client Component, but never a closure/function (React
   * throws "Functions cannot be passed directly to Client Components" at render time). The
   * `page.tsx` caller invokes `LocationIndex.locationName`/`.warehouseName` itself, server-side,
   * and hands over only the resulting plain strings. */
  locationNames: Map<string, string>;
  locationWarehouseNames: Map<string, string>;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [balancesByVariant, setBalancesByVariant] = useState<Record<string, BalancesState>>({});

  function toggle(variantId: string): void {
    const willOpen = !expanded.has(variantId);
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(variantId)) next.delete(variantId);
      else next.add(variantId);
      return next;
    });
    if (willOpen && canViewInventory && !balancesByVariant[variantId]) {
      setBalancesByVariant((cur) => ({ ...cur, [variantId]: { status: 'loading', rows: [] } }));
      apiFetch<{ data: InventoryBalance[] }>('/api/v1/inventory/balances', {
        query: { productVariantId: variantId, pageSize: 100 },
      })
        .then((page) => {
          setBalancesByVariant((cur) => ({
            ...cur,
            [variantId]: { status: 'ready', rows: page.data },
          }));
        })
        .catch((err: unknown) => {
          setBalancesByVariant((cur) => ({
            ...cur,
            [variantId]: { status: 'error', rows: [], error: httpErrorMessage(err) },
          }));
        });
    }
  }

  return (
    <Table>
      <THead>
        <TR>
          <TH className="w-0">
            <span className="sr-only">Expandir</span>
          </TH>
          {/* `w-16` (not `w-0` like the icon-only columns) — a real `<img>` is a replaced element;
              table auto-layout squeezed it to ~2px wide when this column had no other content to
              size against, even though the `<img>` itself carries an explicit `h-10 w-10`
              (confirmed against the real rendered DOM: `getBoundingClientRect()` reported
              width:2, height:40 despite `complete: true` and a valid 128x128 source). A plain
              `<button>`/`<div>` (the Expandir/Editar columns) never hits this, only `<img>`. */}
          <TH className="w-16">
            <span className="sr-only">Imagen</span>
          </TH>
          <TH>Nombre</TH>
          <TH>Código</TH>
          <TH className="text-right">Stock</TH>
          <TH className="text-right">Precio máx.</TH>
          <TH className="text-right">Precio base</TH>
          <TH>Estado</TH>
          <TH>QR</TH>
          <TH className="w-0">
            <span className="sr-only">Editar</span>
          </TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((row) => {
          const isOpen = expanded.has(row.variantId);
          const qrValue = qrValueByVariant.get(row.variantId);
          return (
            <Fragment key={row.variantId}>
              <TR>
                <TD>
                  <button
                    type="button"
                    onClick={() => toggle(row.variantId)}
                    aria-expanded={isOpen}
                    aria-label={
                      isOpen ? `Contraer ${row.productName}` : `Expandir ${row.productName}`
                    }
                    className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      aria-hidden
                    >
                      <path d="M9 6l6 6-6 6" />
                    </svg>
                  </button>
                </TD>
                <TD>
                  <ThumbnailPlaceholder {...(row.thumbnailUrl ? { src: row.thumbnailUrl } : {})} />
                </TD>
                <TD className="font-medium">{row.productName}</TD>
                <TD className="text-slate-500">{row.sku}</TD>
                <TD className="text-right text-slate-700">{row.availableQuantity}</TD>
                <TD className="text-right text-slate-500">{money(row.maxPrice)}</TD>
                <TD className="text-right text-slate-500">{money(row.basePrice)}</TD>
                <TD>
                  <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
                    {VARIANT_STATUS_LABELS[row.status as VariantStatus] ?? row.status}
                  </Badge>
                </TD>
                <TD>
                  {qrValue ? (
                    <QrThumbnailModal
                      value={qrValue}
                      label={`${row.productName} — ${row.sku}`}
                      maxPrice={row.maxPrice}
                    />
                  ) : (
                    <Link
                      href={`/qr/new?productId=${row.productId}&variantId=${row.variantId}`}
                      className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
                    >
                      Generar
                    </Link>
                  )}
                </TD>
                <TD>
                  <Link
                    href={`/products/${row.productId}/variants/${row.variantId}`}
                    className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                  >
                    {canManage ? 'Editar' : 'Ver'}
                  </Link>
                </TD>
              </TR>
              {isOpen && (
                <TR>
                  <TD colSpan={10} className="bg-slate-50">
                    <div className="flex flex-col gap-3 py-3">
                      {categoryNames.get(row.categoryId ?? '') && (
                        <p className="text-sm">
                          <span className="text-slate-500">Categoría:</span>{' '}
                          <span className="text-slate-800">
                            {categoryNames.get(row.categoryId ?? '')}
                          </span>
                        </p>
                      )}
                      {canViewInventory ? (
                        <ExistenciasCard
                          variantId={row.variantId}
                          balances={balancesByVariant[row.variantId]}
                          locationNames={locationNames}
                          locationWarehouseNames={locationWarehouseNames}
                        />
                      ) : (
                        <p className="text-sm text-slate-500">
                          Necesitas el permiso de inventario para ver existencias.
                        </p>
                      )}
                      <Link
                        href={`/products/${row.productId}`}
                        className="w-fit text-xs font-medium text-slate-600 underline-offset-2 hover:underline"
                      >
                        Ver producto completo →
                      </Link>
                    </div>
                  </TD>
                </TR>
              )}
            </Fragment>
          );
        })}
      </TBody>
    </Table>
  );
}
