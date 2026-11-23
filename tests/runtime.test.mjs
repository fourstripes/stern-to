import test from 'node:test';
import assert from 'node:assert/strict';
import { FIXED_STEP, MAX_STEPS, planSimulationSteps, renderPixelRatio, AdaptiveQuality } from '../src/runtime.js';

for (const refreshRate of [30, 60, 120, 144]) {
  test(`ten seconds advances the same simulation at ${refreshRate} Hz`, () => {
    let accumulator = 0;
    let steps = 0;
    for (let frame = 0; frame < refreshRate * 10; frame++) {
      const plan = planSimulationSteps(accumulator, 1 / refreshRate);
      steps += plan.count;
      accumulator = plan.remainder;
    }
    assert.equal(steps, 600);
    assert.ok(accumulator < FIXED_STEP);
  });
}

test('a long stall has a bounded catch-up budget', () => {
  assert.equal(planSimulationSteps(0, 30).count, MAX_STEPS);
  assert.equal(planSimulationSteps(0, 30).remainder, 0);
  assert.deepEqual(planSimulationSteps(0, -1), { count: 0, remainder: 0 });
  assert.deepEqual(planSimulationSteps(NaN, Infinity), { count: 0, remainder: 0 });
});

test('irregular frames preserve elapsed simulation time', () => {
  let accumulator = 0, elapsed = 0, simulated = 0;
  for (const delta of [0.012, 0.021, 0.016, 0.03, 0.009, 0.017, 0.008]) {
    const plan = planSimulationSteps(accumulator, delta);
    accumulator = plan.remainder;
    simulated += plan.count * FIXED_STEP;
    elapsed += delta;
  }
  assert.ok(Math.abs(elapsed - simulated - accumulator) < 1e-9);
});

test('drawing buffer fits the pixel budget on high resolution displays', () => {
  const ratio = renderPixelRatio(3840, 2160, 3, 1);
  assert.ok(3840 * 2160 * ratio ** 2 <= 4_200_001);
  assert.equal(renderPixelRatio(390, 844, 3, 1), 2);
  assert.equal(renderPixelRatio(1280, 720, 1, 0.85), 0.85);
  assert.ok(Number.isFinite(renderPixelRatio(0, 0, 0)));
});

test('quality reacts to sustained load and recovers without rapid toggling', () => {
  const quality = new AdaptiveQuality();
  quality.sample(5);
  assert.equal(quality.low, false, 'one stalled or hidden frame must not downgrade quality');
  for (let i = 0; i < 160; i++) quality.sample(1 / 25);
  assert.equal(quality.low, true);
  assert.ok(quality.scale < 1 && quality.scale >= 0.7);
  const reduced = quality.scale;
  for (let i = 0; i < 60; i++) quality.sample(1 / 60);
  assert.equal(quality.scale, reduced, 'recovery needs several seconds of headroom');
  for (let i = 0; i < 60 * 55; i++) quality.sample(1 / 60);
  assert.equal(quality.scale, 1);
  assert.equal(quality.low, false);
});
