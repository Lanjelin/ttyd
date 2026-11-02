import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default [
    { ignores: ['dist/**', '.yarn/**', 'node_modules/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended.map(config => ({ ...config, files: ['src/**/*.{ts,tsx}'] })),
    {
        files: ['**/*.{js,mjs}'],
        languageOptions: { globals: globals.node },
    },
    {
        files: ['src/**/*.{ts,tsx}'],
        languageOptions: { globals: { ...globals.browser, ...globals.node } },
        rules: {
            // The browser entry loads preact/debug synchronously in development only.
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/no-duplicate-enum-values': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none', varsIgnorePattern: '^h$' }],
        },
    },
];
