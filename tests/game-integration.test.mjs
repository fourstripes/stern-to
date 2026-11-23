import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGameHarness } from './helpers/game-harness.mjs';

function game(t, options) {
  const harness = createGameHarness(options);
  t.after(() => harness.close());
  return harness;
}

function finiteScene(h, label) {
  assert.equal(h.run(`(() => {
    let finite = camera.projectionMatrix.elements.every(Number.isFinite);
    scene3.traverse(object => {
      finite &&= object.matrixWorld.elements.every(Number.isFinite);
      finite &&= object.position.toArray().every(Number.isFinite);
    });
    return finite;
  })()`), true, `${label}: finite scene transforms`);
  assert.ok(h.read('[S.x,S.y,S.psi,S.u,S.v,S.r,S.t,...S.rpm]').every(Number.isFinite), `${label}: finite simulation`);
  assert.deepEqual(h.errors.map(String), [], `${label}: no runtime exceptions`);
  assert.deepEqual(h.warnings, [], `${label}: no recovery warnings`);
}

test('all three vessels and four harbours build, simulate and reset with real Three.js objects', t => {
  assert.equal(THREE.REVISION, '187');
  const h = game(t);
  assert.equal(h.readyCount, 1);
  for (const ship of ['tender', 'super', 'ls']) {
    h.run(`openMenu();setShip(${JSON.stringify(ship)});`);
    for (let level = 0; level < 4; level++) {
      const label = `${ship}, harbour ${level}`;
      h.run(`pick(${level});`);
      h.click('go');
      h.run('S.lever[0]=1;S.lever[1]=.7;S.rud=9;S.thr=.3;');
      h.advance(250, 1000 / 30);
      assert.ok(Math.abs(h.run('S.t') - .25) < 1e-9, `${label}: fixed simulation advances`);
      finiteScene(h, label);
      h.run('reset();');
      assert.deepEqual(h.read('[S.x,S.y,S.psi]'), h.read('[LV.start[0]*GEO,LV.start[1]*GEO,LV.start[2]*D2R]'), `${label}: restart location`);
      assert.deepEqual(h.read('[S.t,S.u,S.v,S.r,parts.length]'), [0, 0, 0, 0, 0], `${label}: reset state`);
      h.run('openMenu();');
    }
  }
  assert.equal(h.readyCount, 1, 'rebuilds do not announce a second application boot');
  assert.equal(h.fetchCalls.length, 0, 'local tests never touch the public play counter');
  assert.ok(h.renderer.shaderIncludes.has('colorspace_fragment'), 'custom colour shader uses the current chunk');
  assert.equal(h.renderer.shaderIncludes.has('encodings_fragment'), false);
});

test('rebuilding vessels and harbours disposes owned resources and keeps shared assets alive', t => {
  const h = game(t);
  let sharedDisposals = 0;
  for (const resource of h.run('[...sharedGeometries,...sharedMaterials]')) {
    resource.addEventListener('dispose', () => sharedDisposals++);
  }
  const counts = () => ({
    geometries: h.renderer.geometries.size,
    materials: h.renderer.materials.size,
    instances: h.renderer.instances.size,
    textures: h.renderer.textures.size
  });
  let warmed;
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const ship of ['tender', 'super', 'ls']) {
      h.run(`setShip(${JSON.stringify(ship)});`);
      for (let level = 0; level < 4; level++) {
        h.run(`pick(${level});invalidateFrame();`);
        h.frame();
      }
    }
    h.run("setShip('super');pick(0);invalidateFrame();");
    h.frame();
    if (cycle === 0) warmed = counts();
    else assert.deepEqual(counts(), warmed, 'tracked scene resource counts stay bounded after a full rebuild cycle');
  }
  assert.equal(sharedDisposals, 0, 'cached model geometry and materials remain available for later vessels');
  for (const kind of ['geometries', 'materials', 'instances']) {
    assert.ok(h.renderer.disposals[kind] > 0, `${kind}: outgoing resources emit disposal events`);
  }
  finiteScene(h, 'rebuilt harbour');
});

test('restart clears transient wake, foam, smoke, ropes and vessel motion', t => {
  const h = game(t);
  h.click('go');
  h.run('S.lever[0]=S.lever[1]=1;');
  h.advance(1500);
  assert.ok(h.run('puffs.length') > 0, 'power produces pooled exhaust or spray');
  assert.ok(h.run('U.uWake.value.some(wake=>wake.w>0)'), 'power produces a wake');
  h.run('chainLinks.count=5;ropes[0].visible=true;ownDyn.vy=4;');
  const clearCalls = h.renderer.clearCalls;
  h.run('reset();');
  assert.equal(h.run('puffs.every(puff=>puff.life===0&&!puff.sp.visible)'), true);
  assert.equal(h.run('U.uWake.value.every(wake=>wake.w===0)'), true);
  assert.equal(h.run('[...ropes,...leads,...whip,chainM,chainM2,hose].every(mesh=>!mesh.visible)'), true);
  assert.deepEqual(h.read('[chainLinks.count,sGeo.instanceCount,stamps.visible,ownDyn.vy,ownDyn.acc]'), [0, 0, false, 0, 0]);
  assert.equal(h.renderer.clearCalls - clearCalls, 2, 'both foam render targets are cleared');
  assert.equal(h.renderer.getRenderTarget(), null, 'the prior render target is restored');
  h.frame();
  finiteScene(h, 'restarted vessel');
});

