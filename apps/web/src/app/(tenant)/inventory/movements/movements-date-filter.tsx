'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Field } from '../../../../components/ui/field';
import { Input } from '../../../../components/ui/input';

export interface MovementsDateFilterValues {
  occurredFrom?: string | undefined;
  occurredTo?: string | undefined;
}

/**
 * F18-03 (`GAP-MOVEMENTS-DATE-FILTER`, resolved) — `occurredFrom`/`occurredTo` on
 * `GET /inventory/movements`, half-open `[occurredFrom, occurredTo)`. Same navigate-and-let-the-
 * server-refetch pattern as the location/type filter chips already on this page: no client-side
 * fetching, no loading spinner of its own. "To" is sent as the start of the *next* day so the
 * picked end date is fully included (same convention as `SalesReportFilters`, F18-02).
 *
 * Reads the current URL's search params itself (`useSearchParams`) rather than taking a
 * server-built `buildHref` callback prop — a plain function cannot cross the Server->Client
 * Component boundary (React throws at render: "Functions cannot be passed directly to Client
 * Components"), only serializable props can. Self-contained here instead, mirroring every other
 * filter change on this page: a date change resets `page` to 1, same as the location/type chips.
 */
export function MovementsDateFilter({ initial }: { initial: MovementsDateFilterValues }): React.JSX.Element {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [from, setFrom] = useState(initial.occurredFrom?.slice(0, 10) ?? '');
  const [to, setTo] = useState(initial.occurredTo?.slice(0, 10) ?? '');

  function nextDayStart(dateOnly: string): string {
    const d = new Date(`${dateOnly}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString();
  }

  function apply(next: { from?: string; to?: string }): void {
    const nextFrom = next.from ?? from;
    const nextTo = next.to ?? to;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('page');
    if (nextFrom) {
      params.set('occurredFrom', `${nextFrom}T00:00:00.000Z`);
    } else {
      params.delete('occurredFrom');
    }
    if (nextTo) {
      params.set('occurredTo', nextDayStart(nextTo));
    } else {
      params.delete('occurredTo');
    }
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:max-w-md">
      <Field label="From" hint="Occurred on or after">
        <Input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => {
            setFrom(e.target.value);
            apply({ from: e.target.value });
          }}
        />
      </Field>
      <Field label="To" hint="Up to and including">
        <Input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => {
            setTo(e.target.value);
            apply({ to: e.target.value });
          }}
        />
      </Field>
    </div>
  );
}
