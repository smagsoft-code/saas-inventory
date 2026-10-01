'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Input } from '../../../components/ui/input';

const SEARCH_DEBOUNCE_MS = 350;

/**
 * The `/users` name search box — closes `GAP-USER-FILTERS`'s name-search half. Debounced
 * (`SEARCH_DEBOUNCE_MS`), same live-search convention `ProductsFilters` established: a real
 * navigation fires once typing pauses, never on every keystroke. Matching is server-side
 * (`GET /users?q=`, `UsersRepository.findManyByTenant`'s `ILIKE '%q%'` on `fullName`), never a
 * client-side filter over an already-paged slice.
 */
export function UsersFilters({ initial }: { initial: { q?: string | undefined } }): React.JSX.Element {
  const router = useRouter();
  const [q, setQ] = useState(initial.q ?? '');
  const skipNextDebounce = useRef(true);

  // Skips the very first render so mounting with an existing `?q=` never re-fires it immediately.
  useEffect(() => {
    if (skipNextDebounce.current) {
      skipNextDebounce.current = false;
      return;
    }
    const timer = setTimeout(() => {
      const trimmed = q.trim();
      const params = new URLSearchParams();
      if (trimmed) params.set('q', trimmed);
      router.push(`/users${params.toString() ? `?${params}` : ''}`);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [q]);

  return (
    <Input
      type="search"
      aria-label="Buscar usuarios por nombre"
      placeholder="Buscar por nombre"
      value={q}
      onChange={(event) => setQ(event.target.value)}
      className="max-w-xs"
    />
  );
}
