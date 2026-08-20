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
      // NestJS's dependency injection (and its ValidationPipe's DTO metatype resolution) reads
      // classes off `design:paramtypes` decorator metadata (tsconfig/nestjs.json's
      // emitDecoratorMetadata) at runtime. `import type` is fully erased by TypeScript with no
      // exception for that metadata, so autofixing an implicitly-injected class or a
      // @Body()/@Query() DTO to `import type` compiles cleanly but silently breaks DI/validation
      // at runtime (discovered in Prompt 05-A: the base config's blanket 'error' here had already
      // done this to every constructor-injected class and request DTO in apps/api, which meant the
      // app could not boot at all — see git history for the fix). base.js's rule is fine for
      // packages that don't use decorator metadata (apps/web, packages/*); backend packages need
      // it off entirely, since the rule has no way to except "classes used for DI/pipe metadata".
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];

export default nestjs;
