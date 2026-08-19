// @ts-check
import { base } from './base.js';

/** ESLint flat config for NestJS backend packages. */
export const nestjs = [
  ...base,
  {
    rules: {
      '@typescript-eslint/interface-name-prefix': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
];

export default nestjs;
