// Builds a small, self-contained release in release/:
//   server.mjs (API bundled with esbuild), dist/ (website), package.json (only the SQLite driver).
// The server needs no TypeScript runtime, no build tools and only one npm package on the host.
import { build } from 'esbuild';
import { cpSync, rmSync, mkdirSync, writeFileSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

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
// Ship the SQLite driver inside the release so the server installs nothing.
// better-sqlite3 includes ready-made Linux builds (glibc 2.34+, e.g. Oracle Linux 9 / Ubuntu 22.04+);
// keep only the Linux x64 and Arm ones and drop the C sources.
execSync('npm install --omit=dev --no-audit --no-fund --ignore-scripts --loglevel=error', { cwd: 'release', stdio: 'inherit' });
const bs = 'release/node_modules/better-sqlite3';
for (const f of readdirSync(`${bs}/prebuilds`)) if (!['linux-x64.node', 'linux-arm64.node'].includes(f)) rmSync(`${bs}/prebuilds/${f}`);
for (const d of ['deps', 'src', 'docs']) rmSync(`${bs}/${d}`, { recursive: true, force: true });

const size = dir => readdirSync(dir, { recursive: true }).reduce((n, f) => { const s = statSync(`${dir}/${f}`); return n + (s.isFile() ? s.size : 0); }, 0);
console.log(`release/ ready: ${(size('release') / 1024).toFixed(0)} KB (server ${(statSync('release/server.mjs').size / 1024).toFixed(0)} KB)`);
