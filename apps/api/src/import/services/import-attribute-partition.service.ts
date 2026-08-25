import { Injectable } from '@nestjs/common';
import { AttributesRepository } from '../../catalog/repositories/attributes.repository';
import type { TenantTransaction } from '../../database/tenant-context';
import { extractAttributeValues, isAttributeField } from '../import-fields';

export interface AttributePartition {
  productAttrs: Record<string, unknown>;
  variantAttrs: Record<string, unknown>;
  /** Submitted attr:<code> values that matched neither scope for this category — a row error,
   * computed by the caller (ImportValidationService); ImportExecutionService never needs this list
   * since a row only reaches commit once it is already `valid`/`warning`. */
  unrouted: string[];
}

/**
 * Routes a row's flat `attr:<code>` submissions into product-scope vs variant-scope attribute
 * maps, shared by ImportValidationService (validates both partitions) and ImportExecutionService
 * (writes both partitions onto the product/variant it creates or updates) — computed once per
 * concern rather than two divergent implementations of the same category_attributes lookup.
 */
@Injectable()
export class ImportAttributePartitionService {
  constructor(private readonly attributesRepository: AttributesRepository) {}

  async partition(tx: TenantTransaction, tenantId: string, categoryId: string | null, mapped: Record<string, unknown>): Promise<AttributePartition> {
    const attributeFields = Object.keys(mapped).filter(isAttributeField);
    if (attributeFields.length === 0) {
      return { productAttrs: {}, variantAttrs: {}, unrouted: [] };
    }

    const submitted = extractAttributeValues(mapped);
    const [productApplicable, variantApplicable] = categoryId
      ? await Promise.all([
          this.attributesRepository.listApplicableForCategory(tx, tenantId, categoryId, 'product'),
          this.attributesRepository.listApplicableForCategory(tx, tenantId, categoryId, 'variant'),
        ])
      : [[], []];
    const productCodes = new Set(productApplicable.map((def) => def.code));
    const variantCodes = new Set(variantApplicable.map((def) => def.code));

    const productAttrs: Record<string, unknown> = {};
    const variantAttrs: Record<string, unknown> = {};
    const unrouted: string[] = [];
    for (const [code, value] of Object.entries(submitted)) {
      if (productCodes.has(code)) productAttrs[code] = value;
      else if (variantCodes.has(code)) variantAttrs[code] = value;
      else unrouted.push(code);
    }
    return { productAttrs, variantAttrs, unrouted };
  }
}
