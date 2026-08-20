import { Module } from '@nestjs/common';
import { AuditLogService } from '../common/audit/audit-log.service';
import { AttributesController } from './categories/attributes.controller';
import { AttributesService } from './categories/attributes.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { ProductsController } from './products/products.controller';
import { ProductsService } from './products/products.service';
import { AttributeValidationService } from './products/attribute-validation.service';
import { AttributesRepository } from './repositories/attributes.repository';
import { CategoriesRepository } from './repositories/categories.repository';
import { ProductsRepository } from './repositories/products.repository';

/**
 * modules.md#catalog — products, variants, categories, and the dynamic-attribute governance layer
 * (Prompt 06). Depends only on CORE (tenant scoping via CurrentTenant/withTenantTransaction, audit
 * via AuditLogService) — deliberately no dependency on INVENTORY/SALES/QR/IMPORT, per modules.md's
 * "CATALOG itself keeps its single, simple Catalog --> Core dependency edge". AuditLogService is
 * registered here the same way CoreModule registers it alongside AuthModule's own registration
 * (each module gets its own stateless instance of the same class, not a competing implementation).
 */
@Module({
  controllers: [CategoriesController, AttributesController, ProductsController],
  providers: [
    CategoriesService,
    AttributesService,
    ProductsService,
    AttributeValidationService,
    AuditLogService,
    CategoriesRepository,
    AttributesRepository,
    ProductsRepository,
  ],
})
export class CatalogModule {}
