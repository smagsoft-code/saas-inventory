'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * A product image the user picked on the edit screen but has not saved yet. The image panel and the
 * form's "Guardar cambios" are separate components, so they share this one piece of state: picking a
 * new image only *stages* it (preview + enables "Guardar cambios"); the form uploads it when the
 * user saves, in the same action as the rest of the changes. Outside a provider (e.g. the create
 * flow, which has its own staging) `useStagedImage()` is `null` and nothing changes.
 */
interface StagedImage {
  file: File | null;
  setFile: (file: File | null) => void;
}

const StagedImageContext = createContext<StagedImage | null>(null);

export function StagedImageProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const value = useMemo(() => ({ file, setFile }), [file]);
  return <StagedImageContext.Provider value={value}>{children}</StagedImageContext.Provider>;
}

export function useStagedImage(): StagedImage | null {
  return useContext(StagedImageContext);
}
