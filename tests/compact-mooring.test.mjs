import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';

function fixture(t,options={}){
  const h=createGameHarness({width:390,height:700,coarse:true,...options});t.after(()=>h.close());
  h.click('go');assert.deepEqual(h.errors,[]);return h;
}

test('line names remain readable as their status and individual selection change',t=>{
  const h=fixture(t);h.click('linesT');
  const buttons=[...h.document.querySelectorAll('.ln')],labels=buttons.map(b=>b.querySelector('.line-label').textContent);
  assert.equal(new Set(labels).size,6);assert.ok(labels.every(label=>label.trim().length>0));
  h.run("lines.forEach(l=>l.state='fast');updateMooringUI();");
  assert.deepEqual(buttons.map(b=>b.querySelector('.line-label').textContent),labels);
  assert.ok(buttons.every(b=>b.querySelector('.line-state').textContent==='✓'));
  h.click('.ln[data-i="3"]');
  assert.equal(h.read('sel'),3);assert.equal(buttons[3].getAttribute('aria-pressed'),'true');
  assert.match(buttons[3].getAttribute('aria-label'),/Starboard stern line: made fast, selected/);
  assert.equal(h.element('actName').textContent,'Starboard stern');
  h.click('.ln[data-i="3"]');assert.equal(h.read('sel'),-1);assert.equal(h.element('actName').textContent,'All lines');
  h.run("lines[0].state='throw';lines[1].state='stowed';updateMooringUI();");
  assert.equal(buttons[0].querySelector('.line-state').textContent,'…');assert.equal(buttons[1].querySelector('.line-state').textContent,'+');
  assert.deepEqual(buttons.map(b=>b.querySelector('.line-label').textContent),labels);assert.deepEqual(h.errors,[]);
});

test('short landscape separates equipment from the helm and restores the normal layout on close or rotation',t=>{
  const h=fixture(t,{width:844,height:320});
  assert.equal(h.element('app').classList.contains('mooring-split'),false);
  for(const section of ['anchors','lines','fenders']){
    h.click(section+'T');assert.equal(h.element('app').classList.contains('mooring-wide'),true);
    assert.equal(h.element('app').classList.contains('mooring-split'),true);
  }
  h.click('fendersT');assert.equal(h.element('app').classList.contains('mooring-split'),false);
  h.click('anchorsT');h.setRect('app',{width:390,height:700});h.resize();h.frame();
  assert.equal(h.element('app').classList.contains('mooring-wide'),false);
  assert.equal(h.element('app').classList.contains('mooring-split'),false);
  assert.equal(h.element('anchorsT').getAttribute('aria-expanded'),'true');assert.deepEqual(h.errors,[]);
});

test('moving the helm for short-screen equipment releases momentary input without changing latched throttle',t=>{
  const h=fixture(t,{width:844,height:320}),bump=h.element('lvP').querySelector('[data-d="1"]');
  h.run('S.lever[1]=.6');h.pointer(bump,'pointerdown',{pointerId:71});h.pointer('thR','pointerdown',{pointerId:72});
  h.click('linesT');
  assert.deepEqual(h.read('[...S.lever,S.thr]'),[0,.6,0]);
  assert.equal(bump.hasPointerCapture(71),false);assert.equal(h.element('thR').hasPointerCapture(72),false);
  assert.deepEqual(h.errors,[]);
});

test('Escape closes an equipment card before opening the main menu',t=>{
  const h=fixture(t);h.click('anchorsT');h.element('anchDrop').focus();
  h.key('keydown','Escape',{target:'anchDrop'});
  assert.equal(h.read('mooringSection'),null);assert.equal(h.read('state'),'play');assert.equal(h.element('menu').hidden,true);
  assert.equal(h.document.activeElement,h.element('anchorsT'));
  h.key('keydown','Escape',{target:'anchorsT'});assert.equal(h.read('state'),'menu');assert.equal(h.element('menu').hidden,false);
  assert.deepEqual(h.errors,[]);
});

test('short-screen camera framing follows the clear side when the helm moves',t=>{
  const h=fixture(t,{width:844,height:320});h.click('anchorsT');
  h.setRect('dock',{x:10,y:150,width:340,height:160});h.resize();h.frame();
  assert.equal(h.read('viewOffsetX'),242);assert.equal(h.read('camera.view.offsetX'),242);
  h.setRect('dock',{x:494,y:150,width:340,height:160});h.click('cornerBtn');h.resize();h.frame();
  assert.equal(h.read('viewOffsetX'),-242);assert.equal(h.read('camera.view.offsetX'),-242);
  h.click('anchorsT');h.frame();assert.equal(h.read('viewOffsetX'),0);assert.equal(h.read('camera.view.offsetX'),0);
  assert.deepEqual(h.errors,[]);
});
