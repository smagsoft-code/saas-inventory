import { SetMetadata } from '@nestjs/common';

/** Marks a route as exempt from the double-submit CSRF check (security.md#csrf) — reserved for
 * routes where no session cookie can exist yet (register, login), never used to exempt a
 * state-changing route just because it's inconvenient. */
export const SKIP_CSRF_KEY = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);
