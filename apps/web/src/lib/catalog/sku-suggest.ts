import { apiFetch } from '../api/client';

/** First (up to) 3 letters of a category name, accent-stripped and uppercased, for the SKU prefix
 * (`CAR-001` for "Carpintería") — a plain display transform, no new backend field. */
export function categorySkuPrefix(categoryName: string): string {
  const lettersOnly = categoryName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z]/g, '');
  return lettersOnly.slice(0, 3).toUpperCase();
}

/** Suggests the next `PREFIX-NNN` SKU for a category from its existing variants — a best-effort
 * convenience, not a guarantee: bounded to the first 100 rows (same convention as every other list
 * in this app), and the backend's own unique-SKU constraint is what actually prevents a collision.
 * If two people create a product in the same category at once, or the category already has more
 * than 100 SKUs, the suggested number can collide — the caller's existing 409 handling covers that,
 * and the field stays fully editable. */
export async function suggestNextSku(categoryId: string, prefix: string): Promise<string> {
  if (!prefix) {
    return '';
  }
  const page = await apiFetch<{ data: { sku: string }[] }>('/api/v1/reports/product-catalog', {
    query: { categoryId, pageSize: 100 },
  });
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  let maxNumber = 0;
  for (const row of page.data) {
    const match = pattern.exec(row.sku);
    if (match) {
      maxNumber = Math.max(maxNumber, Number(match[1]));
    }
  }
  return `${prefix}-${String(maxNumber + 1).padStart(3, '0')}`;
}
