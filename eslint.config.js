import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// Determinisme-regelset voor alles wat de sim raakt. Zie docs/fase-0-contracten-en-agentbriefs.md sectie 7.
const SIM_FILES = ['packages/sim/src/**/*.ts', 'packages/map/src/**/*.ts', 'packages/data/src/loader*.ts'];
const forbiddenMath = ['random', 'sin', 'cos', 'tan', 'sqrt', 'pow', 'exp', 'log', 'atan2', 'hypot', 'cbrt', 'asin', 'acos', 'atan'];
const forbiddenGlobals = ['Date', 'performance', 'setTimeout', 'setInterval', 'setImmediate', 'queueMicrotask', 'fetch', 'window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame'];

const simDeterminism = {
  files: SIM_FILES,
  rules: {
    'no-restricted-globals': ['error', ...forbiddenGlobals.map((name) => ({ name, message: `${name} is verboden in de sim (determinisme-regel 2 en 6).` }))],
    'no-restricted-properties': [
      'error',
      ...forbiddenMath.map((property) => ({ object: 'Math', property, message: `Math.${property} is verboden in de sim; gebruik tabellen of integer-helpers (determinisme-regel 1).` })),
      { object: 'Object', property: 'keys', message: 'Volgorde van Object.keys is geen bron voor spellogica (determinisme-regel 5).' },
      { object: 'Object', property: 'entries', message: 'Volgorde van Object.entries is geen bron voor spellogica (determinisme-regel 5).' },
    ],
    'no-restricted-syntax': [
      'error',
      { selector: "NewExpression[callee.name='Float32Array']", message: 'Float32Array is verboden in de sim (determinisme-regel 3).' },
      { selector: "NewExpression[callee.name='Float64Array']", message: 'Float64Array is verboden in de sim (determinisme-regel 3).' },
      { selector: "BinaryExpression[operator='/']", message: "Gebruik idiv() uit math/int.ts in plaats van '/' (determinisme-regel 4)." },
      { selector: "BinaryExpression[operator='%']", message: "Gebruik imod() uit math/int.ts in plaats van '%' (determinisme-regel 4)." },
      { selector: 'ForInStatement', message: 'for...in is verboden in de sim (determinisme-regel 5).' },
      { selector: 'AwaitExpression', message: 'async en await zijn verboden in de sim (determinisme-regel 2).' },
      { selector: 'FunctionDeclaration[async=true], FunctionExpression[async=true], ArrowFunctionExpression[async=true]', message: 'async is verboden in de sim (determinisme-regel 2).' },
      { selector: "CallExpression[callee.property.name='sort'][arguments.length=0]", message: 'sort zonder comparator met tiebreak op id is verboden (determinisme-regel 5).' },
    ],
    'no-restricted-imports': [
      'error',
      { patterns: [{ group: ['three', 'three/*', '@crawlout/render', '@crawlout/ui', '@crawlout/relay', 'preact', 'ws'], message: 'De sim importeert geen render, ui, relay of three (determinisme-regel 6).' }] },
    ],
  },
};

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'assets/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  simDeterminism,
);
