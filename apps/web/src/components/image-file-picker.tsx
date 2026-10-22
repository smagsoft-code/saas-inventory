'use client';

import { useRef } from 'react';
import { Button } from './ui/button';
import { Field } from './ui/field';
import { Input } from './ui/input';

/**
 * A file picker plus an explicit "Tomar foto" trigger (OUI-009) — two separate inputs, not one
 * `<input capture>` doing double duty: iOS Safari's `capture` attribute replaces the whole file
 * picker with the camera only (no "Photo Library" option once set), so the only way to offer both
 * "pick an existing image" and "use the device camera" is two real inputs. The camera one is
 * visually hidden and triggered by a normal button — the same hidden-input-plus-ref-click pattern
 * this codebase has no prior instance of, but is the standard, no-dependency way to do this.
 */
export function ImageFilePicker({
  label,
  hint,
  error,
  accept,
  disabled,
  onPick,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  accept: string;
  disabled?: boolean;
  onPick: (file: File | null) => void;
}): React.JSX.Element {
  const cameraInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-2">
      <Field label={label} {...(hint ? { help: hint } : {})} {...(error ? { error } : {})}>
        <Input
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </Field>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => cameraInputRef.current?.click()}
        className="w-fit"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          aria-hidden
        >
          <path d="M4 8a2 2 0 0 1 2-2h1.5l1-1.5h7l1 1.5H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z" />
          <circle cx="12" cy="13" r="3.25" />
        </svg>
        Tomar foto
      </Button>
      {/* Hidden — `capture` steers mobile browsers straight to the camera app; a real click via
          the visible button above is what triggers it, never shown/styled itself. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept={accept}
        capture="environment"
        disabled={disabled}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          onPick(e.target.files?.[0] ?? null);
          // Reset so choosing the same shot again later still fires a change event.
          e.target.value = '';
        }}
      />
    </div>
  );
}
