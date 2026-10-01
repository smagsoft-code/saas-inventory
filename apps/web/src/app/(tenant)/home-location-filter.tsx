'use client';

import { useRouter } from 'next/navigation';
import type { HomeLocationOption } from '../../lib/home/dashboard';
import { Field } from '../../components/ui/field';
import { Select } from '../../components/ui/input';

/**
 * The Almacén filter at the top of Home (OUI-002). Narrows every card at once — navigating with a
 * new `locationId` search param and letting the server component re-fetch, the same
 * navigate-and-refetch pattern every other report filter in this app uses (no client-side
 * re-fetch of its own).
 */
export function HomeLocationFilter({
  options,
  selectedLocationId,
}: {
  options: HomeLocationOption[];
  selectedLocationId?: string;
}): React.JSX.Element {
  const router = useRouter();

  return (
    <Field label="Almacén" className="max-w-xs">
      <Select
        value={selectedLocationId ?? ''}
        onChange={(e) => {
          const params = new URLSearchParams();
          if (e.target.value) {
            params.set('locationId', e.target.value);
          }
          router.push(`/${params.toString() ? `?${params}` : ''}`);
        }}
      >
        <option value="">Todos los almacenes</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
