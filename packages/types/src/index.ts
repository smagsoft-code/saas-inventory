/**
 * Cross-cutting, domain-agnostic type contracts shared between apps.
 * Business/domain types (products, inventory, tenants, ...) are added
 * once the corresponding modules are designed — not in this foundation phase.
 */

export type Nullable<T> = T | null;

export type Optional<T> = T | undefined;

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ApiErrorShape {
  statusCode: number;
  message: string;
  code: string;
  correlationId?: string;
}
