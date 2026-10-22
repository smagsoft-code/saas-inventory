import type { ReactNode } from 'react';
import { HelpTip } from './help-tip';

/** Consistent page title block (Prompt 016 §42). One `<h1>` per page lives here. */
export function PageHeader({
  title,
  description,
  help,
  actions,
}: {
  title: string;
  description?: string;
  /** Page explanation shown on demand behind a small "?" icon next to the title, instead of a
   * permanent line under it (saves vertical space). Prefer this over `description` for legends. */
  help?: ReactNode;
  actions?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
          {help && <HelpTip>{help}</HelpTip>}
        </div>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
