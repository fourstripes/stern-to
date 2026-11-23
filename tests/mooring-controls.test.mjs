import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness } from './helpers/game-harness.mjs';

function fixture(t){
  const h=createGameHarness({width:390,height:844});t.after(()=>h.close());
  h.click('go');assert.equal(h.readyCount,1);assert.deepEqual(h.errors,[]);
  return h;
}

function rigGear(h){
  h.run(`
    obstacles=[];env.wk=0;env.sh=0;
    S.anchors=[-1,1].map(side=>{
      const [a,b]=hawseFor(side),cs=Math.cos(S.psi),sn=Math.sin(S.psi);
      return {side,x:S.x+a*cs-b*sn,y:S.y+a*sn+b*cs,L0:30,held:true,set:false,t:0};
    });
    for(const ln of lines.slice(0,2)){
      const cs=Math.cos(S.psi),sn=Math.sin(S.psi);
      ln.bol={x:S.x+ln.a*cs-ln.b*sn+6,y:S.y+ln.a*sn+ln.b*cs};
      ln.state='fast';ln.L0=10;ln.ten=ln.tl=ln.strain=0;
    }
    S.fend=3;S.fendN=[4,4];updateMooringUI();
  `);
}

const equipment=h=>h.read('({anchors:S.anchors,anchorCmd:S.anchorCmd,anchSel:S.anchSel,lines,fend:S.fend,fendN:S.fendN})');

test('opening and folding sections preserves deployed gear and shows its state when collapsed',t=>{
  const h=fixture(t);rigGear(h);h.run('S.anchSel=1;sel=0');
  const gear=equipment(h);
  assert.equal(h.read('mooringSection'),null);assert.equal(h.element('actBox').hidden,true);
  assert.equal(h.element('anchorsStatus').textContent,'Both');assert.equal(h.element('linesStatus').textContent,'2 fast');assert.equal(h.element('fendersStatus').textContent,'Both');
  for(const section of ['anchors','lines','fenders'])assert.equal(h.element(section+'T').classList.contains('has-equipment'),true);
  h.click('anchorsT');assert.equal(h.read('S.anchSel'),1);assert.equal(h.read('sel'),-1);assert.equal(h.element('actBox').parentElement,h.element('lnBody'));assert.equal(h.element('actBox').hidden,true);
  h.click('linesT');assert.equal(h.element('actBox').parentElement,h.element('lnBody'));assert.equal(h.element('actBox').hidden,false);
  assert.equal(h.element('lgBtn').textContent,'Let go');assert.equal(h.element('actBox').querySelector('.meter').hidden,false);
  h.click('fendersT');assert.equal(h.element('actBox').hidden,true);
  h.click('fendersT');assert.equal(h.read('mooringSection'),null);assert.deepEqual(equipment(h),gear);
  assert.deepEqual([...h.document.querySelectorAll('.mooring-label')].map(el=>el.textContent),['Anchors','Lines','Fenders']);
});

test('line actions stay inside Lines and never become duplicate anchor controls',t=>{
  const h=fixture(t);h.click('anchorsT');assert.equal(h.element('actBox').hidden,true);
  h.click('linesT');assert.equal(h.element('actBox').hidden,true);
  rigGear(h);assert.equal(h.element('actBox').hidden,false);
  h.click('anchorsT');assert.equal(h.element('actBox').hidden,true);
  assert.equal(h.element('actBox').parentElement,h.element('lnBody'));assert.equal(h.element('anchWeigh').disabled,false);
  assert.equal(h.document.querySelectorAll('.anc').length,0);
  h.click('fendersT');assert.equal(h.element('actBox').hidden,true);
  h.pointer('hvBtn','pointerdown',{pointerId:9});assert.equal(h.read('haul'),0);assert.equal(h.element('hvBtn').hasPointerCapture(9),false);
});

