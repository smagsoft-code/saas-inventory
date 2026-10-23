import { getSession } from '../../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../../lib/auth/permissions';
import { listWarehouses } from '../../../../../lib/inventory/warehouses';
import { listLocations } from '../../../../../lib/inventory/locations';
import { PageContainer } from '../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../components/ui/page-header';
import { Alert } from '../../../../../components/ui/alert';
import { ButtonLink } from '../../../../../components/ui/button';
import { NoAccess } from '../../../../../components/ui/no-access';
import { BulkStockForm } from './bulk-stock-form';

export const metadata = { title: 'Carga masiva de stock · SaaS Inventory' };

/**
 * "Carga masiva de stock": ingreso (RECEIPT) de muchos productos desde un Excel, a una sucursal +
 * almacén. Mismo permiso que «Agregar stock» (`inventory.adjust`); la autorización por almacén
 * (ADR-0024) la aplica el backend en cada llamada.
 */
export default async function BulkStockPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('inventory.adjust')) {
    return (
      <PageContainer>
        <PageHeader title="Carga masiva de stock" />
        <NoAccess message="Necesitas el permiso de ajuste de inventario para registrar ingresos de stock." />
      </PageContainer>
    );
  }
  const canViewWarehouses = checker.can('warehouses.view');
  const canViewLocations = checker.can('locations.view');
  const [warehouses, locations] = await Promise.all([
    canViewWarehouses ? listWarehouses({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
    canViewLocations ? listLocations({ pageSize: 100, status: 'active' }).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Carga masiva de stock"
        help="Sube un Excel con Código, Cantidad, Costo unitario y Motivo. Si alguna fila tiene errores no se carga nada. Máximo 500 filas por archivo."
        actions={
          <ButtonLink href="/inventory/add-stock" variant="ghost">
            Volver a Agregar stock
          </ButtonLink>
        }
      />
      {(!canViewWarehouses || !canViewLocations) && (
        <Alert tone="warning">
          No puedes listar sucursales o almacenes, por eso los selectores están vacíos. Pide a un administrador los permisos correspondientes.
        </Alert>
      )}
      <BulkStockForm
        warehouses={(warehouses?.data ?? []).map((w) => ({ id: w.id, name: w.name }))}
        locations={(locations?.data ?? []).map((l) => ({ id: l.id, warehouseId: l.warehouseId, name: l.name }))}
      />
    </PageContainer>
  );
}
