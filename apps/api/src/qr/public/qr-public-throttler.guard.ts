import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Rate limiting for the unauthenticated QR public resolver (threat-model.md#brute-force: "automated
 * credential guessing against login (or, later, the QR public resolver, or any other unauthenticated
 * endpoint)"). Keyed by IP alone — unlike auth/guards/auth-throttler.guard.ts's IP+email compound key
 * (there is no meaningful second identifier to key on here: `code` is exactly the high-entropy value
 * being probed, not a stable per-caller identifier like an email address).
 */
@Injectable()
export class QrPublicThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = typeof req['ip'] === 'string' ? (req['ip'] as string) : 'unknown';
    return ip;
  }
}
