import { serverApiFetch } from '../api/server';
import type { PaginatedUsers } from '../types/core';

/**
 * `GET /api/v1/users` (`core.users.read`), paginated — used by `/users` itself and, here, to
 * resolve an actor id to a display name elsewhere (e.g. the movements history's "Usuario" column,
 * `GAP-NAME-ENRICHMENT`). See `buildUserIndex` below for the bounded-fetch, permission-gated
 * resolver, mirroring `lib/inventory/location-index.ts`'s `buildLocationIndex`.
 */
export async function listUsers(params: { page?: number; pageSize?: number; q?: string } = {}): Promise<PaginatedUsers> {
  return serverApiFetch<PaginatedUsers>('/api/v1/users', {
    query: { page: params.page ?? 1, pageSize: params.pageSize ?? 100, ...(params.q ? { q: params.q } : {}) },
  });
}

export interface UserIndex {
  /** Resolves an actor id to their full name, falling back to a short id when the caller lacks
   * `core.users.read` or the id isn't found (e.g. a since-removed user). */
  userName: (id: string) => string;
}

export async function buildUserIndex(canViewUsers: boolean): Promise<UserIndex> {
  const users = canViewUsers ? await listUsers({ pageSize: 100 }).catch(() => null) : null;
  const nameById = new Map((users?.data ?? []).map((u) => [u.id, u.fullName]));
  return {
    userName: (id) => nameById.get(id) ?? (id.length > 8 ? `${id.slice(0, 8)}…` : id),
  };
}
