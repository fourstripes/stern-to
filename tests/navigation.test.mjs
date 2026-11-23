import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { closestApproach, classifyEncounter, planTrafficStep, planWaterRoute, segmentClear, navigationAdvice } from '../src/navigation.js';

const boat=(id,x,y,heading,speed=3)=>({id,x,y,heading,speed,length:30,beam:7,cruiseSpeed:3});
const rectangle=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1]];
const source=readFileSync(new URL('../src/game.js',import.meta.url),'utf8');
const definitions=source.slice(source.indexOf('/* ---------- ship ---------- */'),source.indexOf('/* mooring:'));
const context=vm.createContext({createVesselPhysics:()=>({thrusterArm:0})});
vm.runInContext('const D2R=Math.PI/180,TAU=Math.PI*2;'+definitions,context);

function harbour(ship,index){
  return JSON.parse(vm.runInContext(`JSON.stringify((()=>{
    setShipParams('${ship}');const level=LEVELS[${index}],g=GEO,polygons=[],traffic=[];
    const land=(x0,y0,x1,y1)=>polygons.push([[x0*g,y0*g],[x1*g,y0*g],[x1*g,y1*g],[x0*g,y1*g]]);
    level.build({land,pier:land,boat:(x,y,h,l,b)=>polygons.push(poly(x*g,y*g,h*D2R,l*g,b*g)),
      isle:(x,y,r)=>polygons.push(Array.from({length:12},(_,i)=>[(x+Math.cos(i*TAU/12)*r)*g,(y+Math.sin(i*TAU/12)*r)*g])),
      buoy(){},mover:(x,y,h,l,b,tr)=>traffic.push({x:x*g,y:y*g,heading:h*D2R,length:l*g,beam:b*g,route:tr.wp.map(p=>p.map(v=>v*g))})});
    return {polygons,traffic,length:LEN,beam:BEAM,scale:g,start:[level.start[0]*g,level.start[1]*g],goals:(level.stops||[{slip:level.slip}]).map(stop=>[stop.slip.x*g,stop.slip.y*g]),junctions:level.navigation.map(p=>p.map(v=>v*g))};
  })())`,context));
}

// Independent polygon SAT checks the actual hull, not the planner's capsule.
function hull(v){
  const outline=[[.5,0],[.38,.31],[.2,.48],[-.1,.5],[-.5,.46],[-.5,-.46],[-.1,-.5],[.2,-.48],[.38,-.31]],c=Math.cos(v.heading),s=Math.sin(v.heading);
  return outline.map(([a,b])=>[v.x+a*v.length*c-b*v.beam*s,v.y+a*v.length*s+b*v.beam*c]);
}
function overlap(a,b){
  for(const shape of [a,b])for(let i=0;i<shape.length;i++){
    const p=shape[i],q=shape[(i+1)%shape.length],axis=[q[1]-p[1],p[0]-q[0]],project=poly=>poly.map(v=>v[0]*axis[0]+v[1]*axis[1]);
    const aa=project(a),bb=project(b);if(Math.max(...aa)<=Math.min(...bb)||Math.max(...bb)<=Math.min(...aa))return false;
  }
  return true;
}
function navigate(initial,goal,{other,polygons=[],seconds=60,dt=.1}={}){
  let vessel={...initial},memory={},minimum=Infinity;const track=[];
  for(let i=0;i<seconds/dt;i++){
    const contact=typeof other==='function'?other(i*dt):other;
    const result=planTrafficStep({vessel,goal,contacts:contact?[contact]:[],obstacles:polygons,dt,memory});vessel={...vessel,...result};memory=result.memory;
    for(const obstacle of polygons)assert.equal(overlap(hull(vessel),obstacle),false,'hull remains clear of a fixed obstacle');
    if(contact){assert.equal(overlap(hull(vessel),hull(contact)),false,'vessels remain clear');minimum=Math.min(minimum,Math.hypot(vessel.x-contact.x,vessel.y-contact.y));}
    track.push([vessel.x,vessel.y,vessel.heading,vessel.speed]);
  }
  return{vessel,track,minimum};
}

