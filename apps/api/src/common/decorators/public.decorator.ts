import { SetMetadata } from '@nestjs/common';

/** Marks a route as not requiring JwtAuthGuard/TenantGuard — api.md#public-endpoints. Does not
 * exempt the route from CsrfGuard; use @SkipCsrf() separately for that (register/login, where no
 * session cookie can exist yet). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