test('dynamic foam uploads cover the active instances and stop when time is frozen', t => {
  const h = game(t);
  h.run('parts=[];spawn(0,S.x,S.y,0,0,1,5,0);foamPass(1/60);');
  assert.equal(h.run('sP.usage'), THREE.DynamicDrawUsage);
  assert.equal(h.run('sC.usage'), THREE.DynamicDrawUsage);
  assert.equal(h.run('chainLinks.instanceMatrix.usage'), THREE.DynamicDrawUsage);
  assert.equal(h.run('sGeo.instanceCount'), 1);
  assert.deepEqual(h.read('sP.updateRanges'), [{ start: 0, count: 4 }]);
  assert.deepEqual(h.read('sC.updateRanges'), [{ start: 0, count: 3 }]);
  const versions = h.read('[sP.version,sC.version]');
  const passes = h.renderer.foamPasses;
  h.run('foamPass(0);');
  assert.deepEqual(h.read('[sP.version,sC.version]'), versions);
  assert.equal(h.renderer.foamPasses, passes);
  assert.equal(h.renderer.getRenderTarget(), null);
  assert.deepEqual(h.errors.map(String), []);
});

test('the menu and paused game stop scheduling frames and resume with one frame loop', async t => {
  const h = game(t);
  await h.flush();
  assert.equal(h.pendingFrames, 1, 'initial focus does not create a second frame loop');
  h.advance(2000);
  await h.flush();
  assert.equal(h.pendingFrames, 0, 'the idle menu stops');
  const menuRenders = h.renderer.renderCalls;
  h.advance(2000);
  assert.equal(h.renderer.renderCalls, menuRenders);
  h.click('go');
  h.advance(500);
  assert.equal(h.pendingFrames, 1);
  h.click('pauseBtn');
  const time = h.run('S.t'), foamPasses = h.renderer.foamPasses;
  h.advance(2000);
  assert.equal(h.pendingFrames, 0, 'the paused game stops after camera and UI settle');
  assert.equal(h.run('S.t'), time);
  assert.equal(h.renderer.foamPasses, foamPasses, 'no foam passes run during paused settling frames');
  h.click('pauseBtn');
  h.advance(1000);
  assert.equal(h.pendingFrames, 1);
  assert.ok(Math.abs(h.run('S.t') - time - 1) < 1e-8, 'resuming does not replay idle time');
  assert.equal(h.readyCount, 1);
  finiteScene(h, 'resumed game');
});

test('context loss freezes the run and restoration clears visuals and remains paused', async t => {
  const h = game(t);
  h.click('go');
  h.run('S.lever[0]=S.lever[1]=.7;');
  h.advance(500);
  await h.flush();
  const state = h.read('[S.x,S.y,S.psi,S.t,S.damage]');
  const renders = h.renderer.renderCalls;
  assert.equal(h.loseContext().defaultPrevented, true, 'the application opts in to restoration');
  assert.equal(h.pendingFrames, 0);
  h.advance(10_000);
  assert.deepEqual(h.read('[S.x,S.y,S.psi,S.t,S.damage]'), state);
  assert.equal(h.renderer.renderCalls, renders, 'lost graphics never receive a render call');
  const clearCalls = h.renderer.clearCalls;
  h.restoreContext();
  assert.equal(h.renderer.clearCalls - clearCalls, 2);
  h.frame();
  await h.flush();
  h.advance(2000);
  assert.deepEqual(h.lifecycleEvents, ['ready', 'context-lost', 'context-restored']);
  assert.equal(h.run('hold'), true);
  assert.equal(h.pendingFrames, 0);
  assert.deepEqual(h.read('[S.x,S.y,S.psi,S.t,S.damage]'), state);
  h.click('pauseBtn');
  h.advance(1000);
  assert.ok(Math.abs(h.run('S.t') - state[3] - 1) < 1e-8);
  finiteScene(h, 'restored context');
});

test('hidden tabs pause the simulation and require an explicit resume', t => {
  const h = game(t);
  h.click('go');
  h.advance(500);
  h.setVisibility('hidden');
  const state = h.read('[S.x,S.y,S.t]');
  assert.equal(h.pendingFrames, 0);
  h.advance(60_000, 1000);
  assert.deepEqual(h.read('[S.x,S.y,S.t]'), state);
  h.setVisibility('visible');
  h.advance(1000);
  assert.equal(h.run('hold'), true);
  assert.deepEqual(h.read('[S.x,S.y,S.t]'), state);
  h.click('pauseBtn');
  h.advance(500);
  assert.ok(Math.abs(h.run('S.t') - state[2] - .5) < 1e-8);
  finiteScene(h, 'visible tab');
});

test('a failing first frame reports an error without claiming that the game is ready', t => {
  const h = game(t, { autoFrame: false });
  const error = new Error('Test draw failure');
  h.renderer.render = () => { throw error; };
  h.frame();
  assert.equal(h.readyCount, 0);
  assert.deepEqual(h.errors, [error]);
  assert.deepEqual(h.lifecycleEvents, ['error']);
  assert.equal(h.pendingFrames, 0);
  assert.equal(h.run('hold'), true);
});
