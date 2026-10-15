/** Prefix used when a product has no category (or its name has no letters). */
export const DEFAULT_SKU_PREFIX = 'PRD';

/**
 * The prefix of an automatic product code: the first three letters of the category name, accents
 * removed and uppercased (`ARMARIO CON MALETERO` → `ARM`, `FERRETERÍA` → `FER`). A name with fewer than
 * three letters uses the ones it has (`TV` → `TV`); one with none, or no category at all, uses
 * `PRD`. Always letters only (A–Z), which keeps it safe to use in the sequence query.
 */
export function skuPrefixFromCategoryName(name: string | null | undefined): string {
  const letters = (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase();
  return letters.slice(0, 3) || DEFAULT_SKU_PREFIX;
}
