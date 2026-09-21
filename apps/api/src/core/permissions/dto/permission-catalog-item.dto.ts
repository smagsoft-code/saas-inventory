import { ApiProperty } from '@nestjs/swagger';

/** One row of the platform-wide `permissions` catalog — never tenant-specific (see
 * database.md#rbac-roles-permissions: "no tenant_id; no RLS"). Backs the role-editor's
 * "group by module" permission picker. */
export class PermissionCatalogItemDto {
  @ApiProperty({ type: String })
  code!: string;

  @ApiProperty({ type: String, description: 'Grouping used by the permission picker UI, e.g. "sales", "inventory".' })
  module!: string;

  @ApiProperty({ type: String })
  description!: string;
}
