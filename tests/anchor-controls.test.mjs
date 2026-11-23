import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';

function fixture(t, ship='super') {
  const h=createGameHarness({width:390,height:844});t.after(()=>h.close());h.click('go');
  h.run(`setShip(${JSON.stringify(ship)});obstacles=[];env.wk=env.sh=0;S.x=S.y=S.psi=S.u=S.v=S.r=0;`);
  h.click('anchorsT');assert.deepEqual(h.errors,[]);return h;
}
function select(h,value) {
  h.element('anchSel').value=String(value);
  h.element('anchSel').dispatchEvent(new h.window.Event('change',{bubbles:true}));
}
function rig(h,sides=[-1,1],lengths=[20,30]) {
  h.run(`S.anchors=${JSON.stringify(sides)}.map((side,i)=>{const [x,y]=hawseFor(side);return{side,x,y,L0:${JSON.stringify(lengths)}[i],held:true,set:false};});updateMooringUI();`);
}
function ticks(h,n) { h.run(`for(let i=0;i<${n};i++)step(1/60);updateMooringUI();`); }
const lengths=h=>h.read('S.anchors.map(a=>a.L0)');

test('Drop deploys just the chosen sides with 3 m held, including a partial Both request',t=>{
  const h=fixture(t);h.click('anchDrop');
  assert.deepEqual(h.read('S.dropSides'),[-1]);assert.equal(h.element('anchDrop').disabled,true);
  h.run('S.bowX=23.2;advanceDeckWork(1/60)');
  assert.deepEqual(h.read('S.anchors.map(a=>[a.side,a.L0,a.held])'),[[-1,3,true]]);
  ticks(h,90);assert.deepEqual(lengths(h),[3],'an untouched drop never runs out more chain');
  select(h,2);h.click('anchDrop');assert.deepEqual(h.read('S.dropSides'),[1]);
  h.run('S.bowX=23.2;advanceDeckWork(1/60)');
  assert.deepEqual(h.read('S.anchors.map(a=>[a.side,a.L0,a.held])'),[[-1,3,true],[1,3,true]]);
  h.run('dropAnchors();advanceDeckWork(1/60)');assert.equal(h.read('S.anchors.length'),2);
});

test('pending drops keep requested sides across selection changes and stale work never duplicates gear',t=>{
  const h=fixture(t);h.click('anchDrop');select(h,1);
  h.run('S.bowX=23.2;advanceDeckWork(1/60)');
  assert.deepEqual(h.read('S.anchors.map(a=>a.side)'),[-1]);assert.equal(h.read('S.anchSel'),1);
  assert.equal(h.element('anchorChain').textContent,'—');assert.equal(h.element('chOut').disabled,true);
  h.click('anchDrop');select(h,2);h.run('dropAnchors()');assert.deepEqual(h.read('S.dropSides'),[1]);
  h.run('S.bowX=23.2;advanceDeckWork(1/60);S.dropSides=[-1,1];S.anchorCmd=true;advanceDeckWork(1/60)');
  assert.deepEqual(h.read('S.anchors.map(a=>a.side)'),[-1,1]);assert.equal(h.read('S.anchorCmd'),false);
  assert.deepEqual(h.errors,[]);
});

test('Both Drop holds an already retrieving selected anchor while adding the missing side',t=>{
  const h=fixture(t);rig(h,[-1],[3]);h.run('S.anchors[0].weighing=true');select(h,2);h.click('anchDrop');
  assert.equal(h.read('S.anchors[0].weighing'),false);assert.deepEqual(h.read('S.dropSides'),[1]);
  h.advance(2600);assert.deepEqual(h.read('S.anchors.map(a=>[a.side,a.L0,a.held])'),[[-1,3,true],[1,3,true]]);
  rig(h,[1],[20]);h.run('S.anchors[0].weighing=true');select(h,0);h.click('anchDrop');
  assert.equal(h.read('S.anchors[0].weighing'),true,'an unselected anchor keeps retrieving');
  h.run('S.bowX=23.2;advanceDeckWork(1/60)');assert.deepEqual(h.read('S.anchors.map(a=>a.side)'),[1,-1]);
});

