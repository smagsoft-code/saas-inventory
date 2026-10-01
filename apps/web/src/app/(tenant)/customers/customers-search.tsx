'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Input } from '../../../components/ui/input';

const SEARCH_DEBOUNCE_MS = 350;

/**
 * Live search for `/customers` (owner redesign) — same debounced, no-submit-button behavior as
 * `ProductsFilters`' search box. Matches `q` against firstName/lastName/taxId/email/phone
 * server-side (`ListCustomersQueryDto.q`); no Tipo/Estado filters, no Buscar button here anymore.
 */
export function CustomersSearch({ initialQ }: { initialQ: string }): React.JSX.Element {
  const router = useRouter();
  const [q, setQ] = useState(initialQ);
  const skipNextDebounce = useRef(true);

  useEffect(() => {
    if (skipNextDebounce.current) {
      skipNextDebounce.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      router.push(`/customers${params.toString() ? `?${params}` : ''}`);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <Input
      type="search"
      aria-label="Buscar clientes"
      placeholder="Nombre, apellido o identificación"
      value={q}
      onChange={(e) => setQ(e.target.value)}
      className="min-w-[16rem] max-w-sm"
    />
  );
}
