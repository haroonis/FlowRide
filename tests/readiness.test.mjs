// Checks whether this repo contains a runnable app yet.
// Today it only holds a README, so these are reported as TODO, not failures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const sourceFiles = readdirSync(ROOT, { recursive: true })
  .filter(f => !String(f).startsWith('node_modules') && !String(f).startsWith('tests') && !String(f).startsWith('.git'))
  .filter(f => /\.(m?[jt]sx?|py|go|rb)$/.test(String(f)));

test('README describes the product', () => {
  assert.match(readFileSync(path.join(ROOT, 'README.md'), 'utf8'), /ride sharing/i);
});

test('repo contains application source code', { todo: 'GAP: repo has no source code yet' }, () => {
  assert.ok(sourceFiles.length > 0, 'no source files found');
});

test('package.json defines a start script', { todo: 'GAP: nothing to start' }, () => {
  assert.ok(pkg.scripts?.start, 'no start script');
});

test('repo has deployment config', { todo: 'GAP: no Dockerfile / hosting config' }, () => {
  assert.ok(['Dockerfile', 'netlify.toml', 'vercel.json', 'fly.toml'].some(f => existsSync(path.join(ROOT, f))));
});
