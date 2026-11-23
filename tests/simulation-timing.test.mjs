import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';

function simulate(frameMs, setup, duration, snapshot) {
  const h = createGameHarness();
  try {
    h.click('go');
    h.run(setup + ';resetFrameClock();');
    h.advance(duration, frameMs);
    assert.deepEqual(h.errors.map(String), []);
    return h.read(snapshot);
  } finally { h.close(); }
}

function near(actual, expected, path = 'state') {
  if (typeof expected === 'number') {
    assert.ok(Math.abs(actual - expected) < 1e-7, `${path}: ${actual} matches ${expected}`);
  } else if (expected && typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual), Object.keys(expected), path);
    for (const key of Object.keys(expected)) near(actual[key], expected[key], `${path}.${key}`);
  } else assert.equal(actual, expected, path);
}

test('anchor deployment and fender work use the same simulation time at 30, 60 and 120 Hz', () => {
  const setup = 'S.x=S.px=1000;S.y=S.py=1000;S.u=S.v=S.r=0;env.wk=0;env.sh=0;dropAnchors();S.fend=3';
  const snapshot = '({time:S.t,bow:[S.bowX,S.bowY],anchors:S.anchors.map(a=>({side:a.side,x:a.x,y:a.y,length:a.L0,held:a.held})),fenders:S.fendN,crew:crew.map(c=>[c.position.x,c.position.z])})';
  const baseline = simulate(1000 / 60, setup, 3000, snapshot);
  assert.equal(baseline.anchors.length, 1);
  assert.ok(baseline.fenders.some(n => n > 0));
  for (const hz of [30, 120]) near(simulate(1000 / hz, setup, 3000, snapshot), baseline, `${hz} Hz`);
});

test('mission weather and its vessel forces are independent of display refresh rate', () => {
  const setup = "pick(3);state='play';S.stage=3;setStop(3);S.x=S.px=560;S.y=S.py=332;S.u=S.v=S.r=0;S.leg0={d:500,wk:10,sh:.3}";
  const snapshot = '({time:S.t,pose:[S.x,S.y,S.psi],motion:[S.u,S.v,S.r,S.roll],wind:env.wk,swell:env.sh,night:S.night,king:[KW.on,KW.pos,KW.A],shelter:[shC.x,shC.y]})';
  const baseline = simulate(1000 / 60, setup, 1500, snapshot);
  assert.equal(baseline.king[0], true);
  for (const hz of [30, 120]) near(simulate(1000 / hz, setup, 1500, snapshot), baseline, `${hz} Hz`);
});

test('pausing freezes pending deck work and mission weather', t => {
  const h = createGameHarness();
  t.after(() => h.close());
  h.click('go');
  h.run('dropAnchors();S.fend=3;');
  h.click('pauseBtn');
  const snapshot = '({time:S.t,bow:S.bowX,anchors:S.anchors.length,fenders:S.fendN,wind:env.wk,swell:env.sh})';
  const before = h.read(snapshot);
  h.advance(3000, 1000 / 120);
  assert.deepEqual(h.read(snapshot), before);
});
