import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { generateId } from '@saas-inventory/shared';
import type { PaginatedResult } from '@saas-inventory/types';
import { AuditLogService } from '../../common/audit/audit-log.service';
import { withTenantTransaction, type TenantTransaction } from '../../database/tenant-context';
import type { AttributeDefinitionRow } from '../repositories/attributes.repository';
import { AttributesRepository } from '../repositories/attributes.repository';
import type { CategoryRow } from '../repositories/categories.repository';
import { CategoriesRepository } from '../repositories/categories.repository';
import type { AuditMeta } from '../catalog-audit-meta';
import type { CategoryAttributeResponseDto } from './dto/category-attributes.dto';
import type { SetCategoryAttributesDto } from './dto/category-attributes.dto';
import type { CategoryResponseDto } from './dto/category-response.dto';
import type { CreateCategoryDto } from './dto/create-category.dto';
import type { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import type { UpdateCategoryDto } from './dto/update-category.dto';

interface UniqueViolation {
  code: string;
}

function hasUniqueViolationCode(error: unknown): error is UniqueViolation {
  return typeof error === 'object' && error !== null && 'code' in error && (error as UniqueViolation).code === '23505';
}

/** drizzle-orm's postgres-js driver wraps the real Postgres error (carrying `.code`) as
 * `DrizzleQueryError.cause`, never on the thrown error directly — found running this for real
 * against PostgreSQL in Prompt 05-B; the same fix is applied here from the start. */
function isUniqueViolation(error: unknown): boolean {
  if (hasUniqueViolationCode(error)) {
    return true;
  }
  return error instanceof Error && hasUniqueViolationCode(error.cause);
}

function toResponse(category: CategoryRow): CategoryResponseDto {
  return {
    id: category.id,
    parentCategoryId: category.parentCategoryId ?? undefined,
    name: category.name,
    slug: category.slug,
    status: category.status,
    createdAt: category.createdAt.toISOString(),
  };
}

/**
 * Categories + the attribute-governance assignment layer (§13, §32-#category_attributes) within
 * the caller's own tenant. Every method runs inside `withTenantTransaction`, so RLS backstops every
 * query here on top of the explicit tenantId filter, same convention as core/users/users.service.ts.
 */
@Injectable()
export class CategoriesService {
  constructor(
    private readonly categoriesRepository: CategoriesRepository,
    private readonly attributesRepository: AttributesRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(tenantId: string, query: ListCategoriesQueryDto): Promise<PaginatedResult<CategoryResponseDto>> {
    return withTenantTransaction(tenantId, async (tx) => {
      const { rows, total } = await this.categoriesRepository.listByTenant(tx, tenantId, {
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
      });
      return {
        data: rows.map(toResponse),
        meta: {
          page: query.page,
          pageSize: query.pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
        },
      };
    });
  }

  async getById(tenantId: string, categoryId: string): Promise<CategoryResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const category = await this.categoriesRepository.findById(tx, tenantId, categoryId);
      if (!category) {
        throw new NotFoundException('Category not found.');
      }
      return toResponse(category);
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateCategoryDto, meta: AuditMeta): Promise<CategoryResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      if (dto.parentCategoryId) {
        const parent = await this.categoriesRepository.findById(tx, tenantId, dto.parentCategoryId);
        if (!parent) {
          throw new NotFoundException('Parent category not found.');
        }
      }

      let created: CategoryRow;
      try {
        created = await this.categoriesRepository.create(tx, {
          id: generateId(),
          tenantId,
          name: dto.name,
          slug: dto.slug,
          parentCategoryId: dto.parentCategoryId,
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A category with this slug already exists.');
        }
        throw error;
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'category.created',
        entityId: created.id,
        afterState: { name: created.name, slug: created.slug, parentCategoryId: created.parentCategoryId },
        meta,
      });

      return toResponse(created);
    });
  }

  async update(
    tenantId: string,
    actorId: string,
    categoryId: string,
    dto: UpdateCategoryDto,
    meta: AuditMeta,
  ): Promise<CategoryResponseDto> {
    return withTenantTransaction(tenantId, async (tx) => {
      const before = await this.categoriesRepository.findById(tx, tenantId, categoryId);
      if (!before) {
        throw new NotFoundException('Category not found.');
      }

      if (dto.parentCategoryId !== undefined) {
        if (dto.parentCategoryId === categoryId) {
          throw new BadRequestException('A category cannot be its own parent.');
        }
        const parent = await this.categoriesRepository.findById(tx, tenantId, dto.parentCategoryId);
        if (!parent) {
          throw new NotFoundException('Parent category not found.');
        }
      }

      let updated: CategoryRow | undefined;
      try {
        updated = await this.categoriesRepository.update(tx, tenantId, categoryId, {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
          ...(dto.parentCategoryId !== undefined ? { parentCategoryId: dto.parentCategoryId } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new ConflictException('A category with this slug already exists.');
        }
        throw error;
      }
      if (!updated) {
        throw new NotFoundException('Category not found.');
      }

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'category.updated',
        entityId: categoryId,
        beforeState: { name: before.name, slug: before.slug, status: before.status },
        afterState: { name: updated.name, slug: updated.slug, status: updated.status },
        meta,
      });

      return toResponse(updated);
    });
  }

  async getAttributes(tenantId: string, categoryId: string): Promise<CategoryAttributeResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const category = await this.categoriesRepository.findById(tx, tenantId, categoryId);
      if (!category) {
        throw new NotFoundException('Category not found.');
      }
      return this.loadAttributes(tx, tenantId, categoryId);
    });
  }

  /** Shared by getAttributes() (its own transaction) and setAttributes() (reuses the caller's
   * already-open transaction) — never opens a second, nested transaction from inside one that's
   * already open, which would run outside the first one's uncommitted writes. */
  private async loadAttributes(
    tx: TenantTransaction,
    tenantId: string,
    categoryId: string,
  ): Promise<CategoryAttributeResponseDto[]> {
    const [assignments, definitions] = await Promise.all([
      this.attributesRepository.listCategoryAttributes(tx, tenantId, categoryId),
      this.attributesRepository.listDefinitionsByTenant(tx, tenantId),
    ]);
    const definitionsById = new Map<string, AttributeDefinitionRow>(definitions.map((def) => [def.id, def]));
    return assignments.flatMap((assignment) => {
      const def = definitionsById.get(assignment.attributeDefinitionId);
      if (!def) {
        return [];
      }
      return [
        {
          attributeDefinitionId: def.id,
          code: def.code,
          name: def.name,
          dataType: def.dataType,
          isRequired: assignment.isRequired ?? def.isRequiredDefault,
          displayOrder: assignment.displayOrder,
        },
      ];
    });
  }

  async setAttributes(
    tenantId: string,
    actorId: string,
    categoryId: string,
    dto: SetCategoryAttributesDto,
    meta: AuditMeta,
  ): Promise<CategoryAttributeResponseDto[]> {
    return withTenantTransaction(tenantId, async (tx) => {
      const category = await this.categoriesRepository.findById(tx, tenantId, categoryId);
      if (!category) {
        throw new NotFoundException('Category not found.');
      }

      for (const entry of dto.entries) {
        const definition = await this.attributesRepository.findDefinitionById(tx, tenantId, entry.attributeDefinitionId);
        if (!definition) {
          throw new NotFoundException(`Attribute definition "${entry.attributeDefinitionId}" not found.`);
        }
      }

      await this.attributesRepository.replaceCategoryAttributes(tx, tenantId, categoryId, dto.entries);

      await this.writeAudit(tx, {
        tenantId,
        actorId,
        actionCode: 'category.attributes_changed',
        entityId: categoryId,
        afterState: { attributeDefinitionIds: dto.entries.map((entry) => entry.attributeDefinitionId) },
        meta,
      });

      return this.loadAttributes(tx, tenantId, categoryId);
    });
  }

  private async writeAudit(
    tx: TenantTransaction,
    input: {
      tenantId: string;
      actorId: string;
      actionCode: string;
      entityId: string;
      beforeState?: Record<string, unknown>;
      afterState?: Record<string, unknown>;
      meta: AuditMeta;
    },
  ): Promise<void> {
    try {
      await this.auditLogService.record(tx, {
        tenantId: input.tenantId,
        actorId: input.actorId,
        actionCode: input.actionCode,
        entityType: 'category',
        entityId: input.entityId,
        beforeState: input.beforeState,
        afterState: input.afterState,
        correlationId: input.meta.correlationId,
        ipAddress: input.meta.ipAddress,
      });
    } catch {
      // Best-effort — an audit write failure must never block the primary operation, same
      // convention as core/users/users.service.ts's writeAudit().
    }
  }
}
