'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '../../../../../../lib/api/client';
import { httpErrorMessage } from '../../../../../../lib/api/errors';
import { Button } from '../../../../../../components/ui/button';

/**
 * SUPPORT_WRITE's one curated action (ADR-0036 §9) — `PATCH .../support/warehouses/:id/status`.
 * Requires an active `write`-mode session for this tenant; the backend re-checks that on every
 * call via `SupportSessionGuard` regardless of what this button renders. Always audited
 * server-side, including a no-op toggle to the same status.
 */
export function WarehouseStatusToggle({
  tenantId,
  warehouseId,
  status,
  writable,
}: {
  tenantId: string;
  warehouseId: string;
  status: string;
  writable: boolean;
}): React.JSX.Element {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = status === 'active' ? 'inactive' : 'active';

  async function toggle(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/v1/platform/tenants/${tenantId}/support/warehouses/${warehouseId}/status`, {
        method: 'PATCH',
        body: { status: next },
      });
      router.refresh();
    } catch (err) {
      setError(httpErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!writable) {
    return <span className="text-xs text-slate-400">Requiere modo intervención</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="secondary" size="sm" loading={busy} disabled={busy} onClick={() => void toggle()}>
        {status === 'active' ? 'Desactivar' : 'Activar'}
      </Button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
