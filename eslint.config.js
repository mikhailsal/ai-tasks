import js from '@eslint/js';
import importX from 'eslint-plugin-import-x';
import { createTypeScriptImportResolver } from 'eslint-import-resolver-typescript';
import tseslint from 'typescript-eslint';
import architecture from './scripts/lint/architecture.mjs';

const typedFiles = [
  'src/**/*.ts',
  'web/src/**/*.{ts,tsx}',
  'tests/**/*.{ts,tsx}',
  'scripts/**/*.ts',
  'drizzle/**/*.ts',
  '*.config.ts',
  'web/*.config.ts',
];
const applicationFiles = ['src/**/*.ts', 'web/src/**/*.{ts,tsx}', 'drizzle/**/*.ts'];
const testFiles = ['tests/**/*.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}'];

// Cohesive production functions: guard clauses (depth 4), options objects (4 parameters),
// and branches a reviewer can follow (12). Functions count logical code lines; modules
// count every nonblank line, including comments, as specified in the setup plan.
const applicationLimits = {
  complexity: ['error', 12],
  'max-depth': ['error', 4],
  'max-params': ['error', 4],
  'max-lines-per-function': ['error', { max: 100, skipBlankLines: true, skipComments: true }],
  'max-lines': ['error', { max: 400, skipBlankLines: true }],
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'artifacts/**',
      'drizzle/meta/**',
    ],
  },
  {
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'error' },
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({ ...config, files: typedFiles })),
  {
    files: ['**/*.{js,mjs,cjs}', '*.config.ts', 'web/*.config.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    files: typedFiles,
    plugins: { 'import-x': importX, architecture },
    settings: {
      'import-x/resolver-next': [
        createTypeScriptImportResolver({ project: ['tsconfig.json', 'web/tsconfig.json'] }),
      ],
    },
    rules: {
      // Local cycles are also checked by architecture/no-local-cycle, including type edges.
      'import-x/no-cycle': ['error', { ignoreExternal: true }],
      'architecture/no-local-cycle': 'error',
      'import-x/no-unresolved': 'error',
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './src/schema',
              from: ['./src/core', './src/cli', './src/api', './src/runtime', './web'],
            },
            { target: './src/core', from: ['./src/cli', './src/api', './src/runtime', './web'] },
            { target: './src/cli', from: ['./src/api', './web'] },
            { target: './src/api', from: ['./src/cli', './web'] },
            { target: './src/runtime', from: ['./src/core/database', './src/schema', './web'] },
            {
              target: './web/src',
              from: ['./src/core', './src/cli', './src/api', './src/runtime'],
            },
          ],
        },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['moment', 'moment/*', 'lodash', 'lodash/*', 'lodash-es', 'lodash-es/*'],
              message:
                'Use standard APIs; heavy utility libraries are forbidden by the constitution.',
            },
          ],
        },
      ],
    },
  },
  {
    files: applicationFiles,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      ...applicationLimits,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-expect-error': true, 'ts-nocheck': true, 'ts-check': false },
      ],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-unsafe-type-assertion': 'error',
      // Schema/DTO return types stay inferred from Drizzle/Zod; explicit parameter types
      // and strict checking preserve public contracts without duplicating those types.
      'architecture/functions-and-boundaries': 'error',
    },
  },
  {
    // JSX needs more room for accessible markup, without increasing module/depth limits.
    files: ['web/src/**/*.tsx'],
    rules: {
      complexity: ['error', 15],
      'max-lines-per-function': ['error', { max: 150, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // Cases include arrange/action/assert plus cleanup; fixtures may explain a whole scenario.
    files: testFiles,
    rules: {
      ...applicationLimits,
      complexity: ['error', 20],
      'max-lines-per-function': ['error', { max: 250, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 700, skipBlankLines: true }],
    },
  },
  {
    // Generated migration code retains syntax/type/import checks; only size is exempt.
    files: ['drizzle/**/*.ts'],
    languageOptions: { parser: tseslint.parser },
    rules: { 'max-lines': 'off', 'max-lines-per-function': 'off' },
  },
];
