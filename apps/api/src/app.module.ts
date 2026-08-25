import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CatalogModule } from './catalog/catalog.module';
import { CommonModule } from './common/common.module';
import { CoreModule } from './core/core.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { InventoryModule } from './inventory/inventory.module';
import { QrModule } from './qr/qr.module';

@Module({
  imports: [CommonModule, DatabaseModule, HealthModule, AuthModule, CoreModule, CatalogModule, InventoryModule, QrModule],
})
export class AppModule {}
