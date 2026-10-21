import tsParser from '@typescript-eslint/parser';
import hooks from 'eslint-plugin-react-hooks';
export default [{ files: ['**/*.tsx','**/*.ts'], languageOptions: { parser: tsParser, parserOptions: { ecmaVersion: 2022, sourceType: 'module', ecmaFeatures: { jsx: true } } }, plugins: { 'react-hooks': hooks }, rules: { ...hooks.configs.recommended.rules, 'no-debugger': 'error', 'no-duplicate-imports': 'error' } }];
