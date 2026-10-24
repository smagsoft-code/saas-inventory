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
  variant = 'light',
}: {
  options: HomeLocationOption[];
  selectedLocationId?: string;
  /** The year picked in the trend chart, kept when the Almacén changes. */
  chartYear?: string;
  /** `'dark'` = the full-width pill on the phone hero (navy background). */
  variant?: 'light' | 'dark';
}): React.JSX.Element {
  const router = useRouter();

  function onChange(value: string): void {
    const params = new URLSearchParams();
    if (chartYear) {
      params.set('year', chartYear);
    }
    if (value) {
      params.set('locationId', value);
    }
    router.push(`/${params.toString() ? `?${params}` : ''}`, { scroll: false });
  }

  const choices = (
    <>
      <option value="">Todos los almacenes</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </>
  );

  if (variant === 'dark') {
    return (
      <label className="flex h-12 items-center gap-3 rounded-2xl bg-white/10 px-4 text-sm text-slate-300">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 shrink-0" aria-hidden="true">
          <path d="M3 9l9-5 9 5v11H3z" />
          <path d="M7 20v-7h10v7M7 16h10" />
        </svg>
        <span className="shrink-0">Almacén</span>
        <select
          aria-label="Almacén"
          className="min-w-0 flex-1 appearance-none truncate bg-transparent pr-6 font-semibold text-white focus-visible:outline-none [&>option]:text-slate-900"
          value={selectedLocationId ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          {choices}
        </select>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="-ml-8 h-4 w-4 shrink-0" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </label>
    );
  }

  return (
    <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
      <span className="whitespace-nowrap">Almacén</span>
      <Select className="w-full min-w-48 sm:w-64" value={selectedLocationId ?? ''} onChange={(e) => onChange(e.target.value)}>
        {choices}
      </Select>
    </label>
  );
}
