import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { AUTH_CONFIG, type AuthConfig } from '../../common/config/auth-config';

/**
 * Password hashing — Argon2id (security.md#authentication's preferred choice), never a fast
 * general-purpose hash (MD5/SHA-*) and never reversible encryption. Cost parameters are
 * configurable via env (AUTH_CONFIG.argon2), not hardcoded, per CLAUDE.md §7.4/§20.
 */
@Injectable()
export class PasswordService {
  constructor(@Inject(AUTH_CONFIG) private readonly authConfig: AuthConfig) {}

  async hash(plainPassword: string): Promise<string> {
    return argon2.hash(plainPassword, {
      type: argon2.argon2id,
      memoryCost: this.authConfig.argon2.memoryCostKib,
      timeCost: this.authConfig.argon2.timeCost,
      parallelism: this.authConfig.argon2.parallelism,
    });
  }

  async verify(passwordHash: string, plainPassword: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, plainPassword);
    } catch {
      // argon2.verify throws on a malformed/foreign hash (e.g. the seed script's
      // `unset:<random>` placeholder, database/seeds/demo-tenant.ts) rather than returning false
      // — treat that identically to "wrong password", never a distinct error a caller could use
      // to enumerate accounts with an unusable hash.
      return false;
    }
  }
}
