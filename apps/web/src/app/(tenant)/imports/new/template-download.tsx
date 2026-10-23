'use client';

import { useState } from 'react';
import { buttonClasses } from '../../../../components/ui/button';
import { Select } from '../../../../components/ui/input';

interface CategoryOption {
  id: string;
  name: string;
}

/**
 * "Descargar plantilla (.xlsx)" — lives in the page header, level with the title, as a primary
 * button. The optional category picker only decides which attribute columns the downloaded file
 * carries (`GET /imports/template?categoryId=`); it is a compact, label-less control next to the
 * button rather than a separate "Plantilla" card. A plain `<a>` (not `next/link`) on purpose: the
 * target is a file download, not a client-side route.
 */
export function TemplateDownload({ categories }: { categories: CategoryOption[] }): React.JSX.Element {
  const [categoryId, setCategoryId] = useState('');
  const href = '/api/v1/imports/template' + (categoryId ? `?categoryId=${encodeURIComponent(categoryId)}` : '');

  return (
    <div className="flex flex-wrap items-center gap-2">
      {categories.length > 0 && (
        <Select
          aria-label="Categoría de la plantilla"
          title="Agrega las columnas de atributos de esa categoría. Opcional."
          className="w-52"
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">General (sin atributos)</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
      )}
      <a href={href} className={buttonClasses('primary')}>
        Descargar plantilla (.xlsx)
      </a>
    </div>
  );
}