test('CPA uses relative velocity, distinguishes receding traffic, and handles equal velocities',()=>{
  const own=boat('own',0,0,0),headOn=boat('other',120,0,Math.PI);
  const cpa=closestApproach(own,headOn);assert.equal(cpa.time,20);assert.ok(cpa.distance<1e-10);assert.equal(cpa.closing,true);
  const equal=closestApproach(own,boat('other',100,20,0));assert.equal(equal.time,0);assert.equal(equal.closing,false);assert.ok(Number.isFinite(equal.distance));
  const receding=closestApproach(own,boat('other',-100,0,Math.PI));assert.equal(receding.time,0);assert.equal(receding.future,false);
  assert.equal(classifyEncounter(own,boat('other',-60,0,Math.PI)).risk,false);
});

test('encounters distinguish head-on, crossing responsibilities and overtaking',()=>{
  const own=boat('own',0,0,0);
  assert.equal(classifyEncounter(own,boat('other',100,0,Math.PI)).kind,'head-on');
  assert.equal(classifyEncounter(own,boat('other',60,60,-Math.PI/2)).kind,'give-way');
  assert.equal(classifyEncounter(own,boat('other',60,-60,Math.PI/2)).kind,'stand-on');
  assert.equal(classifyEncounter({...own,speed:4},boat('other',60,0,0,2)).kind,'overtaking');
  assert.equal(classifyEncounter({...own,speed:2},boat('other',-60,0,0,4)).kind,'being-overtaken');
});

test('head-on traffic makes an early starboard alteration and passes clear',()=>{
  const result=navigate(boat('own',0,0,0),[300,0],{other:t=>boat('other',120-3*t,0,Math.PI),seconds:45});
  assert.ok(result.track.some(([,y],i)=>i<150&&y>3),'starboard action is visible before the close encounter');
  assert.ok(result.vessel.x>100,'traffic resumes its route after passing');
});

test('a route bending to port cannot override an active head-on starboard duty',()=>{
  const own=boat('own',0,0,0),other=boat('other',100,0,Math.PI);
  assert.equal(classifyEncounter(own,other).kind,'head-on');
  for(const goal of [[0,-200],[-200,-100]]){
    const result=planTrafficStep({vessel:own,goal,contacts:[other],dt:1/60});
    assert.ok(result.heading>0,'actual heading initially alters to starboard');assert.equal(result.memory.side,1);assert.equal(result.encounter,'head-on');
  }
  assert.equal(navigationAdvice(own,[other]).text,'Head-on traffic · turn to starboard');
});

test('two active traffic vessels plan from the same snapshot and pass port-to-port',()=>{
  let vessels=[boat('eastbound',0,0,0),boat('westbound',160,0,Math.PI)],memories=[{},{}];const goals=[[300,0],[-140,0]];let separatedSides=false;
  for(let i=0;i<500;i++){
    const plans=vessels.map((v,index)=>planTrafficStep({vessel:v,goal:goals[index],contacts:[vessels[1-index]],dt:.1,memory:memories[index]}));
    vessels=vessels.map((v,index)=>({...v,...plans[index]}));memories=plans.map(p=>p.memory);
    assert.equal(overlap(hull(vessels[0]),hull(vessels[1])),false);
    if(vessels[0].y>4&&vessels[1].y<-4)separatedSides=true;
  }
  assert.equal(separatedSides,true);assert.ok(vessels[0].x>vessels[1].x);
});

test('a starboard quay never turns a head-on avoidance manoeuvre into a grounding',()=>{
  const quay=rectangle(-50,8,300,100);
  const result=navigate(boat('own',0,0,0),[260,0],{other:t=>boat('other',110-3*t,0,Math.PI),polygons:[quay],seconds:45});
  assert.ok(result.track.some(([,y])=>y<-5),'uses available clear water when starboard is obstructed');
  assert.ok(result.vessel.x>70);
});

