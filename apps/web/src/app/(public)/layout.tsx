import type { ReactNode } from 'react';

/** Marketing/landing, login, register — no session required (frontend.md#app-router-structure). */
export default function PublicLayout({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="min-h-screen bg-slate-50">{children}</div>;
}
