'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../lib/api-client';

export function LogoutButton(): React.JSX.Element {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  async function handleLogout(): Promise<void> {
    setSubmitting(true);
    try {
      // Logout is intentionally best-effort/idempotent on the API side (auth.service.ts) — it
      // always succeeds from the caller's perspective, so no error handling branch is needed here.
      await apiFetch('/api/v1/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <button type="button" onClick={() => void handleLogout()} disabled={submitting} className="text-sm underline">
      {submitting ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
