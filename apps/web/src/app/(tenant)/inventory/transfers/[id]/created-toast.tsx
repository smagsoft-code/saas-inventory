'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Toast } from '../../../../../components/ui/toast';

/** Shows the "transferencia creada" toast once, right after `transfer-form.tsx`'s
 * `router.push(...?created=1)` — then strips the query param on dismiss so a later reload/share of
 * this URL never re-shows it. */
export function CreatedToast({ show }: { show: boolean }): React.JSX.Element | null {
  const router = useRouter();
  const pathname = usePathname();
  const [dismissed, setDismissed] = useState(false);

  if (!show || dismissed) {
    return null;
  }

  return (
    <Toast
      message="Transferencia creada correctamente."
      onDismiss={() => {
        setDismissed(true);
        router.replace(pathname);
      }}
    />
  );
}
