import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import { withTenantTransaction } from '../../database/tenant-context';
import type { AttributeDefinitionRow, AttributeOptionRow, MeasurementUnitRow } from '../repositories/attributes.repository';
import { AttributesRepository } from '../repositories/attributes.repository';
import type { AttributeDefinitionResponseDto } from './dto/attribute-definition.dto';
import type { CreateAttributeDefinitionDto } from './dto/attribute-definition.dto';
import type { UpdateAttributeDefinitionDto } from './dto/attribute-definition.dto';
import type { AttributeOptionResponseDto } from './dto/attribute-option.dto';
import type { CreateAttributeOptionDto } from './dto/attribute-option.dto';
import type { UpdateAttributeOptionDto } from './dto/attribute-option.dto';
import type { MeasurementUnitResponseDto } from './dto/measurement-unit-response.dto';

interface UniqueViolation {
  code: string;
}

function hasUniqueViolationCode(error: unknown): error is UniqueViolation {
  return typeof error === 'object' && error !== null && 'code' in error && (error as UniqueViolation).code === '23505';
}

function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) {
    return true;
  }
  return error instanceof Error && hasUniqueViolationCode(error.cause);
}

const NUMERIC_TYPES = new Set(['number', 'decimal']);

function toDefinitionResponse(def: AttributeDefinitionRow): AttributeDefinitionResponseDto {
  return {
    id: def.id,
    code: def.code,
    name: def.name,
    description: def.description ?? undefined,
    dataType: def.dataType,
    appliesTo: def.appliesTo,
    unitId: def.unitId ?? undefined,
    isRequiredDefault: def.isRequiredDefault,
    minValue: def.minValue !== null ? Number(def.minValue) : undefined,
    maxValue: def.maxValue !== null ? Number(def.maxValue) : undefined,
    status: def.status,
  };
}

function toOptionResponse(option: AttributeOptionRow): AttributeOptionResponseDto {
  return {
    id: option.id,
    attributeDefinitionId: option.attributeDefinitionId,
    code: option.code,
    label: option.label,
    displayOrder: option.displayOrder,
    status: option.status,
  };
}

/**
 * `attribute_definitions`/`attribute_options` administration (§6-§9, `catalog.attributes.manage`)
 * plus the read-only `measurement_units` reference list, within the caller's own tenant.
 */
@Injectable()
export class AttributesService {
  constructor(private readonly attributesRepository: AttributesRepository) {}

