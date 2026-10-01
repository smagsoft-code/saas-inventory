import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/**
 * Thin, semantic wrappers over `<table>` (F17-03 §19 / §21) — consistent borders, header style and
 * row hover, no data logic. Wide content scrolls inside its own container; the page never scrolls
 * horizontally.
 *
 * Dark header (`bg-slate-900` / white `TH` text) is the one shared look every table in the app
 * gets automatically — first established for the Kardex/movements tables, now the default here so
 * every other table matches it without each page re-declaring its own header override. A caller's
 * own `className` on `TH` is still additive (e.g. `text-right` for a numeric column) — just never a
 * second `text-*`/`bg-*` color utility, which would silently race this one for the same CSS
 * property (no `tailwind-merge` in this project, `lib/cn.ts`'s own header comment).
 */
export function Table({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-slate-200">
      <table className={cn('w-full border-collapse text-sm', className)}>{children}</table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }): React.JSX.Element {
  return <thead className="bg-slate-900 text-left">{children}</thead>;
}

export function TBody({ children, className }: { children: ReactNode; className?: string }): React.JSX.Element {
  return <tbody className={cn('divide-y divide-slate-100', className)}>{children}</tbody>;
}

export function TR({
  children,
  className,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { children: ReactNode }): React.JSX.Element {
  return (
    <tr className={cn('hover:bg-slate-50/60', className)} {...rest}>
      {children}
    </tr>
  );
}

export function TH({
  children,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { children: ReactNode }): React.JSX.Element {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-2 text-xs font-semibold uppercase tracking-wide text-white',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TD({
  children,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { children: ReactNode }): React.JSX.Element {
  return (
    <td className={cn('px-3 py-2 align-middle text-slate-900', className)} {...rest}>
      {children}
    </td>
  );
}