test('switching sections clears captured haul inputs while independent engine and thruster holds continue',t=>{
  const h=fixture(t);rigGear(h);h.click('anchorsT');
  const bump=h.element('lvP').querySelector('[data-d="1"]');
  h.run('S.lever[1]=.6');h.pointer(bump,'pointerdown',{pointerId:11});h.pointer('thR','pointerdown',{pointerId:12});h.pointer('chIn','pointerdown',{pointerId:13});
  assert.equal(h.read('anchorHold.direction'),1);assert.equal(h.element('chIn').hasPointerCapture(13),true);
  h.click('linesT');
  assert.deepEqual(h.read('[haul,S.thr,...S.lever]'),[0,1,.32,.6]);assert.equal(h.read('anchorHold'),null);assert.equal(h.element('chIn').hasPointerCapture(13),false);
  assert.equal(bump.hasPointerCapture(11),true);assert.equal(h.element('thR').hasPointerCapture(12),true);
  assert.equal(h.read('[...inputSources.values()].filter(command=>command.kind==="haul"||command.kind==="anchor").length'),0);
  h.pointer('chIn','pointerup',{pointerId:13});assert.deepEqual(h.read('[haul,S.thr,...S.lever]'),[0,1,.32,.6]);
  h.pointer(bump,'pointerup',{pointerId:11});h.pointer('thR','pointerup',{pointerId:12});assert.deepEqual(h.read('[S.thr,...S.lever]'),[0,0,.6]);
});

test('folding clears keyboard haul ownership, keeps engine keys, and requires a fresh haul press',t=>{
  const h=fixture(t);rigGear(h);h.click('linesT');
  h.key('keydown','w',{target:'gl'});h.key('keydown','a',{target:'gl'});h.key('keydown','h',{target:'gl'});h.key('keydown','Enter',{target:'slBtn'});
  assert.equal(h.read('haul'),-1);h.click('linesT');assert.equal(h.read('haul'),0);
  h.key('keydown','h',{target:'gl',repeat:true});h.key('keydown','Enter',{target:'slBtn',repeat:true});h.run('heldKeys(.1)');
  assert.equal(h.read('haul'),0);assert.equal(h.read('S.thr'),-1);assert.ok(h.read('S.lever[0]')>0);
  h.key('keyup','h',{target:'gl'});h.key('keydown','h',{target:'gl'});assert.equal(h.read('haul'),1);assert.equal(h.read('mooringSection'),null);
  h.key('keyup','h',{target:'gl'});h.click('linesT');h.key('keyup','Enter',{target:'slBtn'});h.key('keydown','Enter',{target:'slBtn'});assert.equal(h.read('haul'),-1);
});

test('chain controls use the selected existing anchor, and Lines actions cannot retarget it',t=>{
  const h=fixture(t);rigGear(h);h.run('S.anchSel=1');h.click('anchorsT');h.pointer('chIn','pointerdown',{pointerId:21});h.run('step(.1)');
  assert.equal(h.read('S.anchSel'),1);assert.equal(h.read('S.anchors[0].L0'),30);assert.ok(h.read('S.anchors[1].L0')<30);
  const chains=h.read('S.anchors.map(a=>a.L0)');h.click('linesT');h.click('.ln[data-i="0"]');h.pointer('hvBtn','pointerdown',{pointerId:22});h.run('step(.1)');
  assert.deepEqual(h.read('S.anchors.map(a=>a.L0)'),chains);assert.ok(h.read('lines[0].L0')<10);assert.equal(h.read('lines[1].L0'),10);
  h.click('lgBtn');assert.equal(h.read('lines[0].state'),'stowed');assert.equal(h.read('S.anchors.length'),2);assert.equal(h.read('haul'),0);
});

test('a retrieved anchor clears its own hold without cancelling independent line or thruster commands',t=>{
  const h=fixture(t);rigGear(h);h.run('S.anchors.splice(1);S.anchors[0].L0=2.01');h.click('anchorsT');
  h.pointer('thR','pointerdown',{pointerId:31});h.pointer('chIn','pointerdown',{pointerId:32});h.key('keydown','h',{target:'gl'});
  h.run('step(.02)');assert.equal(h.read('S.anchors.length'),0);assert.equal(h.read('haul'),1);assert.equal(h.read('anchorHold'),null);assert.equal(h.element('chIn').hasPointerCapture(32),false);
  assert.equal(h.read('[...inputSources.values()].some(command=>command.kind==="anchor")'),false);assert.equal(h.read('S.thr'),1);
  assert.ok(h.read('lines[0].L0')<10);h.key('keyup','h',{target:'gl'});const lengths=h.read('lines.slice(0,2).map(line=>line.L0)');
  h.pointer('thR','pointerup',{pointerId:31});h.run('step(.1)');assert.equal(h.read('haul'),0);assert.deepEqual(h.read('lines.slice(0,2).map(line=>line.L0)'),lengths);
});

