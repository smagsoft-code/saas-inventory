import { serverApiFetch } from '../api/server';
import type { AttributeDefinition, AttributeOption, MeasurementUnit } from '../types/catalog';

/**
 * Server-side reads for attribute definitions / options / measurement units
 * (`GET /api/v1/attribute-definitions*`, permission `products.view`; `GET /api/v1/measurement-units`,
 * no permission). Lists are **plain arrays, not paginated** — the governance table is bounded
 * (ADR-0026). Client-side mutations go through `apiFetch` in the form components.
 *
 * There is **no `GET /attribute-definitions/:id` detail endpoint** — {@link getAttributeDefinition}
 * fetches the (bounded) list and finds the one. Recorded as an observation in f17-gaps.md.
 */
export async function listAttributeDefinitions(
  status?: 'active' | 'inactive',
): Promise<AttributeDefinition[]> {
  const query = status ? { status } : undefined;
  return serverApiFetch<AttributeDefinition[]>('/api/v1/attribute-definitions', query ? { query } : {});
}

export async function getAttributeDefinition(id: string): Promise<AttributeDefinition | undefined> {
  const all = await serverApiFetch<AttributeDefinition[]>('/api/v1/attribute-definitions');
  return all.find((def) => def.id === id);
}

export async function getAttributeOptions(definitionId: string): Promise<AttributeOption[]> {
  return serverApiFetch<AttributeOption[]>(`/api/v1/attribute-definitions/${definitionId}/options`);
}

export async function listMeasurementUnits(): Promise<MeasurementUnit[]> {
  return serverApiFetch<MeasurementUnit[]>('/api/v1/measurement-units');
}
