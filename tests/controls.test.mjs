import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameHarness } from './helpers/game-harness.mjs';

function fixture(t,options={}){
  const h=createGameHarness(options);t.after(()=>h.close());
  assert.equal(h.readyCount,1);assert.deepEqual(h.errors,[]);
  return h;
}
const play=h=>h.click('go');
const settleCounter=async h=>{await h.flush();await new Promise(resolve=>setImmediate(resolve));};

test('keyboard engine slider changes its own engine without triggering starboard shortcuts',t=>{
  const h=fixture(t);play(h);
  const port=h.element('lvP').querySelector('.track');
  h.key('keydown','ArrowUp',{target:port});
  assert.equal(h.read('S.lever[0]'),.05);assert.equal(h.read('S.lever[1]'),0);
  h.key('keydown','End',{target:port});assert.equal(h.read('S.lever[0]'),1);
  h.frame();assert.equal(port.getAttribute('aria-valuenow'),'100');
});

test('native rudder input updates simulation steering and its accessible value',t=>{
  const h=fixture(t);play(h);h.element('rud').value='12';
  h.element('rud').dispatchEvent(new h.window.Event('input',{bubbles:true}));h.frame();
  assert.equal(h.read('S.rud'),12);assert.equal(h.element('rud').getAttribute('aria-valuetext'),'12 degrees starboard');
});

test('releasing one pointer restores the other held thruster',t=>{
  const h=fixture(t);play(h);
  h.pointer('thL','pointerdown',{pointerId:1});h.pointer('thR','pointerdown',{pointerId:2});assert.equal(h.read('S.thr'),1);
  h.pointer('thR','pointerup',{pointerId:2});assert.equal(h.read('S.thr'),-1);
  h.pointer('thL','pointerup',{pointerId:1});assert.equal(h.read('S.thr'),0);
});

test('keyboard and pointer holds coexist; blur clears momentary inputs while preserving latched throttle',t=>{
  const h=fixture(t);play(h);h.run('S.lever[1]=.6');
  h.key('keydown','a',{target:'gl'});h.key('keydown',' ',{target:'thR'});assert.equal(h.read('S.thr'),1);
  h.key('keyup',' ',{target:'thR'});assert.equal(h.read('S.thr'),-1);
  h.pointer(h.element('lvP').querySelector('[data-d="1"]'),'pointerdown',{pointerId:3});assert.equal(h.read('S.lever[0]'),.32);
  h.window.dispatchEvent(new h.window.Event('blur'));
  assert.equal(h.read('S.thr'),0);assert.equal(h.read('S.lever[0]'),0);assert.equal(h.read('S.lever[1]'),.6);
});

test('Help Enter preserves the Back button action without starting gameplay',t=>{
  const h=fixture(t);h.click('helpBtn');
  const event=h.key('keydown','Enter',{target:'helpClose'});
  assert.equal(event.defaultPrevented,false);assert.equal(h.read('state'),'menu');assert.equal(h.element('menu').hidden,false);
  // jsdom dispatches keyboard events but does not synthesise native button activation.
  h.click('helpClose');assert.equal(h.element('help').hidden,true);assert.equal(h.document.activeElement,h.element('helpBtn'));
});

test('modal focus wraps within Help and Escape closes Help before resuming',t=>{
  const h=fixture(t);play(h);h.click('menuBtn');h.click('helpBtn');
  assert.equal(h.element('dock').inert,true);assert.equal(h.element('menu').inert,true);
  h.element('helpClose').focus();h.key('keydown','Tab',{target:'helpClose'});assert.equal(h.document.activeElement,h.element('minBtn'));
  h.key('keydown','Escape',{target:'minBtn'});assert.equal(h.element('help').hidden,true);assert.equal(h.read('state'),'menu');
});

test('starting from a paused menu resets Pause state and closes both modals',t=>{
  const h=fixture(t);play(h);h.click('pauseBtn');h.click('menuBtn');play(h);
  assert.equal(h.read('hold'),false);assert.equal(h.element('pauseBtn').textContent,'Pause');assert.equal(h.element('pauseBtn').getAttribute('aria-pressed'),'false');
  assert.equal(h.element('menu').hidden,true);assert.equal(h.element('help').hidden,true);assert.equal(h.element('dock').inert,false);
});

test('repeated camera and restart keys do not retrigger one-shot actions',t=>{
  const h=fixture(t);play(h);h.key('keydown','t',{target:'gl'});h.key('keydown','t',{target:'gl',repeat:true});assert.equal(h.read('topDown'),true);
  h.run('S.t=37');h.key('keydown','r',{target:'gl',repeat:true});assert.equal(h.read('S.t'),37);
});

