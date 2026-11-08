// Builds a small, self-contained release in release/:
//   server.mjs (API bundled with esbuild), dist/ (website), package.json (only the SQLite driver).
// The server needs no TypeScript runtime, no build tools and only one npm package on the host.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
rmSync('release', { recursive: true, force: true });
mkdirSync('release');
await build({
  entryPoints: ['server/index.ts'],
  outfile: 'release/server.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: true,
  external: ['better-sqlite3', 'vite'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
cpSync('dist', 'release/dist', { recursive: true });
cpSync('deploy', 'release/deploy', { recursive: true });
writeFileSync('release/package.json', JSON.stringify({
  name: 'flowride-release', private: true, type: 'module', version: pkg.version,
  engines: { node: '>=22' },
  dependencies: { 'better-sqlite3': pkg.dependencies['better-sqlite3'] },
}, null, 2));
const size = dir => readdirSync(dir, { recursive: true }).reduce((n, f) => { const s = statSync(`${dir}/${f}`); return n + (s.isFile() ? s.size : 0); }, 0);
console.log(`release/ ready: ${(size('release') / 1024).toFixed(0)} KB (server ${(statSync('release/server.mjs').size / 1024).toFixed(0)} KB)`);
