import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';

function anchorage(t, options) {
  const h=createGameHarness(options);t.after(()=>h.close());h.click('go');
  h.run(`pick(3);state='play';S.stage=3;setStop(3);
    S.x=S.px=slip.x-19.4;S.y=S.py=slip.y+2.4;S.psi=S.ppsi=0;S.u=S.v=S.r=0;
    env.wk=env.sh=0;S.nightOn=true;S.night=1;nightEnv0=null;
    S.anchors=[{side:-1,x:slip.x,y:slip.y,L0:18,held:true,t:1}];
    resetFrameClock();updateMooringUI();`);
  return h;
}

test('the final goal shows exact required chain and never rounds short scope up to success',t=>{
  const h=anchorage(t);
  h.run('S.anchors[0].L0=17.99;updateMooringUI();');
  assert.equal(h.element('anchorGoal').hidden,false);
  assert.equal(h.element('anchorNeed').textContent,'18');
  assert.equal(h.element('anchorProgress').getAttribute('aria-valuenow'),'17.9');
  assert.equal(h.element('anchorChain').textContent,'17.9');
  assert.equal(h.element('anchorGoal').parentElement,h.element('anchorBody'));
  assert.match(h.element('anchorHint').textContent,/Pay out 18 m/);
  assert.equal(h.element('anchorGoal').classList.contains('ready'),false);
  h.run('S.anchors[0].L0=18;S.anchors[0].held=false;updateMooringUI();');
  assert.match(h.element('anchorHint').textContent,/Hold the chain/);
  h.run('S.anchors[0].held=true;updateMooringUI();');
  assert.equal(h.element('anchorGoal').classList.contains('ready'),true);
});

test('meeting the anchorage goal completes the mission, pans and zooms, then permits continued play',t=>{
  const h=anchorage(t),view=h.read('({pitch,zoomMul,rotv,topDown,chase,x:camOff.x,y:camOff.y})');
  h.advance(3150);
  assert.equal(h.run('S.done'),true);
  assert.equal(h.element('anchorGoal').hidden,true);
  assert.equal(h.run('canDrive()'),false);
  assert.equal(h.element('dock').inert,true);
  h.key('keydown','w');assert.equal(h.run('!!held.w'),false);
  h.advance(1600);
  assert.ok(h.run('zoomMul')<view.zoomMul,'camera zooms out');
  assert.ok(h.run('rotv')>view.rotv,'camera pans around the anchorage');
  assert.ok(h.run('camOff.x')>view.x,'camera frames the boat and anchorage');
  h.advance(3100);
  assert.equal(h.run('banner'),'mission');
  assert.equal(h.run('S.cineDone'),true);
  assert.equal(h.element('result').hidden,false);
  assert.equal(h.element('dock').inert,false);
  h.click('rKeep');
  assert.equal(h.run('S.cineT'),null);
  assert.deepEqual(h.read('({pitch,zoomMul,rotv,topDown,chase,x:camOff.x,y:camOff.y})'),view);
  assert.equal(h.run('canDrive()'),true);
  assert.equal(h.element('result').hidden,true);
  assert.deepEqual(h.errors.map(String),[]);
});

test('the final goal follows a qualifying anchor even when another side or Both is selected',t=>{
  const h=anchorage(t);
  h.run('S.anchors.push({...S.anchors[0],side:1,L0:3});S.anchSel=1;updateMooringUI();');
  assert.equal(h.element('anchorChain').textContent,'3.0');
  assert.equal(h.element('anchorProgress').getAttribute('aria-valuenow'),'18');
  assert.equal(h.element('anchorGoal').classList.contains('ready'),true);
  h.run('S.anchSel=2;updateMooringUI();');
  assert.equal(h.element('anchorChain').textContent,'P18.0\nS3.0');
  h.advance(3150);assert.equal(h.run('S.done'),true);
});

test('reduced motion completes the anchorage without an automatic camera move',t=>{
  for(const mode of ['normal','top','chase']){
    const h=anchorage(t,{reducedMotion:true});
    h.run(`topDown=${mode==='top'};chase=${mode==='chase'};pitchE=topDown?1.5:pitch;`);
    const view=h.read('[pitch,pitchE,zoomMul,rotv,topDown,chase,camOff.x,camOff.y]');
    h.advance(3200);
    assert.equal(h.run('banner'),'mission');
    assert.equal(h.element('result').hidden,false);
    assert.deepEqual(h.read('[pitch,pitchE,zoomMul,rotv,topDown,chase,camOff.x,camOff.y]'),view,mode);
  }
});
