import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';

function fixture(t){
  const h=createGameHarness({width:390,height:700,coarse:true});t.after(()=>h.close());
  const style=h.document.createElement('style');
  style.textContent=readFileSync(new URL('../assets/game.css',import.meta.url),'utf8');
  h.document.head.append(style);
  assert.deepEqual(h.errors,[]);
  return h;
}
const sheets=h=>['menu','help','result'].filter(id=>!h.element(id).hidden);

test('Help replaces the menu and returns to it without stacking visible sheets',t=>{
  const h=fixture(t);assert.deepEqual(sheets(h),['menu']);
  h.click('helpBtn');assert.deepEqual(sheets(h),['help']);
  assert.equal(h.element('dock').inert,true);assert.equal(h.element('gLines').inert,true);
  h.click('helpClose');assert.deepEqual(sheets(h),['menu']);
  assert.equal(h.document.activeElement,h.element('helpBtn'));
  h.click('go');assert.deepEqual(sheets(h),[]);
  h.click('menuBtn');h.click('helpBtn');assert.deepEqual(sheets(h),['help']);
  h.key('keydown','Escape',{target:'helpClose'});assert.deepEqual(sheets(h),['menu']);
  h.click('resume');assert.deepEqual(sheets(h),[]);
  h.run('finish(false)');assert.deepEqual(sheets(h),['result']);
  h.click('rMenu');assert.deepEqual(sheets(h),['menu']);
  h.click('helpBtn');assert.deepEqual(sheets(h),['help']);
  assert.deepEqual(h.errors,[]);
});

test('the anchorage objective stays in the anchor panel and follows its visibility in every corner',t=>{
  const h=fixture(t);h.click('go');
  h.run("pick(3);state='play';S.stage=3;setStop(3);updateMooringUI();");
  const goal=h.element('anchorGoal'),body=h.element('anchorBody');
  assert.equal(goal.hidden,false);assert.equal(goal.parentElement,body);
  assert.equal(goal.closest('[hidden]'),body,'a folded Anchors section also hides the objective');
  h.click('anchorsT');
  for(let i=0;i<4;i++){
    assert.equal(goal.closest('[hidden]'),null);
    assert.equal(goal.closest('#gLines'),h.element('gLines'));
    assert.equal(h.window.getComputedStyle(goal).position,'static','the goal cannot float over panel controls');
    h.click('cornerBtn');
  }
  h.click('linesT');assert.equal(goal.closest('[hidden]'),body);
  h.click('fendersT');assert.equal(goal.closest('[hidden]'),body);
  h.click('anchorsT');assert.equal(goal.closest('[hidden]'),null);
  assert.equal(h.element('actBox').parentElement,h.element('lnBody'));
  assert.deepEqual(h.errors,[]);
});

test('the result hides the mooring panel and dismissal restores it without changing equipment',t=>{
  const h=fixture(t);h.click('go');h.click('anchorsT');
  h.run('S.anchors=[{side:-1,x:S.x,y:S.y,L0:18,held:true,t:1}];S.fend=3;S.fendN=[4,4];updateMooringUI();');
  const gear=h.read('({anchors:S.anchors,lines,fend:S.fend,fendN:S.fendN})');
  h.run('finish(false)');
  assert.equal(h.window.getComputedStyle(h.element('gLines')).visibility,'hidden');
  h.click('rKeep');
  assert.equal(h.window.getComputedStyle(h.element('gLines')).visibility,'visible');
  assert.deepEqual(h.read('({anchors:S.anchors,lines,fend:S.fend,fendN:S.fendN})'),gear);
  assert.equal(h.element('anchorsT').getAttribute('aria-expanded'),'true');
  assert.deepEqual(h.errors,[]);
});
