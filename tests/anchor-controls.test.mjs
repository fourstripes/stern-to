import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameHarness } from './helpers/game-harness.mjs';

function fixture(t, ship='super') {
  const h=createGameHarness({width:390,height:844});t.after(()=>h.close());h.click('go');
  h.run(`setShip(${JSON.stringify(ship)});obstacles=[];env.wk=env.sh=0;S.x=S.y=S.psi=S.u=S.v=S.r=0;`);
  h.click('anchorsT');assert.deepEqual(h.errors,[]);return h;
}
function select(h,value) {
  h.click('[data-anchor="'+value+'"]');
}
function rig(h,sides=[-1,1],lengths=[20,30]) {
  h.run(`S.anchors=${JSON.stringify(sides)}.map((side,i)=>{const [x,y]=hawseFor(side);return{side,x,y,L0:${JSON.stringify(lengths)}[i],held:true,set:false};});updateMooringUI();`);
}
function ticks(h,n) { h.run(`for(let i=0;i<${n};i++)step(1/60);updateMooringUI();`); }
const lengths=h=>h.read('S.anchors.map(a=>a.L0)');

test('Drop lets go just the chosen sides and the crew pay out until the chain is locked, including a partial Both request',t=>{
  const h=fixture(t);h.click('anchDrop');
  assert.deepEqual(h.read('S.dropSides'),[-1]);assert.equal(h.element('anchDrop').disabled,true);
  h.run('S.bowX=23.2;advanceDeckWork(1/60)');
  assert.deepEqual(h.read('S.anchors.map(a=>[a.side,a.L0,a.held,a.paying])'),[[-1,3,true,true]]);
  ticks(h,90);assert.ok(lengths(h)[0]>3,'the crew pay out chain without a held button');assert.equal(h.element('anchDrop').classList.contains('on'),true);
  h.click('anchLock');const locked=lengths(h)[0];assert.equal(h.read('S.anchors[0].paying'),false);
  ticks(h,90);assert.deepEqual(lengths(h),[locked],'a locked chain stays put');assert.equal(h.element('anchLock').classList.contains('on'),true);
  select(h,2);h.click('anchDrop');assert.deepEqual(h.read('S.dropSides'),[1]);assert.equal(h.read('S.anchors[0].paying'),false,'adding a side leaves the first locked');
  h.run('S.bowX=23.2;advanceDeckWork(1/60)');
  assert.deepEqual(h.read('S.anchors.map(a=>[a.side,a.held])'),[[-1,true],[1,true]]);assert.equal(h.read('S.anchors[1].L0'),3);
  h.run('dropAnchors();advanceDeckWork(1/60)');assert.equal(h.read('S.anchors.length'),2);
  h.click('anchLock');h.click('anchDrop');assert.deepEqual(h.read('S.anchors.map(a=>a.paying)'),[true,true],'Drop again eases the brake on both');
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
  h.advance(2600);assert.deepEqual(h.read('S.anchors.map(a=>[a.side,a.held])'),[[-1,true],[1,true]]);assert.equal(h.read('S.anchors[0].L0'),3);
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
  h.key('keydown','Enter',{target:'chOut'});h.element('[data-anchor="0"]').focus();assert.equal(h.read('anchorHold'),null);
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
  h.run('S.bowX=23.2;advanceDeckWork(1/60)');h.click('anchLock');ticks(h,60);const l=lengths(h);assert.equal(l[0],21);assert.ok(l[1]>=3&&l[1]<6,`new anchor ${l[1]}`);
});

test('a selected stowed side never falls back to the other deployed anchor or to lines',t=>{
  const h=fixture(t);rig(h,[-1],[20]);select(h,1);
  assert.equal(h.element('anchWeigh').disabled,true);assert.equal(h.element('chIn').disabled,true);
  h.click('anchWeigh');h.pointer('chIn','pointerdown',{pointerId:11});h.key('keydown','b',{target:'gl'});ticks(h,60);
  assert.deepEqual(lengths(h),[20]);assert.equal(h.read('anchorHold'),null);assert.equal(h.read('haul'),0);
});

test('tender has one Bow choice and its Drop, adjustment and retrieval use only the bow anchor',t=>{
  const h=fixture(t,'tender'),choices=[...h.document.querySelectorAll('[data-anchor]')];
  assert.deepEqual(choices.filter(b=>!b.hidden).map(b=>[b.dataset.anchor,b.querySelector('.equipment-label').textContent]),[['0','Bow']]);
  assert.equal(h.element('anchorDiagram').dataset.mode,'bow');
  assert.ok(choices.filter(b=>b.hidden).every(b=>b.disabled));
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

test('switching equipment cards preserves anchor selection and gear until a new game',t=>{
  const h=fixture(t);rig(h);select(h,2);h.click('linesT');
  h.click('anchorsT');assert.equal(h.element('[data-anchor="2"]').getAttribute('aria-pressed'),'true');assert.deepEqual(lengths(h),[20,30]);
  h.click('anchorsT');h.click('go');assert.equal(h.read('mooringSection'),null);assert.equal(h.read('S.anchors.length'),0);
});

test('anchor diagram keeps selection separate from actual dropping and retrieval on each side',t=>{
  const h=fixture(t),port=h.element('[data-anchor="0"]'),starboard=h.element('[data-anchor="1"]');
  select(h,1);assert.equal(h.read('S.anchors.length'),0);assert.equal(h.read('S.anchorCmd'),false);
  assert.equal(port.getAttribute('aria-pressed'),'false');assert.equal(starboard.getAttribute('aria-pressed'),'true');
  h.click('anchDrop');select(h,0);
  assert.equal(starboard.classList.contains('working'),true);assert.match(starboard.getAttribute('aria-label'),/preparing/);
  assert.equal(starboard.getAttribute('aria-pressed'),'false');assert.equal(port.classList.contains('deployed'),false);
  h.run('S.bowX=23.2;advanceDeckWork(1/60)');
  assert.equal(starboard.classList.contains('working'),false);assert.equal(starboard.classList.contains('deployed'),true);
  assert.equal(starboard.querySelector('.equipment-state').textContent,'Out');
  select(h,1);h.click('anchWeigh');assert.equal(starboard.classList.contains('working'),true);
  assert.match(starboard.getAttribute('aria-label'),/bringing in/);select(h,2);
  assert.equal(port.getAttribute('aria-pressed'),'true');assert.equal(starboard.getAttribute('aria-pressed'),'true');
  assert.equal(port.classList.contains('deployed'),false);assert.equal(starboard.classList.contains('deployed'),true);
  h.run("setShip('tender');updateMooringUI()");h.run("setShip('super');updateMooringUI()");
  assert.equal(h.element('anchorDiagram').dataset.mode,'paired');
  assert.ok([...h.document.querySelectorAll('[data-anchor]')].every(b=>!b.hidden&&!b.disabled));
  assert.equal(port.querySelector('.equipment-label').textContent,'Port');assert.deepEqual(h.errors,[]);
});
