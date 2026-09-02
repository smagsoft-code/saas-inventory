/** A whole-section "you're authenticated but not allowed here" notice (F17-03 §11 — the 403 case
 * rendered *in place*, never a redirect to login). The backend is still the authority; this is the
 * friendly surface for a direct navigation to a screen the user's role does not include. */
export function NoAccess({
  message = "You don't have permission to view this.",
}: {
  message?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <p className="text-sm font-medium text-slate-900">Access denied</p>
      <p className="mt-1 text-sm text-slate-500">{message}</p>
    </div>
  );
}
