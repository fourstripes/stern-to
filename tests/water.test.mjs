import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWaves, evaluateWater, sampleWater, stepDampedSpring, foamParameters, waterQuality, WATER_GLSL } from '../src/water.js';
import { createGameHarness } from './helpers/game-harness.mjs';

const environment = { wk: 18, wFrom: 250, sFrom: 190, sh: 1.2, lam: 48 };
const settings = { shelterX: -25, shelterZ: 18, scale: 1, king: { on: false, d: [.6, .8], pos: 110, A: 4, c: 11 } };
const close = (actual, expected, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);

test('wave parameters obey dispersion and keep storm steepness below overturning', () => {
  for (const height of [0, .2, 1.5, 9, 30]) {
    const waves = buildWaves({ ...environment, sh: height });
    assert.equal(waves.length, 6);
    for (const wave of waves) {
      close(Math.hypot(wave.dx, wave.dz), 1);
      close(wave.om ** 2, 9.81 * wave.k);
    }
    assert.ok(waves.chop * waves.reduce((sum, wave) => sum + wave.amp * wave.k, 0) <= .60000001);
  }
  const waves = buildWaves({ ...environment, wk: 0, sh: 0 });
  assert.equal(sampleWater(waves, settings, 170, 85, 15).height, 0, 'zero wind and swell make a flat ambient surface');
});

test('world-space height queries invert the displaced Gerstner surface through sheltered and storm seas', () => {
  for (const sh of [.2, 2, 9]) for (const on of [false, true]) {
    const waves = buildWaves({ ...environment, sh });
    const sea = { ...settings, king: { ...settings.king, on } };
    for (const [x, z] of [[0, 0], [45, 0], [-120, 70], [180, 100], [400, -150]]) for (const time of [0, 13.4, 900]) {
      const surface = evaluateWater(waves, sea, x, z, time);
      const sample = sampleWater(waves, sea, surface.x, surface.z, time);
      close(sample.x, surface.x, 2e-7); close(sample.z, surface.z, 2e-7); close(sample.height, surface.height, 2e-7);
      assert.ok(surface.determinant > .2, 'the tested surface remains locally invertible');
    }
  }
});

test('analytic surface derivatives agree with finite differences including the shelter boundary and large set', () => {
  const waves = buildWaves({ ...environment, sh: 3 });
  const sea = { ...settings, king: { ...settings.king, on: true } };
  const epsilon = 1e-4;
  for (const [x, z] of [[10, 5], [100, 75], [180, 100], [-180, -45]]) {
    const p = evaluateWater(waves, sea, x, z, 4.2);
    const xp = evaluateWater(waves, sea, x + epsilon, z, 4.2), xm = evaluateWater(waves, sea, x - epsilon, z, 4.2);
    const zp = evaluateWater(waves, sea, x, z + epsilon, 4.2), zm = evaluateWater(waves, sea, x, z - epsilon, 4.2);
    for (const [field, a, b, value] of [
      ['x', xp, xm, p.jxx], ['z', xp, xm, p.jzx], ['height', xp, xm, p.dyx],
      ['x', zp, zm, p.jxz], ['z', zp, zm, p.jzz], ['height', zp, zm, p.dyz]
    ]) close((a[field] - b[field]) / (2 * epsilon), value, 2e-6);
  }
});

test('world-space slopes and vertical velocity match independent height differences', () => {
  const waves = buildWaves(environment), epsilon = 1e-4;
  for (const [x, z] of [[0, 0], [100, 30], [210, 80]]) {
    const p = sampleWater(waves, settings, x, z, 7.3);
    close(p.slopeX, (sampleWater(waves, settings, x + epsilon, z, 7.3).height - sampleWater(waves, settings, x - epsilon, z, 7.3).height) / (2 * epsilon), 3e-5);
    close(p.slopeZ, (sampleWater(waves, settings, x, z + epsilon, 7.3).height - sampleWater(waves, settings, x, z - epsilon, 7.3).height) / (2 * epsilon), 3e-5);
    close(p.velocityY, (sampleWater(waves, settings, x, z, 7.3 + epsilon).height - sampleWater(waves, settings, x, z, 7.3 - epsilon).height) / (2 * epsilon), 3e-5);
  }
});

test('the large set remains unsheltered consistently in CPU height and derivatives', () => {
  const waves = buildWaves({ ...environment, wk: 0, sh: 0 });
  const king = { on: true, d: [1, 0], pos: 0, A: 3.6, c: 11 };
  const inner = sampleWater(waves, { ...settings, shelterX: 0, shelterZ: 0, king }, 10, 0, 0);
  const outer = sampleWater(waves, { ...settings, shelterX: 1000, shelterZ: 1000, king }, 10, 0, 0);
  close(inner.height, outer.height); close(inner.slopeX, outer.slopeX);
});

test('exact vessel spring damping is invariant across display rates and bounded through a stall', () => {
  for (const damping of [.22, .35, .5, 1, 2]) {
    const reference = { y: -.2, v: .6 };
    stepDampedSpring(reference, 'y', 'v', .4, 3.7, damping, 2);
    for (const rate of [30, 60, 120, 144]) {
      const state = { y: -.2, v: .6 };
      for (let i = 0; i < rate * 2; i++) stepDampedSpring(state, 'y', 'v', .4, 3.7, damping, 1 / rate);
      close(state.y, reference.y, 1e-12); close(state.v, reference.v, 1e-12);
    }
    const stalled = { y: 2, v: 8 };
    stepDampedSpring(stalled, 'y', 'v', 0, 3.7, damping, 10);
    assert.ok(Math.abs(stalled.y) < .05 && Math.abs(stalled.v) < .05);
  }
});

