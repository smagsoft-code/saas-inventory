'use client';

import { useEffect, useState } from 'react';
import { cn } from '../../lib/cn';

const FADE_MS = 300;

/**
 * A single, self-timed, bottom-right toast — success feedback only (Transferencias UI feedback
 * thread): errors stay inline/persistent (`Alert tone="error"`, never auto-dismissed, since the
 * user must be able to read and act on them). Owns its own lifecycle: visible for `durationMs`,
 * then fades out over `FADE_MS`, then calls `onDismiss` once so the caller can drop the message
 * from state — never a global queue/provider, since this project only ever shows one success toast
 * at a time per action.
 */
export function Toast({
  message,
  onDismiss,
  durationMs = 3000,
}: {
  message: string;
  onDismiss: () => void;
  durationMs?: number;
}): React.JSX.Element {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const hideTimer = setTimeout(() => setVisible(false), durationMs);
    return () => clearTimeout(hideTimer);
  }, [durationMs]);

  useEffect(() => {
    if (visible) {
      return;
    }
    const removeTimer = setTimeout(onDismiss, FADE_MS);
    return () => clearTimeout(removeTimer);
  }, [visible, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        // The system's primary color (Button's `primary` variant, table headers) — not blue.
        'fixed bottom-4 right-4 z-50 max-w-sm rounded-md bg-slate-900 px-4 py-3 text-sm text-white shadow-lg transition-opacity ease-out',
        visible ? 'opacity-100' : 'opacity-0',
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      {message}
    </div>
  );
}
