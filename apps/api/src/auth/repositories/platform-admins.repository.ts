import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { PLATFORM_DATABASE } from '../../database/database.module';
import type { PlatformDatabase } from '../../database/platform-client';
import { platformAdmins } from '../../database/schema';

export interface PlatformAdminRow {
  id: string;
  email: string;
  passwordHash: string;
  fullName: string;
  status: string;
  createdAt: Date;
}

/**
 * The one repository touching `platform_admins` (multi-tenancy.md#superadmin-vs-tenant — a
 * structurally separate identity table, never a view over `users`). No `create`/registration
 * method: per multi-tenancy.md's "narrow, explicit... not 'log in as any tenant user' by default"
 * posture, platform admins are provisioned out-of-band (direct database access / a future
 * dedicated seed, not a public endpoint this phase adds) — see docs/decisions (ADR proposed by
 * this phase's final report) for why self-service SuperAdmin creation is deliberately not built.
 */
@Injectable()
export class PlatformAdminsRepository {
  constructor(@Inject(PLATFORM_DATABASE) private readonly platformDb: PlatformDatabase) {}

  async findByEmail(email: string): Promise<PlatformAdminRow | undefined> {
    const [row] = await this.platformDb.select().from(platformAdmins).where(eq(platformAdmins.email, email));
    return row;
  }

  async findById(id: string): Promise<PlatformAdminRow | undefined> {
    const [row] = await this.platformDb.select().from(platformAdmins).where(eq(platformAdmins.id, id));
    return row;
  }
}
