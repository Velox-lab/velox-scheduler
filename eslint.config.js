const tsPlugin = require('@typescript-eslint/eslint-plugin');

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  { ignores: ['dist/', 'coverage/', 'node_modules/', '*.config.js'] },
  ...tsPlugin.configs['flat/recommended'],
];