for(const loss of ['auto-releases beyond reach','parts under strain']){
  const arrangeLoss=h=>h.run(loss==='auto-releases beyond reach'?'lines[0].bol.x+=50':'lines[0].L0=3;lines[0].strain=2.21;S.thrAct=1');
  for(const [action,key,direction] of [['hvBtn','h',1],['slBtn','j',-1]])test(`a selected line that ${loss} stops ${key==='h'?'heaving':'slacking'} before other lines are processed`,t=>{
    const h=fixture(t);rigGear(h);h.click('linesT');h.click('.ln[data-i="0"]');arrangeLoss(h);
    const bump=h.element('lvP').querySelector('[data-d="1"]');
    h.run('S.lever[1]=.6');h.pointer(bump,'pointerdown',{pointerId:41});h.pointer('thR','pointerdown',{pointerId:42});h.pointer(action,'pointerdown',{pointerId:43});h.key('keydown',key,{target:'gl'});
    assert.equal(h.read('haul'),direction);h.run('step(.02)');
    assert.equal(h.read('lines[0].state'),'stowed');assert.equal(h.read('sel'),-1);assert.deepEqual(h.read('[lines[1].state,lines[1].L0]'),['fast',10]);
    assert.deepEqual(h.read('[haul,S.thr,...S.lever]'),[0,1,.32,.6]);assert.equal(h.element(action).hasPointerCapture(43),false);assert.equal(bump.hasPointerCapture(41),true);assert.equal(h.element('thR').hasPointerCapture(42),true);
    assert.equal(h.read('[...inputSources.values()].some(command=>command.kind==="haul")'),false);assert.deepEqual(h.read('[S.anchors.length,S.fend,...S.fendN]'),[2,3,4,4]);
    h.pointer('thR','pointerup',{pointerId:42});h.key('keydown',key,{target:'gl',repeat:true});h.run('step(.02)');assert.equal(h.read('haul'),0);assert.equal(h.read('lines[1].L0'),10);
  });
  test(`all-lines hauling continues when an unselected line ${loss}`,t=>{
    const h=fixture(t);rigGear(h);h.click('linesT');arrangeLoss(h);h.pointer('hvBtn','pointerdown',{pointerId:44});h.run('step(.02)');
    assert.equal(h.read('lines[0].state'),'stowed');assert.equal(h.read('haul'),1);assert.equal(h.element('hvBtn').hasPointerCapture(44),true);assert.equal(h.read('lines[1].state'),'fast');assert.ok(h.read('lines[1].L0')<10);
  });
}

test('fender choices select exact sides while keyboard gear actions do not open any panel',t=>{
  const h=fixture(t);h.click('fendersT');
  for(const value of [3,1,2,0]){
    h.click('[data-fender="'+value+'"]');assert.equal(h.read('S.fend'),value);
    assert.deepEqual([...h.document.querySelectorAll('[data-fender]')].map(el=>el.getAttribute('aria-pressed')),['0','1','2','3'].map(key=>String(+key===value)));
  }
  h.click('fendersT');h.key('keydown','f',{target:'gl'});assert.equal(h.read('S.fend'),1);assert.equal(h.element('fendersStatus').textContent,'Port');
  h.key('keydown','x',{target:'gl'});assert.equal(h.read('S.anchorCmd'),true);h.run('updateMooringUI()');assert.equal(h.element('anchorsStatus').textContent,'Working');
  assert.equal(h.read('mooringSection'),null);for(const id of ['anchorBody','lnBody','fenderBody'])assert.equal(h.element(id).hidden,true);
});

test('collapsing a section returns focus from its controls to a visible heading',t=>{
  const h=fixture(t);rigGear(h);h.click('anchorsT');h.element('chIn').focus();h.run('setMooringSection(null)');
  assert.equal(h.document.activeElement,h.element('anchorsT'));
  h.click('anchorsT');h.element('chOut').focus();h.run('setMooringSection("lines")');assert.equal(h.document.activeElement,h.element('linesT'));
});