test('keyboard restart keeps the selected mission stop and resets the run',t=>{
  const h=fixture(t);h.run('pick(3)');h.click('#mStart [data-k="2"]');play(h);
  const initial=h.read('[S.stage,S.x,S.y,S.psi]');
  assert.equal(initial[0],2);
  h.run('S.stage=3;S.x+=80;S.y-=50;S.t=37;S.damage=25');
  h.key('keydown','r',{target:'gl'});
  assert.deepEqual(h.read('[S.stage,S.x,S.y,S.psi]'),initial);
  assert.equal(h.read('S.t'),0);assert.equal(h.read('S.damage'),0);
  h.frame(5);
  assert.deepEqual(h.read('[RX,RY,RP]'),initial.slice(1));
  assert.deepEqual(h.errors,[]);
});

test('cleared held controls require a fresh press before they can resume',t=>{
  const h=fixture(t);play(h);h.key('keydown','w',{target:'gl'});h.key('keydown','a',{target:'gl'});h.run('releaseControls()');
  h.key('keydown','w',{target:'gl',repeat:true});h.key('keydown','a',{target:'gl',repeat:true});h.run('heldKeys(.1)');
  assert.equal(h.read('S.lever[0]'),0);assert.equal(h.read('S.thr'),0);
});

test('mooring panels open only on request, stay exclusive, and fold on restart',t=>{
  const h=fixture(t,{width:390,height:844});
  const panels={anchors:'anchorBody',lines:'lnBody',fenders:'fenderBody'};
  const expectOpen=section=>{for(const [name,id] of Object.entries(panels)){assert.equal(h.element(id).hidden,name!==section);assert.equal(h.element(name+'T').getAttribute('aria-expanded'),String(name===section));assert.equal(h.element(name+'T').getAttribute('aria-controls'),id);}};
  expectOpen(null);play(h);expectOpen(null);
  h.run('S.x=slip.x;S.y=slip.y');h.frame();expectOpen(null);
  h.run('S.x=slip.x+300;S.y=slip.y+300');h.frame();expectOpen(null);
  for(const section of ['anchors','lines','fenders']){h.click(section+'T');expectOpen(section);}
  h.click('fendersT');expectOpen(null);
  h.click('linesT');h.key('keydown','r',{target:'gl'});expectOpen(null);
});

test('preview origins and nonproduction paths never touch the public play counter',t=>{
  const h=fixture(t,{url:'https://preview.example/stern-to/'});play(h);assert.equal(h.fetchCalls.length,0);
  const other=fixture(t,{url:'https://fourstripes.github.io/stern-to/preview/'});play(other);assert.equal(other.fetchCalls.length,0);
});