  async listDefinitions(tenantId: string, status?: string | undefined): Promise<AttributeDefinitionResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const rows = await this.attributesRepository.listDefinitionsByTenant(tx, tenantId, status);
      return rows.map(toDefinitionResponse);
    });
  }

  async createDefinition(tenantId: string, dto: CreateAttributeDefinitionDto): Promise<AttributeDefinitionResponseDto> {
    this.assertNumericOnlyFields(dto.dataType, dto);

    return withTenantTransaction(tenantId, async (tx) => {
      try {
        const created = await this.attributesRepository.createDefinition(tx, {
          id: generateId(),
          tenantId,
          code: dto.code,
          name: dto.name,
          description: dto.description,
          dataType: dto.dataType,
          appliesTo: dto.appliesTo,
          unitId: dto.unitId,
          isRequiredDefault: dto.isRequiredDefault,
          minValue: dto.minValue !== undefined ? String(dto.minValue) : undefined,
          maxValue: dto.maxValue !== undefined ? String(dto.maxValue) : undefined,
        });
        return toDefinitionResponse(created);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('An attribute definition with this code already exists.');
        }
        throw error;
      }
    });
  }

  async updateDefinition(
    tenantId: string,
    definitionId: string,
    dto: UpdateAttributeDefinitionDto,
  ): Promise<AttributeDefinitionResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const existing = await this.attributesRepository.findDefinitionById(tx, tenantId, definitionId);
      if (!existing) {
        throw new NotFoundException('Attribute definition not found.');
      }
      if ((dto.minValue !== undefined || dto.maxValue !== undefined) && !NUMERIC_TYPES.has(existing.dataType)) {
        throw new BadRequestException('minValue/maxValue only apply to number/decimal attributes.');
      }

      const updated = await this.attributesRepository.updateDefinition(tx, tenantId, definitionId, {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.isRequiredDefault !== undefined ? { isRequiredDefault: dto.isRequiredDefault } : {}),
        ...(dto.minValue !== undefined ? { minValue: String(dto.minValue) } : {}),
        ...(dto.maxValue !== undefined ? { maxValue: String(dto.maxValue) } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      });
      if (!updated) {
        throw new NotFoundException('Attribute definition not found.');
      }
      return toDefinitionResponse(updated);
    });
  }

  async listOptions(tenantId: string, definitionId: string): Promise<AttributeOptionResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const definition = await this.attributesRepository.findDefinitionById(tx, tenantId, definitionId);
      if (!definition) {
        throw new NotFoundException('Attribute definition not found.');
      }
      const rows = await this.attributesRepository.listOptionsByDefinition(tx, tenantId, definitionId);
      return rows.map(toOptionResponse);
    });
  }

  async createOption(
    tenantId: string,
    definitionId: string,
    dto: CreateAttributeOptionDto,
  ): Promise<AttributeOptionResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const definition = await this.attributesRepository.findDefinitionById(tx, tenantId, definitionId);
      if (!definition) {
        throw new NotFoundException('Attribute definition not found.');
      }
      if (definition.dataType !== 'select' && definition.dataType !== 'multi_select') {
        throw new BadRequestException('Options only apply to select/multi_select attributes.');
      }
      try {
        const created = await this.attributesRepository.createOption(tx, {
          id: generateId(),
          tenantId,
          attributeDefinitionId: definitionId,
          code: dto.code,
          label: dto.label,
          displayOrder: dto.displayOrder,
        });
        return toOptionResponse(created);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('An option with this code already exists for this attribute.');
        }
        throw error;
      }
    });
  }

  async updateOption(
    tenantId: string,
    definitionId: string,
    optionId: string,
    dto: UpdateAttributeOptionDto,
  ): Promise<AttributeOptionResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const existing = await this.attributesRepository.findOptionById(tx, tenantId, optionId);
      if (!existing || existing.attributeDefinitionId !== definitionId) {
        throw new NotFoundException('Attribute option not found.');
      }
      const updated = await this.attributesRepository.updateOption(tx, tenantId, optionId, {
        ...(dto.label !== undefined ? { label: dto.label } : {}),
        ...(dto.displayOrder !== undefined ? { displayOrder: dto.displayOrder } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      });
      if (!updated) {
        throw new NotFoundException('Attribute option not found.');
      }
      return toOptionResponse(updated);
    });
  }

  async listUnits(tenantId: string): Promise<MeasurementUnitResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const rows = await this.attributesRepository.listUnits(tx);
      return rows.map((row: MeasurementUnitRow) => ({ id: row.id, code: row.code, label: row.label, dimension: row.dimension }));
    });
  }

  /** database.md's attribute_definitions CHECK constraints, enforced here too for a clean 400
   * before ever reaching Postgres's constraint error — the DB stays the ultimate backstop. */
  private assertNumericOnlyFields(
    dataType: string,
    dto: { unitId?: string | undefined; minValue?: number | undefined; maxValue?: number | undefined },
  ): void {
    if (NUMERIC_TYPES.has(dataType)) {
      if (dto.minValue !== undefined && dto.maxValue !== undefined && dto.minValue > dto.maxValue) {
        throw new BadRequestException('minValue must be <= maxValue.');
      }
      return;
    }
    if (dto.unitId !== undefined) {
      throw new BadRequestException('unitId only applies to number/decimal attributes.');
    }
    if (dto.minValue !== undefined || dto.maxValue !== undefined) {
      throw new BadRequestException('minValue/maxValue only apply to number/decimal attributes.');
    }
  }
}