test('vessel response to a moving wave target converges across display rates', () => {
  const sample = rate => {
    const state = { y: 0, v: 0 };
    for (let i = 1; i <= rate * 10; i++) stepDampedSpring(state, 'y', 'v', .4 * Math.sin(i / rate * 1.1), 2.85, .5, 1 / rate);
    return state;
  };
  const reference = sample(480);
  for (const rate of [30, 60, 120, 144]) {
    const state = sample(rate);
    close(state.y, reference.y, .009); close(state.v, reference.v, .012);
  }
});

test('foam decay composes in time and its diffusion stencil remains nonnegative', () => {
  close(foamParameters(1 / 30).decay, foamParameters(1 / 60).decay ** 2, 1e-12);
  close(foamParameters(.3).decay, .5, 1e-12);
  for (const dt of [0, 1 / 144, 1 / 60, 1 / 30, .1, 10]) {
    const step = foamParameters(dt);
    assert.ok(step.spread >= 0 && 1 - 4 * step.spread >= 0);
    close(step.decay + step.stampWeight, 1);
  }
});

test('both sea shaders share the tested analytic model and uniform wave parameters', t => {
  const h = createGameHarness(); t.after(() => h.close());
  assert.equal(h.run('sea.material.vertexShader.includes(WATER_GLSL)'), true);
  assert.equal(h.run('sea.material.fragmentShader.includes(WATER_GLSL)'), true);
  assert.match(WATER_GLSL, /waterSurface/);
  h.run('env.sh=5;setWaves();');
  assert.deepEqual(h.read('U.uW.value.map(w=>w.toArray())'), h.read('WV.map(w=>[w.dx,w.dz,w.k,w.amp])'));
  assert.deepEqual(h.read('U.uOm.value'), h.read('WV.map(w=>w.om)'));
  close(h.run('U.uChop.value'), h.run('WV.chop'));
  assert.equal(h.run('sea.geometry.attributes.normal'), undefined);
  assert.equal(h.run('sea.geometry.attributes.uv'), undefined);
  assert.deepEqual(h.errors.map(String), []);
});

test('foam uses thirty field updates per second at any render rate and skips an empty field', t => {
  const h = createGameHarness(); t.after(() => h.close());
  for (const rate of [30, 60, 120, 144]) {
    h.run('reset();spawn(0,S.x,S.y,0,0,1,5,0);');
    const before = h.renderer.foamPasses;
    h.run(`for(let i=0;i<${rate};i++)foamPass(1/${rate});`);
    assert.equal(h.renderer.foamPasses - before, 30, `field rate at ${rate} Hz`);
  }
  h.run('reset();');
  const before = h.renderer.foamPasses;
  h.run('for(let i=0;i<120;i++)foamPass(1/60);');
  assert.equal(h.renderer.foamPasses, before, 'empty foam does not run an offscreen pass');
  assert.deepEqual(h.errors.map(String), []);
});

test('mobile and reduced detail tiers cut real geometry, texture and shader work', t => {
  const desktop = waterQuality(false, false), mobile = waterQuality(true, false), low = waterQuality(true, true);
  assert.ok(mobile.segments ** 2 < desktop.segments ** 2 / 2);
  assert.equal(mobile.foamResolution ** 2, desktop.foamResolution ** 2 / 4);
  assert.ok(low.rippleOctaves < mobile.rippleOctaves && mobile.rippleOctaves < desktop.rippleOctaves);
  assert.equal(low.foamDetail, 0); assert.equal(low.wakeStride, 2);
  const h = createGameHarness({ coarse: true, width: 844, height: 390 }); t.after(() => h.close());
  assert.equal(h.run('sea.geometry.index.count/3'), 2 * mobile.segments ** 2);
  assert.equal(h.run('rtA.width'), mobile.foamResolution);
  const old = h.run('sea.geometry'); let disposed = false;
  old.addEventListener('dispose', () => { disposed = true; });
  h.run('applyWaterQuality(true);');
  assert.equal(disposed, true);
  assert.equal(h.run('sea.geometry.index.count/3'), 2 * low.segments ** 2);
  assert.equal(h.run('U.uRippleCount.value'), low.rippleOctaves);
  assert.equal(h.run('U.uFoamDetail.value'), 0);
});

test('wind-blown spray survives reduced detail and makes foam when it reaches the moving water', t => {
  const h = createGameHarness({ coarse: true }); t.after(() => h.close());
  h.run("setShip('tender');start();env.wk=20;env.wFrom=270;env.sh=0;setWaves();parts=[];");
  const puff = h.run(`(() => {
    const p=puff(S.x,1,S.y,false);p.x=S.x;p.z=S.y;p.spray=true;p.dr=1;p.g=9.81;
    p.vx=p.vy=p.vz=0;p.life=p.max=5;p.s=.5;return p;
  })()`);
  const initialX = puff.x;
  h.run('applyWaterQuality(true);updateSmoke(1/60);');
  assert.equal(puff.sp.visible, true, 'the low-detail tier retains live spray');
  assert.ok(puff.vx > 0, 'wind pushes the spray downwind');
  h.run('for(let i=0;i<60;i++)updateSmoke(1/60);');
  assert.ok(puff.x > initialX);
  assert.equal(puff.hitWater, true);
  assert.ok(h.run('parts.some(p=>p.k===1)'), 'the landing leaves surface foam');
  const reused = h.run('puff(S.x,1,S.y,false)');
  assert.equal(reused, puff);
  assert.equal(reused.hitWater, false, 'a recycled sprite can splash again');
  assert.deepEqual(h.errors.map(String), []);
});
