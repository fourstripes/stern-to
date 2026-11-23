import assert from 'node:assert/strict';
import test from 'node:test';
import { createVesselPhysics, vesselForces, bodyAcceleration, resolveContact } from '../src/physics.js';
import { createGameHarness } from './helpers/game-harness.mjs';

// Read the actual ship configurations rather than maintaining test-only hulls.
const catalogue = createGameHarness();
const ships = catalogue.read('SHIPS');
catalogue.close();
const energy = (model, v) => .5 * (model.mx * v.u ** 2 + model.my * v.v ** 2 + model.iz * v.r ** 2);
const neutral = { rpm: [0, 0], thrAct: 0, rud: 0 };

for (const [id, ship] of Object.entries(ships)) {
  const model = createVesselPhysics(ship);

  test(`${id}: complete Coriolis coupling has zero kinetic power`, () => {
    for (const u of [-8, -.3, 0, 12]) for (const v of [-2, .4]) for (const r of [-.3, .17]) {
      const a = bodyAcceleration(model, { u, v, r }, { X: 0, Y: 0, N: 0 });
      const power = model.mx * u * a.u + model.my * v * a.v + model.iz * r * a.r;
      assert.ok(Math.abs(power) < 1e-7, `Coriolis power ${power} W at ${[u, v, r]}`);
    }
  });

  test(`${id}: hull and an unpowered rudder cannot create kinetic energy`, () => {
    for (const u of [-8, -1, 0, 14]) for (const v of [-2, .4]) for (const r of [-.2, .15]) for (const rud of [-35, 0, 35]) {
      const f = vesselForces(model, { ...neutral, u, v, r, rud });
      assert.ok(f.X * u + f.Y * v + f.N * r <= 1e-8, `Passive power at ${[u, v, r, rud]}`);
    }
  });

  test(`${id}: port, starboard, ahead and astern controls have consistent signs`, () => {
    const rest = { ...neutral, u: 0, v: 0, r: 0 };
    const ahead = vesselForces(model, { ...rest, rpm: [1, 1] });
    const astern = vesselForces(model, { ...rest, rpm: [-1, -1] });
    const split = vesselForces(model, { ...rest, rpm: [1, -1] });
    const thruster = vesselForces(model, { ...rest, thrAct: 1 });
    const rudder = vesselForces(model, { ...rest, u: 3, rud: 35 });
    const reverseRudder = vesselForces(model, { ...rest, u: -3, rud: 35 });
    assert.ok(ahead.X > 0 && Math.abs(ahead.N) < 1e-10);
    assert.ok(astern.X < 0 && Math.abs(astern.X) < ahead.X);
    assert.ok(split.N > 0 && thruster.Y > 0 && thruster.N > 0);
    assert.ok(rudder.Y < 0 && rudder.N > 0);
    assert.ok(reverseRudder.Y > 0 && reverseRudder.N < 0);
    const faded = vesselForces(model, { ...rest, u: 4, thrAct: 1 });
    const noThruster = vesselForces(model, { ...rest, u: 4 });
    assert.deepEqual(faded, noThruster);
  });

  test(`${id}: oblique fixed contacts dissipate energy with directional added mass`, () => {
    for (let i = 0; i < 40; i++) {
      const angle = i * 1.17, nx = Math.cos(angle), ny = Math.sin(angle);
      const velocity = { u: -3 * nx - 1.2 * ny, v: -3 * ny + 1.2 * nx, r: (i % 3 - 1) * .03 };
      const result = resolveContact(model, velocity, { a: (i % 5 - 2) * ship.L / 5, b: (i % 3 - 1) * ship.B / 2, nx, ny });
      assert.ok(energy(model, result) <= energy(model, velocity) + 1e-6);
    }
    const impact = { u: 0, v: -2, r: 0 }, central = { a: 0, b: 0, nx: 0, ny: 1 };
    const bare = resolveContact(model, impact, { ...central, restitution: .15 });
    const fender = resolveContact(model, impact, { ...central, restitution: .05 });
    assert.ok(Math.abs(bare.v - .3) < 1e-12);
    assert.ok(Math.abs(fender.v - .1) < 1e-12);
    assert.ok(energy(model, fender) < energy(model, bare));
    const traffic = resolveContact(model, { u: 0, v: 0, r: 0 }, { ...central, otherV: 2 });
    assert.ok(traffic.impact === 2 && traffic.v > 0);
  });
}

