import { HelpTip } from '../../../../components/ui/help-tip';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import {
  getAttributeDefinition,
  getAttributeOptions,
  listMeasurementUnits,
} from '../../../../lib/catalog/attributes';
import {
  ATTRIBUTE_DATA_TYPE_LABELS,
  isSelectType,
  type MeasurementUnit,
} from '../../../../lib/types/catalog';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Badge, statusTone } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { AttributeForm } from '../attribute-form';
import { AttributeOptionsEditor } from './attribute-options-editor';

export const metadata = { title: 'Atributo · SaaS Inventory' };

export default async function AttributeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('products.view')) {
    return (
      <PageContainer>
        <PageHeader title="Atributo" />
        <NoAccess message="Necesitas el permiso de vista del catálogo para ver los atributos." />
      </PageContainer>
    );
  }
  const canManage = checker.can('catalog.attributes.manage');

  const definition = await getAttributeDefinition(id);
  if (!definition) {
    notFound();
  }

  const selectType = isSelectType(definition.dataType);
  const [units, options] = await Promise.all([
    canManage ? listMeasurementUnits() : Promise.resolve<MeasurementUnit[]>([]),
    selectType ? getAttributeOptions(id) : Promise.resolve([]),
  ]);
  const unitLabel = definition.unitId
    ? units.find((u) => u.id === definition.unitId)?.label
    : undefined;

  return (
    <PageContainer>
      <PageHeader
        title={definition.name}
        description={`${ATTRIBUTE_DATA_TYPE_LABELS[definition.dataType] ?? definition.dataType} · ${definition.appliesTo === 'variant' ? 'por variante' : 'por producto'}`}
        actions={
          <Badge tone={statusTone(definition.status)}>
            {definition.status === 'active' ? 'Activo' : definition.status === 'inactive' ? 'Inactivo' : definition.status}
          </Badge>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Definición</h2>
          {canManage ? (
            <AttributeForm mode="edit" definition={definition} units={units} />
          ) : (
            <dl className="grid max-w-md grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Código</dt>
              <dd className="text-slate-900"><code className="text-xs">{definition.code}</code></dd>
              <dt className="text-slate-500">Tipo</dt>
              <dd className="text-slate-900">{ATTRIBUTE_DATA_TYPE_LABELS[definition.dataType] ?? definition.dataType}</dd>
              <dt className="text-slate-500">Aplica a</dt>
              <dd className="text-slate-900">{definition.appliesTo === 'variant' ? 'Variante' : 'Producto'}</dd>
              {definition.description && (
                <>
                  <dt className="text-slate-500">Descripción</dt>
                  <dd className="text-slate-900">{definition.description}</dd>
                </>
              )}
              {unitLabel && (
                <>
                  <dt className="text-slate-500">Unidad</dt>
                  <dd className="text-slate-900">{unitLabel}</dd>
                </>
              )}
            </dl>
          )}
        </CardBody>
      </Card>

      {selectType && (
        <Card>
          <CardBody className="flex flex-col gap-4">
            <div>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                Opciones
                <HelpTip>
                  Los valores seleccionables de este atributo de {definition.dataType === 'multi_select' ? 'selección múltiple' : 'selección única'}.
                </HelpTip>
              </h2>
            </div>
            <AttributeOptionsEditor definitionId={definition.id} options={options} canManage={canManage} />
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
}
