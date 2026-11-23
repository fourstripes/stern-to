import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';

test('pause and clock resets display the current vessel pose without rewinding interpolation', t => {
  const h = createGameHarness();
  t.after(() => h.close());
  h.click('go');
  h.run('S.x=100;S.y=200;S.psi=.8;S.px=99.8;S.py=199.9;S.ppsi=.79;acc=FIXED_STEP*.25;');
  h.click('pauseBtn');
  assert.deepEqual(h.read('[S.px,S.py,S.ppsi,acc]'), [100, 200, .8, 0]);
  h.frame();
  assert.deepEqual(h.read('[RX,RY,RP,own.position.x,own.position.z,own.rotation.y]'), [100, 200, .8, 100, 200, -.8]);

  // The first resumed display can precede the next 60 Hz simulation tick.
  h.click('pauseBtn');
  h.frame(5);
  assert.deepEqual(h.read('[RX,RY,RP]'), [100, 200, .8]);

  // Opening a menu freezes the current simulation position, even with a remainder.
  h.run('S.px=99.8;S.py=199.9;S.ppsi=.79;acc=FIXED_STEP*.25;');
  h.click('menuBtn');
  h.frame();
  assert.deepEqual(h.read('[RX,RY,RP]'), [100, 200, .8]);
  assert.deepEqual(h.errors.map(String), []);
});

test('camera matrices are current before overlays project points for a changed view', t => {
  const h = createGameHarness();
  t.after(() => h.close());
  let checked = false;
  const render = h.renderer.render.bind(h.renderer);
  h.renderer.render = (scene, camera) => {
    if (!h.renderer.getRenderTarget()) {
      // Inspect before FakeRenderer performs the renderer's usual matrix update.
      // The production overlay calculations have already used this camera.
      const expected = camera.clone();
      expected.updateMatrixWorld();
      for (let i = 0; i < 16; i++) {
        assert.ok(Math.abs(camera.matrixWorldInverse.elements[i] - expected.matrixWorldInverse.elements[i]) < 1e-10,
          `camera inverse entry ${i} reflects this frame's position and rotation`);
      }
      checked = true;
    }
    render(scene, camera);
  };
  h.run('rotv=1.4;pitch=1.1;cam.x+=120;cam.y-=80;invalidateFrame();');
  h.frame();
  assert.equal(checked, true);
  assert.deepEqual(h.errors.map(String), []);
});
