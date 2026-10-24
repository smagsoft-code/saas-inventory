'use client';

import { useEffect, useState } from 'react';
import { companyInitials } from '../../lib/company-initials';

/** Same-origin logo URL; `version` (the logo's last change) busts the browser cache on replace. */
export function companyLogoUrl(version: number): string {
  return `/api/v1/tenant/logo?v=${version}`;
}

/** Names up to this long keep the regular size; longer ones step down a size and may take two lines. */
const FULL_SIZE_MAX_CHARS = 14;

/**
 * The top of the tenant sidebar: the company logo — or, without one, a badge with its two initials
 * — followed by the company name. The badge keeps its fixed 28 px square and the name keeps the
 * width it always had: a long name gets a smaller type size and wraps to a second line (clamped at
 * two) instead of widening anything. A logo that fails to load falls back to the initials.
 */
export function CompanyBrand({ name, logoVersion }: { name: string; logoVersion?: number | undefined }): React.JSX.Element {
  const [logoFailed, setLogoFailed] = useState(false);
  // A new version is a new image: give it a fresh chance.
  useEffect(() => setLogoFailed(false), [logoVersion]);
  const showLogo = logoVersion !== undefined && !logoFailed;
  const long = name.length > FULL_SIZE_MAX_CHARS;

  return (
    <div className="flex h-14 items-center gap-3 px-[1.125rem] font-semibold text-slate-900">
      {showLogo ? (
        <img
          src={companyLogoUrl(logoVersion)}
          alt=""
          onError={() => setLogoFailed(true)}
          className="h-7 w-7 shrink-0 rounded-md border border-slate-200 bg-white object-contain"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white"
        >
          {companyInitials(name)}
        </span>
      )}
      <span
        title={name}
        className={`nav-label min-w-0 flex-1 break-words leading-tight ${long ? 'text-xs' : 'text-sm'}`}
        style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
      >
        {name}
      </span>
    </div>
  );
}