function fixture(t, id = 'super') {
  const h = createGameHarness();
  t.after(() => h.close());
  h.run(`setShipParams(${JSON.stringify(id)});pick(0);reset();state='play';obstacles=[];env.wk=env.sh=0;S.x=S.y=S.psi=0;`);
  return h;
}

const handlingBounds = {
  tender: { cruise: [26, 29], stop: [35, 65], seconds: [5, 9], diameter: [50, 80], yaw: 26, drift: [4, 14] },
  super: { cruise: [15, 17], stop: [40, 70], seconds: [11, 18], diameter: [85, 130], yaw: 9, drift: [3, 9] },
  ls: { cruise: [16, 18], stop: [65, 105], seconds: [17, 27], diameter: [140, 200], yaw: 6, drift: [2, 8] }
};
const within = (value, range, label) => assert.ok(value >= range[0] && value <= range[1], `${label}: ${value} outside ${range}`);

for (const [id, limits] of Object.entries(handlingBounds)) {
  test(`${id}: actual fixed-step game preserves cruise, stopping, turning and wind drift envelopes`, t => {
    const h = fixture(t, id);
    const result = h.run(`(() => {
      const tick=()=>{T+=1/60;step(1/60);parts.length=0;};
      S.lever=[1,1];S.gear=[1,1];S.rpm=[1,1];
      for(let i=0;i<10800;i++)tick();
      const cruise=S.u, speed=cruise*KN, start=S.x;
      S.lever=[-1,-1];let frames=0;
      while(S.u>0&&frames<10800){tick();frames++;}
      const stop=S.x-start, seconds=frames/60;
      S.x=S.y=S.psi=0;S.u=cruise;S.v=S.r=0;S.lever=[1,1];S.gear=[1,1];S.rpm=[1,1];S.rud=35;
      let yaw=0;for(let i=0;i<7200;i++){tick();yaw=Math.max(yaw,Math.abs(S.r));}
      const diameter=2*Math.hypot(S.u,S.v)/Math.abs(S.r);
      reset();state='play';obstacles=[];env.wk=15;env.wFrom=0;env.sh=0;S.x=S.y=S.psi=0;
      for(let i=0;i<1800;i++)tick();
      return {speed,stop,seconds,diameter,yaw:yaw/D2R,drift:Math.hypot(S.x,S.y)};
    })()`);
    for (const key of ['cruise', 'stop', 'seconds', 'diameter', 'drift']) within(result[key === 'cruise' ? 'speed' : key], limits[key], `${id} ${key}`);
    assert.ok(result.yaw < limits.yaw, `${id} peak turn rate ${result.yaw} deg/s`);
    assert.deepEqual(h.errors, []);
  });

  test(`${id}: a small sideways disturbance decays with the helm centred`, t => {
    const h = fixture(t, id);
    const settled = h.run(`(() => {
      S.u=${limits.cruise[0]}/KN;S.v=.05;S.r=.005;S.lever=[1,1];S.gear=[1,1];S.rpm=[1,1];
      for(let i=0;i<7200;i++){T+=1/60;step(1/60);parts.length=0;}
      return {v:S.v,r:S.r,heading:S.psi};
    })()`);
    assert.ok(Math.abs(settled.v) < .005, `${id} persistent sway ${settled.v}`);
    assert.ok(Math.abs(settled.r) < .0001, `${id} uncommanded turn ${settled.r}`);
    assert.ok(Math.abs(settled.heading) < .1, `${id} departed straight course ${settled.heading}`);
  });
}

