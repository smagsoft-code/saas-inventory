'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import { CATEGORY_SLUG_PATTERN, type Category } from '../../../lib/types/catalog';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

const CATEGORIES_PATH = '/api/v1/categories';

function slugify(value: string): string {
  // A best-effort suggestion only — the field stays editable and the backend validates the
  // final value against CATEGORY_SLUG_PATTERN.
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export interface ParentOption {
  id: string;
  name: string;
}

/**
 * Create / edit a category. Sends exactly the real DTO fields — `POST /categories` (create,
 * `categories.manage`) or `PATCH /categories/:id` (edit). `status` only exists on edit
 * (`UpdateCategoryDto`). Client validation mirrors the backend (`Length(2,120)`, slug pattern);
 * the backend is the authority for slug uniqueness, parent existence and self-parent.
 */
export function CategoryForm({
  mode,
  category,
  parentOptions,
}: {
  mode: 'create' | 'edit';
  category?: Category;
  parentOptions: ParentOption[];
}): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState(category?.name ?? '');
  const [slug, setSlug] = useState(category?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(mode === 'edit');
  const [parentId, setParentId] = useState(category?.parentCategoryId ?? '');
  const [status, setStatus] = useState<'active' | 'inactive'>(
    (category?.status as 'active' | 'inactive') ?? 'active',
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; slug?: string }>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  const dirty = useMemo(() => {
    if (mode === 'create') {
      return name.trim().length > 0;
    }
    return (
      name.trim() !== category?.name ||
      effectiveSlug !== category?.slug ||
      (parentId || undefined) !== (category?.parentCategoryId ?? undefined) ||
      status !== category?.status
    );
  }, [mode, name, effectiveSlug, parentId, status, category]);

  function validate(): boolean {
    const next: { name?: string; slug?: string } = {};
    if (name.trim().length < 2 || name.trim().length > 120) {
      next.name = 'El nombre debe tener 2–120 caracteres.';
    }
    if (!CATEGORY_SLUG_PATTERN.test(effectiveSlug) || effectiveSlug.length < 2) {
      next.slug = 'El slug debe tener minúsculas, números y guiones.';
    }
    setFieldError(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (submitting || !dirty) {
      return;
    }
    if (!validate()) {
      return;
    }
    setError(null);
    setSuccess(false);
    setSubmitting(true);
    try {
      if (mode === 'create') {
        const created = await apiFetch<Category>(CATEGORIES_PATH, {
          method: 'POST',
          body: {
            name: name.trim(),
            slug: effectiveSlug,
            ...(parentId ? { parentCategoryId: parentId } : {}),
          },
        });
        router.replace(`/categories/${created.id}`);
        router.refresh();
        return;
      }
      // edit — only send changed fields
      const body: Record<string, unknown> = {};
      if (name.trim() !== category?.name) body['name'] = name.trim();
      if (effectiveSlug !== category?.slug) body['slug'] = effectiveSlug;
      if ((parentId || undefined) !== (category?.parentCategoryId ?? undefined)) {
        body['parentCategoryId'] = parentId || undefined;
      }
      if (status !== category?.status) body['status'] = status;
      await apiFetch<Category>(`${CATEGORIES_PATH}/${category!.id}`, { method: 'PATCH', body });
      setSuccess(true);
      setSlugTouched(true);
      router.refresh();
    } catch (err) {
      if (isApiError(err) && err.status === 403) {
        setError('Ya no tienes permiso para hacer este cambio.');
      } else {
        setError(httpErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-md flex-col gap-4">
      <Field label="Nombre" required {...(fieldError.name ? { error: fieldError.name } : {})}>
        <Input
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSuccess(false);
          }}
        />
      </Field>

      <Field
        label="Slug"
        required
        hint="Minúsculas, números y guiones. Único dentro de la empresa."
        {...(fieldError.slug ? { error: fieldError.slug } : {})}
      >
        <Input
          required
          value={effectiveSlug}
          onChange={(e) => {
            setSlug(e.target.value);
            setSlugTouched(true);
            setSuccess(false);
          }}
        />
      </Field>

      <Field label="Categoría padre" hint="Opcional. Deja «Ninguna» para una categoría de nivel superior.">
        <Select
          value={parentId}
          onChange={(e) => {
            setParentId(e.target.value);
            setSuccess(false);
          }}
        >
          <option value="">Ninguna</option>
          {parentOptions
            .filter((p) => p.id !== category?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
      </Field>

      {mode === 'edit' && (
        <Field label="Estado">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as 'active' | 'inactive');
              setSuccess(false);
            }}
          >
            <option value="active">Activa</option>
            <option value="inactive">Inactiva</option>
          </Select>
        </Field>
      )}

      {error && <Alert tone="error">{error}</Alert>}
      {success && <Alert tone="success">Categoría guardada.</Alert>}

      <div className="flex gap-2">
        <Button type="submit" loading={submitting} disabled={!dirty} className="w-fit">
          {mode === 'create' ? 'Crear categoría' : 'Guardar cambios'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-fit"
          onClick={() => router.push('/categories')}
        >
          {mode === 'create' ? 'Cancelar' : 'Volver a categorías'}
        </Button>
      </div>
    </form>
  );
}
