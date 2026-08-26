/**
 * SALES money policy (§29-§31): monetary columns are `numeric` in Postgres (database.md#orders),
 * carried as JS `number` at the application boundary and persisted back as decimal strings — the
 * exact same convention `catalog` already uses for `product_variants.max_price` etc.
 * (`String(dto.maxPrice)`), not a new one.
 *
 * ONE rounding policy, applied everywhere a monetary result is produced: half-up to 2 decimal
 * places. `Number.EPSILON` nudges values like `1.005` off the binary-representation boundary so
 * they round the way a human expects. There is no tax engine in this phase (§31) — `tax_total` is
 * always 0, so no fiscal rounding rules apply.
 */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** The decimal string form persisted into a `numeric` column. */
export function moneyString(value: number): string {
  return roundMoney(value).toFixed(2);
}
