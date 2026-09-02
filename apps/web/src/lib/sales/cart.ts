import { serverApiFetch } from '../api/server';
import { isApiError } from '../api/errors';
import type { Cart } from '../types/sales';

/**
 * Server-side read of the caller's open cart (`GET /api/v1/cart`, permission `sales.carts.manage`).
 * The backend returns `404` when the vendor has no open cart yet — that is the normal "start a new
 * sale" state, not an error, so it is mapped to `null`. Every cart mutation (create / set customer /
 * add / update / remove line) goes through `apiFetch` in the New Sale client component and returns
 * the full updated cart.
 */
export async function getActiveCart(): Promise<Cart | null> {
  try {
    return await serverApiFetch<Cart>('/api/v1/cart');
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      return null;
    }
    throw error;
  }
}
