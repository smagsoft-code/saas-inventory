import { cn } from '../../lib/cn';

/** Indeterminate progress indicator. `role="status"` + visually-hidden label so screen readers
 * announce it (Prompt 016 §24 / §29). */
export function Spinner({
  className,
  label = 'Loading',
}: {
  className?: string;
  label?: string;
}): React.JSX.Element {
  return (
    <span role="status" className="inline-flex items-center">
      <svg
        className={cn('h-5 w-5 animate-spin text-current', className)}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </span>
  );
}
