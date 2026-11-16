// ESLint flat config. no-undef catches the class of bug behind "Step failed: rng is not defined";
// the engine may not use Math.random (all randomness comes from the world's seeded RNG).
const globals = require('globals');

const ENGINE_FILES = ['src/index.js', 'src/models.js', 'src/utils.js', 'src/migrations.js', 'src/engine/**/*.js'];

module.exports = [
  { ignores: ['node_modules/**', 'data/**', 'public/**', 'coverage/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node } },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-redeclare': 'error',
    },
  },
  {
    files: ENGINE_FILES,
    rules: {
      'no-restricted-properties': ['error', { object: 'Math', property: 'random', message: 'Engine randomness must come from the world RNG (world.rng).' }],
      'no-restricted-globals': ['error', { name: 'window', message: 'The engine has no DOM.' }, { name: 'document', message: 'The engine has no DOM.' }, { name: 'fetch', message: 'The engine has no network.' }],
    },
  },
  {
    files: ['test/**/*.js', 'vitest.config.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
];
