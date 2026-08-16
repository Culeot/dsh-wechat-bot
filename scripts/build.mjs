// Build: server bundle (ESM, externals) + web client bundle (CJS,
// ModuleLoader shell, react external, schemastery bundled).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  outfile: 'lib/index.js',
  sourcemap: true,
  external: ['@deepseek-ai/*', 'node:*', 'qrcode'],
  logLevel: 'info',
});

await build({
  entryPoints: ['src/client/index.tsx'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  outfile: 'lib/client.js',
  jsx: 'automatic',
  // Only react stays external (provided by the DSH web shell). schemastery
  // is BUNDLED — DSH web's module table has no factory for it.
  external: ['react', 'react/jsx-runtime'],
  banner: { js: 'window.__ModuleLoader__.load({\n\tid: "dsh-wechat-bot",\n\tfactory: (require) => {\n\t\tvar module = { exports: {} };\n\t\tvar exports = module.exports;\n\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" });\n' },
  footer: { js: '\n\t\treturn module.exports;\n\t}\n});\n' },
  logLevel: 'info',
});

console.log('build ok');
