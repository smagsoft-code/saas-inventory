'use client';

import { useRouter } from 'next/navigation';
import type { HomeLocationOption } from '../../lib/home/dashboard';
import { Select } from '../../components/ui/input';

/**
 * The Almacén filter on Home — rendered in the page header, level with the welcome message and
 * aligned right. It only offers the locations the user is authorized for (resolved server-side from
 * `GET /inventory/location-scope`). Narrows every card at once — navigating with a new `locationId`
 * search param and letting the server component re-fetch, the same navigate-and-refetch pattern
 * every other report filter in this app uses.
 */
export function HomeLocationFilter({
  options,
  selectedLocationId,
  chartYear,
}: {
  options: HomeLocationOption[];
  selectedLocationId?: string;
  /** The year picked in the trend chart, kept when the Almacén changes. */
  chartYear?: string;
}): React.JSX.Element {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
      <span className="whitespace-nowrap">Almacén</span>
      <Select
        className="w-full min-w-48 sm:w-64"
        value={selectedLocationId ?? ''}
        onChange={(e) => {
          const params = new URLSearchParams();
          if (chartYear) {
            params.set('year', chartYear);
          }
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
    </label>
  );
}
