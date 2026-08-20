import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { attributeDefinitions, attributeOptions, categoryAttributes, measurementUnits } from '../../database/schema';
import type { TenantTransaction } from '../../database/tenant-context';

export interface AttributeDefinitionRow {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string | null;
  dataType: string;
  appliesTo: string;
  unitId: string | null;
  isRequiredDefault: boolean;
  minValue: string | null;
  maxValue: string | null;
  status: string;
  displayOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface AttributeOptionRow {
  id: string;
  tenantId: string;
  attributeDefinitionId: string;
  code: string;
  label: string;
  displayOrder: number;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One row per attribute applicable to a category, resolved (isRequired already merges the
 * category_attributes override with attribute_definitions.isRequiredDefault) — exactly what
 * AttributeValidationService needs, and what a product-creation form would render. */
export interface ApplicableAttributeRow {
  definitionId: string;
  code: string;
  name: string;
  dataType: string;
  isRequired: boolean;
  minValue: string | null;
  maxValue: string | null;
}

export interface CategoryAttributeRow {
  categoryId: string;
  attributeDefinitionId: string;
  isRequired: boolean | null;
  displayOrder: number;
}

export interface MeasurementUnitRow {
  id: string;
  code: string;
  label: string;
  dimension: string;
}

/**
 * Tenant-scoped reads/writes for the dynamic-attribute governance layer
 * (attribute_definitions/attribute_options/category_attributes — ADR-0026) plus the platform-scoped,
 * read-only measurement_units reference catalog. Same per-transaction convention as every other
 * repository in this codebase.
 */
@Injectable()
export class AttributesRepository {
  async findDefinitionById(
    tx: TenantTransaction,
    tenantId: string,
    definitionId: string,
  ): Promise<AttributeDefinitionRow | undefined> {
    const [row] = await tx
      .select()
      .from(attributeDefinitions)
      .where(
        and(
          eq(attributeDefinitions.tenantId, tenantId),
          eq(attributeDefinitions.id, definitionId),
          isNull(attributeDefinitions.deletedAt),
        ),
      );
    return row;
  }

  async listDefinitionsByTenant(
    tx: TenantTransaction,
    tenantId: string,
    status?: string | undefined,
  ): Promise<AttributeDefinitionRow[]> {
    const conditions = [eq(attributeDefinitions.tenantId, tenantId), isNull(attributeDefinitions.deletedAt)];
    if (status) {
      conditions.push(eq(attributeDefinitions.status, status));
    }
    return tx
      .select()
      .from(attributeDefinitions)
      .where(and(...conditions))
      .orderBy(attributeDefinitions.displayOrder, attributeDefinitions.name);
  }

  async createDefinition(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      code: string;
      name: string;
      description?: string | undefined;
      dataType: string;
      appliesTo: string;
      unitId?: string | undefined;
      isRequiredDefault?: boolean | undefined;
      minValue?: string | undefined;
      maxValue?: string | undefined;
    },
  ): Promise<AttributeDefinitionRow> {
    const [row] = await tx.insert(attributeDefinitions).values(values).returning();
    if (!row) {
      throw new Error('Attribute definition insert did not return a row.');
    }
    return row;
  }

  async updateDefinition(
    tx: TenantTransaction,
    tenantId: string,
    definitionId: string,
    values: {
      name?: string;
      description?: string | null;
      isRequiredDefault?: boolean;
      minValue?: string | null;
      maxValue?: string | null;
      status?: string;
    },
  ): Promise<AttributeDefinitionRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findDefinitionById(tx, tenantId, definitionId);
    }
    const [row] = await tx
      .update(attributeDefinitions)
      .set(values)
      .where(
        and(
          eq(attributeDefinitions.tenantId, tenantId),
          eq(attributeDefinitions.id, definitionId),
          isNull(attributeDefinitions.deletedAt),
        ),
      )
      .returning();
    return row;
  }

  async findOptionById(
    tx: TenantTransaction,
    tenantId: string,
    optionId: string,
  ): Promise<AttributeOptionRow | undefined> {
    const [row] = await tx
      .select()
      .from(attributeOptions)
      .where(and(eq(attributeOptions.tenantId, tenantId), eq(attributeOptions.id, optionId)));
    return row;
  }

  async listOptionsByDefinition(
    tx: TenantTransaction,
    tenantId: string,
    definitionId: string,
  ): Promise<AttributeOptionRow[]> {
    return tx
      .select()
      .from(attributeOptions)
      .where(and(eq(attributeOptions.tenantId, tenantId), eq(attributeOptions.attributeDefinitionId, definitionId)))
      .orderBy(attributeOptions.displayOrder, attributeOptions.label);
  }

  async createOption(
    tx: TenantTransaction,
    values: {
      id: string;
      tenantId: string;
      attributeDefinitionId: string;
      code: string;
      label: string;
      displayOrder?: number | undefined;
    },
  ): Promise<AttributeOptionRow> {
    const [row] = await tx.insert(attributeOptions).values(values).returning();
    if (!row) {
      throw new Error('Attribute option insert did not return a row.');
    }
    return row;
  }

  async updateOption(
    tx: TenantTransaction,
    tenantId: string,
    optionId: string,
    values: { label?: string; displayOrder?: number; status?: string },
  ): Promise<AttributeOptionRow | undefined> {
    if (Object.keys(values).length === 0) {
      return this.findOptionById(tx, tenantId, optionId);
    }
    const [row] = await tx
      .update(attributeOptions)
      .set(values)
      .where(and(eq(attributeOptions.tenantId, tenantId), eq(attributeOptions.id, optionId)))
      .returning();
    return row;
  }

  /** The active option codes for a batch of attribute definitions at once — used by
   * AttributeValidationService to avoid one query per select/multi_select attribute submitted. */
  async listActiveOptionCodes(
    tx: TenantTransaction,
    tenantId: string,
    definitionIds: string[],
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    if (definitionIds.length === 0) {
      return result;
    }
    const rows = await tx
      .select({ definitionId: attributeOptions.attributeDefinitionId, code: attributeOptions.code })
      .from(attributeOptions)
      .where(
        and(
          eq(attributeOptions.tenantId, tenantId),
          inArray(attributeOptions.attributeDefinitionId, definitionIds),
          eq(attributeOptions.status, 'active'),
        ),
      );
    for (const row of rows) {
      const existing = result.get(row.definitionId) ?? new Set<string>();
      existing.add(row.code);
      result.set(row.definitionId, existing);
    }
    return result;
  }

  /** database.md#dynamic-attributes: which attributes govern `categoryId` for the given
   * PRODUCT/VARIANT scope, with category_attributes.isRequired already resolved against
   * attribute_definitions.isRequiredDefault (NULL = inherit) — the exact set
   * AttributeValidationService's §33 algorithm needs. Only active definitions apply to *new*
   * validation (a retired definition stays resolvable on historical products but is never
   * enforced/offered for new ones — ADR-0026). */
  async listApplicableForCategory(
    tx: TenantTransaction,
    tenantId: string,
    categoryId: string,
    scope: 'product' | 'variant',
  ): Promise<ApplicableAttributeRow[]> {
    const rows = await tx
      .select({
        definitionId: attributeDefinitions.id,
        code: attributeDefinitions.code,
        name: attributeDefinitions.name,
        dataType: attributeDefinitions.dataType,
        isRequiredOverride: categoryAttributes.isRequired,
        isRequiredDefault: attributeDefinitions.isRequiredDefault,
        minValue: attributeDefinitions.minValue,
        maxValue: attributeDefinitions.maxValue,
      })
      .from(categoryAttributes)
      .innerJoin(
        attributeDefinitions,
        and(
          eq(attributeDefinitions.id, categoryAttributes.attributeDefinitionId),
          eq(attributeDefinitions.tenantId, categoryAttributes.tenantId),
        ),
      )
      .where(
        and(
          eq(categoryAttributes.tenantId, tenantId),
          eq(categoryAttributes.categoryId, categoryId),
          eq(attributeDefinitions.appliesTo, scope),
          eq(attributeDefinitions.status, 'active'),
          isNull(attributeDefinitions.deletedAt),
        ),
      );
    return rows.map((row) => ({
      definitionId: row.definitionId,
      code: row.code,
      name: row.name,
      dataType: row.dataType,
      isRequired: row.isRequiredOverride ?? row.isRequiredDefault,
      minValue: row.minValue,
      maxValue: row.maxValue,
    }));
  }

  async listCategoryAttributes(
    tx: TenantTransaction,
    tenantId: string,
    categoryId: string,
  ): Promise<CategoryAttributeRow[]> {
    return tx
      .select()
      .from(categoryAttributes)
      .where(and(eq(categoryAttributes.tenantId, tenantId), eq(categoryAttributes.categoryId, categoryId)))
      .orderBy(categoryAttributes.displayOrder);
  }

  /** Replaces the full set of attribute assignments for a category in one transactional
   * delete+insert — a PUT-style "this is now the complete set" semantic, matching
   * RolesRepository.setUserRole's replace-not-merge convention. */
  async replaceCategoryAttributes(
    tx: TenantTransaction,
    tenantId: string,
    categoryId: string,
    entries: Array<{ attributeDefinitionId: string; isRequired?: boolean | null; displayOrder?: number }>,
  ): Promise<void> {
    await tx
      .delete(categoryAttributes)
      .where(and(eq(categoryAttributes.tenantId, tenantId), eq(categoryAttributes.categoryId, categoryId)));
    if (entries.length > 0) {
      await tx.insert(categoryAttributes).values(
        entries.map((entry) => ({
          tenantId,
          categoryId,
          attributeDefinitionId: entry.attributeDefinitionId,
          isRequired: entry.isRequired ?? null,
          displayOrder: entry.displayOrder ?? 0,
        })),
      );
    }
  }

  /** Platform-scoped, migration-managed reference data (like `permissions`) — no tenant filter. */
  async listUnits(tx: TenantTransaction): Promise<MeasurementUnitRow[]> {
    return tx
      .select({ id: measurementUnits.id, code: measurementUnits.code, label: measurementUnits.label, dimension: measurementUnits.dimension })
      .from(measurementUnits)
      .orderBy(measurementUnits.dimension, measurementUnits.label);
  }
}
