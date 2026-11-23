import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as vendor from '../vendor/three.module.min.js';

const root = new URL('../', import.meta.url);

test('the deployed page references existing local assets', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  for (const [, target] of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^https?:/.test(target)) continue;
    await access(new URL(target, root));
  }
  assert.match(html, /<script type="module" src="src\/main.js(?:\?[^\"]+)?"><\/script>/);
  assert.equal((html.match(/<body>/g) || []).length, 1);
  assert.equal((html.match(/<\/head>/g) || []).length, 1);
});

test('the pinned vendor bundle is intact and exports every renderer dependency', async () => {
  const manifest = JSON.parse(await readFile(new URL('vendor/manifest.json', root), 'utf8'));
  const bytes = await readFile(new URL('vendor/three.module.min.js', root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), manifest.sha256);
  assert.equal(manifest.version, '0.187.0');
  assert.equal(vendor.REVISION, '187');
  const game = await readFile(new URL('src/game.js', root), 'utf8');
  for (const [, name] of game.matchAll(/\bT3\.([A-Za-z0-9_]+)/g)) {
    assert.ok(name in vendor, `missing vendored Three.js export: ${name}`);
  }
  const module = await import('../src/game.js');
  assert.equal(typeof module.startGame, 'function');
});
