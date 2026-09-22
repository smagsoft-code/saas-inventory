'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../lib/api/client';
import { httpErrorMessage } from '../../lib/api/errors';
import { Button } from '../ui/button';

/** The banner only ever renders `mode` and a countdown to `expiresAt` — a narrow `Pick` so this
 * one component works from either `PlatformShell` (the full `SupportSession` from
 * `getCurrentSupportSession()`) or `AppShell` (the smaller `Session['supportSession']` shape
 * `GET /auth/me` returns for a support principal, ADR-0036 extension) without either caller
 * constructing fields the banner never uses. */
export interface SupportModeBannerSession {
  mode: 'read' | 'write';
  expiresAt: string;
}

/**
 * ADR-0036 §13 — always visible while a `platform_support_sessions` row is `active` for the
 * signed-in platform admin, on EVERY `(superadmin)/` page (not just the support screen itself) —
 * rendered from `PlatformShell`, which every page under that layout composes. A full-width,
 * high-contrast strip, never a tooltip. `[ Salir del modo soporte ]` is the one explicit exit the
 * prompt requires; the backend is the actual authority on expiry (§14) — this banner's own
 * "queda Xm" is informational, recomputed on the next page load, never trusted for enforcement.
 */
export function SupportModeBanner({ session }: { session: SupportModeBannerSession }): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutesLeft = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 60000));

  async function exit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/api/v1/platform/support-sessions/current/end', { method: 'POST' });
      // `push()` alone — no `router.refresh()`. This banner can render inside the TENANT shell
      // (AppShell, ADR-0036 extension), so a trailing `refresh()` here raced Next's reconciliation
      // into re-evaluating the still-mounted `(tenant)/layout.tsx` tree for its OLD segment: with
      // the support session just ended, that layout's own `getSession()` now 403s and calls
      // `redirect('/login')` — a second, competing navigation fired mid-transition against this
      // `push()`'s own `/platform/tenants`, which surfaced as an uncaught error at the root
      // boundary ("Algo salió mal") instead of either destination. `/platform/tenants` is fully
      // dynamic (`(superadmin)/layout.tsx` calls `cookies()`), so `push()` alone already fetches it
      // fresh — no separate refresh was ever needed for correctness, only for this race to exist.
      router.push('/platform/tenants');
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1 border-b border-amber-300 bg-amber-100 px-4 py-2 text-sm text-amber-900 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span aria-hidden="true">⚠</span>
          <strong>MODO SOPORTE</strong>
          <span>
            {session.mode === 'write' ? 'Intervención' : 'Solo lectura'} · vence en ~{minutesLeft} min
          </span>
        </span>
        <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => void exit()}>
          Salir del modo soporte
        </Button>
      </div>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
