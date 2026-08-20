import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';

// @testing-library/react's own auto-cleanup only self-registers when it detects a *global*
// `afterEach` (e.g. Jest, or Vitest with `test.globals: true`). This project's vitest.config.ts
// deliberately does not enable globals (every test file imports `describe`/`it`/`expect` from
// 'vitest' explicitly), so that auto-detection never fires and DOM nodes from one test's render()
// leak into the next within the same file — registering it explicitly here is the correct fix,
// not a per-test workaround.
afterEach(() => {
  cleanup();
});
