import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as physics from '../src/physics.js';
import * as navigation from '../src/navigation.js';
import * as water from '../src/water.js';

const source = readFileSync(new URL('../src/game.js', import.meta.url), 'utf8');

function between(start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Production source section exists: ${start}`);
  return source.slice(first, last);
}

// Execute the actual private game functions with graphics and browser services
// stubbed out. No simulation or state-transition logic is duplicated here.
function game() {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        value: 0, hidden: false, textContent: '', children: [],
        setAttribute() {},
        classList: {
          add: name => classes.add(name),
          remove: name => classes.delete(name),
          contains: name => classes.has(name),
          toggle(name, enabled) {
            const on = enabled === undefined ? !classes.has(name) : enabled;
            if (on) classes.add(name); else classes.delete(name);
            return on;
          }
        }
      });
    }
    return elements.get(id);
  };
  const math = Object.create(Math);
  math.random = () => .5;
  const context = vm.createContext({
    ...physics, ...navigation, ...water,
    Math: math, Set, Map, console, $: element, clearTimeout() {},
    toast() {}, spawn() {}, spray() {}, wakeDrop() {},
    build3D() {}, buildSlipMarker() {}, resetVisuals() {},
    releaseControls() {}, releaseMooringInputs() {}, setMooringSection() {}, updateMooringUI() {}, resetFrameClock() {}, condLabels() {},
    advanceMissionEnvironment() {}, advanceDeckWork() {}, setWaves() {}, updateNavigation() {},
    finish() {}, startNight() {}, shelter: () => 1
  });
  vm.runInContext(`
    const KN=1.94384,D2R=Math.PI/180,TAU=Math.PI*2;
    const sgn=Math.sign,clamp=(v,a,b)=>Math.max(a,Math.min(b,v)),rnd=(a,b)=>(a+b)/2;
    ${between('/* ---------- ship ---------- */', '/* ---------- state ---------- */')}
    const WV=buildWaves(env);
    function setWaves(){buildWaves(env,WV);}
    let S,state='menu',T=0,parts=[],toastT=0,banner='',paused=false;
    let nightEnv0=null,physGood=null,physWarned=false;
    const KW={on:false,d:[1,0],pos:0,A:0,c:11},U={uNight:{value:0}};
    const cam={x:0,y:0},camOff={x:0,y:0},bEl={children:[]};
    function applyNight(n){U.uNight.value=n;}
    ${between('function reset()', '/* ---------- results ---------- */')}
    ${between('function passage()', '/* toasts:')}
    ${between('function pick(i)', '// mission: start')}
    pick(0);
  `, context);
  return {
    element,
    run(code) { return vm.runInContext(code, context); },
    read(code) { return JSON.parse(vm.runInContext(`JSON.stringify(${code})`, context)); }
  };
}

test('changing harbours uses the selected weather, not the previous mission storm', () => {
  const g = game();
  g.run('pick(3);S.leg0={wk:22,sh:1.2};nightEnv0={wk:28,sh:1.4};env.wk=28;env.sh=1.4;pick(0);');
  assert.deepEqual(g.read('[env.wk,env.sh]'), [5, .2]);
  assert.equal(g.element('cW').value, 5);
  assert.equal(g.element('cS').value, .2);
});

test('restart preserves custom conditions and resets mission traffic and transient clocks', () => {
  const g = game();
  g.run(`
    pick(3);
    $('cW').oninput({target:{value:'18'}});
    $('cD').oninput({target:{value:'150'}});
    $('cS').oninput({target:{value:'0.8'}});
    S.leg0={wk:3,sh:.1};env.wk=29;env.sh=1.5;T=900;toastT=800;
    for(const o of obstacles)if(o.tr){o.x=777;o.y=888;o.tr.st='done';o.tr.i=3;o.tr.v=4;o.tr.said=true;}
    reset();
  `);
  assert.deepEqual(g.read('[env.wk,env.wFrom,env.sh,T,toastT,S.t]'), [18, 150, .8, 0, 0, 0]);
  const traffic = g.read('obstacles.filter(o=>o.tr).map(o=>({x:o.x,y:o.y,origin:o.tr.origin,state:o.tr.st,index:o.tr.i,speed:o.tr.v,said:o.tr.said}))');
  assert.equal(traffic.length, 2);
  for (const boat of traffic) {
    assert.equal(boat.x, boat.origin.x);
    assert.equal(boat.y, boat.origin.y);
    assert.equal(boat.state, 'wait');
    assert.equal(boat.index, 1);
    assert.equal(boat.speed, 0);
    assert.equal(boat.said, false);
  }
});

test('restart or a new harbour cancels a pending passage', () => {
  const g = game();
  g.run('state="play";passage();advancePassage(.3);reset();');
  assert.equal(g.run('advancePassage(10)'), false);
  assert.equal(g.run('lvI'), 0);
  assert.equal(g.element('fade').classList.contains('on'), false);
  g.run('passage();pick(2);');
  assert.equal(g.run('advancePassage(10)'), false);
  assert.equal(g.run('lvI'), 2);
});

test('passage advances only with simulation time and carries voyage totals', () => {
  const g = game();
  g.run('state="play";S.damage=23;S.hits=2;S.t=96;S.u=3;passage();');
  assert.equal(g.run('advancePassage(0)'), false);
  assert.equal(g.run('advancePassage(.69)'), false);
  assert.equal(g.run('lvI'), 0);
  assert.equal(g.run('advancePassage(.01)'), true);
  assert.deepEqual(g.read('[lvI,S.damage,S.hits,S.t,S.u,S.legT0,S.passing]'), [1, 23, 2, 96, 3, 96, false]);
  assert.equal(g.element('fade').classList.contains('on'), false);
});

test('SAT resolves a fully contained hull in one separation', () => {
  const g = game();
  assert.equal(g.run(`(() => {
    const hull=[[-1,-1],[1,-1],[1,1],[-1,1]],quay=[[-5,-5],[5,-5],[5,5],[-5,5]];
    const hit=sat(hull,quay);
    if(!hit||hit.depth!==6)return false;
    return sat(hull.map(p=>[p[0]+hit.n[0]*hit.depth,p[1]+hit.n[1]*hit.depth]),quay)===null;
  })()`), true);
});

test('moving traffic transfers a collision to a stationary yacht', () => {
  const g = game();
  const setup = speed => `
    reset();S.x=0;S.y=0;S.psi=0;S.t=10;
    obstacles=[{kind:'boat',p:poly(0,29.5,-Math.PI/2,50,9.4),cx:0,cy:29.5,x:0,y:29.5,r:26,psi:-Math.PI/2,tr:{st:'go',v:${speed},stopT:0}}];
    collide();
  `;
  g.run(setup(0));
  assert.equal(g.run('S.damage'), 0);
  g.run(setup(4));
  assert.ok(g.run('S.damage') > 0);
  assert.equal(g.run('S.hits'), 1);
  assert.equal(g.run('obstacles[0].tr.v'), 0);
});

test('traffic cannot start moving during a zero-time or menu update', () => {
  const g = game();
  g.run('pick(3);S.stage=1;S.x=181;S.y=0;state="play";updateTraffic(0);');
  assert.equal(g.run('obstacles.find(o=>o.tr).tr.st'), 'wait');
  g.run('state="menu";updateTraffic(1);');
  assert.equal(g.run('obstacles.find(o=>o.tr).tr.st'), 'wait');
  g.run('state="play";updateTraffic(1/60);');
  assert.equal(g.run('obstacles.find(o=>o.tr).tr.st'), 'go');
});

test('an anchor stops reporting dragging once the chain is slack', () => {
  const g = game();
  g.run(`
    state='play';env.wk=env.sh=0;obstacles=[];S.x=0;S.y=0;S.psi=0;
    S.anchors=[{side:-1,x:30,y:-2.4,L0:20,held:true,set:true,drag:true}];
    step(1/60);
  `);
  assert.equal(g.run('S.anchors[0].drag'), false);
});

test('a dragging anchor and a yacht still making way cannot complete the anchorage', () => {
  const g = game();
  g.run(`
    pick(3);state='play';env.wk=env.sh=0;obstacles=[];S.stage=3;setStop(3);
    S.x=slip.x+100;S.y=slip.y;S.psi=0;S.u=8;
    S.anchors=[{side:-1,x:slip.x,y:slip.y,L0:100,held:true,set:true,drag:true}];
    step(1/60);
  `);
  assert.equal(g.run('S.anchors[0].drag'), true);
  assert.equal(g.run('S.svc'), null);
  assert.equal(g.run('S.done'), false);
});

test('a held anchor and a stationary yacht can complete the anchorage', () => {
  const g = game();
  g.run(`
    pick(3);state='play';env.wk=env.sh=0;obstacles=[];S.stage=3;setStop(3);
    S.x=slip.x-19.4;S.y=slip.y+2.4;S.psi=0;
    S.anchors=[{side:-1,x:slip.x,y:slip.y,L0:20,held:true,set:true,drag:false}];
    for(let i=0;i<181;i++)step(1/60);
  `);
  assert.equal(g.run('S.done'), true);
});

test('interrupted shipyard visits retain all repaired damage in the mission score', () => {
  const g = game();
  g.run(`
    pick(3);state='play';env.wk=env.sh=0;obstacles=[];S.stage=1;setStop(1);
    S.x=slip.x;S.y=slip.y;S.psi=slip.h;S.damage=60;S.hold=3;
    for(const line of lines.slice(0,2)){
      line.state='fast';line.L0=20;
      line.bol={x:S.x+line.a*Math.cos(S.psi)-line.b*Math.sin(S.psi),y:S.y+line.a*Math.sin(S.psi)+line.b*Math.cos(S.psi)};
    }
    for(let i=0;i<120;i++)step(1/60);
  `);
  assert.ok(Math.abs(g.run('S.dmgBank') - 20) < 1e-8);
  g.run('S.u=1;step(1/60);');
  assert.equal(g.run('S.svc'), null);
  g.run('S.x=slip.x;S.y=slip.y;S.u=S.v=S.r=0;S.hold=3;for(let i=0;i<241;i++)step(1/60);');
  assert.ok(Math.abs(g.run('S.dmgBank+S.damage') - 60) < 1e-8);
  assert.equal(g.run('S.damage'), 0);
});

test('throwing a recovered mooring line clears its old strain', () => {
  const g = game();
  g.run(`
    state='play';S.x=slip.x;S.y=slip.y;S.psi=slip.h;
    const line=lines[0];line.strain=2.1;line.ten=80000;line.tl=80000;
    line.fx=S.x+line.a*Math.cos(S.psi)-line.b*Math.sin(S.psi);
    line.fy=S.y+line.a*Math.sin(S.psi)+line.b*Math.cos(S.psi);
    lineClick(0);
  `);
  assert.equal(g.run('lines[0].state'), 'throw');
  assert.deepEqual(g.read('[lines[0].strain,lines[0].ten,lines[0].tl]'), [0, 0, 0]);
});
