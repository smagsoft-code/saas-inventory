/** Emails are compared/stored case-insensitively (a deliberate normalization, not an implicit
 * one) — trims whitespace and lowercases before every lookup or insert. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function normalizeSlug(slug: string): string {
  return slug.trim().toLowerCase();
}
