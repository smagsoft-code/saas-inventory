/**
 * The two letters shown in the sidebar badge when a company has no logo.
 *  - Two words or more: the first letter of the first two words ("Muebles del Norte" → "MD").
 *  - A single word: its first two letters ("Acme" → "AC"; a one-letter word → that letter).
 * Letters are taken by code point (an accented or emoji initial is never cut in half) and
 * upper-cased. An empty name gives "?" rather than an empty badge.
 */
export function companyInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = words[0];
  if (!first) return '?';
  const letters = words.length >= 2 ? [firstChar(first), firstChar(words[1] ?? '')] : Array.from(first).slice(0, 2);
  return letters.join('').toLocaleUpperCase('es');
}

function firstChar(word: string): string {
  return Array.from(word)[0] ?? '';
}
