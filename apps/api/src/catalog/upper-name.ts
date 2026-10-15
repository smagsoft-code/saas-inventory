/**
 * Product and category names are always stored in UPPERCASE (owner decision). Applied in the
 * repositories — the one place every write goes through (HTTP, Excel import, any future caller) — so
 * the rule cannot be bypassed by a code path that forgets it. `toUpperCase` handles accents
 * (`ñ` → `Ñ`, `á` → `Á`) independently of the database's locale.
 */
export function upperName(name: string): string {
  return name.trim().toUpperCase();
}
