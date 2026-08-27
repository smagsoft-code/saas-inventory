/** Joins truthy class-name fragments. Deliberately tiny — no `clsx`/`tailwind-merge` dependency
 * for a foundation this small (Prompt 016 §21). */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}
