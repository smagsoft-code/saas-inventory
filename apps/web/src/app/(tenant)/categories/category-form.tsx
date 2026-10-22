'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, type FormEvent } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage, isApiError } from '../../../lib/api/errors';
import {
  CATEGORY_CODE_MAX,
  CATEGORY_CODE_MIN,
  CATEGORY_CODE_PATTERN,
  type Category,
} from '../../../lib/types/catalog';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';
import { Field } from '../../../components/ui/field';
import { Input, Select } from '../../../components/ui/input';

const CATEGORIES_PATH = '/api/v1/categories';

export interface ParentOption {
  id: string;
  name: string;
}

/**
 * Create / edit a category. Sends exactly the real DTO fields — `POST /categories` (create,
 * `categories.manage`) or `PATCH /categories/:id` (edit). `status` only exists on edit
 * (`UpdateCategoryDto`). Client validation mirrors the backend (`Length(2,120)`, code pattern);
 * the backend is the authority for code uniqueness (case-insensitive), parent existence and
 * self-parent.
 *
 * The code is proposed automatically (`CAT-001`, …) and stays editable. On create, if the user leaves
 * the proposal untouched no code is sent and the server assigns the real next one (so two people
 * creating categories at once never collide); a code the user typed or changed is sent as is.
 */
export function CategoryForm({
  mode,
  category,
  parentOptions,
  suggestedCode = '',
}: {
  mode: 'create' | 'edit';
  category?: Category;
  parentOptions: ParentOption[];
  /** Create mode: the proposed next code, pre-filled in the field. */
  suggestedCode?: string;
}): React.JSX.Element {
  const router = useRouter();
  const [name, setName] = useState(category?.name ?? '');
  const [code, setCode] = useState(category?.code ?? suggestedCode);
  const [parentId, setParentId] = useState(category?.parentCategoryId ?? '');
  const [status, setStatus] = useState<'active' | 'inactive'>(
    (category?.status as 'active' | 'inactive') ?? 'active',
  );
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ name?: string; code?: string }>({});
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const trimmedCode = code.trim();
  // Create mode: the untouched proposal is not sent — the server assigns the real next code.
  const codeIsProposal = mode === 'create' && trimmedCode === suggestedCode;

  const dirty = useMemo(() => {
    if (mode === 'create') {
      return name.trim().length > 0;
    }
    return (
      name.trim() !== category?.name ||
      trimmedCode !== category?.code ||
      (parentId || undefined) !== (category?.parentCategoryId ?? undefined) ||
      status !== category?.status
    );
  }, [mode, name, trimmedCode, parentId, status, category]);

  function validate(): boolean {
    const next: { name?: string; code?: string } = {};
    if (name.trim().length < 2 || name.trim().length > 120) {
      next.name = 'El nombre debe tener 2–120 caracteres.';
    }
    // An untouched proposal is not validated: the server assigns the real code.
    if (
      !codeIsProposal &&
      (!CATEGORY_CODE_PATTERN.test(trimmedCode) ||
      trimmedCode.length < CATEGORY_CODE_MIN ||
      trimmedCode.length > CATEGORY_CODE_MAX)
    ) {
      next.code = 'El código debe tener letras, números y guiones (sin espacios), de 2 a 60 caracteres.';
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
            ...(codeIsProposal ? {} : { code: trimmedCode }),
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
      if (trimmedCode !== category?.code) body['code'] = trimmedCode;
      if ((parentId || undefined) !== (category?.parentCategoryId ?? undefined)) {
        body['parentCategoryId'] = parentId || undefined;
      }
      if (status !== category?.status) body['status'] = status;
      await apiFetch<Category>(`${CATEGORIES_PATH}/${category!.id}`, { method: 'PATCH', body });
      setSuccess(true);
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
          className="uppercase"
          value={name}
          onChange={(e) => {
            // Category names are always stored in capitals.
            setName(e.target.value.toUpperCase());
            setSuccess(false);
          }}
        />
      </Field>

      <Field
        label="Código"
        required
        help="Se propone automáticamente (CAT-001, CAT-002…) y puedes cambiarlo. Letras, números y guiones; único dentro de la empresa."
        {...(fieldError.code ? { error: fieldError.code } : {})}
      >
        <Input
          required
          maxLength={CATEGORY_CODE_MAX}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setSuccess(false);
          }}
        />
      </Field>

      <Field label="Categoría padre" help="Opcional. Deja «Ninguna» para una categoría de nivel superior.">
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
