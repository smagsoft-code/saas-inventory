/** Route-level loading state (frontend.md#error-loading-and-empty-states) — shown while the
 * server component above fetches the current session/user. */
export default function TenantLoading(): React.JSX.Element {
  return <p className="p-8 text-sm text-slate-400">Loading…</p>;
}
