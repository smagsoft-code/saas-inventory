/**
 * The API's own public origin — never a secret (same posture as this file's sibling `client.ts`'s
 * own doc comment on `API_URL`). Needed wherever a Server Component must hand a Client Component a
 * `{origin}/q/:code` value: the public QR resolver (`GET /q/:code`, `api.md#public-endpoints`) is
 * deliberately never proxied through `next.config.ts`'s `/api/*` rewrite (it is meant to be a
 * short, version-neutral URL embedded in a physical printed label), so it needs the API's real
 * origin, not a same-origin path — OUI-007/OUI-008.
 */
export function apiPublicUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? '';
}