test('automatic Weigh reels in chain, can be held, and respects a manual slack override', t => {
  const h = fixture(t);
  h.run(`S.anchors=[{side:-1,x:19.4,y:-2.4,L0:10,held:true,set:false}];bringInAnchors();`);
  assert.equal(h.read('S.anchors.length'), 1);
  assert.equal(h.read('S.anchors[0].weighing'), true);
  h.run('step(1/60)');
  within(h.read('S.anchors[0].L0'), [9.98, 10], 'Chain retrieval rate');
  h.run('bringInAnchors();step(1/60)');
  const held = h.read('S.anchors[0].L0');
  h.run('step(1/60)');
  assert.equal(h.read('S.anchors[0].L0'), held);
  h.run('bringInAnchors();adjustAnchorChain(selectedAnchors(),-1);step(1/60)');
  assert.equal(h.read('S.anchors[0].weighing'), false);
  assert.ok(h.read('S.anchors[0].L0') > held);
  h.run('S.anchors[0].L0=2.01;bringInAnchors();step(1/60)');
  assert.equal(h.read('S.anchors.length'), 0);
});

test('weighing cannot teleport a distant anchor aboard and does not cancel another line hold', t => {
  const h = fixture(t);
  h.run(`S.anchors=[{side:-1,x:40,y:-2.4,L0:2.01,held:true,set:true,weighing:true}];step(1/60);`);
  assert.equal(h.read('S.anchors.length'), 1);
  h.run(`
    S.anchors[0].x=S.x+19.4;S.anchors[0].y=S.y-2.4;
    S.u=S.v=S.r=S.psi=0;sel=0;
    lines[0].state='fast';lines[0].L0=10;lines[0].bol={x:21,y:-8};
  `);
  h.run('setHeldInput("test:line",{kind:"haul",direction:1});step(1/60)');
  assert.equal(h.read('S.anchors.length'), 0);
  assert.equal(h.read('haul'), 1);
  assert.equal(h.read('sel'), 0);
});

test('two anchors cannot complete a shore-service berth without shore lines', t => {
  const h = fixture(t);
  h.run(`
    pick(3);state='play';obstacles=[];env.wk=env.sh=0;
    S.x=slip.x;S.y=slip.y;S.psi=slip.h;S.hold=2.999;
    S.anchors=[-1,1].map(side=>{const [a,b]=hawseFor(side),c=Math.cos(S.psi),s=Math.sin(S.psi);return{side,x:S.x+a*c-b*s,y:S.y+a*s+b*c,L0:30,held:true,set:true};});
    step(1/60);
  `);
  assert.equal(h.read('S.svc'), null);
  assert.equal(h.read('S.done'), false);
});

test('swell forcing follows the shared down-slope phase and roll changes sign across the beam', t => {
  const h = fixture(t);
  const result = h.run(`(() => {
    env.sh=1;env.wk=0;env.sFrom=180;S.x=0;S.y=960;S.psi=0;T=0;
    step(1/60);const starboard={v:S.v,roll:S.roll};
    S.u=S.v=S.r=0;S.x=0;S.y=960;S.psi=Math.PI;T=0;
    step(1/60);return {starboard,port:{v:S.v,roll:S.roll}};
  })()`);
  assert.ok(result.starboard.v > 0, 'Water rises against travel at phase zero, so the boat accelerates down-slope');
  assert.ok(result.port.v < 0);
  assert.ok(result.starboard.roll < 0 && result.port.roll > 0);
});

