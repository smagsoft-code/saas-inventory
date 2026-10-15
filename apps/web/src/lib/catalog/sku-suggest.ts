import { apiFetch } from '../api/client';

/**
 * The next automatic product code for a category: its first three letters plus a sequence number
 * (`ARM-001`, `ARM-002`, … — `PRD-001` without a category). The sequence is evaluated by the server
 * across **every category that shares that prefix** ("ARMARIO CON MALETERO" and "ARMARIO SIN MALETERO"
 * both use `ARM` and never repeat a number). A *preview* of `GET /api/v1/products/next-sku`: when the
 * user leaves the proposal untouched the form sends no code and the server assigns the real next one
 * atomically, so two people creating products at once never collide.
 */
export async function fetchNextSku(categoryId?: string): Promise<string> {
  const response = await apiFetch<{ code: string }>('/api/v1/products/next-sku', {
    ...(categoryId ? { query: { categoryId } } : {}),
  });
  return response.code;
}
