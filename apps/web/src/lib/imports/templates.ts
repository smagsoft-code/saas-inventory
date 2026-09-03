import { serverApiFetch } from '../api/server';
import type { Paginated } from '../types/pagination';
import type { MappingTemplate } from '../types/imports';

/**
 * Server-side reads for import mapping templates (`GET /api/v1/import-mapping-templates*`,
 * permission `import.execute` — the same single gate as the rest of the pipeline). Create / update
 * / delete go through `apiFetch` in the client editor. `ListMappingTemplatesQueryDto` accepts only
 * `{ page, pageSize }` — no status, no search.
 */
export interface ListMappingTemplatesQuery {
  page?: number;
  pageSize?: number;
}

export async function listMappingTemplates(query: ListMappingTemplatesQuery = {}): Promise<Paginated<MappingTemplate>> {
  return serverApiFetch<Paginated<MappingTemplate>>('/api/v1/import-mapping-templates', {
    query: { page: query.page ?? 1, pageSize: query.pageSize ?? 50 },
  });
}

export async function getMappingTemplate(id: string): Promise<MappingTemplate> {
  return serverApiFetch<MappingTemplate>(`/api/v1/import-mapping-templates/${id}`);
}
