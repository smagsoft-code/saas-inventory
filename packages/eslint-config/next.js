// @ts-check
import { base } from './base.js';

/** ESLint flat config for the Next.js frontend package. */
export const next = [
  ...base,
  {
    rules: {
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },
];

export default next;
