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

export const metadata = { title: 'Attribute · SaaS Inventory' };

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
        <PageHeader title="Attribute" />
        <NoAccess message="You need the catalogue-view permission to view attributes." />
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
        description={`${ATTRIBUTE_DATA_TYPE_LABELS[definition.dataType] ?? definition.dataType} · ${definition.appliesTo === 'variant' ? 'per variant' : 'per product'}`}
        actions={<Badge tone={statusTone(definition.status)}>{definition.status}</Badge>}
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Definition</h2>
          {canManage ? (
            <AttributeForm mode="edit" definition={definition} units={units} />
          ) : (
            <dl className="grid max-w-md grid-cols-[9rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Code</dt>
              <dd className="text-slate-900"><code className="text-xs">{definition.code}</code></dd>
              <dt className="text-slate-500">Type</dt>
              <dd className="text-slate-900">{ATTRIBUTE_DATA_TYPE_LABELS[definition.dataType] ?? definition.dataType}</dd>
              <dt className="text-slate-500">Applies to</dt>
              <dd className="text-slate-900">{definition.appliesTo === 'variant' ? 'Variant' : 'Product'}</dd>
              {definition.description && (
                <>
                  <dt className="text-slate-500">Description</dt>
                  <dd className="text-slate-900">{definition.description}</dd>
                </>
              )}
              {unitLabel && (
                <>
                  <dt className="text-slate-500">Unit</dt>
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
              <h2 className="text-sm font-semibold text-slate-900">Options</h2>
              <p className="mt-1 text-sm text-slate-500">
                The selectable values for this {definition.dataType === 'multi_select' ? 'multi-select' : 'select'} attribute.
              </p>
            </div>
            <AttributeOptionsEditor definitionId={definition.id} options={options} canManage={canManage} />
          </CardBody>
        </Card>
      )}
    </PageContainer>
  );
}