test('chain taps adjust exact selected sides by one metre and Both readouts preserve unequal amounts',t=>{
  const h=fixture(t);rig(h,[-1,1],[17.99,22]);
  assert.equal(h.element('anchorChain').textContent,'17.9');
  select(h,1);h.click('chOut');assert.deepEqual(lengths(h),[17.99,23]);
  select(h,2);h.click('chIn');assert.deepEqual(lengths(h),[16.99,22]);
  assert.equal(h.element('anchorChain').textContent,'P16.9\nS22.0');
  assert.match(h.element('anchorChain').getAttribute('aria-label'),/Port: 16\.9 m.*Starboard: 22\.0 m/);
  h.run('S.anchors[0].L0=2;S.anchors[1].L0=140');h.click('chOut');assert.deepEqual(lengths(h),[3,140]);
  h.run('S.anchors[0].L0=2');h.click('chIn');assert.deepEqual(lengths(h),[2,139]);
});

test('holding chain waits after its one-metre tap then continues at the physical payout rate',t=>{
  const h=fixture(t);rig(h);select(h,2);h.pointer('chOut','pointerdown',{pointerId:1});
  assert.deepEqual(lengths(h),[21,31]);ticks(h,18);assert.deepEqual(lengths(h),[21,31]);
  ticks(h,42);const paid=lengths(h);assert.ok(paid[0]>22.3&&paid[0]<22.6);assert.ok(Math.abs(paid[1]-paid[0]-10)<1e-9);
  h.pointer('chOut','pointerup',{pointerId:1});
  h.element('chOut').dispatchEvent(new h.window.MouseEvent('click',{bubbles:true,detail:1}));
  ticks(h,60);assert.deepEqual(lengths(h),paid,'release and the generated click add no further chain');
  assert.equal(h.read('anchorHold'),null);
});

test('changing selection cancels captured anchor work while line, engine and thruster owners remain',t=>{
  const h=fixture(t);rig(h);select(h,2);
  h.key('keydown','h',{target:'gl'});h.pointer('thR','pointerdown',{pointerId:2});
  const bump=h.element('lvP').querySelector('[data-d="1"]');h.pointer(bump,'pointerdown',{pointerId:3});
  h.pointer('chOut','pointerdown',{pointerId:4});select(h,1);
  assert.equal(h.read('anchorHold'),null);assert.equal(h.element('chOut').hasPointerCapture(4),false);
  assert.deepEqual(h.read('[haul,S.thr,S.lever[0]]'),[1,1,.32]);
  const before=lengths(h);ticks(h,30);assert.deepEqual(lengths(h),before);
  h.pointer('chOut','pointerup',{pointerId:4});h.click('chIn');assert.deepEqual(lengths(h),[before[0],before[1]-1]);
});

for(const cancellation of ['pointercancel','lostpointercapture','pause','fold'])test(`${cancellation} stops a windlass hold without another tap`,t=>{
  const h=fixture(t);rig(h);h.pointer('chOut','pointerdown',{pointerId:8});
  if(cancellation==='pause')h.click('pauseBtn');else if(cancellation==='fold')h.click('anchorsT');else h.pointer('chOut',cancellation,{pointerId:8});
  const before=lengths(h);assert.equal(h.read('anchorHold'),null);assert.equal(h.element('chOut').hasPointerCapture(8),false);
  if(cancellation==='pause')h.click('pauseBtn');ticks(h,60);assert.deepEqual(lengths(h),before);
});

test('Space and Enter chain controls support tap, repeat suppression and blur cancellation',t=>{
  const h=fixture(t);rig(h);h.element('chOut').focus();
  const event=h.key('keydown',' ',{target:'chOut'});assert.equal(event.defaultPrevented,true);
  h.key('keydown',' ',{target:'chOut',repeat:true});assert.deepEqual(lengths(h),[21,30]);
  h.key('keyup',' ',{target:'chOut'});ticks(h,60);assert.deepEqual(lengths(h),[21,30]);
  h.key('keydown','Enter',{target:'chOut'});h.element('anchSel').focus();assert.equal(h.read('anchorHold'),null);
  ticks(h,60);assert.deepEqual(lengths(h),[22,30]);
  h.key('keydown','Enter',{target:'chOut',repeat:true});assert.equal(h.read('anchorHold'),null);
});

test('Bring in and Stop affect exact selected sides and manual adjustment cancels retrieval there',t=>{
  const h=fixture(t);rig(h);select(h,2);h.click('anchWeigh');
  assert.deepEqual(h.read('S.anchors.map(a=>a.weighing)'),[true,true]);assert.equal(h.element('anchWeigh').textContent,'Stop');
  ticks(h,60);assert.ok(Math.abs(lengths(h)[0]-19.2)<1e-8);assert.ok(Math.abs(lengths(h)[1]-29.2)<1e-8);
  select(h,0);h.click('anchWeigh');assert.deepEqual(h.read('S.anchors.map(a=>a.weighing)'),[false,true]);
  select(h,2);assert.equal(h.element('anchWeigh').textContent,'Stop');h.click('anchWeigh');assert.deepEqual(h.read('S.anchors.map(a=>a.weighing)'),[false,false]);
  h.click('anchWeigh');select(h,1);h.click('chOut');assert.deepEqual(h.read('S.anchors.map(a=>a.weighing)'),[true,false]);
});