test('wind heel follows the wind force and an abandoned gear change clears its clutch timer', t => {
  const h = fixture(t);
  h.run('env.wk=15;env.wFrom=0;step(1/60);');
  assert.ok(h.read('S.v') > 0);
  assert.ok(h.read('S.roll') < 0, 'pose subtracts this value, leaning the starboard side down');
  h.run('S.gear[0]=1;S.rpm[0]=0;S.clutch[0]=.4;S.lever[0]=.5;step(1/60);');
  assert.equal(h.read('S.clutch[0]'), 0);
});

function setFinalAnchorage(h, shortBy = 0) {
  h.run(`
    pick(3);state='play';S.stage=stops.length-1;setStop(S.stage);obstacles=[];env.wk=env.sh=0;
    S.x=slip.x;S.y=slip.y;S.psi=0;S.u=S.v=S.r=0;
    const hp=hawseFor(shipId==='tender'?0:-1);
    S.anchors=[{side:shipId==='tender'?0:-1,x:S.x+hp[0],y:S.y+hp[1],L0:Math.ceil(18*Math.max(.7,SL))-${shortBy},held:true,set:false}];
  `);
}

for (const [id, target] of [['tender', 13], ['super', 18], ['ls', 27]]) {
  test(`${id}: exact displayed chain target wins the final anchorage without stretching the chain`, t => {
    const h = fixture(t, id);
    setFinalAnchorage(h);
    const initial = h.read('anchorageStatus()');
    assert.equal(initial.target, target);
    assert.equal(initial.current, target);
    assert.equal(initial.inside, true);
    assert.equal(initial.held, true);
    assert.equal(initial.settled, true);
    assert.equal(initial.progress, 0);
    assert.equal(h.read('S.anchors[0].set'), false);
    h.run('for(let i=0;i<181;i++){T+=1/60;step(1/60);}');
    const complete = h.read('anchorageStatus()');
    assert.equal(h.read('S.anchors[0].set'), true);
    assert.equal(h.read('S.done'), true);
    assert.equal(complete.complete, true);
    assert.equal(complete.progress, 1);
    assert.ok(h.read('S.cineT') >= 0);
  });
}

test('final anchorage rejects short, unheld and outside chains, then resets progress when disturbed', t => {
  const h = fixture(t);
  setFinalAnchorage(h, .01);
  h.run('for(let i=0;i<200;i++){T+=1/60;step(1/60);}');
  assert.equal(h.read('S.done'), false);
  assert.equal(h.read('S.svc'), null);
  assert.equal(h.read('anchorageStatus().target'), 18);
  h.run('S.anchors[0].L0=18;S.anchors[0].held=false;step(1/60);');
  assert.equal(h.read('S.svc'), null);
  h.run('S.anchors[0].held=true;S.anchors[0].x=slip.x+slip.len;step(1/60);');
  assert.equal(h.read('anchorageStatus().inside'), false);
  assert.equal(h.read('S.svc'), null);
  setFinalAnchorage(h);
  h.run('S.anchors[0].set=true;S.x+=50;step(1/60);');
  assert.equal(h.read('S.anchors[0].drag'), true);
  assert.equal(h.read('anchorageStatus().settled'), false);
  assert.equal(h.read('S.svc'), null);
  setFinalAnchorage(h);
  h.run('for(let i=0;i<60;i++){T+=1/60;step(1/60);}');
  assert.ok(h.read('anchorageStatus().progress') > .3);
  h.run('S.u=.5;step(1/60);');
  assert.equal(h.read('S.svc'), null);
  assert.equal(h.read('anchorageStatus().progress'), 0);
  assert.equal(h.read('S.done'), false);
});

test('a second secure anchor can satisfy the final goal when the first anchor is dragging', t => {
  const h = fixture(t);
  setFinalAnchorage(h);
  h.run('S.anchors[0].drag=true;S.anchors.push({...S.anchors[0],side:1,drag:false});');
  assert.equal(h.read('anchorageStatus().settled'), true);
  h.run('S.anchors[1].held=false;');
  assert.equal(h.read('anchorageStatus().settled'), false);
});
