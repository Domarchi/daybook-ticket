import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['dist/**', '.vinext/**', '.wrangler/**', '.sites-runtime/**', 'outputs/**', 'work/**']),
  {
    // Size and complexity are watched, not enforced yet: these are warnings that name the code worth splitting next.
    // New code should stay under them. db/schema.ts is one long list of table definitions by nature.
    files: ['app/**/*.{ts,tsx}', 'lib/**/*.ts', 'hooks/**/*.ts'],
    rules: {
      'max-lines': ['warn', { max: 800, skipBlankLines: true, skipComments: true }],
      complexity: ['warn', 40],
    },
  },
]);

export default eslintConfig;