test('Both retrieval keeps its remaining anchor moving after the first is stowed',t=>{
  const h=fixture(t);rig(h,[-1,1],[3,5]);select(h,2);h.pointer('chIn','pointerdown',{pointerId:9});ticks(h,1);
  assert.deepEqual(h.read('S.anchors.map(a=>a.side)'),[1]);assert.equal(h.element('chIn').hasPointerCapture(9),true);
  assert.equal(h.read('anchorHold.direction'),1);ticks(h,180);
  assert.equal(h.read('S.anchors.length'),0);assert.equal(h.read('anchorHold'),null);assert.equal(h.element('chIn').hasPointerCapture(9),false);
  assert.equal(h.read('haul'),0);
});

test('Drop clears old anchor ownership so newly deployed gear cannot inherit a held windlass',t=>{
  const h=fixture(t);rig(h,[-1],[20]);select(h,2);h.pointer('chOut','pointerdown',{pointerId:10});h.click('anchDrop');
  assert.equal(h.read('anchorHold'),null);assert.equal(h.element('chOut').hasPointerCapture(10),false);
  h.run('S.bowX=23.2;advanceDeckWork(1/60)');ticks(h,60);assert.deepEqual(lengths(h),[21,3]);
});

test('a selected stowed side never falls back to the other deployed anchor or to lines',t=>{
  const h=fixture(t);rig(h,[-1],[20]);select(h,1);
  assert.equal(h.element('anchWeigh').disabled,true);assert.equal(h.element('chIn').disabled,true);
  h.click('anchWeigh');h.pointer('chIn','pointerdown',{pointerId:11});h.key('keydown','b',{target:'gl'});ticks(h,60);
  assert.deepEqual(lengths(h),[20]);assert.equal(h.read('anchorHold'),null);assert.equal(h.read('haul'),0);
});

test('tender has one Bow choice and its Drop, adjustment and retrieval use only the bow anchor',t=>{
  const h=fixture(t,'tender');assert.deepEqual([...h.element('anchSel').options].map(o=>[o.value,o.text]),[['0','Bow']]);
  h.key('keydown','z',{target:'gl'});h.key('keydown','x',{target:'gl'});h.run('S.bowX=23.2;advanceDeckWork(1/60)');
  assert.deepEqual(h.read('S.anchors.map(a=>[a.side,a.L0,a.held])'),[[0,3,true]]);
  h.click('chOut');assert.deepEqual(lengths(h),[4]);h.key('keydown','b',{target:'gl'});assert.equal(h.read('S.anchors[0].weighing'),true);
  ticks(h,160);assert.equal(h.read('S.anchors.length'),0);
});

test('H, J and G always operate shore lines while anchor selection and retrieval remain independent',t=>{
  const h=fixture(t);rig(h);h.run(`const ln=lines[0];ln.state='fast';ln.L0=10;ln.bol={x:ln.a+6,y:ln.b};sel=0;`);
  h.key('keydown','h',{target:'gl'});ticks(h,6);assert.ok(h.read('lines[0].L0')<10);assert.deepEqual(lengths(h),[20,30]);
  h.key('keyup','h',{target:'gl'});h.key('keydown','j',{target:'gl'});ticks(h,6);assert.ok(h.read('lines[0].L0')>10);
  h.key('keydown','b',{target:'gl'});h.key('keydown','g',{target:'gl'});
  assert.equal(h.read('lines[0].state'),'stowed');assert.equal(h.read('S.anchors[0].weighing'),true);assert.equal(h.read('S.anchors.length'),2);
});

test('opening a different mooring section resets scroll while keeping the selector and equipment intact',t=>{
  const h=fixture(t);rig(h);select(h,2);h.click('linesT');h.element('gLines').scrollTop=100;
  h.click('anchorsT');assert.equal(h.element('gLines').scrollTop,0);assert.equal(h.element('anchSel').value,'2');assert.deepEqual(lengths(h),[20,30]);
  h.click('anchorsT');h.click('go');assert.equal(h.read('mooringSection'),null);assert.equal(h.read('S.anchors.length'),0);
});