test('a crossing give-way vessel passes astern while stand-on advice preserves responsibility',()=>{
  const own=boat('own',0,0,0),crossing=t=>boat('other',60,60-3*t,-Math.PI/2);
  const result=navigate(own,[240,0],{other:crossing,seconds:45});
  const crossingLine=result.track.find(([x])=>x>=60);
  assert.ok(crossingLine);assert.ok(crossingLine[1]>0,'keeps behind the crossing vessel');
  const standOn=planTrafficStep({vessel:own,goal:[240,0],contacts:[boat('other',60,-60,Math.PI/2)],dt:.1});
  assert.equal(standOn.heading,0);assert.equal(standOn.speed,3);
  assert.match(navigationAdvice(own,[boat('other',60,-60,Math.PI/2)]).text,/hold course/);
});

test('overtaking traffic remains clear until past the slower vessel',()=>{
  const result=navigate({...boat('own',0,0,0,4),cruiseSpeed:4},[500,0],{other:t=>boat('other',70+1.5*t,0,0,1.5),seconds:75});
  assert.ok(result.vessel.x>70+1.5*75+30);
});

test('blocked traffic brakes before a quay and resumes when the obstruction clears',()=>{
  const wall=rectangle(75,-200,80,200),initial=boat('own',0,0,0);
  const waiting=navigate(initial,[180,0],{polygons:[wall],seconds:20});assert.ok(waiting.vessel.x<60);
  const released=navigate(waiting.vessel,[180,0],{seconds:35});assert.ok(released.vessel.x>waiting.vessel.x+40);
});

test('traffic output is deterministic, zero-time updates preserve state, and invalid routes fail closed',()=>{
  const initial=boat('own',0,0,0),options={other:boat('other',90,0,0,0),seconds:35};
  assert.deepEqual(navigate(initial,[200,0],options).track,navigate(initial,[200,0],options).track);
  const paused=planTrafficStep({vessel:initial,goal:[200,0],dt:0});assert.deepEqual([paused.x,paused.y,paused.heading,paused.speed],[0,0,0,3]);
  const island=rectangle(20,-20,60,20);assert.equal(segmentClear([0,0],[80,0],[island],4),false);
  assert.deepEqual(planWaterRoute([0,0],[40,0],[[0,40],[80,40]],[island],4),[]);
});

test('the six-knot harbour advisory is limited to the simulation harbour zone',()=>{
  const vessel=boat('own',0,0,0,4);
  assert.equal(navigationAdvice(vessel,[],{harbour:true}).overspeed,true);
  assert.equal(navigationAdvice(vessel,[],{harbour:true}).speedLimit,6);
  assert.equal(navigationAdvice(vessel,[],{harbour:false}).speedLimit,null);
  assert.equal(navigationAdvice(vessel,[],{harbour:false}).text,'');
});

for(const ship of ['tender','super','ls'])test(`${ship} receives clear-water guidance for every harbour and every mission leg`,()=>{
  for(let level=0;level<4;level++){
    const data=harbour(ship,level),clearance=data.beam*.5+.6*data.scale;let from=data.start;
    for(const goal of data.goals){
      const route=planWaterRoute(from,goal,data.junctions,data.polygons,clearance);
      assert.ok(route.length,`${ship}, harbour ${level}, goal ${goal}: reachable`);assert.deepEqual(route.at(-1),goal);
      for(const point of route){assert.equal(segmentClear(from,point,data.polygons,clearance),true);from=point;}
    }
    for(const traffic of data.traffic)for(let i=1;i<traffic.route.length;i++)assert.equal(segmentClear(traffic.route[i-1],traffic.route[i],data.polygons,traffic.beam*.5+1.5),true,'authored traffic route stays in clear water');
  }
});