test('separate public browsers share one exact total and menu refresh observes other players',async t=>{
  let total=11990;
  const backend=async url=>{if(url.includes('/hit/'))total++;const value=total;return{ok:true,json:async()=>({value})};};
  const first=fixture(t,{url:'https://fourstripes.github.io/stern-to/',fetch:backend});
  const second=fixture(t,{url:'https://fourstripes.github.io/stern-to/index.html',fetch:backend});
  await settleCounter(first);await settleCounter(second);assert.equal(first.element('playsN').textContent,'11,990');assert.equal(second.element('playsN').textContent,'11,990');
  play(first);play(second);await settleCounter(first);await settleCounter(second);assert.equal(total,11992);
  first.frame(5100);first.click('menuBtn');await settleCounter(first);
  assert.equal(first.element('playsN').textContent,'11,992');assert.equal(second.element('playsN').textContent,'11,992');
  assert.match(first.element('plays').textContent,/Total games played/);assert.match(first.element(first.element('plays').getAttribute('aria-describedby')).textContent,/all players/);
  for(const h of [first,second])for(const [url,options] of h.fetchCalls){assert.match(url,/\/sternto-dock-sim\/plays$/);assert.equal(options.credentials,'omit');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');}
});

test('new games, keyboard restarts and retries count; resume, help and voyage legs do not',async t=>{
  let total=10;
  const h=fixture(t,{url:'https://fourstripes.github.io/stern-to/',fetch:async url=>{if(url.includes('/hit/'))total++;return{ok:true,json:async()=>({value:total})};}});
  const hits=()=>h.fetchCalls.filter(([url])=>url.includes('/hit/')).length;
  await settleCounter(h);assert.equal(hits(),0);play(h);assert.equal(hits(),1);
  h.click('pauseBtn');h.click('pauseBtn');h.click('menuBtn');h.click('helpBtn');h.click('helpClose');h.click('resume');assert.equal(hits(),1);
  h.key('keydown','r',{target:'gl'});h.key('keydown','r',{target:'gl',repeat:true});assert.equal(hits(),2);
  h.run('finish(false)');h.click('rRetry');assert.equal(hits(),3);
  h.run('startDepart(true);passage();advancePassage(1)');assert.equal(hits(),3);
  h.click('menuBtn');play(h);await settleCounter(h);assert.equal(hits(),4);assert.equal(h.element('playsN').textContent,'14');
});

test('a start that fails during setup never increments the shared total',t=>{
  const h=fixture(t,{url:'https://fourstripes.github.io/stern-to/'});
  h.run('const originalReset=reset;reset=()=>{throw new Error("Setup failed");};try{start();}catch{}finally{reset=originalReset;}');
  assert.equal(h.fetchCalls.filter(([url])=>url.includes('/hit/')).length,0);
});

test('menu total reads deduplicate in flight and observe the read cooldown',async t=>{
  const pending=[];
  const h=fixture(t,{url:'https://fourstripes.github.io/stern-to/',fetch:()=>new Promise(resolve=>pending.push(resolve))});
  h.click('menuBtn');h.run('plays("get");plays("get")');assert.equal(h.fetchCalls.length,1);
  pending.shift()({ok:true,json:async()=>({value:500})});await settleCounter(h);
  h.click('menuBtn');assert.equal(h.fetchCalls.length,1);
  h.frame(5100);h.click('menuBtn');h.click('menuBtn');assert.equal(h.fetchCalls.length,2);
  pending.shift()({ok:true,json:async()=>({value:503})});await settleCounter(h);assert.equal(h.element('playsN').textContent,'503');
});

test('out-of-order reads and start responses cannot replace a newer shared total',async t=>{
  const pending=[];
  const h=fixture(t,{url:'https://fourstripes.github.io/stern-to/',fetch:()=>new Promise(resolve=>pending.push(resolve))});
  play(h);h.run('start()');assert.equal(h.fetchCalls.length,3);
  pending[2]({ok:true,json:async()=>({value:22})});await settleCounter(h);assert.equal(h.element('playsN').textContent,'22');
  pending[1]({ok:true,json:async()=>({value:21})});pending[0]({ok:true,json:async()=>({value:20})});await settleCounter(h);assert.equal(h.element('playsN').textContent,'22');
});

test('failed or malformed counter responses show Unavailable without inventing a total or retrying hits',async t=>{
  for(const fetch of [async()=>({ok:false,status:503}),async()=>({ok:true,json:async()=>({value:'not a count'})}),async()=>{throw new Error('Network unavailable');}]){
    const h=fixture(t,{url:'https://fourstripes.github.io/stern-to/',fetch});await settleCounter(h);
    assert.equal(h.element('plays').hidden,false);assert.equal(h.element('playsN').textContent,'Unavailable');
    play(h);await settleCounter(h);assert.equal(h.read('state'),'play');assert.equal(h.element('playsN').textContent,'Unavailable');assert.equal(h.fetchCalls.filter(([url])=>url.includes('/hit/')).length,1);assert.deepEqual(h.errors,[]);
  }
});

test('a failed increment preserves the last confirmed total and is never retried automatically',async t=>{
  const h=fixture(t,{url:'https://fourstripes.github.io/stern-to/',fetch:async url=>{if(url.includes('/hit/'))throw new Error('Response lost');return{ok:true,json:async()=>({value:321})};}});
  await settleCounter(h);play(h);await settleCounter(h);h.frame(15100);await settleCounter(h);
  assert.equal(h.element('playsN').textContent,'321');assert.equal(h.fetchCalls.filter(([url])=>url.includes('/hit/')).length,1);assert.deepEqual(h.errors,[]);
});

test('public counter aborts an unresponsive request without affecting the game',async t=>{
  const h=fixture(t,{url:'https://fourstripes.github.io/stern-to/',fetch:(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Aborted'))))});
  h.frame(11100);assert.equal(h.fetchCalls[0][1].signal.aborted,false);
  h.advance(4100);await settleCounter(h);assert.equal(h.fetchCalls[0][1].signal.aborted,true);assert.deepEqual(h.errors,[]);assert.equal(h.read('state'),'menu');
  assert.equal(h.element('plays').hidden,false);assert.equal(h.element('playsN').textContent,'Unavailable');
});

test('wake lock is deduplicated and released on pause',async t=>{
  const h=fixture(t);let requests=0,releases=0;
  Object.defineProperty(h.window.navigator,'wakeLock',{configurable:true,value:{request:async()=>{requests++;return{release:async()=>{releases++;},addEventListener(){}};}}});
  play(h);h.run('syncWakeLock();syncWakeLock()');await h.flush();assert.equal(requests,1);
  h.click('pauseBtn');await h.flush();assert.equal(releases,1);
  h.click('pauseBtn');await h.flush();assert.equal(requests,2);
});
