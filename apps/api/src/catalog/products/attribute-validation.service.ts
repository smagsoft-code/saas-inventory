import { BadRequestException, Injectable } from '@nestjs/common';
import type { ApplicableAttributeRow } from '../repositories/attributes.repository';
import { AttributesRepository } from '../repositories/attributes.repository';
import type { TenantTransaction } from '../../database/tenant-context';

export interface AttributeFieldError {
  code: string;
  message: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * database.md#validation-jsonb, ADR-0026 — the shared, backend-only validation logic for the
 * governed `products.attributes`/`product_variants.attributes` JSONB, written once so both the
 * interactive product create/edit path (this service) and a future Excel-import row validator
 * (deferred — see the Prompt 06 plan) can reuse it verbatim, per ADR-0026's explicit design intent.
 * Never a single opaque error — always the field-level shape a per-row import preview needs too.
 *
 * §33's algorithm exactly: resolve the category's governed attribute set for the given scope,
 * reject any submitted key outside it, check every required key is present, then type/range/option
 * check every submitted value. A category with no governed attributes for this scope (including no
 * category at all, categoryId === null) makes the empty object the only valid input.
 */
@Injectable()
export class AttributeValidationService {
  constructor(private readonly attributesRepository: AttributesRepository) {}

  async validate(
    tx: TenantTransaction,
    tenantId: string,
    categoryId: string | null,
    scope: 'product' | 'variant',
    attributes: Record<string, unknown>,
  ): Promise<void> {
    const applicable = categoryId
      ? await this.attributesRepository.listApplicableForCategory(tx, tenantId, categoryId, scope)
      : [];
    const byCode = new Map(applicable.map((def) => [def.code, def]));

    const errors: AttributeFieldError[] = [];

    for (const key of Object.keys(attributes)) {
      if (!byCode.has(key)) {
        errors.push({ code: key, message: `"${key}" is not a governed attribute for this category.` });
      }
    }

    for (const def of applicable) {
      if (def.isRequired && !(def.code in attributes)) {
        errors.push({ code: def.code, message: `"${def.code}" is required for this category.` });
      }
    }

    const selectDefs = applicable.filter(
      (def) => (def.dataType === 'select' || def.dataType === 'multi_select') && def.code in attributes,
    );
    const optionsByDefinition =
      selectDefs.length > 0
        ? await this.attributesRepository.listActiveOptionCodes(
            tx,
            tenantId,
            selectDefs.map((def) => def.definitionId),
          )
        : new Map<string, Set<string>>();

    for (const [key, value] of Object.entries(attributes)) {
      const def = byCode.get(key);
      if (!def) {
        continue;
      }
      const error = this.validateValue(def, value, optionsByDefinition.get(def.definitionId) ?? new Set());
      if (error) {
        errors.push({ code: key, message: error });
      }
    }

    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid attributes.', errors });
    }
  }

  private validateValue(def: ApplicableAttributeRow, value: unknown, activeOptionCodes: Set<string>): string | undefined {
    switch (def.dataType) {
      case 'text':
        return typeof value === 'string' ? undefined : `"${def.code}" must be a string.`;
      case 'boolean':
        return typeof value === 'boolean' ? undefined : `"${def.code}" must be a boolean.`;
      case 'number':
      case 'decimal':
        return this.validateNumber(def, value);
      case 'date':
        return typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value))
          ? undefined
          : `"${def.code}" must be a date in YYYY-MM-DD format.`;
      case 'datetime':
        return typeof value === 'string' && !Number.isNaN(Date.parse(value))
          ? undefined
          : `"${def.code}" must be a valid ISO datetime string.`;
      case 'select':
        return typeof value === 'string' && activeOptionCodes.has(value)
          ? undefined
          : `"${def.code}" must be one of this attribute's active options.`;
      case 'multi_select':
        return this.validateMultiSelect(def, value, activeOptionCodes);
      default:
        return `"${def.code}" has an unrecognized data type.`;
    }
  }

  private validateNumber(def: ApplicableAttributeRow, value: unknown): string | undefined {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return `"${def.code}" must be a number.`;
    }
    if (def.minValue !== null && value < Number(def.minValue)) {
      return `"${def.code}" must be >= ${def.minValue}.`;
    }
    if (def.maxValue !== null && value > Number(def.maxValue)) {
      return `"${def.code}" must be <= ${def.maxValue}.`;
    }
    return undefined;
  }

  private validateMultiSelect(def: ApplicableAttributeRow, value: unknown, activeOptionCodes: Set<string>): string | undefined {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      return `"${def.code}" must be an array of option codes.`;
    }
    const invalid = value.find((entry) => !activeOptionCodes.has(entry as string));
    if (invalid !== undefined) {
      return `"${def.code}" contains "${String(invalid)}", which is not an active option.`;
    }
    return undefined;
  }
}
