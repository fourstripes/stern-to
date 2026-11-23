import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

async function bootstrap(load) {
  const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), {
    url: 'https://preview.example/game/', runScripts: 'outside-only'
  });
  dom.window.__loadGame = load;
  dom.window.console.error = () => {};
  const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
    .replace("await import('./game.js')", 'await __loadGame()');
  await vm.runInContext(`(async () => { ${source}\n })()`, dom.getInternalVMContext());
  return dom;
}

test('successful first render releases the loading screen and inert game', async t => {
  const dom = await bootstrap(async () => ({ startGame: lifecycle => lifecycle.onReady() }));
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.getElementById('startup').hidden, true);
  assert.equal(doc.getElementById('app').inert, false);
  assert.equal(doc.getElementById('app').hasAttribute('aria-busy'), false);
});

test('a failed module download presents a usable retry message', async t => {
  const dom = await bootstrap(async () => { throw new Error('Network connection failed'); });
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.getElementById('startupTitle').textContent, 'The game could not load');
  assert.equal(doc.getElementById('startupRetry').hidden, false);
  assert.equal(doc.activeElement.id, 'startupRetry');
  assert.equal(doc.getElementById('app').inert, true);
});

test('unsupported graphics explains the WebGL 2 requirement', async t => {
  const dom = await bootstrap(async () => ({ startGame() { throw new Error('Error creating WebGL context.'); } }));
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  assert.equal(doc.getElementById('startupTitle').textContent, '3D graphics unavailable');
  assert.match(doc.getElementById('startupMessage').textContent, /WebGL 2/);
  assert.equal(doc.getElementById('startup').hidden, false);
});

test('graphics recovery clears the blocking status without a forced reload', async t => {
  let lifecycle;
  const dom = await bootstrap(async () => ({ startGame(callbacks) { lifecycle = callbacks; callbacks.onReady(); } }));
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  lifecycle.onContextLost();
  assert.equal(doc.getElementById('startup').hidden, false);
  assert.equal(doc.getElementById('app').inert, true);
  assert.equal(doc.getElementById('startupTitle').textContent, 'Graphics interrupted');
  lifecycle.onContextRestored();
  assert.equal(doc.getElementById('startup').hidden, true);
  assert.equal(doc.getElementById('app').inert, false);
});
