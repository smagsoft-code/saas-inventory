'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { apiFetch } from '../../../lib/api/client';
import { httpErrorMessage } from '../../../lib/api/errors';
import { companyInitials } from '../../../lib/company-initials';
import { companyLogoUrl } from '../../../components/shell/company-brand';
import { Alert } from '../../../components/ui/alert';
import { Button } from '../../../components/ui/button';

const ACCEPT = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 2 * 1024 * 1024;
/** The sidebar draws the logo in a 28 px square; this is the size to upload so it stays sharp on
 * high-density screens. */
export const LOGO_DIMENSIONS_TEXT = '256x256 px';

/**
 * Configuración → Logo de la empresa (`PUT`/`DELETE /tenant/logo`, `core.tenant.update`). Shows the
 * current logo — or the initials the sidebar uses while there is none — and lets the owner upload a
 * replacement or remove it. The sidebar shows it right after (`router.refresh()` re-reads
 * `GET /tenant`, whose `logoVersion` changes with every upload).
 */
export function CompanyLogoForm({
  companyName,
  logoVersion,
  canManage,
}: {
  companyName: string;
  logoVersion: number | undefined;
  canManage: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onPick(file: File | null): Promise<void> {
    if (!file) return;
    setError(null);
    setMessage(null);
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Elige una imagen JPEG, PNG o WEBP.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('Esa imagen supera el límite de 2 MB.');
      return;
    }
    setBusy('upload');
    try {
      const body = new FormData();
      body.append('file', file);
      await apiFetch('/api/v1/tenant/logo', { method: 'PUT', body });
      setMessage('Logo guardado.');
      router.refresh();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function onRemove(): Promise<void> {
    setError(null);
    setMessage(null);
    setBusy('remove');
    try {
      await apiFetch('/api/v1/tenant/logo', { method: 'DELETE' });
      setMessage('Logo quitado.');
      router.refresh();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex max-w-md flex-col gap-3">
      <div className="flex items-center gap-4">
        <div className="flex flex-col items-center gap-1">
          {logoVersion !== undefined ? (
            <img
              src={companyLogoUrl(logoVersion)}
              alt={`Logo de ${companyName}`}
              className="h-24 w-24 rounded-md border border-slate-200 bg-white object-contain"
            />
          ) : (
            <div
              aria-label="Sin logo: se muestran las iniciales de la empresa"
              className="flex h-24 w-24 items-center justify-center rounded-md bg-slate-900 text-3xl font-bold text-white"
            >
              {companyInitials(companyName)}
            </div>
          )}
          <p className="text-xs text-slate-500">Dimensiones: {LOGO_DIMENSIONS_TEXT}</p>
        </div>

        {canManage ? (
          <div className="flex flex-col gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              aria-label="Elegir logo"
              className="sr-only"
              tabIndex={-1}
              disabled={busy !== null}
              onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="secondary" size="sm" loading={busy === 'upload'} disabled={busy !== null} onClick={() => inputRef.current?.click()}>
              {logoVersion !== undefined ? 'Cambiar logo' : 'Subir logo'}
            </Button>
            {logoVersion !== undefined && (
              <Button type="button" variant="ghost" size="sm" loading={busy === 'remove'} disabled={busy !== null} onClick={() => void onRemove()}>
                Quitar logo
              </Button>
            )}
            <p className="text-xs text-slate-500">JPEG, PNG o WEBP, hasta 2 MB.</p>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No tienes permiso para cambiar el logo.</p>
        )}
      </div>
      {message && <Alert tone="success">{message}</Alert>}
      {error && <Alert tone="error">{error}</Alert>}
    </div>
  );
}
