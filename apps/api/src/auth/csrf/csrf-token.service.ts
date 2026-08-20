import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';

/** Generates the double-submit CSRF token issued alongside session cookies — see
 * common/guards/csrf.guard.ts for the verification side. */
@Injectable()
export class CsrfTokenService {
  generate(): string {
    return randomBytes(24).toString('base64url');
  }
}
