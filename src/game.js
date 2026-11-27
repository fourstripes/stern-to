import * as T3 from '../vendor/three.module.min.js';
import { FIXED_STEP, MAX_FRAME_TIME, planSimulationSteps, renderPixelRatio, AdaptiveQuality } from './runtime.js';
import { createVesselPhysics, vesselForces, bodyAcceleration, resolveContact } from './physics.js?v=20261126-arcadefoil';
import { planTrafficStep, planWaterRoute, segmentClear, navigationAdvice } from './navigation.js?v=20261123-simulation';
import { buildWaves, sampleWater, stepDampedSpring, foamParameters, waterQuality, WATER_GLSL } from './water.js?v=20261123-simulation';

export function startGame(lifecycle = {}) {
const $=id=>document.getElementById(id);
const app=$('app'),glc=$('gl'),cv=glc;
const KN=1.94384,D2R=Math.PI/180,TAU=Math.PI*2;
const clamp=(v,a,b)=>v<a?a:v>b?b:v, sgn=Math.sign, rnd=(a,b)=>a+Math.random()*(b-a);
const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- ship ---------- */
const HULL=[[25,0],[19,2.9],[10,4.5],[-5,4.7],[-25,4.3],[-25,-4.3],[-5,-4.7],[10,-4.5],[19,-2.9]];
const SHIPS={
 tender:{name:'Tender',spec:'12 m foiler · 9 t · flies from 16 kn · about 41 kn',L:12,B:3.6,m:9e3,tA:16e3,tS:9e3,thr:1.6e3,cd:.3,steeringSpeed:10,rudderScale:3},
 super:{name:'Superyacht',spec:'50 m · 500 t · 2 × 1,200 kW · about 16 kn',L:50,B:9.4,m:5e5,tA:180e3,tS:125e3,thr:30e3},
 ls:{name:'Megayacht',spec:'74 m · 1,500 t · 2 × 2,000 kW · about 17 kn',L:74,B:12.6,m:1.5e6,tA:360e3,tS:245e3,thr:55e3,cd:.9}};
// everything below scales from the 50 m boat: SL length, SB beam, MR mass, GEO the harbour, LK line strength
let shipId='super',LEN,BEAM,SL,SB,MR,GEO,LK,physics,THR_X;
function setShipParams(id){
  const q=SHIPS[id];shipId=id;LEN=q.L;BEAM=q.B;SL=LEN/50;SB=BEAM/9.4;MR=q.m/5e5;GEO=id==='ls'?1.45:1;LK=Math.pow(MR,.67); // the harbour grows to take the 74 m
  physics=createVesselPhysics(q);THR_X=physics.thrusterArm;
}
setShipParams('super');
function poly(x,y,psi,l,b){const cs=Math.cos(psi),sn=Math.sin(psi),sl=l/50,sb=b/9.4;return HULL.map(([a,d])=>{a*=sl;d*=sb;return[x+a*cs-d*sn,y+a*sn+d*cs];});}

/* ---------- berths ---------- */
const LOOKS=[
 {hull:'#f3f5f6',side:'#c3ccd2',trim:'#22394a',deck:'#c8a878',s1:'#e4e9ec',s2:'#f6f8f9',s3:'#d9e0e4',wall:'#aeb9c0'},
 {hull:'#2a455b',side:'#14283a',trim:'#0e1c27',deck:'#bfa074',s1:'#e9edf0',s2:'#f6f8f9',s3:'#dfe5e8',wall:'#aeb9c0'},
 {hull:'#e9e4d8',side:'#bdb6a6',trim:'#6d6558',deck:'#b89a6e',s1:'#f2efe8',s2:'#fbfaf6',s3:'#e1dccf',wall:'#b9b3a4'},
 {hull:'#a3adb3',side:'#69757c',trim:'#3d474d',deck:'#c3a57a',s1:'#dfe4e7',s2:'#eef1f3',s3:'#cfd6da',wall:'#a3adb3'}];
const OWN={hull:'#fbfcfc',side:'#cdd6db',trim:'#0f2a3a',deck:'#d2b07c',s1:'#e8edf0',s2:'#ffffff',s3:'#dde4e8',wall:'#b2bdc4'};
const LEVELS=[
 {name:'Fuel quay',sub:'Side-to in an open basin. Either way round.',wind:[5,270],swell:[.2,180],start:[-30,95,-90],par:170,
  slip:{x:0,y:-33.6,h:0,len:64,wid:13.5,either:true},
  navigation:[[-60,30],[0,30],[60,30]],harbourZones:[[-210,-45,210,55]],
  build(o){o.land(-700,-240,700,-40);o.boat(-62,-34.6,0,38,8);o.boat(64,-34.3,180,44,8.6);o.boat(150,-35,0,30,7);o.boat(-140,-35,0,34,7.4);}},
 {name:'The row',sub:'Stern-to between two neighbours, wind on the beam.',wind:[10,270],swell:[.2,160],start:[115,75,180],par:260,
  slip:{x:0,y:-12,h:90,len:58,wid:14.6},
  navigation:[[0,55],[60,55],[-60,55],[90,85]],harbourZones:[[-110,-45,110,65]],
  build(o){o.land(-700,-240,700,-40);
   [[-12.6,-14,46,9.4],[12.8,-11,54,10],[-25.5,-16,42,8.8],[-38,-18,38,8.2],[26.5,-13,50,9.6],[40,-15,46,9.2],[53,-18,40,8.6]].forEach(b=>o.boat(b[0],b[1],90,b[2],b[3]));}},
 {name:'Inner basin',sub:'Up the channel, turn in the basin, back between the piers.',wind:[15,315],swell:[.4,180],start:[2,205,-90],par:440,
  slip:{x:118,y:-121.5,h:90,len:58,wid:13.4},
  navigation:[[0,160],[0,-70],[40,-85],[118,-85],[180,-85]],harbourZones:[[-20,-155,220,160]],
  build(o){o.land(-700,-190,700,-150);o.land(-700,-150,-18,140);o.land(18,-40,700,140);o.land(215,-150,700,-40);
   [78,94,110,126,142,158].forEach(x=>o.pier(x-1.2,-150,x+1.2,-110));
   o.boat(86,-128,90,34,8);o.boat(102,-127,90,36,8.4);o.boat(134,-126,90,38,8.6);o.boat(150,-129,90,30,7.6);
   o.boat(-13,62,-90,28,7);o.boat(172,-45.2,0,36,8);}},
 // Mission: one island, three stops, sailed in one go. Fuel on the south quay (easy), the yard's dock cut into the east side (medium),
 // then stern-to between the piers of the north basin, behind its breakwater (hard).
 {name:'Mission',mission:true,sub:'Fuel, the shipyard, collect the owner, then anchor off the little island. One run, one score.',wind:[10,250],swell:[.3,200],start:[-330,300,0],par:1300,
  stops:[{name:'Fuel dock',dur:9,doing:'Taking fuel',done:'Fuel on board',slip:{x:-60,y:206.6,h:0,len:64,wid:13.5,either:true}},
         {name:'Shipyard',dur:10,doing:'Yard crew at work',done:'Repairs done',slip:{x:181,y:0,h:180,len:60,wid:15.4,either:true}},
         {name:"Owner's berth",dur:14,doing:'Owner flying in',done:'Owner aboard',slip:{x:0,y:-229.5,h:-90,len:58,wid:13.4}},
         {name:'Anchorage',dur:3,anchor:true,doing:'Anchor down',done:'Anchored',slip:{x:330,y:332,h:0,len:56,wid:56,either:true,circle:true}}],
  slip:{x:-60,y:206.6,h:0,len:64,wid:13.5,either:true},
  navigation:[[-280,270],[-120,245],[80,245],[270,245],[290,110],[290,0],[260,0],[290,-110],[285,-250],[220,-275],[150,-275],[85,-275],[0,-275],[-70,-275],[-270,-370],[140,-370],[330,300]],
  harbourZones:[[-230,190,235,255],[160,-165,335,165],[-150,-350,240,-195]],
  build(o){
   o.land(-220,-200,150,200);o.land(150,-200,220,-8);o.land(150,8,220,200);        // the island, with the yard dock cut into its east side
   o.land(-140,-330,90,-322);o.land(-140,-322,-132,-200);                            // breakwater round the north basin
   [-40,-24,-8,8,24].forEach(x=>o.pier(x-1.2,-240,x+1.2,-200));
   o.boat(-32,-220,-90,34,8);o.boat(-16,-221,-90,36,8.4);o.boat(16,-222,-90,38,8.6);
   o.boat(-135,205.2,0,38,8);o.boat(15,205.5,180,44,8.6);o.boat(110,205,0,30,7);     // along the fuel quay
   o.boat(225.5,-110,90,40,8.6);o.boat(225.2,120,-90,34,8);                          // alongside the east face
   o.isle(492,432,36);
   // traffic: a boat crosses the yard entrance as you arrive, another comes into the north basin as you leave with the owner
   o.mover(272,-360,90,30,7,{wp:[[272,-360],[290,-110],[290,110],[280,360]],spd:4.2,stage:1,near:[181,0,190],name:'Coastal launch'});
   o.mover(440,-285,180,34,7.6,{wp:[[440,-285],[220,-285],[80,-285],[-80,-285]],spd:3.4,stage:3,leave:[0,-229.5,14],name:'Inbound launch'});
   // IALA region A lateral marks (red to port entering), plus an east cardinal off the island
   o.buoy(232,22,'red');o.buoy(232,-22,'green');
   o.buoy(110,-212,'red');o.buoy(110,-312,'green');o.buoy(170,-205,'red');o.buoy(170,-318,'green');
   o.buoy(552,432,'east');o.buoy(-190,226,'red');o.buoy(-190,292,'green');o.buoy(240,-70,'east');                                                               // the little island off the south-east point
  }}
];
let buoys=[],obstacles=[],lvI=0,LV=LEVELS[0],slip=LV.slip,stops=null,allSlips=[];
let navigationPolygons=[],navigationJunctions=[],trafficPolygons=[],navCache={key:'',path:[],index:0,check:0,advice:{text:'',speedLimit:null},blocked:false,finalTarget:null};
/* mooring: fairleads on the yacht (body coords), bollards on the dock, two dockhands */
// kind: 1 leads forward, -1 leads aft, 2 forward spring (leads aft from forward of midships), -2 aft spring (leads forward from the quarter)
const LINE_DEF=[['Port bow',21,-1.9,1],['Starboard bow',21,1.9,1],['Port stern',-24,-3.9,-1],['Starboard stern',-24,3.9,-1],['Forward spring',9,0,2],['Aft spring',-11,0,-2]];
let lines=[],bollards=[],hands=[];
const sendHand=b=>{
  if(hands.some(h=>h.tx===b.x&&h.ty===b.y))return;
  const busy=h=>lines.some(l=>(l.state==='throw'||l.state==='haul')&&l.bol&&l.bol.x===h.tx&&l.bol.y===h.ty);
  let best=null,bd=1e9;for(const h of hands){if(busy(h))continue;const d=Math.hypot(h.x-b.x,h.y-b.y);if(d<bd){bd=d;best=h;}}
  if(best){best.tx=b.x;best.ty=b.y;best.h=b.h;}
};
let sel=-1,haul=0,anchorHold=null,mooringSection=null; // line haul and anchor windlass have separate input owners
let FEND_D=.75; // how far a rigged fender holds the hull off
const fendOK=sd=>{let n=0;for(let i=0;i<4;i++)if(i+1<=S.fendN[sd]+.001&&!S.fPop[i*2+sd])n++;return n;};
function ownPoly(){ // hull outline, pushed out on any side with fenders rigged
  const cs=Math.cos(S.psi),sn=Math.sin(S.psi),sl=LEN/50,sb=BEAM/9.4,fp=fendOK(0)>=3?FEND_D:0,fs=fendOK(1)>=3?FEND_D:0;
  return HULL.map(([a,d])=>{a*=sl;d*=sb;if(a<12*sl){if(d>0)d+=fs;else if(d<0)d-=fp;}return[S.x+a*cs-d*sn,S.y+a*sn+d*cs];});
}
function popFender(sd,px,py){
  const a=(px-S.x)*Math.cos(S.psi)+(py-S.y)*Math.sin(S.psi);let best=-1,bd=1e9;
  for(let i=0;i<4;i++)if(i+1<=S.fendN[sd]+.001&&!S.fPop[i*2+sd]){const d=Math.abs(FENDX[i]*LEN/2-a);if(d<bd){bd=d;best=i;}}
  if(best<0)return;
  S.fPop[best*2+sd]=.001;S.fStress[sd]=1.1;S.shake=.9;S.kick=1.2;S.boom={x:px,y:py};S.popT=S.t;toast('FENDER BURST',2200);
  for(let i=0;i<18;i++)spawn(1,px+rnd(-1,1),py+rnd(-1,1),rnd(-3,3),rnd(-3,3),rnd(.5,1),rnd(1,2.4),.7);
}
const FENDX=[-.78,-.5,-.2,.1],FENDL=['','Port','Starboard','Both'];
function setFenders(value){if(state!=='play'||!Number.isInteger(value)||value<0||value>3)return;S.fend=value;updateMooringUI();toast(['Fenders in','Fenders to port','Fenders to starboard','Fenders both sides'][S.fend],1200);}
function toggleFend(){if(state==='play')setFenders((S.fend+1)%4);}
function lineClick(i){
  if(state!=='play')return;const ln=lines[i];
  releaseMooringInputs('haul');
  if(ln.state!=='stowed'){sel=sel===i?-1:i;updateMooringUI();return;} /* tap a working line to single it out, tap again for all */
  const [best,bd,near]=pickBol(ln);
  if(!best){toast(near<60?'Too far to throw · '+Math.round(near)+' m to a bollard':'No bollard in reach',1500);return;}
  ln.bol=best;ln.dist=bd;ln.reach=bd;ln.good=true;ln.state='throw';ln.t=0;ln.ten=ln.tl=ln.strain=0;sendHand(best);toast(ln.name+' line away',1100);
}
function pickBol(ln){
  const cs=Math.cos(S.psi),sn=Math.sin(S.psi),spring=Math.abs(ln.kind)===2;
  if(spring){ // springs go out on whichever side the dock is
    let nb=null,nd=1e9;for(const q of bollards){const d=Math.hypot(q.x-(S.x+ln.a*cs),q.y-(S.y+ln.a*sn));if(d<nd){nd=d;nb=q;}}
    if(nb){ln.b=((-(nb.x-S.x)*sn+(nb.y-S.y)*cs)>0?1:-1)*4.5*SB;ln.fx=S.x+ln.a*cs-ln.b*sn;ln.fy=S.y+ln.a*sn+ln.b*cs;}
  }
  // every line takes its own bollard, and leads the right way: bow lines ahead, stern lines astern, springs along the hull
  const used=new Set(lines.filter(l=>l!==ln&&l.state!=='stowed'&&l.bol).map(l=>l.bol));
  let best=null,bs=1e9,bd=1e9,near=1e9;
  for(const q of bollards){
    const d=Math.hypot(q.x-ln.fx,q.y-ln.fy);if(d<near)near=d;if(used.has(q)||d>(spring?30:24))continue;
    const al=(q.x-ln.fx)*cs+(q.y-ln.fy)*sn;let sc=d;
    if(ln.kind===1&&al<-2)sc+=(-2-al)*1.5;else if(ln.kind===-1&&al>2)sc+=(al-2)*1.5;
    else if(ln.kind===2)sc+=al>-7?(al+7)*3:0;else if(ln.kind===-2)sc+=al<7?(7-al)*3:0;
    if(sc<bs){bs=sc;bd=d;best=q;}
  }
  return [best,bd,near];
}
/* mission skip: she starts still moored at the stop before, fenders out on the quay side and every line that reaches made fast */
function mooredStart(){
  const cs=Math.cos(S.psi),sn=Math.sin(S.psi),hit=[0,0];
  for(const q of bollards){const al=(q.x-S.x)*cs+(q.y-S.y)*sn,la=-(q.x-S.x)*sn+(q.y-S.y)*cs;if(Math.abs(al)<LEN*.55&&Math.abs(la)<BEAM*.5+8)hit[la<0?0:1]++;}
  S.fend=(hit[0]?1:0)|(hit[1]?2:0);S.fendN[0]=hit[0]?4:0;S.fendN[1]=hit[1]?4:0; /* a pen gets fenders both sides */
  for(const ln of lines){ln.fx=S.x+ln.a*cs-ln.b*sn;ln.fy=S.y+ln.a*sn+ln.b*cs;const [best,bd]=pickBol(ln);
    if(best){ln.bol=best;ln.dist=ln.reach=bd;ln.good=true;ln.state='fast';ln.prog=1;
      const fx=S.x+ln.a*cs-ln.b*sn,fy=S.y+ln.a*sn+ln.b*cs;ln.L0=Math.hypot(best.x-fx,best.y-fy)+.4;}}
}
// Every anchor command uses the selected sides; accepted crew work keeps its own side snapshot.
const hawseFor=sd=>shipId==='tender'?[24.6*SL,0]:[19.4*SL,sd*2.4*SB];
const anchSides=()=>shipId==='tender'?[0]:S.anchSel===2?[-1,1]:[S.anchSel===0?-1:1];
const selectedAnchors=()=>S.anchors.filter(a=>anchSides().includes(a.side));
const SCOPE_OF=()=>Math.ceil(18*Math.max(.7,SL));
const preferredAnchor=()=>selectedAnchors()[0]||S.anchors[0]; // goal display only; never an operation target
function setAnchorSelection(value){
  if(!canDrive()||!Number.isInteger(value)||value<0||value>2)return;
  releaseMooringInputs('anchor');S.anchSel=shipId==='tender'?0:value;updateMooringUI();
}
function cycleAnchSel(){
  if(!canDrive())return;if(shipId==='tender'){toast('The tender has one bow anchor',1200);return;}
  setAnchorSelection((S.anchSel+1)%3);toast(['Port anchor','Starboard anchor','Both anchors'][S.anchSel],900);
}
/* Anchoring works like a real foredeck: Drop lets the anchor go and the crew pay the chain out under the brake as
   she falls back; Lock puts the brake on; Up heaves it in. Each is one tap. */
function dropAnchors(){
  if(!canDrive())return;releaseMooringInputs('anchor');
  const addSides=anchSides().some(sd=>!S.anchors.some(a=>a.side===sd)&&!(S.dropSides||[]).includes(sd));
  /* adding a missing anchor leaves the one already down as it is; otherwise Drop eases the brake and pays out more */
  const resume=addSides?[]:selectedAnchors().filter(A=>!A.paying&&A.L0<140);
  for(const A of selectedAnchors()){A.held=true;A.weighing=false;A.tapHeave=false;if(resume.includes(A)){A.paying=true;A.scopeSaid=false;}}
  if(resume.length)toast('Paying out chain · tap the lock to hold it',1600);
  const pending=S.dropSides||[],missing=anchSides().filter(sd=>!S.anchors.some(a=>a.side===sd)&&!pending.includes(sd));
  if(!missing.length){updateMooringUI();return;}
  S.dropSides=[...pending,...missing];S.anchorCmd=true;updateMooringUI();toast('Anchor party to the bow',1300);
}
function lockAnchors(){
  if(!canDrive())return;releaseMooringInputs('anchor');
  const anchors=selectedAnchors();if(!anchors.length)return;
  for(const A of anchors){A.held=true;A.weighing=false;A.paying=false;A.tapHeave=false;}
  updateMooringUI();toast('Chain locked · '+Math.floor(Math.max(...anchors.map(a=>a.L0)))+' m out',1500);
}
function bringInAnchors(){
  if(!canDrive())return;releaseMooringInputs('anchor');
  const anchors=selectedAnchors();if(!anchors.length)return;
  const stop=anchors.some(a=>a.weighing);
  for(const A of anchors){A.held=true;A.weighing=!stop;A.paying=false;A.tapHeave=false;}
  updateMooringUI();toast(stop?'Chain held':anchors.length>1?'Bringing in both anchors':'Bringing in anchor',1500);
}
function letGo(){if(state!=='play')return;
  releaseMooringInputs('haul');
  if(sel>=0&&lines[sel].state!=='stowed'){lines[sel].state='stowed';toast(lines[sel].name+' line let go',1200);sel=-1;updateMooringUI();return;}
  let n=0;for(const ln of lines)if(ln.state!=='stowed'){ln.state='stowed';n++;}if(n)toast('All lines let go',1200);sel=-1;updateMooringUI();}
const env={wk:5,wFrom:270,sh:.2,sFrom:180,T:5.5,lam:48};
// Menu choices are the baseline. Mission weather may temporarily change env.
let selectedWeather={wk:env.wk,wFrom:env.wFrom,sh:env.sh,sFrom:env.sFrom};
function buildLevel(i){
  lvI=i;LV=LEVELS[i];const G=GEO;buoys=[];slip={...LV.slip,x:LV.slip.x*G,y:LV.slip.y*G,len:LV.slip.len*G,wid:LV.slip.wid*G,h:LV.slip.h*D2R};obstacles=[];let n=0;
  stops=LV.stops?LV.stops.map(st=>({...st,slip:{...st.slip,x:st.slip.x*G,y:st.slip.y*G,len:st.slip.len*G,wid:st.slip.wid*G,h:st.slip.h*D2R}})):null;if(stops)slip=stops[0].slip;allSlips=stops?stops.map(st=>st.slip):[slip];
  const add=(kind,p,extra)=>{let cx=0,cy=0;p.forEach(v=>{cx+=v[0];cy+=v[1];});cx/=p.length;cy/=p.length;let r=0;p.forEach(v=>r=Math.max(r,Math.hypot(v[0]-cx,v[1]-cy)));obstacles.push({kind,p,cx,cy,r,...extra});};
  LV.build({
    land:(a,b,d,e)=>{a*=G;b*=G;d*=G;e*=G;add('land',[[a,b],[d,b],[d,e],[a,e]]);},
    pier:(a,b,d,e)=>{a*=G;b*=G;d*=G;e*=G;add('pier',[[a,b],[d,b],[d,e],[a,e]]);},
    isle:(x,y,r)=>{x*=G;y*=G;r*=G;const P=[];for(let k=0;k<12;k++){const a=k/12*TAU;P.push([x+Math.cos(a)*r,y+Math.sin(a)*r]);}add('isle',P,{ix:x,iy:y,ir:r});},
    boat:(x,y,h,l,b)=>{x*=G;y*=G;l*=G;b*=G;add('boat',poly(x,y,h*D2R,l,b),{x,y,psi:h*D2R,l,b,look:LOOKS[n++%LOOKS.length]});},
    mover:(x,y,h,l,b,tr)=>{x*=G;y*=G;l*=G;b*=G;tr={...tr,id:'traffic-'+n,wp:tr.wp.map(q=>[q[0]*G,q[1]*G]),origin:{x,y,psi:h*D2R},st:'wait',i:1,v:0,stopT:0,memory:{}};add('boat',poly(x,y,h*D2R,l,b),{x,y,psi:h*D2R,l,b,look:LOOKS[n++%LOOKS.length],tr});},
    buoy:(x,y,t)=>{buoys.push({x:x*G,y:y*G,t});}
  });
  navigationPolygons=obstacles.filter(o=>!o.tr).map(o=>o.p);trafficPolygons=navigationPolygons;
  navigationJunctions=(LV.navigation||[]).map(p=>[p[0]*G,p[1]*G]);
  // bollards along every quay and pier edge near the berth
  bollards=[];
  for(const o of obstacles){
    if(o.kind==='boat'||o.kind==='isle')continue;const P=o.p;
    for(let i=0;i<P.length;i++){
      const a=P[i],b=P[(i+1)%P.length],ex=b[0]-a[0],ey=b[1]-a[1],L=Math.hypot(ex,ey);if(L<6)continue;
      let nx=-ey/L,ny=ex/L;if((o.cx-(a[0]+b[0])/2)*nx+(o.cy-(a[1]+b[1])/2)*ny<0){nx=-nx;ny=-ny;}
      let lo=1e9,hi=-1e9;for(const v of P){const d=v[0]*nx+v[1]*ny;lo=Math.min(lo,d);hi=Math.max(hi,d);}
      const ins=Math.min(1.1,(hi-lo)/2),sp=o.kind==='pier'?10:8;
      for(let d=sp/2;d<L;d+=sp){
        const x=a[0]+ex/L*d+nx*ins,y=a[1]+ey/L*d+ny*ins;
        const ox=x-nx*(ins+1.5),oy=y-ny*(ins+1.5); // no bollards on an edge that backs onto more land
        if(allSlips.some(q=>Math.hypot(x-q.x,y-q.y)<230)&&!obstacles.some(o2=>o2!==o&&o2.kind!=='boat'&&inside([ox,oy],o2.p))&&!bollards.some(q=>Math.hypot(q.x-x,q.y-y)<.6))bollards.push({x,y,h:o.kind==='pier'?.4:.55});
      }
    }
  }
}

/* ---------- state ---------- */
let S,state='menu',T=0,parts=[],toastT=0;
/* wash particles: 0 aerated water (soft, long lived), 1 foam clumps, 2 contact rings */
const MAXP=innerWidth<600?2600:4500;
const spawn=(k,x,y,vx,vy,size,life,g,w)=>{if(parts.length<MAXP)parts.push({k,x,y,vx,vy,size,life,max:life,g,w:w||0,s:Math.random()*6.28,v:(Math.random()*4)|0});};
const sprite=draw=>{const n=64,s=document.createElement('canvas');s.width=s.height=n;draw(s.getContext('2d'),n);return s;};
function reset(){
  releaseControls();resetFrameClock();
  toast.q=[];clearTimeout(toast.h);toast.h=null;toastT=0;$('toast').classList.add('off');
  $('fade').classList.remove('on');banner='';T=0;KW.on=false;
  nightEnv0=null;Object.assign(env,selectedWeather);
  if(U.uNight.value)applyNight(0);
  physGood=null;physWarned=false;
  const s=LV.start;
  S={x:s[0]*GEO,y:s[1]*GEO,foil:0,foilOn:false,rideH:0,dragScale:1,foilH:0,foilVH:0,stage:0,svc:null,dmgBank:0,mode:'arrive',voyage:false,legT0:0,legHits0:0,passing:false,fend:0,fendN:[0,0],fStress:[0,0],fSq:[0,0],fPop:[0,0,0,0,0,0,0,0],boom:null,bowX:19.5,weigh:{'-1':0,'0':0,'1':0},anchors:[],anchSel:0,anchorCmd:false,fire:null,done:false,wreck:false,psi:s[2]*D2R,u:0,v:0,r:0,lever:[0,0],rpm:[0,0],gear:[0,0],clutch:[0,0],thr:0,thrAct:0,rud:0,
     damage:0,hits:0,t:0,hold:0,inPos:false,lastTouch:-9,roll:0,shake:0};
  parts=[];$('rud').value=0;cam.x=S.x;cam.y=S.y;
  lines=LINE_DEF.map((d,i)=>({i,name:d[0],kind:d[3],a:d[1]*SL,b:d[2]*SB,state:'stowed',bol:null,L0:0,t:0,ten:0,strain:0,fx:S.x,fy:S.y,ready:false,dist:999,prog:0,reach:0,good:false}));S.bowY=0;sel=-1;haul=0;anchorHold=null;$('result').hidden=true;
  setMooringSection(null);
  if(stops){slip=stops[0].slip;buildSlipMarker();}
  resetTraffic();homeHands();resetVisuals();
}
function resetTraffic(){
  for(const o of obstacles)if(o.tr){
    const tr=o.tr;Object.assign(tr,{st:'wait',i:1,v:0,stopT:0,yield:false,said:false,memory:{},notice:'',noticeT:0});
    Object.assign(o,tr.origin);o.cx=o.x;o.cy=o.y;o.p=poly(o.x,o.y,o.psi,o.l,o.b);
  }
  navCache={key:'',path:[],index:0,check:0,advice:{text:'',speedLimit:null},blocked:false,finalTarget:null};updateNavigation(0);
}
function homeHands(){
  hands=[];
  for(const b of [...bollards].sort((p,q)=>Math.hypot(p.x-slip.x,p.y-slip.y)-Math.hypot(q.x-slip.x,q.y-slip.y)))
    if(hands.length<2&&!hands.some(h=>Math.hypot(h.x-b.x,h.y-b.y)<6))hands.push({x:b.x,y:b.y,tx:b.x,ty:b.y,h:b.h});
}
function setStop(i){slip=stops[i].slip;S.inPos=false;S.hold=0;buildSlipMarker();homeHands();}
const playerContact=()=>{const c=Math.cos(S.psi),s=Math.sin(S.psi);return{id:'player',x:S.x,y:S.y,heading:S.psi,length:LEN,beam:BEAM,vx:S.u*c-S.v*s,vy:S.u*s+S.v*c};};
const trafficContact=o=>({id:o.tr.id,x:o.x,y:o.y,heading:o.psi,length:o.l,beam:o.b,speed:o.tr.st==='go'?o.tr.v:0});
const inHarbour=(x,y)=>(LV.harbourZones||[]).some(([x0,y0,x1,y1])=>x>=x0*GEO&&x<=x1*GEO&&y>=y0*GEO&&y<=y1*GEO);
function updateNavigation(dt=0){
  if(!S)return;
  const goal=S.mode==='depart'?[LV.start[0]*GEO,LV.start[1]*GEO]:[slip.x,slip.y],key=lvI+'|'+shipId+'|'+S.stage+'|'+S.mode;
  const here=[S.x,S.y],clearance=BEAM*.5+.6*GEO;
  navCache.check-=dt;
  if(navCache.key!==key||navCache.check<=0){
    const current=navCache.path[navCache.index];
    if(navCache.key!==key||!current||!segmentClear(here,current,navigationPolygons,clearance)){
      navCache.path=planWaterRoute(here,goal,navigationJunctions,navigationPolygons,clearance);navCache.index=0;navCache.key=key;
      navCache.blocked=!navCache.path.length;navCache.waitAt=[...here];
    }
    navCache.finalTarget=goal;navCache.check=.5;
    // A visible next leg can be taken directly; never cut a corner through land.
    while(navCache.index<navCache.path.length-1&&segmentClear(here,navCache.path[navCache.index+1],navigationPolygons,clearance))navCache.index++;
    navCache.advice=navigationAdvice(playerContact(),obstacles.filter(o=>o.tr).map(trafficContact),{harbour:inHarbour(S.x,S.y),speedLimit:6});
  }
}
function navigationStatus(){
  const finalTarget=navCache.finalTarget||[slip.x,slip.y],waypoint=navCache.path[navCache.index]||navCache.waitAt||finalTarget;
  let remaining=Math.hypot(waypoint[0]-S.x,waypoint[1]-S.y);
  for(let i=navCache.index+1;i<navCache.path.length;i++)remaining+=Math.hypot(navCache.path[i][0]-navCache.path[i-1][0],navCache.path[i][1]-navCache.path[i-1][1]);
  return{waypoint,finalTarget,leg:navCache.index+1,remaining,blocked:navCache.blocked,advice:navCache.advice.text,speedLimit:navCache.advice.speedLimit,overspeed:!!navCache.advice.overspeed,encounter:navCache.advice.kind||'clear'};
}
const windTo=()=>{const a=(env.wFrom+180)*D2R+.12*Math.sin(T*.17);return[Math.sin(a),-Math.cos(a)];};
const windSpd=()=>env.wk/KN*(1+.22*Math.sin(T*.31+1.3)+.1*Math.sin(T*.83));
const swellTo=()=>{const a=(env.sFrom+180)*D2R;return[Math.sin(a),-Math.cos(a)];};

/* ---------- collision (SAT on convex polygons) ---------- */
function sat(A,B){
  let best=1e9,bn=null;
  for(const P of [A,B])for(let i=0;i<P.length;i++){
    const p=P[i],q=P[(i+1)%P.length];let nx=q[1]-p[1],ny=p[0]-q[0];const l=Math.hypot(nx,ny);if(l<1e-9)continue;nx/=l;ny/=l;
    let a0=1e9,a1=-1e9,b0=1e9,b1=-1e9;
    for(const v of A){const d=v[0]*nx+v[1]*ny;if(d<a0)a0=d;if(d>a1)a1=d;}
    for(const v of B){const d=v[0]*nx+v[1]*ny;if(d<b0)b0=d;if(d>b1)b1=d;}
    const back=a1-b0,forward=b1-a0;if(back<=0||forward<=0)return null;
    const overlap=Math.min(back,forward);
    if(overlap<best){best=overlap;const dir=back<forward?-1:1;bn=[nx*dir,ny*dir];}
  }
  return{n:bn,depth:best};
}
function inside(pt,P){let s=0;for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length];const cr=(b[0]-a[0])*(pt[1]-a[1])-(b[1]-a[1])*(pt[0]-a[0]);if(cr!==0){if(s===0)s=sgn(cr);else if(sgn(cr)!==s)return false;}}return true;}
function collide(){
  let touching=false;
  for(const o of obstacles){
    if(Math.hypot(o.cx-S.x,o.cy-S.y)>o.r+LEN/2+2)continue;
    const hp=ownPoly(),m=sat(hp,o.p);if(!m)continue;
    touching=true;const[nx,ny]=m.n;
    let px=0,py=0,k=0;
    for(const v of hp)if(inside(v,o.p)){px+=v[0];py+=v[1];k++;}
    for(const v of o.p)if(inside(v,hp)){px+=v[0];py+=v[1];k++;}
    if(k){px/=k;py/=k;}else{let mn=1e9;for(const v of hp){const d=v[0]*nx+v[1]*ny;if(d<mn){mn=d;px=v[0];py=v[1];}}}
    S.x+=nx*m.depth;S.y+=ny*m.depth;
    const cs=Math.cos(S.psi),sn=Math.sin(S.psi);
    const rx=px-S.x,ry=py-S.y,a=rx*cs+ry*sn,b=-rx*sn+ry*cs;
    const otherSpeed=o.tr&&o.tr.st==='go'?o.tr.v:0;
    const side=b>0?1:0,prot=fendOK(side)>=3,relativeHeading=(o.psi||0)-S.psi;
    const contact=resolveContact(physics,S,{a,b,nx:nx*cs+ny*sn,ny:-nx*sn+ny*cs,
      otherU:Math.cos(relativeHeading)*otherSpeed,otherV:Math.sin(relativeHeading)*otherSpeed,restitution:prot?.05:.15});
    if(contact.impact>0){
      S.u=contact.u;S.v=contact.v;S.r=contact.r;
      const hit=contact.impact;
      if(o.tr&&o.tr.st==='go'){o.tr.stopT=4;o.tr.v=0;S.u*=.25;S.v*=.25;S.r*=.25;} // both boats come to a stop
      const tied=lines.filter(l=>l.state==='fast').length>=2;
      if(prot){S.fSq[side]=Math.min(1,S.fSq[side]+hit*1.2+.03);S.fStress[side]+=Math.max(0,hit-(tied?.45:.12))*3;if(S.fStress[side]>2.2)popFender(side,px,py);}
      const soft=prot?(tied?.95:.55):.18;
      if(hit>soft){S.listV=clamp((S.listV||0)+(side?1:-1)*(hit-soft)*.07,-.14,.14);S.damage=Math.min(100,S.damage+((hit-soft)*45+2)*(prot?.7:1.2));if((hit>1.1||S.damage>=70)&&!S.fire){S.fire={a:a*.8,b:b*.8};toast('Fire on board',2200);}S.hits++;S.shake=Math.min(1,hit);S.kick=hit;if(S.t-(S.popT||-9)>1.5)toast('Hard contact · '+(hit*KN).toFixed(1)+' kn',1600);for(let i=0;i<10;i++)spawn(1,px,py,rnd(-2,2),rnd(-2,2),rnd(.7,1.2),rnd(1.2,2.4),.5);wakeDrop(px,py,Math.min(1.6,.4+hit*.3));S.sprayQ={t:0,k:Math.min(1.6,hit*.5),bias:side?-1:1,dur:.3,peak:.7};}
      else if(S.t-S.lastTouch>3&&hit>.03)toast(prot?'On the fenders':'Touching · no fenders that side',1100);
    }
    S.lastTouch=S.t;
  }
  return touching;
}

/* ---------- physics ---------- */
function updateTraffic(dt){
  if(state!=='play'||dt<=0)return;
  const moving=obstacles.filter(o=>o.tr),snapshot=moving.map(trafficContact),player=playerContact(),plans=[];
  for(const o of moving){const tr=o.tr;
    if(tr.st==='wait'){
      const go=stops&&S.stage===tr.stage&&(tr.near?Math.hypot(S.x-tr.near[0]*GEO,S.y-tr.near[1]*GEO)<tr.near[2]*GEO:Math.hypot(S.x-tr.leave[0]*GEO,S.y-tr.leave[1]*GEO)>tr.leave[2]*GEO);
      if(go){tr.st='go';tr.v=0;tr.memory={};}
    }
    if(tr.st!=='go')continue;
    let tg=tr.wp[tr.i],d=Math.hypot(tg[0]-o.x,tg[1]-o.y);
    while(tr.i<tr.wp.length-1&&d<Math.max(8*GEO,o.l*.45)){tr.i++;tg=tr.wp[tr.i];d=Math.hypot(tg[0]-o.x,tg[1]-o.y);tr.memory.replan=0;}
    const last=tr.i===tr.wp.length-1;
    if(last&&d<3*GEO&&tr.v<.5){tr.st='done';tr.v=0;tr.memory={};continue;}
    tr.stopT=Math.max(0,tr.stopT-dt);
    const cruise=Math.min(tr.spd,inHarbour(o.x,o.y)?6/KN:Infinity,last?Math.sqrt(Math.max(0,d-2*GEO)*1.1):Infinity);
    const vessel={...trafficContact(o),cruiseSpeed:tr.stopT>0?0:cruise};
    const plan=planTrafficStep({vessel,goal:tg,contacts:[player,...snapshot.filter(q=>q.id!==tr.id)],obstacles:trafficPolygons,dt,memory:tr.memory});
    plans.push([o,plan]);
  }
  // All vessels plan against the same snapshot, so array order grants no priority.
  for(const [o,plan] of plans){const tr=o.tr;o.x=plan.x;o.y=plan.y;o.psi=plan.heading;tr.v=plan.speed;tr.memory=plan.memory;tr.yield=plan.reason!=='following';o.p=poly(o.x,o.y,o.psi,o.l,o.b);o.cx=o.x;o.cy=o.y;
    tr.noticeT=Math.max(0,(tr.noticeT||0)-dt);
    const notice=navigationAdvice(player,[trafficContact(o)]);
    if(notice.risk&&notice.kind!==tr.notice&&tr.noticeT===0){tr.notice=notice.kind;tr.noticeT=12;toast(notice.text,3200);}
    else if(!notice.risk&&tr.noticeT===0)tr.notice='';
    const sp=tr.v;
    if(sp>.6&&Math.random()<dt*22)spawn(1,o.x-Math.cos(o.psi)*o.l*.5+rnd(-1,1),o.y-Math.sin(o.psi)*o.l*.5+rnd(-1,1),-Math.cos(o.psi)*1.5,-Math.sin(o.psi)*1.5,rnd(.6,1.1),rnd(2,4),.5);
    if(sp>.6&&Math.random()<dt*10){const sd=Math.random()<.5?-1:1;spawn(1,o.x+Math.cos(o.psi)*o.l*.45-Math.sin(o.psi)*sd*o.b*.5,o.y+Math.sin(o.psi)*o.l*.45+Math.cos(o.psi)*sd*o.b*.5,-Math.sin(o.psi)*sd,Math.cos(o.psi)*sd,.5,rnd(1.5,3),.35);}
  }
}
function anchorageStatus(){
  const target=Math.ceil(18*Math.max(.7,SL)),stop=stops&&stops[S.stage],active=!!(stop&&stop.anchor);
  const inZone=a=>active&&Math.hypot(a.x-slip.x,a.y-slip.y)<=slip.len/2;
  const held=a=>a.held&&!a.weighing&&!a.paying;
  const anchor=S.anchors.find(a=>inZone(a)&&held(a)&&a.L0>=target&&!a.drag)
    ||S.anchors.find(a=>inZone(a)&&held(a)&&a.L0>=target)
    ||S.anchors.find(a=>inZone(a)&&held(a))||S.anchors.find(inZone)||preferredAnchor();
  const current=anchor?anchor.L0:0,inside=!!(anchor&&inZone(anchor)),chainHeld=!!(anchor&&held(anchor));
  const settled=!!(anchor&&!anchor.drag&&Math.hypot(S.u,S.v)<.2&&Math.abs(S.r)<.6*D2R);
  const complete=active&&S.done,progress=complete?1:active?clamp((S.svc||0)/stop.dur,0,1):0;
  const status=complete?'Anchorage complete':!anchor?'Drop an anchor in the marked circle':!inside?'Place the anchor in the marked circle'
    :current<target?'Pay out '+target+' m of chain':!chainHeld?'Lock the chain':!settled?'Let the boat settle'
    :'Holding · '+((S.svc||0).toFixed(1))+' / '+stop.dur+' s';
  return {target,current,inside,held:chainHeld,settled,progress,complete,status};
}
function step(dt){
  if(S.passing&&advancePassage(dt))return;
  S.t+=dt;
  advanceMissionEnvironment(dt);setWaves();advanceDeckWork(dt);
  updateTraffic(dt);
  for(let i=0;i<2;i++){S.fStress[i]=Math.max(0,S.fStress[i]-.12*dt);S.fSq[i]*=Math.max(0,1-4*dt);}
  for(let i=0;i<2;i++){
    const want=Math.abs(S.lever[i])<.02?0:sgn(S.lever[i]);
    if(S.gear[i]!==want){const d=.9*dt;if(Math.abs(S.rpm[i])>d)S.rpm[i]-=sgn(S.rpm[i])*d;else{S.rpm[i]=0;S.clutch[i]+=dt;if(S.clutch[i]>.45){S.gear[i]=want;S.clutch[i]=0;}}}
    else{S.clutch[i]=0;S.rpm[i]+=clamp(S.lever[i]-S.rpm[i],-.5*dt,.5*dt);}
  }
  S.thrAct+=clamp(S.thr-S.thrAct,-2.5*dt,2.5*dt);
  const cs=Math.cos(S.psi),sn=Math.sin(S.psi),u=S.u,v=S.v,r=S.r;
  const S2=SL*SL;
  /* Hydrofoil tender, tuned for fun. On the hull, chop and the hump drag at her and she labours; at about 16 kn
     she leaps onto the foils, sheds the drag and the chop, picks up a little extra push and carves tight banked turns.
     Below about 14 kn, or after a hard knock, she drops back onto the hull. */
  if(shipId==='tender'){
    const was=S.foilOn,chop=Math.min(1.1,clamp(env.sh/1.2,0,1.2)+clamp(windSpd()/20,0,.5)*.5);
    if(S.foilOn&&S.shake>.6){S.foilOn=false;S.foilCrash=S.t;}
    else if(!S.foilOn&&u>8.2&&S.t-(S.foilCrash??-9)>2.5)S.foilOn=true;
    else if(S.foilOn&&u<7.1)S.foilOn=false;
    S.foil=clamp((S.foil||0)+(S.foilOn?dt/.9:-dt/.6),0,1);
    if(S.foilOn!==was&&state==='play')toast(S.foilOn?'Up on the foils':'Off the foils',1100);
    const hullK=1-S.foil,hump=S.foilOn?0:.35*clamp((u-5)/3.2,0,1);
    const slam=Math.pow(Math.max(0,Math.sin(S.t*3.3)),3); /* each sea she slams into knocks her back */
    /* ride height grows with speed (foil lift rises with speed squared), and the higher she flies the less of her
       drags: low just after take-off she still clips the chop, high and fast she is clean and free */
    const lift=clamp((u-7.5)/11.5,0,1),rideT=S.foil*(.5+1.7*lift*lift*(3-2*lift));
    S.rideH=(S.rideH||0)+clamp(rideT-(S.rideH||0),-2.2*dt,1.1*dt);const hN=clamp(S.rideH/2.2,0,1);
    S.dragScale=(1+hump+chop*clamp(u/7,0,1)*hullK*(1.1+.9*slam))*(1-.12*S.foil-.3*hN)+chop*.7*S.foil*clamp(1-hN*1.7,0,1)*(.6+.8*slam);
    /* lots of extra punch at high throttle to bully her over the hump in rough water (docking throttle is unchanged);
       the boost eases once she is flying high so top speed stays sane */
    const thr=(Math.abs(S.rpm[0])+Math.abs(S.rpm[1]))/2,punch=.45*clamp((thr-.45)/.55,0,1)*(1-.65*hN);
    S.thrustScale=(1+punch)*(1+.18*S.foil);S.steeringSpeed=S.foil>.5?15:undefined;
  }else{S.foil=0;S.foilOn=false;S.rideH=0;S.dragScale=1;S.thrustScale=1;S.steeringSpeed=undefined;}
  let {X,Y,N}=vesselForces(physics,S);
  // wind on the topsides, centre of effort forward of midships
  const wd=windTo(),ws=windSpd(),vx=u*cs-v*sn,vy=u*sn+v*cs;
  const ax=wd[0]*ws-vx,ay=wd[1]*ws-vy,wu=ax*cs+ay*sn,wv=-ax*sn+ay*cs;
  const yw=242*S2*wv*Math.abs(wv);
  X+=41*SB*SB*wu*Math.abs(wu);Y+=yw;N+=3.5*SL*yw;
  // The dominant shared wave supplies the forcing phase. Acceleration is down
  // its slope; short visual chop is filtered out of this planar hull model.
  const sw=WV[0],sd=[sw.dx,sw.dz],ph=sw.k*(sd[0]*S.x+sd[1]*S.y)-sw.om*T,seaShelter=shelter(S.x,S.y);
  const fs=(-60e3*env.sh*Math.cos(ph)+2500*env.sh*env.sh)*MR*seaShelter*1.4,su=sd[0]*cs+sd[1]*sn,sv=-sd[0]*sn+sd[1]*cs;
  X+=fs*su;Y+=fs*sv;N+=5e5*MR*SL*env.sh*Math.sin(ph)*2*su*sv*seaShelter;
  if(KW.on){KW.pos+=KW.c*dt;const xb=kingX(S.x,S.y);
    if(xb<100&&xb>0&&!S.kingSaid){S.kingSaid=1;toast('Here it comes · bow into it!',2600);}
    // push along its travel, strongest on the face, at bow and stern separately so a beam-on boat gets slewed round
    const kd=KW.d,push=(px,py)=>{const hh=kingH(px,py),sl=kingS(px,py);return physics.mx*9.81*(Math.max(0,-sl)*.55+hh/40*.6);};
    const bx=S.x+cs*LEN*.4,by=S.y+sn*LEN*.4,ax=S.x-cs*LEN*.4,ay=S.y-sn*LEN*.4,Pb=push(bx,by),Pa=push(ax,ay);
    const fu=kd[0]*cs+kd[1]*sn,fv=-kd[0]*sn+kd[1]*cs;X+=(Pb+Pa)*.5*fu;Y+=(Pb+Pa)*.5*fv;N+=(Pb-Pa)*fv*LEN*.4*.6;
    if(Math.abs(xb)<6&&!S.kingHit){S.kingHit=true;S.shake=.8;S.kick=1.4;S.sprayQ={t:0,k:1.6,bias:clamp(-fv,-1,1),dur:.6,peak:1.3};}
    if(xb<-320)KW.on=false;}
  S.roll=env.sh*Math.cos(ph)*sv*.07*seaShelter-wv*Math.abs(wv)*.00012;

  // mooring lines: thrown on a tap; the selected one is heaved in or slacked while a button is held
  // heaving on all lines evens the load: slack lines come in quickly, the hard ones are eased a touch
  const allH=haul>0&&(sel<0||lines[sel].state!=='fast'),fastL=lines.filter(l=>l.state==='fast'),avgT=fastL.length?fastL.reduce((q,l)=>q+(l.ten||0),0)/fastL.length:0,
    lenOf=l=>Math.hypot(l.bol.x-(S.x+l.a*cs-l.b*sn),l.bol.y-(S.y+l.a*sn+l.b*cs)),avgD=fastL.length?fastL.reduce((q,l)=>q+lenOf(l),0)/fastL.length:1;
  for(const ln of lines){
    const fx=S.x+ln.a*cs-ln.b*sn,fy=S.y+ln.a*sn+ln.b*cs;ln.fx=fx;ln.fy=fy;ln.tl=ln.ten;ln.ten=0;
    if(ln.state==='throw'){
      ln.t+=dt/.9;sendHand(ln.bol);
      if(ln.t>=1){ln.state='haul';ln.prog=0;}
    }else if(ln.state==='haul'){
      const d=Math.hypot(ln.bol.x-fx,ln.bol.y-fy);ln.prog=Math.min(1,ln.prog+.6*dt);
      if(d>30){ln.state='stowed';toast(ln.name+' line lost',1400);}
      else if(ln.prog>=1){ln.state='fast';ln.L0=d+2;toast(ln.name+' line on · hold Heave in',1700);}
    }else if(ln.state==='fast'){
      const dx=ln.bol.x-fx,dy=ln.bol.y-fy,d=Math.hypot(dx,dy)||1;
      if(d>45){if(sel===ln.i){releaseMooringInputs('haul');sel=-1;}ln.state='stowed';toast(ln.name+' line let go',1400);continue;}
      if(haul&&(sel<0||sel===ln.i||lines[sel].state!=='fast')){
        if(haul<0)ln.L0=clamp(ln.L0+.9*dt,2.5,45);
        else{const t=ln.tl||0;
          if(t<50e3*LK){let rate=.5;if(allH&&fastL.length>1){const tgt=Math.max(avgT,8e3*LK),share=t<tgt*.85?1.2:t>tgt*1.15?-.16:.4;rate=.5*clamp(Math.pow(d/Math.max(avgD,.1),1.6),.25,2.4)*share;}ln.L0=clamp(ln.L0-rate*dt,2.5,45);}}
      }
      let ext=d-ln.L0;
      if(ext>0){
        if(ext>1.5){ln.L0=d-1.5;ext=1.5;} // surge the line rather than part it
        const open=-((vx-r*(fy-S.y))*dx+(vy+r*(fx-S.x))*dy)/d;
        const tn=Math.max(0,45e3*ext+25e3*open)*LK;ln.ten=tn;
        const Fx=tn*dx/d,Fy=tn*dy/d,bx=Fx*cs+Fy*sn,by=-Fx*sn+Fy*cs;X+=bx;Y+=by;N+=ln.a*by-ln.b*bx;
      }
      // held near its limit a line goes red, then parts with a bang
      const forcing=Math.abs(S.rpm[0])+Math.abs(S.rpm[1])>.3||Math.abs(S.thrAct)>.6||Math.hypot(u,v)>.7;
      ln.strain=ln.ten>60e3*LK&&forcing?(ln.strain||0)+dt:Math.max(0,(ln.strain||0)-dt*1.5);
      if(ln.strain>2.2){
        ln.state='stowed';ln.strain=0;if(sel===ln.i){releaseMooringInputs('haul');sel=-1;}
        S.snap={ax:fx,ay:fy,bx:ln.bol.x,by:ln.bol.y,top:ln.bol.top||1.6,a:ln.a,b:ln.b,t:0};
        S.shake=1;S.kick=1.6;S.damage=Math.min(100,S.damage+4);toast(ln.name.toUpperCase()+' LINE PARTED',2400);
        for(let i=0;i<28;i++){const q=Math.random();spawn(1,fx+dx*q+rnd(-1,1),fy+dy*q+rnd(-1,1),rnd(-3,3),rnd(-3,3),rnd(.6,1.2),rnd(1.2,2.8),.7);}
        wakeDrop(fx+dx*.5,fy+dy*.5,1.4);
      }
    }
  }
  const weighed=[];
  for(const A of S.anchors){
    A.drag=false;
    const manual=anchorHold&&anchorHold.targets.includes(A)?anchorHold.direction:0;
    if(manual){A.held=true;A.weighing=false;A.paying=false;if(S.t>=anchorHold.after)A.L0=clamp(A.L0+(manual>0?-.8:2.2)*dt,2,140);}
    else if(A.weighing){A.held=true;A.paying=false;A.L0=Math.max(2,A.L0-.8*dt);}
    const ha=hawseFor(A.side),fx=S.x+ha[0]*cs-ha[1]*sn,fy=S.y+ha[0]*sn+ha[1]*cs;let dx=A.x-fx,dy=A.y-fy,d=Math.hypot(dx,dy)||1;
    const retrieving=A.tapHeave||(manual?manual>0:A.weighing);A.tapHeave=false;
    if(retrieving&&A.L0<=2.05&&d<=2.5){weighed.push(A);continue;}
    if(retrieving&&A.L0<3&&d<3)A.set=false;
    if(A.paying&&!manual&&!A.weighing){ /* the bosun works the brake: enough to reach the bottom, then only as fast as she moves away */
      A.held=true;const dep=7*Math.sqrt(Math.max(.25,SL)),need=Math.hypot(d,dep)+1;
      A.L0=Math.min(140,A.L0+Math.min(Math.max(0,need-A.L0),dt*2.5*Math.sqrt(Math.max(.25,SL))));
      if(A.L0>=dep&&!A.bottomSaid&&Math.hypot(u,v)<.3&&A.L0<SCOPE_OF()){A.bottomSaid=true;toast('Anchor on the bottom · back away to lay out chain',2200);}
      if(A.L0>=140){A.paying=false;toast('All the chain is out · locked',1600);}}
    const SCOPE=Math.ceil(18*Math.max(.7,SL)),inAnchorage=!!(stops&&stops[S.stage].anchor&&Math.hypot(A.x-slip.x,A.y-slip.y)<=slip.len/2);
    const readyToSet=!retrieving&&A.held&&!A.paying&&A.L0>=SCOPE;
    if(A.paying&&A.L0>=SCOPE&&!A.scopeSaid){A.scopeSaid=true;toast('Enough chain out · tap the lock to hold it',2200);}
    A.settle=inAnchorage&&readyToSet&&Math.hypot(u,v)<.2&&Math.abs(r)<.6*D2R?(A.settle||0)+dt:0;
    if(!A.set&&readyToSet&&(inAnchorage?A.settle>=.75:d>=Math.min(A.L0-1.2,SCOPE*.8))){A.set=true;toast('Anchor holding · '+Math.floor(A.L0)+' m out',1800);}
    if(!retrieving&&A.held&&!A.paying&&!A.set&&A.L0<SCOPE&&S.t-(A.warnT||-9)>8){A.warnT=S.t;toast('Short on chain · tap the down arrow and back away',2200);}
    {const al=(A.x-S.x)*cs+(A.y-S.y)*sn,la=-(A.x-S.x)*sn+(A.y-S.y)*cs;if(al<ha[0]-3&&al>-LEN/2&&Math.abs(la)<BEAM*.55){S.damage=Math.min(100,S.damage+dt*(.6+Math.hypot(u,v)*2));if(S.t-(A.scrT||-9)>4){A.scrT=S.t;toast('Chain scraping the hull · back away from it',2000);}}}
    if(!A.held){A.run=(A.run||0)+dt;if(A.run>.9&&A.run<4.4)A.L0+=4*(1-(A.run-.9)/3.5)*Math.max(.5,SL)*dt;A.L0=Math.max(A.L0,d+1);} /* free chain rumbles out to the sea bed */
    else{let ext=d-A.L0;if(ext>0){
      const cap=A.set?3:.5;A.drag=ext>cap&&A.set;if(ext>cap){A.x-=dx/d*(ext-cap);A.y-=dy/d*(ext-cap);ext=cap;} // overloaded or not yet set: she drags
      const open=-((vx-r*(fy-S.y))*dx+(vy+r*(fx-S.x))*dy)/d,tn=Math.max(0,30e3*ext+25e3*open)*LK;
      const Fx=tn*dx/d,Fy=tn*dy/d,bx=Fx*cs+Fy*sn,by=-Fx*sn+Fy*cs;X+=bx;Y+=by;N+=ha[0]*by-ha[1]*bx;}}
  }
  if(weighed.length){
    S.anchors=S.anchors.filter(a=>!weighed.includes(a));
    if(![...inputSources.values()].some(c=>c.kind==='anchor'&&c.targets.some(a=>S.anchors.includes(a))))releaseMooringInputs('anchor');else applyHeldInputs();
    for(const a of weighed)S.weigh[a.side]=1;toast(weighed.length>1?'Anchors up and stowed':'Anchor up and stowed',1400);
  }
  const acceleration=bodyAcceleration(physics,S,{X,Y,N});
  S.u+=acceleration.u*dt;S.v+=acceleration.v*dt;S.r+=acceleration.r*dt;
  S.x+=(S.u*cs-S.v*sn)*dt;S.y+=(S.u*sn+S.v*cs)*dt;S.psi+=S.r*dt;
  collide();
  updateNavigation(dt);

  // wash, wake and spray (deliberately larger than life)
  const PS=Math.max(.5,Math.sqrt(SL)),emit=(k,a,b,du,dv,size,life,g,w)=>spawn(k,S.x+a*SL*cs-b*SB*sn,S.y+a*SL*sn+b*SB*cs,vx*.3+du*cs-dv*sn+rnd(-.3,.3),vy*.3+du*sn+dv*cs+rnd(-.3,.3),size*PS,life,g,w);
  const cnt=q=>{const n=Math.floor(q);return n+(Math.random()<q-n?1:0);};
  for(let i=0;i<2;i++){
    const n=S.rpm[i],a=Math.abs(n);if(a<.02)continue;
    const py=(i?1:-1)*3.2,px=n>0?-25.5:-21,dir=-sgn(n);
    const pod=1-.75*S.foil; /* flying, the propellers run deep and throw little foam */
    for(let j=cnt((a*150*dt+2*dt)*Math.min(1,.4+SL*.6)*pod);j--;)emit(1,px+rnd(-1.5,1),py+rnd(-1.6,1.6),dir*(2+7*a)*rnd(.4,1.2),rnd(-1,1)*(1+2.4*a)+(n>0?S.rud/35*(1.5+5*a):0),rnd(.55,1)+a*.6,rnd(1.6,4),.5);
    for(let j=cnt((a*26*dt+dt)*pod);j--;)emit(0,px,py+rnd(-1.4,1.4),dir*(1.5+5*a)*rnd(.6,1.1),rnd(-1,1)+(n>0?S.rud/35*(1+3.5*a):0),1.5+a*1.5,rnd(6,10),.7);
    if(Math.random()<a*16*dt*pod)emit(4,px,py+rnd(-1.5,1.5),dir*(1.2+4*a)*rnd(.6,1.1),rnd(-.6,.6),1.3+a*1.3,rnd(4,7.5),.6,(i?1:-1)*dir*rnd(.7,1.7));
    if(Math.random()<a*24*dt*pod)emit(5,px,py+rnd(-1.6,1.6),dir*(1.5+5*a)*rnd(.5,1.1),rnd(-.8,.8),1.2+a*1.2,rnd(3,6),.6);
  }
  if(Math.abs(S.thrAct)>.1){
    const d=-sgn(S.thrAct),a=Math.abs(S.thrAct);
    for(let j=cnt(a*110*dt);j--;)emit(1,20+rnd(-.8,.8),d*4.3,rnd(-1.5,1.5),d*rnd(5,11),rnd(.5,.9),rnd(1.2,2.8),.5);
    for(let j=cnt(a*14*dt);j--;)emit(0,20,d*4.6,rnd(-.5,.5),d*rnd(2.5,5.5),1.5,rnd(6,10),.7);
    if(Math.random()<a*9*dt)emit(4,20,d*5,rnd(-.4,.4),d*rnd(2,4),1.2,rnd(3,6),.5,(Math.random()<.5?-1:1)*rnd(.8,1.7));
  }
  const sp=Math.hypot(u,v);
  if(sp>.3){
    /* once a planing hull is up on the plane its bow lifts clear, so the bow wave thins out */
    const bowK=shipId==='tender'?(1-.7*clamp((u/Math.sqrt(9.81*LEN)-.6)/.5,0,1))*(1-S.foil):1;
    for(let sd2=-1;sd2<=1;sd2+=2){
      for(let j=cnt(sp*12*bowK*dt);j--;)emit(1,23.5+rnd(-2.5,.5),sd2*1.2,-u*.15,sd2*(.6+sp*.4)*rnd(.7,1.15),.4+sp*.1,rnd(1.6,3),.35); /* bow-wave foam spreads out along the Kelvin arm, about 0.35-0.4 x speed */
      for(let j=cnt(sp*2*(1-S.foil)*dt);j--;)emit(1,rnd(-24,16),sd2*4.75,-u*.1,sd2*rnd(.05,.25),.32,rnd(.6,1.2),.12);
    }
    for(let j=cnt(Math.abs(u)*20*dt);j--;)emit(0,u>0?-25.5:24,rnd(-3.8,3.8),-u*.25,0,2.4,rnd(8,14),.6);
    /* a planing hull leaves a broad white trail where the hull and props have thrown the water up */
    /* flying, only the three carbon struts cut the surface: each leaves a thin feather of spray */
    if(S.foil>.05){const k=S.foil*Math.min(1,u/10);
      for(const fb of [-1.96,1.96])for(let j=cnt(k*16*dt);j--;)emit(1,6.7+rnd(-.6,.2),fb+rnd(-.3,.3),-u*.1,Math.sign(fb)*rnd(.3,1.1),rnd(.5,.85),rnd(1.1,2),.25);
      for(let j=cnt(k*75*dt);j--;)emit(1,-21.7+rnd(-.6,.4),rnd(-.5,.5),-u*.2,rnd(-.6,.6),rnd(1.2,1.9),rnd(2.6,4.4),.38);} /* the rear strut throws a long white sheet */
    if(shipId==='tender'&&u>5){const k=clamp((u-5)/8,0,1)*(1-S.foil);for(let j=cnt(k*55*dt);j--;)emit(1,-26+rnd(-1,1),rnd(-3.6,3.6),-u*.12,rnd(-.7,.7),rnd(2,3.2),rnd(2.5,4.5),.45);}
  }
  if(sp>1.1){const k=Math.min(1,(sp-1.1)/3);
    for(let sd2=-1;sd2<=1;sd2+=2){
      for(let j=cnt(k*55*dt);j--;){const a=rnd(-22,20);emit(1,a,sd2*4.8,-u*.18,sd2*(.5+sp*.3)*rnd(.7,1.2),rnd(.7,1.2),rnd(3,6),.5);}
      for(let j=cnt(k*30*dt);j--;)emit(1,22+rnd(-3,1),sd2*rnd(1.5,3.5),-u*.1,sd2*(1+sp*.5)*rnd(.7,1.2),rnd(.8,1.3),rnd(3,6),.55);}
    if(u>1.1)for(let j=cnt(k*45*dt);j--;)emit(1,-25.5+rnd(-1,0),rnd(-4.2,4.2),-u*.28,rnd(-.6,.6),rnd(1,1.6),rnd(4,8),.6);}
  if(Math.abs(v)>.2){const sd2=sgn(v);
    for(let j=cnt(Math.abs(v)*6*dt);j--;)emit(1,rnd(-24,21),sd2*4.75,0,sd2*rnd(.1,.4),.38,rnd(.6,1.2),.18);
  }
  // Foam from swell crests slapping the weather side.
  const slap=env.sh*Math.pow(Math.max(0,Math.sin(ph)),3)*Math.abs(sv);
  for(let j=cnt(slap*70*dt);j--;){const b=-sgn(sv)*4.8,a=rnd(-24,22);if(Math.random()<.12)emit(1,a,b,0,-sgn(sv)*.25,.32,rnd(.5,1),.12);if(Math.random()<.1)emit(0,a,b*.99,0,-sgn(sv)*rnd(.05,.15),.8,rnd(1.2,2),.15);}

  // berth check
  const ch=Math.cos(slip.h),sh=Math.sin(slip.h);let ok=true;
  for(const p of poly(S.x,S.y,S.psi,LEN,BEAM)){const dx=p[0]-slip.x,dy=p[1]-slip.y;if(Math.abs(dx*ch+dy*sh)>slip.len/2||Math.abs(-dx*sh+dy*ch)>slip.wid/2){ok=false;break;}}
  let he=Math.abs(Math.atan2(Math.sin(S.psi-slip.h),Math.cos(S.psi-slip.h)));if(slip.either)he=Math.min(he,Math.PI-he);
  const lined=ok&&he<7*D2R,still=Math.hypot(S.u,S.v)<.2&&Math.abs(S.r)<.6*D2R;
  const nFast=lines.filter(l=>l.state==='fast').length;
  const anchStop=stops&&stops[S.stage].anchor,anch=anchStop?anchorageStatus():null,anchOK=!!(anch&&anch.inside&&anch.held&&anch.current>=anch.target&&anch.settled);
  S.inPos=anchStop?anchOK:lined;
  if(anchStop&&anchOK&&S.svc==null&&!S.done){S.svc=0;toast('Anchor down in the anchorage',2400);}
  if(!anchStop&&lined&&still&&nFast>=2&&!S.done){S.hold+=dt;if(S.hold>=3){if(!stops){S.done=true;finish(true);}else if(S.svc==null){S.svc=0;toast(stops[S.stage].doing+' · hold her there',2600);}}}
  else{if(lined&&S.t-toastT>6){toast(still?'In the box · get two lines ashore':'In the box · take the way off',1800);toastT=S.t;}S.hold=Math.max(0,S.hold-dt*2);}
  if(S.svc!=null){
    if(anchStop?anchOK:lined&&still&&nFast>=2){
      S.svc+=dt;if(S.stage===1){S.listV=(S.listV||0)*Math.max(0,1-dt*.6);const repaired=Math.min(S.damage,dt*100/stops[1].dur);S.damage-=repaired;S.dmgBank+=repaired;S.fire=null;S.wreck=false;} // retain repaired damage in the score across interrupted visits
      if(S.svc>=stops[S.stage].dur){
        const was=stops[S.stage];S.svc=null;S.stage++;
        if(S.stage>=stops.length){S.stage=stops.length-1;S.done=true;S.cineT=0;startNight();}
        else{setStop(S.stage);toast(was.done+' · next: '+stops[S.stage].name+' · let go and follow the arrow',4600);}
      }
    }else{S.svc=null;toast(anchStop?'Anchor dragging · reset it in the box':'Interrupted · make her fast again',2000);}
  }
  if(S.mode==='depart'&&!S.passing){
    const ex=[LV.start[0]*GEO,LV.start[1]*GEO],free=!lines.some(l=>l.state!=='stowed')&&!S.anchors.length;
    if(Math.hypot(ex[0]-S.x,ex[1]-S.y)<70||Math.hypot(slip.x-S.x,slip.y-S.y)>300){
      if(free){if(S.voyage)passage();else{S.mode='free';finish('dep');}}
      else if(S.t-toastT>5){toast('Still attached · let go the lines'+(S.anchors.length?' and weigh anchor':''),2000);toastT=S.t;}
    }
  }
  if(S.damage>=100&&!S.wreck){S.wreck=true;if(!S.fire)S.fire={a:0,b:0};finish(false);}
}

/* ---------- results ---------- */
const fmt=t=>Math.floor(t/60)+':'+String(Math.floor(t%60)).padStart(2,'0');
// where the arrow points: the berth, or the way out when leaving
const target=()=>navCache.path[navCache.index]||navCache.waitAt||navCache.finalTarget||[slip.x,slip.y];
const nextName=()=>LEVELS[(lvI+1)%3].name;
let banner='';
function finish(won){
  banner=won==='dep'?'dep':won==='mission'?'mission':won?'won':'lost';

  const t=S.t-S.legT0,hits=S.hits-S.legHits0;
  const score=banner==='lost'?0:banner==='mission'?Math.max(0,Math.round(100-(S.dmgBank+S.damage)*.8-hits*5-Math.max(0,t-LV.par)*.05)):Math.max(0,Math.round(100-S.damage*1.5-hits*6-Math.max(0,t-(banner==='dep'?120:LV.par))*.15));
  let best=0;if(banner==='won')try{const b=JSON.parse(localStorage.getItem('sternto-best')||'{}');best=b[lvI]||0;if(score>best){b[lvI]=score;localStorage.setItem('sternto-best',JSON.stringify(b));}}catch(e){}
  $('rEyebrow').textContent=banner==='mission'?'Mission complete · fuel, yard, owner, anchorage':(banner==='dep'?'Departure · ':banner==='won'?'Lines ashore · ':'Out of service · ')+LV.name;
  $('rTitle').textContent=banner==='mission'?(score>=85?'Owner delighted':score>=60?'Owner aboard':'Owner has notes'):banner==='lost'?'Call the yard':banner==='dep'?(score>=85?'Clear away':'Away, more or less'):score>=90?'Made fast':score>=70?'Alongside':'Paint owed';
  $('rText').textContent=banner==='mission'?'Four stops in one run. '+(score>=85?'Not a mark on her.':score>=60?'A few scuffs along the way.':'The yard bill and the clock both ran up.'):banner==='lost'?'The hull has taken too much and she is alight. Nobody is stopping you, though. Restart when you have had enough.'
    :banner==='dep'?(score>=85?'Lines in, clear of the berth and out into open water without a mark.':'She is out, though the neighbours may want a word.')
    :score>=90?'Clean landing.'
    :score>=70?'On the berth. Come in a little slower next time.'
    :'On the berth, minus some paint.'+(best>score?' Your best here is '+best+'.':'');
  $('rTime').textContent=fmt(t);$('rHits').textContent=hits;$('rScore').textContent=score;
  $('rKeep').textContent=banner==='won'?'Practice leaving':banner==='dep'?'Dock again':'Keep playing';
  $('rNext').hidden=banner==='lost'||banner==='mission';$('rNext').textContent='Next: '+nextName();
  $('result').hidden=false;
}
// leaving: let everything go and take her out to the arrow; on a voyage that leads straight to the next harbour
function startDepart(voyage){
  S.mode='depart';S.voyage=voyage;S.legT0=S.t;S.legHits0=S.hits;$('result').hidden=true;
  toast(voyage?'Let go, take her out and follow the arrow to '+nextName():'Let go the lines and take her out to the arrow',3600);
}
function passage(){
  if(S.passing)return;S.passing=true;S.passageRemaining=.7;$('fade').classList.add('on');
}
function advancePassage(dt){
  if(!S.passing)return false;
  S.passageRemaining=Math.max(0,S.passageRemaining-dt);if(S.passageRemaining>1e-9)return false;
  releaseControls();
  const keep={damage:S.damage,hits:S.hits,t:S.t,fend:S.fend,fendN:S.fendN,fPop:S.fPop,fStress:S.fStress,fire:S.fire,wreck:S.wreck,lever:S.lever,rpm:S.rpm,gear:S.gear},sp=Math.max(2,Math.abs(S.u));
  pick((lvI+1)%3);Object.assign(S,keep);S.u=sp;S.legT0=S.t;S.legHits0=S.hits;camOff.x=camOff.y=0;
  toast(LV.name+' ahead · '+LV.sub,3800);return true;
}
/* toasts: small, under the top bar, held longer; an important one is never cut off by the next */
function toast(msg,ms){const t=$('toast'),on=!t.classList.contains('off');toast.q=toast.q||[];
  if(ms>=1e8){toast.q=[];toastShow(msg,ms);return;}
  if(on&&t.textContent===msg){clearTimeout(toast.h);toast.h=setTimeout(toastNext,toast.hold);return;}
  toast.q=toast.q.filter(e=>e[1]>=2400&&e[0]!==msg);
  if(!on||!toast.imp){if(!toast.q.length){toastShow(msg,ms);return;}toast.q.push([msg,ms]);toastNext();return;}
  toast.q.push([msg,ms]);if(toast.q.length>3)toast.q.shift();
  const left=Math.max(2600,Math.min(toast.hold,3600))-(performance.now()-toast.at);clearTimeout(toast.h);toast.h=setTimeout(toastNext,Math.max(0,left));}
function toastShow(msg,ms){const t=$('toast');t.textContent=msg;t.classList.remove('off');
  toast.at=performance.now();toast.imp=ms>=2400&&ms<1e8;toast.hold=ms<1e8?Math.round(ms*1.6+600):ms;clearTimeout(toast.h);
  toast.h=setTimeout(toastNext,toast.q&&toast.q.length&&toast.imp?3200:toast.q&&toast.q.length?1800:toast.hold);}
function toastNext(){const q=toast.q&&toast.q.shift();if(q)toastShow(q[0],q[1]);else $('toast').classList.add('off');}

/* ---------- 3D scene (three.js) ---------- */

let AW=0,AH=0,qual=1,rotv=0,yawE=0,pitch=.27,pitchE=.27,zoomMul=1,chase=false,topDown=false,camD=220;
const cam={x:0,y:0};
// Hex and CSS colours are converted to linear working space by modern Three.js.
const col=h=>new T3.Color(h);
const renderer=new T3.WebGLRenderer({canvas:glc,antialias:true});
// Preserve the run when a device temporarily loses its graphics context.
glc.addEventListener('webglcontextlost',e=>{
  e.preventDefault();contextUnavailable=true;cancelAnimationFrame(rafId);rafId=0;
  setPaused(true,false);resetFrameClock();lifecycle.onContextLost?.();
});
glc.addEventListener('webglcontextrestored',()=>{
  try{resetVisuals();contextUnavailable=false;resetFrameClock();projectionDirty=true;
    lifecycle.onContextRestored?.();refreshModalState();invalidateFrame();
  }catch(error){lifecycle.onError?.(error);}
});
renderer.toneMapping=T3.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;renderer.outputColorSpace=T3.SRGBColorSpace;
const scene3=new T3.Scene(),camera=new T3.PerspectiveCamera(38,1,1,7000);
const FOG=new T3.Color(.3,.345,.375),SUN=new T3.Vector3(-.33,.34,-.88).normalize();
scene3.fog=new T3.FogExp2(FOG,.0007);
// r155 removed the old internal PI multiplier for these lights. Preserve the art direction.
const LIGHT_SCALE=Math.PI;
const hemiL=new T3.HemisphereLight(col(0xb7c4ca),col(0x161d22),.62*LIGHT_SCALE);scene3.add(hemiL);
const sunL=new T3.DirectionalLight(col(0xfff0da),.85*LIGHT_SCALE);sunL.position.copy(SUN).multiplyScalar(100);scene3.add(sunL);

/* waves: one definition drives the sea surface, the lighting and how the boats ride */
const waterCoarse=matchMedia('(pointer: coarse)').matches||innerWidth<600;
let waterTier=waterQuality(waterCoarse,false);
const WV=buildWaves(env);
const uW=WV.map(()=>new T3.Vector4()),uOm=[0,0,0,0,0,0];
let waveWFrom,waveSFrom,waveKn,waveLength,waveHeight;
function setWaves(){
  if(waveWFrom===env.wFrom&&waveSFrom===env.sFrom&&waveKn===env.wk&&waveLength===env.lam&&waveHeight===env.sh)return;
  waveWFrom=env.wFrom;waveSFrom=env.sFrom;waveKn=env.wk;waveLength=env.lam;waveHeight=env.sh;
  buildWaves(env,WV);
  WV.forEach((w,i)=>{uW[i].set(w.dx,w.dz,w.k,w.amp);uOm[i]=w.om;});
  const wa=(env.wFrom+180)*D2R,wf=clamp(env.wk/22,0,1.4);
  U.uChop.value=WV.chop;U.uWind.value.set(Math.sin(wa),-Math.cos(wa));U.uDet.value=.5+wf*1.1;
}
// king wave: one long-crested ridge with a steep front face, travelling along KW.d
const KW={on:false,d:[1,0],pos:0,A:0,c:11};
const kingX=(x,z)=>x*KW.d[0]+z*KW.d[1]-KW.pos;
const kingH=(x,z)=>{if(!KW.on)return 0;const X=kingX(x,z),W=X>0?11:24;return KW.A*Math.exp(-X*X/(W*W));};
const kingS=(x,z)=>{if(!KW.on)return 0;const X=kingX(x,z),W=X>0?11:24;return KW.A*Math.exp(-X*X/(W*W))*(-2*X/(W*W));}; // slope along the travel direction
const waterSettings={shelterX:0,shelterZ:0,scale:1,king:KW},waterProbe={};
function waveSampleAt(x,z){
  waterSettings.shelterX=shC.x;waterSettings.shelterZ=shC.y;waterSettings.scale=GEO;
  return sampleWater(WV,waterSettings,x,z,T,waterProbe);
}
const waveH=(x,z)=>waveSampleAt(x,z).height;
const U={uT:{value:0},uSun:{value:SUN},uFog:{value:FOG},uW:{value:uW},uOm:{value:uOm},uChop:{value:WV.chop},uWind:{value:new T3.Vector2(1,0)},uDet:{value:1},uCtr:{value:new T3.Vector2()},uFogK:{value:.0007},uLow:{value:waterCoarse?1:0},uRippleCount:{value:waterTier.rippleOctaves},uWakeStride:{value:waterTier.wakeStride},uFoamDetail:{value:waterTier.foamDetail},uSlop:{value:0},uNight:{value:0},uUW:{value:0},uKing:{value:new T3.Vector4(1,0,-9999,0)},uWake:{value:[]},uWakeB:{value:new T3.Vector3(0,0,-1)},uSlip:{value:new T3.Vector3(0,0,1)},uShip:{value:new T3.Vector4(0,0,1,0)},uHull:{value:new T3.Vector4(25,4.7,0,0)},uProp:{value:new T3.Vector2()},tFoam:{value:null},uFoamC:{value:new T3.Vector3(0,0,240)}};
// shelter: full sea outside, about a fifth of it by the berth
const shC={x:0,y:0};
const shelter=(x,z)=>{const t=clamp((Math.hypot(x-shC.x,z-shC.y)-45*GEO)/(165*GEO),0,1);return .22+.78*t*t*(3-2*t);};
for(let i=0;i<32;i++)U.uWake.value.push(new T3.Vector4(0,0,0,0));
let wkI=0,wkX=0,wkY=0,wkT=0;
/* a bounding circle round every live wake ring lets the sea shader skip the ring loop elsewhere */
function updateWakeBounds(){let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const w of U.uWake.value){if(w.w<=0)continue;const age=T-w.z;if(age<0||age>48)continue;const r=1.15*age+6;x0=Math.min(x0,w.x-r);y0=Math.min(y0,w.y-r);x1=Math.max(x1,w.x+r);y1=Math.max(y1,w.y+r);}
  if(x0>x1)U.uWakeB.value.set(0,0,-1);else U.uWakeB.value.set((x0+x1)/2,(y0+y1)/2,Math.hypot(x1-x0,y1-y0)/2);}
const wakeDrop=(x,y,amp)=>{U.uWake.value[wkI].set(x,y,T,amp);wkI=(wkI+1)%32;};
const SKY_GLSL=`
uniform float uT,uNight;uniform vec3 uSun,uFog;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float s=0.,w=.5;for(int i=0;i<4;i++){s+=w*noise(p);p=p*2.03+17.1;w*=.5;}return s;}
vec3 sky(vec3 d,float fine){
  float h=max(d.y,0.);
  vec3 c=mix(uFog,vec3(.1,.14,.18),pow(h,.5));
  vec2 uv=d.xz/(h+.18);
  float cl=fine<-.5?.42+.3*noise(uv*1.3+uT*.005):fbm(uv*.9+vec2(uT*.006,uT*.003));
  if(fine>.5)cl=cl*.72+fbm(uv*2.7-uT*.004)*.28;
  float m=smoothstep(.36,.7,cl)*smoothstep(.02,.3,h);
  float sd=max(dot(d,uSun),0.);
  vec3 cloud=mix(vec3(.62,.66,.67),vec3(.05,.065,.08),smoothstep(.42,.8,cl));
  cloud+=vec3(1.,.93,.8)*pow(sd,5.)*(fine>.5?.55:.2)*(1.-smoothstep(.5,.85,cl));
  c=mix(c,cloud,m*.92);
  c+=vec3(1.,.95,.86)*(pow(sd,9.)*(fine>.5?.35:.1)+pow(sd,80.)*(fine>.5?1.8:.9))*(1.-m*.7);
  if(uNight>0.){ // moonlit night: dark blue sky, stars, a milky moon
    vec3 nc=c*vec3(.14,.17,.26);
    if(d.y>0.){vec2 sp=d.xz/(d.y+.25)*70.;float st=step(.9965,hash(floor(sp)))*smoothstep(.02,.35,d.y)*(1.-m*.9);nc+=vec3(.85,.9,1.)*st*(.6+.4*sin(uT*3.+hash(floor(sp))*40.));}
    float md=max(dot(d,uSun),0.);nc+=vec3(1.,.98,.92)*smoothstep(.99935,.99965,md)*1.3+vec3(.55,.6,.72)*pow(md,40.)*.3;
    c=mix(c,nc,uNight);}
  return c;
}`;
// the water the hull pushes aside: a hump at the leading end, shoulder waves trailing aft, a pile-up when she moves sideways, boil at the props and thruster
const HULL_GLSL=`
#define SQ(x) ((x)*(x))
uniform vec4 uShip,uHull;uniform vec2 uProp;
float hullH(vec2 p){
  vec2 d=p-uShip.xy;float L=uHull.x,B=uHull.y;
  if(dot(d,d)>L*L*36.)return 0.;
  float lx=dot(d,uShip.zw),ly=dot(d,vec2(-uShip.w,uShip.z)),U=uHull.z,V=uHull.w,sc=clamp(L/25.,.35,1.),fw=U<0.?-1.:1.;
  float back=(fw*L-lx)*fw;
  float h=min(.5,.03*U*U)*sc*exp(-SQ((back+1.)/(4.5*sc))-SQ(ly/(B*1.6)));
  /* Kelvin wake: divergent arms at 19.5 deg (tan .354) that close up above a length Froude number of 0.5,
     crest spacing growing with speed squared, and a soft transverse train inside the wedge astern */
  float U2=max(U*U,1.5),frL=abs(U)/sqrt(19.62*L),wedge=.354*min(1.,.5/max(frL,.01));
  h+=min(.28,.018*U*U)*sc*exp(-SQ((abs(ly)-B*.8-wedge*back)/(2.4*sc)))*smoothstep(0.,8.*sc,back)*exp(-back/(L*2.4))*(.75*cos(back*14.7/U2)+.45*cos(back*1.25/sc));
  float sb=back-2.*L;
  if(sb>0.)h+=min(.1,.005*U*U)*sc*cos(sb*9.81/U2)*smoothstep(0.,5.*sc,sb)*exp(-sb/(L*2.5))*(1.-smoothstep(.6,1.,abs(ly)/max(B,wedge*back)));
  float sv=V<0.?-1.:1.;
  h+=min(.3,.45*V*V)*sc*exp(-SQ((ly-sv*(B+1.2*sc))/(2.2*sc)))*(1.-smoothstep(L*.6,L*1.1,abs(lx)));
  float pc=uProp.x>0.?-L-4.*sc:-L+7.*sc;
  h+=.22*abs(uProp.x)*sc*(1.-.8*smoothstep(.5,3.,abs(U)))*exp(-SQ((lx-pc)/(5.5*sc))-SQ(ly/(B*.95)))*(1.+.35*sin(uT*8.+lx*1.9)*cos(uT*6.3+ly*2.3));
  h-=min(.22,.012*U*U)*sc*exp(-SQ((lx+fw*(L+3.*sc))/(6.5*sc))-SQ(ly/(B*.95)));
  float ts=uProp.y<0.?-1.:1.;
  h+=.12*abs(uProp.y)*sc*exp(-SQ((lx-L*.8)/(3.*sc))-SQ((ly+ts*(B+2.*sc))/(3.*sc)))*(1.+.4*sin(uT*9.+ly*2.1));
  return h;
}`;
const skyM=new T3.Mesh(new T3.SphereGeometry(5000,32,16),new T3.ShaderMaterial({uniforms:U,side:T3.BackSide,depthWrite:false,fog:false,
  vertexShader:`varying vec3 vD;void main(){vD=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:SKY_GLSL+`varying vec3 vD;void main(){gl_FragColor=vec4(sky(normalize(vD),1.),1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  }`}));
skyM.frustumCulled=false;scene3.add(skyM);
function seaGeometry(segments){
  const geometry=new T3.PlaneGeometry(2,2,segments,segments);
  // This shader supplies its own coordinates and analytic normals.
  geometry.deleteAttribute('normal');geometry.deleteAttribute('uv');return geometry;
}
const sea=new T3.Mesh(seaGeometry(waterTier.segments),new T3.ShaderMaterial({uniforms:U,fog:false,side:T3.DoubleSide,
  vertexShader:`uniform float uT;uniform vec2 uCtr;`+WATER_GLSL+HULL_GLSL+`varying vec3 vP;varying vec2 vQ;
  void main(){
    vec2 u=position.xy,q=sign(u)*pow(abs(u),vec2(3.))*3000.,p=uCtr+q;
    vec3 o,tx,tz;waterSurface(p,o,tx,tz);o.y+=hullH(o.xz);
    vP=o;vQ=p;gl_Position=projectionMatrix*viewMatrix*vec4(o,1.);
  }`,
  fragmentShader:SKY_GLSL+WATER_GLSL+HULL_GLSL+`uniform vec2 uWind;uniform float uDet,uFogK,uLow,uSlop,uUW,uRippleCount,uWakeStride,uFoamDetail;uniform vec4 uWake[32];uniform vec3 uWakeB;uniform sampler2D tFoam;uniform vec3 uFoamC;varying vec3 vP;varying vec2 vQ;
  vec2 rot(vec2 v,float a){float c=cos(a),s=sin(a);return vec2(c*v.x-s*v.y,s*v.x+c*v.y);}
  void main(){
    vec2 p=vP.xz;float dist=length(cameraPosition-vP);
    vec3 surface,tx,tz;waterSurface(vQ,surface,tx,tz);vec3 baseNormal=cross(tz,tx);
    vec2 g=-baseNormal.xz/max(baseNormal.y,.0001);float hh=surface.y;
    float kingFoam=0.;if(uKing.w>0.){float X=dot(vQ,uKing.xy)-uKing.z,W=X>0.?11.:24.,e=exp(-X*X/(W*W));
      kingFoam=smoothstep(.55,.95,e)*smoothstep(-2.,6.,X)*(.4+.6*noise(p*.35+uT*.5))*smoothstep(1.5,3.,uKing.w);}
    float sh=waterShelter(vQ).x;
    float h0=hullH(p);g+=vec2(hullH(p+vec2(.5,0.))-h0,hullH(p+vec2(0.,.5))-h0)*2.;hh+=h0;
    vec2 sd=p-uShip.xy;float slx=dot(sd,uShip.zw),sly=dot(sd,vec2(-uShip.w,uShip.z));
    float boil=abs(uProp.x)*exp(-SQ((slx-(uProp.x>0.?-uHull.x-5.:-uHull.x+7.))/7.)-SQ(sly/(uHull.y*1.1)));
    g+=boil*.3*vec2(sin(p.x*3.1+uT*7.)+sin(p.y*5.3-uT*9.),cos(p.y*2.7-uT*6.3)+cos(p.x*4.7+uT*8.));
    // swell running into the hull bounces back off it as a short train of ripples, strongest on the weather side
    // distance to the hull's actual waterline outline: fine bow, parallel sides, and a transom with rounded corners
    // like the drawn hull, so the rim of light and ripples wraps the stern instead of drawing a square
    float fx0=clamp(slx/uHull.x,-1.,1.),hw0=uHull.y*(fx0>.1?1.-pow((fx0-.1)/.9,2.15):.93+.07*clamp(fx0+.9,0.,1.)); /* fitted to the drawn hull: fine bow, slight taper aft */
    float rc=uHull.y*.34,dSide=abs(sly)-hw0,dEnd=max(-uHull.x-slx,slx-uHull.x);
    vec2 qa=vec2(dSide,dEnd)+rc,qp=max(qa,0.);float ql=length(qp),hd0=ql+min(max(qa.x,qa.y),0.)-rc;
    vec2 nl=ql>1e-4?qp/ql:(dEnd>dSide?vec2(0.,1.):vec2(1.,0.));
    float shade=.4*exp(-max(hd0,0.)*.45); /* the hull's shadow on the water hugs its real outline, bow included */
    vec2 fwd=uShip.zw,sideN=normalize(fwd*(slx<0.?-1.:1.)*nl.y+vec2(-uShip.w,uShip.z)*(sly<0.?-1.:1.)*nl.x+1e-5);
    float incid=max(0.,-dot(sideN,uW[0].xy))+.15,nearH=exp(-max(hd0,0.)/1.3)*step(-.2,hd0);
    float swPh=uW[0].z*dot(uW[0].xy,p)-uOm[0]*uT;
    g+=sideN*(uW[0].w*.55+uSlop*.3)*nearH*incid*.45*sin(3.6*max(hd0,0.)-uT*3.4+swPh);
    // short wind ripples: lighting only, faded with distance
    vec3 V=normalize(cameraPosition-vP);
    float foot=max(.001,max(length(dFdx(p)),length(dFdy(p)))),lam=foot<1.7?3.2:0.,amp=uDet*.05;
    if(lam>2.*foot){float stir=exp(-max(length(p-uShip.xy)-uHull.x,0.)/22.);vec2 pos=p+(4.+7.*stir)*vec2(noise(p*.06+uT*.04),noise(p*.06+5.3-uT*.04))+stir*3.*vec2(noise(p*.31-uT*.2),noise(p*.29+4.2+uT*.18));float am=.45+1.1*noise(p*.11-uT*.05);
    for(int i=0;i<9;i++){if(lam<=2.*foot||float(i)>=uRippleCount)break;float fi=float(i);vec2 d=rot(uWind,sin(fi*2.4+.6)*(.5+.06*fi));
      float k=6.2832/lam,x=k*dot(d,pos)-k*1.25*sqrt(lam)*uT+fi*1.7,w=exp(sin(x)-1.),dx=w*cos(x);
      g+=amp*am*(.45+.55*sh)*k*dx*d*smoothstep(2.,6.,lam/foot);pos-=d*dx*lam*.08;lam*=.7;amp*=.74;}}
    // rings spreading from where the hull has been: they overlap into a wake
    float wf=smoothstep(2.,6.,2.6/foot);
    if(wf>0.&&length(p-uShip.xy)<460.&&length(p-uWakeB.xy)<uWakeB.z)for(int i=0;i<32;i++){if(uWakeStride>1.&&mod(float(i),uWakeStride)>.5)continue;vec4 w=uWake[i];if(w.w<=0.)continue;
      float age=uT-w.z;if(age>48.)continue;vec2 dv=p-w.xy;float r=length(dv)+.001,x=r-1.15*age;if(abs(x)>5.)continue;
      float a=w.w*.09*exp(-age*.075)/(1.+r*.06)*exp(-x*x*.2)*wf;
      g+=dv/r*a*(-.4*x*cos(2.42*x)-2.42*sin(2.42*x));}
    vec3 n=normalize(vec3(-g.x,1.,-g.y));
    float fres=.02+.98*pow(1.-max(dot(n,V),0.),5.);
    vec3 R=reflect(-V,n);R.y=abs(R.y)+.02;R=normalize(R);
    vec3 deep=vec3(.005,.026,.04);
    vec3 sss=vec3(.018,.075,.095)*(.3+.7*clamp(hh*.8+.5,0.,1.))*(.6+.4*max(dot(n,uSun),0.));
    vec3 c=mix(deep+sss,sky(R,(uLow>0.||dist>520.)?-1.:0.),fres);
    c*=1.-shade;
    // underwater lights: a turquoise glow round the hull, rippling with the surface
    if(uUW>0.)c+=vec3(.04,.6,.68)*uUW*exp(-max(hd0,0.)/3.9)*step(-.4,hd0)*(.6+.55*noise(p*.32+vec2(uT*.25,-uT*.2))*noise(p*.9-uT*.3))*(.6+.4*n.y);
    {float band=(1.-smoothstep(0.,.45,hd0))*step(-.12,hd0);
     c=mix(c,vec3(.6,.7,.73),band*((.04+.07*noise(p*4.+vec2(uT*1.1,-uT*.8)))*(.4+.6*min(1.,length(uHull.zw)*.5))+(uW[0].w*.9+uSlop*.4)*incid*(.2+.8*max(0.,sin(swPh)))*(.5+.5*noise(p*3.-uT*.5))*.3));}
    c=mix(c,c*vec3(.3,.36,.5),uNight);
    float sp=max(dot(R,uSun),0.);
    c+=vec3(1.,.95,.85)*(pow(sp,500.)*10.+pow(sp,60.)*.1);
    // foam field: thick foam is solid, thinning foam opens into a lace of bubble rims, churned water shows dark blue
    vec2 fu=(p-uFoamC.xy)/uFoamC.z+.5;
    if(fu.x>0.&&fu.x<1.&&fu.y>0.&&fu.y<1.){vec4 fm=texture2D(tFoam,fu);
      // fade out irregularly towards the edge of the foam window so the wash never ends in a straight line
      {vec2 ed=min(fu,1.-fu);float en=.06+.08*noise(p*.07+uT*.02);fm*=smoothstep(0.,en,ed.x)*smoothstep(0.,en,ed.y);}
      if(fm.r+fm.g>.004){
        float rim=.35;
        if(uFoamDetail>.5){vec2 cq=p*(.7+.4*noise(p*.07))+1.8*vec2(noise(p*.23+uT*.03),noise(p*.23+9.1-uT*.03))+vec2(uT*.05,-uT*.04),ci=floor(cq),cf=fract(cq);float f1=9.,f2=9.;
          for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 o=vec2(float(i),float(j)),hv=vec2(hash(ci+o),hash(ci+o+7.31));hv=.5+.4*sin(uT*.6+6.2832*hv);float dd=length(o+hv-cf);if(dd<f1){f2=f1;f1=dd;}else if(dd<f2)f2=dd;}
          rim=1.-smoothstep(.02,.24,f2-f1);}
        float dens=fm.r*2.4,fine=noise(p*5.+uT*.4);
        float foam=clamp(smoothstep(.8,1.3,dens)+rim*smoothstep(.1,.7,dens)+(fine-.55)*dens*.8,0.,1.);
        float churn=smoothstep(.05,.5,fm.g*2.2)*(.55+.45*noise(p*2.1-uT*.3));
        c+=vec3(.012,.085,.09)*smoothstep(0.,.6,dens)*(1.-foam);
        c=mix(c,vec3(.01,.05,.11),churn*.7*(1.-foam*.6));
        c=mix(c,vec3(.7,.78,.8)*(1.-.68*uNight)*(.7+.3*max(dot(n,uSun),0.)),foam*.9);
      }}
    // Crests collect a little wind-driven froth where the analytic surface
    // compresses. Keep it sparse and fade subpixel detail before the horizon.
    float crest=smoothstep(.13,.34,1.-baseNormal.y)*smoothstep(.7,1.6,uDet)*smoothstep(.1,.5,hh)*(1.-smoothstep(.3,1.,foot));
    if(crest>.002){float flecks=smoothstep(.48,.78,noise(p*1.25+vec2(uT*.2,-uT*.1)));c=mix(c,vec3(.7,.78,.8)*(1.-.68*uNight),crest*flecks*.65);}
    if(kingFoam>0.)c=mix(c,vec3(.8,.86,.88)*(1.-.6*uNight),kingFoam*.7); // the crest breaking along its face
    c=mix(c,uFog,1.-exp(-dist*dist*uFogK*uFogK));
    gl_FragColor=vec4(c,1.);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`}));
sea.frustumCulled=false;scene3.add(sea);
function applyWaterQuality(low){
  const next=waterQuality(waterCoarse,low);
  if(next.segments!==waterTier.segments){const old=sea.geometry;sea.geometry=seaGeometry(next.segments);old.dispose();}
  waterTier=next;U.uLow.value=waterCoarse||low?1:0;
  U.uRippleCount.value=next.rippleOctaves;U.uWakeStride.value=next.wakeStride;U.uFoamDetail.value=next.foamDetail;
}

/* geometry helpers: shapes are drawn in plan (x forward/east, y starboard/south) and extruded upward */
const matC={},sharedMaterials=new Set();
const M=(hex,r,em)=>{const k=hex+'|'+r+'|'+(em||0);if(!matC[k]){const o={color:col(hex),roughness:r,metalness:.05};if(em)o.emissive=col(em);matC[k]=new T3.MeshStandardMaterial(o);sharedMaterials.add(matC[k]);}return matC[k];};
const slabG=(shape,top,bot)=>{const g=new T3.ExtrudeGeometry(shape,{depth:top-bot,bevelEnabled:false,curveSegments:10});g.rotateX(Math.PI/2);g.translate(0,top,0);return g;};
const hullShape=(sx,sy)=>{const h=25*sx,w=4.7*sy,s=new T3.Shape();s.moveTo(h,0);s.bezierCurveTo(h*.8,w*.55,h*.5,w*.98,h*.1,w);s.lineTo(-h*.9,w*.93);s.quadraticCurveTo(-h,w*.92,-h,w*.7);s.lineTo(-h,-w*.7);s.quadraticCurveTo(-h,-w*.92,-h*.9,-w*.93);s.lineTo(h*.1,-w);s.bezierCurveTo(h*.5,-w*.98,h*.8,-w*.55,h,0);return s;};
const rrShape=(x,y,w,h,r)=>{const s=new T3.Shape();s.moveTo(x+r,y);s.lineTo(x+w-r,y);s.quadraticCurveTo(x+w,y,x+w,y+r);s.lineTo(x+w,y+h-r);s.quadraticCurveTo(x+w,y+h,x+w-r,y+h);s.lineTo(x+r,y+h);s.quadraticCurveTo(x,y+h,x,y+h-r);s.lineTo(x,y+r);s.quadraticCurveTo(x,y,x+r,y);return s;};
const polyShape=P=>{const s=new T3.Shape();P.forEach((v,i)=>i?s.lineTo(v[0],v[1]):s.moveTo(v[0],v[1]));return s;};
// hull skin lofted through sections: each is [height, how far the bow is drawn back, beam factor, overall scale]
function loft(rings,cap){
  const base=hullShape(1,1).getPoints(10);if(base[0].distanceTo(base[base.length-1])<1e-4)base.pop();
  const N=base.length,pos=[],idx=[],sm=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
  const ring=r=>base.map(q=>[(q.x-r[1]*sm((q.x-4)/21))*(r[3]||1),r[0],q.y*r[2]*(r[3]||1)]);
  rings.forEach(r=>ring(r).forEach(v=>pos.push(v[0],v[1],v[2])));
  for(let r=0;r<rings.length-1;r++)for(let i=0;i<N;i++){const a=r*N+i,b=r*N+(i+1)%N,c=(r+1)*N+i,d=(r+1)*N+(i+1)%N;idx.push(a,b,d,a,d,c);}
  if(cap){const top=ring(rings[rings.length-1]),o=pos.length/3;top.forEach(v=>pos.push(v[0],v[1],v[2]));
    T3.ShapeUtils.triangulateShape(top.map(v=>new T3.Vector2(v[0],v[2])),[]).forEach(f=>idx.push(o+f[0],o+f[1],o+f[2]));}
  const g=new T3.BufferGeometry();g.setAttribute('position',new T3.Float32BufferAttribute(pos,3));g.setIndex(idx);g.computeVertexNormals();return g;
}
// The chain socket is on the pocket's outer face, shared with the stowed anchor eye.
const HAWSE={x:19.2,y:2.05,z:2.12,yaw:.28,depth:.5,eye:.48};
const anchorPocketGeometries=[-1,1].map(sd=>new T3.BoxGeometry(1.25,1.3,HAWSE.depth).rotateY(sd*HAWSE.yaw).translate(HAWSE.x,HAWSE.y,sd*HAWSE.z));
// the yacht, built once at 50 x 9.4 m and scaled for the neighbours
const YG=[
 [slabG(hullShape(1,1),3.3,-1.6),'hull'],[slabG(hullShape(1.003,1.012),.32,-.3),'trim'],[slabG(hullShape(.95,.87),3.38,3.2),'deck'],
 [slabG(rrShape(-15.5,-3.4,29,6.8,2.3),5.9,3.0),'s1'],[slabG(rrShape(-15.6,-3.46,29.2,6.92,2.35),5.3,4.2),'glass'],[slabG(rrShape(-17,-3.8,31.5,7.6,2.5),6.05,5.9),'s2'],
 [slabG(rrShape(-11.5,-2.75,20,5.5,2.1),8.5,6.05),'s2'],[slabG(rrShape(-11.6,-2.81,20.2,5.62,2.15),7.9,6.9),'glass'],[slabG(rrShape(-13.5,-3.1,23,6.2,2.3),8.65,8.5),'s2'],
 [slabG(rrShape(-5.5,-2.1,10,4.2,1.8),10.4,8.65),'s3'],[slabG(rrShape(-5.6,-2.16,10.2,4.32,1.85),9.9,9.2),'glass'],[slabG(rrShape(-7,-2.4,12.5,4.8,2),10.6,10.45),'s2'],
 [slabG(rrShape(-21.5,-1.5,3.2,3,.5),3.43,3.3),'pool'],
 [anchorPocketGeometries[0],'pocket'],[anchorPocketGeometries[1],'pocket'],
 [new T3.CylinderGeometry(.42,.56,2.1,16).scale(1,1,.72).rotateZ(.2).translate(-.7,11.6,0),'trim'],[new T3.SphereGeometry(.62,14,10).translate(-3.6,11.32,1.45),'s2'],[new T3.SphereGeometry(.62,14,10).translate(-3.6,11.32,-1.45),'s2'],[new T3.CylinderGeometry(.22,.28,.5,10).translate(-3.6,10.85,1.45),'s3'],[new T3.CylinderGeometry(.22,.28,.5,10).translate(-3.6,10.85,-1.45),'s3'],[new T3.CylinderGeometry(.08,.12,.6,8).translate(2.6,10.9,0),'s2']];
// sheer: the deck line sweeps up toward the bow, about a metre at the stem
const SHEER=x=>{const t=Math.max(0,Math.min(1,(x-5)/20)),a=Math.max(0,Math.min(1,(-6-x)/19));return 1.05*t*t-.42*a*a;};
const RADAR_G=new T3.BoxGeometry(2.3,.13,.3);
/* exhaust outlets low on each side, aft (hull side is about 4.42 m out at x -19) */
[-1,1].forEach(sd=>YG.push([new T3.BoxGeometry(.95,.34,.1).translate(-19,.46,sd*4.43),'pocket']));
/* line fairleads sit on the drawn hull side, half let into it */
const HULL_SIDE=(()=>{const pts=hullShape(1,1).getPoints(120).filter(p=>p.y>=0);return x=>{let w=0;for(let i=0;i<pts.length-1;i++){const a=pts[i],b=pts[i+1];if(a.x!==b.x&&(a.x-x)*(b.x-x)<=0)w=Math.max(w,a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x));}return w;};})();
[21,9,-11,-23.5].forEach(x=>[-1,1].forEach(sd=>YG.push([new T3.CylinderGeometry(.5,.5,.14,18).rotateX(Math.PI/2).scale(.78,.34,1).translate(x,2.92+SHEER(x),sd*(HULL_SIDE(x)+.02)),'pocket']))); /* oval fairleads */
YG.forEach(([g,key],i)=>{if(i>2&&key!=='pool')return;const pa=g.attributes.position;
  for(let k=0;k<pa.count;k++){const x=pa.getX(k),y=pa.getY(k);if(y>0)pa.setY(k,y+SHEER(x)*Math.min(1,y/3.2));}
  pa.needsUpdate=true;g.computeVertexNormals();});
/* Speed: draw each yacht with one mesh per material instead of one per part. The anchor pockets stay separate. */
function mergeGeometries(list){
  const parts=list.map(g=>g.index?g.toNonIndexed():g);let n=0;for(const g of parts)n+=g.attributes.position.count;
  const pos=new Float32Array(n*3),nor=new Float32Array(n*3);let o=0;
  for(const g of parts){pos.set(g.attributes.position.array,o*3);if(!g.attributes.normal)g.computeVertexNormals();nor.set(g.attributes.normal.array,o*3);o+=g.attributes.position.count;}
  const m=new T3.BufferGeometry();m.setAttribute('position',new T3.Float32BufferAttribute(pos,3));m.setAttribute('normal',new T3.Float32BufferAttribute(nor,3));m.computeBoundingSphere();return m;
}
const YG_DRAW=(()=>{const byKey=new Map(),out=[];
  for(const [g,key] of YG){if(anchorPocketGeometries.includes(g)){out.push([g,key]);continue;}if(!byKey.has(key))byKey.set(key,[]);byKey.get(key).push(g);}
  for(const [key,list] of byKey)out.push([list.length>1?mergeGeometries(list):list[0],key]);return out;})();
const sharedGeometries=new Set([...YG.map(([geometry])=>geometry),...YG_DRAW.map(([geometry])=>geometry),RADAR_G]);
// The fleet reuses yacht geometry and cached materials; only dispose resources owned by this group.
function disposeTransientGroup(group){
  const geometries=new Set(),materials=new Set();
  group.removeFromParent();
  group.traverse(object=>{
    if(object.isInstancedMesh)object.dispose();
    if(object.geometry&&!sharedGeometries.has(object.geometry))geometries.add(object.geometry);
    const list=Array.isArray(object.material)?object.material:object.material?[object.material]:[];
    for(const material of list)if(!sharedMaterials.has(material))materials.add(material);
  });
  geometries.forEach(geometry=>geometry.dispose());materials.forEach(material=>material.dispose());
  group.clear();
}
const sheerAt=xm=>shipId==='tender'?0:SHEER(xm/SL)*SL;
// L&S: gunmetal hull with a white sheer band and boot stripe, white superstructure, dark mast with domes
const LS_LOOK={hull:'#2a3640',side:'#1d262d',trim:'#e9edef',deck:'#c8a878',s1:'#f3f5f6',s2:'#f8f9fa',s3:'#eef1f3',wall:'#c3ccd2'};
function makeLS(){
  const g=makeYacht(LS_LOOK,LEN),wh=Object.assign(M('#eef1f3',.35),{side:T3.DoubleSide});
  const band=slabG(hullShape(1.004,1.012),3.36,2.62),pa=band.attributes.position;
  for(let k=0;k<pa.count;k++){const x=pa.getX(k),y=pa.getY(k);pa.setY(k,y+SHEER(x));}pa.needsUpdate=true;band.computeVertexNormals();
  g.add(new T3.Mesh(band,wh));
  const dk=M('#22303a',.45);
  const mast=new T3.Mesh(new T3.BoxGeometry(1.1,3.4,.7).translate(-1.6,12.3,0),dk);mast.rotation.z=.12;
  g.add(mast);return g;
}
/* portholes at a real-world size and spacing, so a bigger yacht shows more of them (one cached strip per length) */
const portholeCache=new Map();
function portholeGeo(L){const key=Math.round(L);if(portholeCache.has(key))return portholeCache.get(key);
  const k=50/L,step=2.4*k,list=[];for(let x=-12;x<=12.01;x+=step)for(const sd of [-1,1])list.push(new T3.CylinderGeometry(.5,.5,.06,10).rotateX(Math.PI/2).scale(.38*k*1.3,.3*k*1.3,1).translate(x,1.75,sd*(HULL_SIDE(x)+.015)));
  const g=mergeGeometries(list);portholeCache.set(key,g);sharedGeometries.add(g);return g;}
function makeYacht(k,L=50){
  const g=new T3.Group(),mats={hull:Object.assign(M(k.hull,.45),{side:T3.DoubleSide}),trim:Object.assign(M(k.trim,.5),{side:T3.DoubleSide}),deck:Object.assign(M(k.deck,.85),{side:T3.DoubleSide}),s1:M(k.s1,.5),s2:M(k.s2,.45),s3:M(k.s3,.5),pocket:M('#141a20',.5),glass:Object.assign(M('#0c1821',.12,'#1c2633'),{side:T3.DoubleSide}),pool:M('#3fb6cf',.2,'#0b3a44')};
  for(const [geo,key] of YG_DRAW)g.add(new T3.Mesh(geo,mats[key]));
  g.add(new T3.Mesh(portholeGeo(L),mats.pocket));
  const rd=new T3.Mesh(RADAR_G,mats.s2);rd.position.set(2.6,11.27,0);rd.rotation.y=Math.random()*6;g.add(rd);g.userData.radar=rd;
  return g;
}
function makeFigure(shirt){
  const g=new T3.Group();
  const legs=new T3.Mesh(new T3.CylinderGeometry(.26,.26,.8,8),M('#1c2b38',.8));legs.position.y=.4;
  const body=new T3.Mesh(new T3.CylinderGeometry(.34,.3,.8,8),M(shirt,.7));body.position.y=1.2;
  const head=new T3.Mesh(new T3.SphereGeometry(.25,10,8),M('#e9bd95',.7));head.position.y=1.85;
  g.add(legs,body,head);g.scale.setScalar(.7);return g;
}
function makeTender(){
  /* a sleek foiling day boat: long low hull, thin dark sheer line, tan deck and a dark glass canopy */
  const g=new T3.Group(),sx=12/50,sy=3.6/9.4,add=(geo,m)=>g.add(new T3.Mesh(geo,m));
  add(slabG(hullShape(sx,sy),1.1,-.45),M('#dddfda',.32));
  add(slabG(hullShape(sx*1.004,sy*1.02),-.08,-.46),M('#b4b8b3',.4));
  add(slabG(hullShape(sx*1.004,sy*1.015),.9,.85),M('#161b1f',.4));
  add(slabG(hullShape(sx*.93,sy*.84),1.14,1),M('#c9a77a',.85));
  /* low glass canopy, raked fore and aft, under a thin dark roof */
  const glass=new T3.MeshStandardMaterial({color:col('#7d9099'),roughness:.18,metalness:0}),frame=M('#262c31',.35);
  const rake=(geo,x0,x1,yb,k)=>{const pa=geo.attributes.position,mid=(x0+x1)/2;for(let i=0;i<pa.count;i++)if(pa.getY(i)>yb+.01)pa.setX(i,mid+(pa.getX(i)-mid)*k);pa.needsUpdate=true;geo.computeVertexNormals();return geo;};
  add(rake(slabG(rrShape(-4.5,-1.28,5.3,2.56,.6),1.86,1.12),-4.5,.8,1.12,.88),glass);
  add(rake(slabG(rrShape(-4.62,-1.33,5.5,2.66,.62),1.93,1.85),-4.62,.88,1.84,.8),frame);
  add(slabG(rrShape(1.5,-1.12,.16,2.24,.08),1.52,1.12),glass);
  add(slabG(rrShape(-5.6,-1.25,1,2.5,.25),1.32,1.12),M('#e9e2d2',.8));
  /* carbon foils on long struts: a main wing on two forward struts, a rear strut with the stabiliser and twin pods */
  const cf=M('#151b20',.32),tip=M('#ffb547',.5);
  for(const z of [-.75,.75])add(new T3.BoxGeometry(.3,2.15,.07).translate(1.6,-1.52,z),cf);
  add(new T3.BoxGeometry(.52,.07,3.1).translate(1.6,-2.6,0),cf);
  for(const z of [-1.55,1.55])add(new T3.BoxGeometry(.5,.18,.05).translate(1.6,-2.53,z),tip);
  add(new T3.BoxGeometry(.38,2.15,.08).translate(-5.2,-1.52,0),cf);
  add(new T3.BoxGeometry(.4,.06,1.6).translate(-5.2,-2.62,0),cf);
  for(const z of [-.74,.74]){add(new T3.CylinderGeometry(.12,.09,.85,12).rotateZ(Math.PI/2).translate(-5.12,-2.62,z),cf);add(new T3.CylinderGeometry(.21,.21,.03,14).rotateZ(Math.PI/2).translate(-5.6,-2.62,z),tip);}
  return g;
}
const own=new T3.Group();own.rotation.order='YZX';scene3.add(own);
const crew=[makeFigure('#f6f8f9'),makeFigure('#f6f8f9'),makeFigure('#f6f8f9')];crew.forEach(f=>own.add(f));
/* Bow wave: two curling white sheets ("the moustache") peeling off each side of the stem, as in photos of yachts and
   patrol boats at speed. Each is a 14 x 4 ribbon in the hull's own frame, rebuilt every frame from speed, sway, yaw and
   the bow's pitch; the foam texture streams aft. Cheap: about a hundred vertices per side, no extra lights or passes. */
const BW_N=14,bowWaveTex=new T3.CanvasTexture((()=>{const w=256,h=128,c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
  g.fillStyle='rgba(255,255,255,.5)';g.fillRect(0,0,w,h); /* aerated white water, then brighter clots and streaks on top */
  for(let i=0;i<340;i++){const x=Math.random()*w,y=Math.random()*h,r=3+Math.random()*12,a=.3+Math.random()*.6;const rg=g.createRadialGradient(x,y,0,x,y,r);rg.addColorStop(0,`rgba(255,255,255,${a})`);rg.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=rg;g.fillRect(x-r,y-r,r*2,r*2);}
  g.strokeStyle='rgba(255,255,255,.35)';for(let i=0;i<40;i++){const y=Math.random()*h;g.lineWidth=.6+Math.random()*1.4;g.beginPath();g.moveTo(Math.random()*w*.3,y);g.lineTo(w*.3+Math.random()*w*.7,y+(Math.random()-.5)*6);g.stroke();}
  g.globalCompositeOperation='destination-in';const vg=g.createLinearGradient(0,0,0,h);vg.addColorStop(0,'rgba(0,0,0,.5)');vg.addColorStop(.28,'rgba(0,0,0,1)');vg.addColorStop(.62,'rgba(0,0,0,.55)');vg.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=vg;g.fillRect(0,0,w,h);return c;})());
bowWaveTex.wrapS=1000; /* RepeatWrapping (the slim vendored bundle omits the named constant) */bowWaveTex.colorSpace=T3.SRGBColorSpace;
const bowWaveMat=new T3.MeshBasicMaterial({map:bowWaveTex,color:0xf2f7f8,transparent:true,opacity:0,depthWrite:false,side:T3.DoubleSide});
const bowWave=[-1,1].map(sd=>{const geo=new T3.BufferGeometry(),uv=[],idx=[];
  for(let i=0;i<BW_N;i++)for(let r=0;r<4;r++)uv.push(i/(BW_N-1),r/3);
  for(let i=0;i<BW_N-1;i++)for(let r=0;r<3;r++){const a=i*4+r,b=a+4;idx.push(a,b,b+1,a,b+1,a+1);}
  geo.setAttribute('position',new T3.Float32BufferAttribute(new Float32Array(BW_N*4*3),3).setUsage(T3.DynamicDrawUsage));geo.setAttribute('uv',new T3.Float32BufferAttribute(uv,2).setUsage(T3.DynamicDrawUsage));geo.setIndex(idx);
  const m=new T3.Mesh(geo,bowWaveMat);m.frustumCulled=false;m.visible=false;m.userData.sd=sd;scene3.add(m);return m;});
const lampP=new T3.Mesh(new T3.SphereGeometry(.28,8,6),new T3.MeshBasicMaterial({color:0xff4030}));
const lampS=new T3.Mesh(new T3.SphereGeometry(.28,8,6),new T3.MeshBasicMaterial({color:0x30ff80}));own.add(lampP,lampS);
const lampM=new T3.Mesh(new T3.SphereGeometry(.22,8,6),new T3.MeshBasicMaterial({color:0xfff6e0})),lampA=lampM.clone();own.add(lampM,lampA);
const glowTex=new T3.CanvasTexture(sprite((g,n)=>{const r=g.createRadialGradient(n/2,n/2,0,n/2,n/2,n/2);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.25,'rgba(255,255,255,.5)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,n,n);}));
const navGlow=[[lampP,0xff4030],[lampS,0x30ff80],[lampM,0xfff3d8],[lampA,0xfff3d8]].map(([l,c])=>{const g=new T3.Sprite(new T3.SpriteMaterial({map:glowTex,color:c,transparent:true,depthWrite:false,blending:T3.AdditiveBlending,opacity:0}));g.scale.set(1.3,1.3,1);l.add(g);return g;});
const anchMast=new T3.Group();{const pole=new T3.Mesh(new T3.CylinderGeometry(.06,.08,3,6).translate(0,1.5,0),new T3.MeshStandardMaterial({color:col('#c3ccd2'),roughness:.5}));anchMast.add(pole);}
const anchLamp=new T3.Mesh(new T3.SphereGeometry(.2,8,6),new T3.MeshBasicMaterial({color:0xffffff}));anchLamp.position.y=3.1;
{const g=new T3.Sprite(new T3.SpriteMaterial({map:glowTex,color:0xfff8e8,transparent:true,depthWrite:false,blending:T3.AdditiveBlending,opacity:.6}));g.scale.set(1.8,1.8,1);anchLamp.add(g);}
anchMast.add(anchLamp);anchMast.visible=false;own.add(anchMast);
const ownGlass=new T3.MeshStandardMaterial({color:col('#0c1821'),roughness:.12,metalness:.05,emissive:col('#1c2633'),side:T3.DoubleSide}),discoL=new T3.PointLight(0xffffff,0,110);discoL.position.set(0,9,0);own.add(discoL);
sharedMaterials.add(ownGlass);
// Point lights now use inverse-square attenuation. Calibrate the accent around the deck, 6 m away.
const PARTY_LIGHT_SCALE=LIGHT_SCALE*6*6;
const fenderG=new T3.Group();own.add(fenderG);
const fendMat=[0,1].map(()=>new T3.MeshStandardMaterial({color:col('#20262b'),roughness:.6,emissive:new T3.Color(0,0,0)})),fendRed=new T3.MeshBasicMaterial({color:0xff2a1a});
const ANCHOR_EYE_Y=1.15,anchorEye=new T3.Group();anchorEye.name='anchor-eye';anchorEye.position.y=ANCHOR_EYE_Y;
const anchorM=new T3.Group();{const am=M('#3a4148',.35); // stockless (hall-type) anchor: shank into the hawse, flat crown and flukes against the hull
  const sh=new T3.Mesh(new T3.BoxGeometry(.2,1.5,.16),am);sh.position.y=.45;
  const cr=new T3.Mesh(new T3.BoxGeometry(.95,.3,.2),am);cr.position.y=-.32;
  const f1=new T3.Mesh(new T3.BoxGeometry(.3,.85,.14),am);f1.position.set(-.34,-.68,0);f1.rotation.z=-.22;
  const f2=new T3.Mesh(new T3.BoxGeometry(.3,.85,.14),am);f2.position.set(.34,-.68,0);f2.rotation.z=.22;
  const sh2=new T3.Mesh(new T3.BoxGeometry(.5,.12,.16),am);sh2.position.y=ANCHOR_EYE_Y;
  anchorM.add(sh,cr,f1,f2,sh2,anchorEye);}own.add(anchorM);const anchorM2=anchorM.clone();own.add(anchorM2);
const anchorModels=[anchorM,anchorM2],anchorEyes=[anchorEye,anchorM2.getObjectByName('anchor-eye')],anchorHawse=[new T3.Group(),new T3.Group()];own.add(...anchorHawse);
let ownModel=null,deckY=3.38;
function buildOwn(){
  if(ownModel)disposeTransientGroup(ownModel);
  const tender=shipId==='tender',hs=SL;
  if(tender)ownModel=makeTender();else{ownModel=shipId==='ls'?makeLS():makeYacht(OWN,LEN);ownModel.scale.set(SL,hs,SB);const gl=M('#0c1821',.12,'#1c2633');ownModel.children.forEach(m=>{if(m.material===gl)m.material=ownGlass;});}
  own.add(ownModel);deckY=tender?1.14:3.38*hs;
  crew.forEach(f=>{f.scale.setScalar(.7);f.visible=!tender;});
  crew[1].position.set(-22.5*SL,deckY,-2.8*SB);crew[2].position.set(-22.5*SL,deckY,2.8*SB);
  if(tender){lampP.position.set(.4,2.02,-1.2);lampS.position.set(.4,2.02,1.2);}else{lampP.position.set(13*SL,6.3*hs,-3.9*SB);lampS.position.set(13*SL,6.3*hs,3.9*SB);}
  anchorM.scale.setScalar(tender?.32:.62);anchorM2.scale.setScalar(.62);anchorM2.visible=!tender;
  const hx=(HAWSE.x+Math.sin(HAWSE.yaw)*HAWSE.depth/2)*SL,hy=(HAWSE.y+HAWSE.eye)*hs,hz=(HAWSE.z+Math.cos(HAWSE.yaw)*HAWSE.depth/2)*SB;
  anchorHawse[0].position.set(tender?LEN/2:hx,tender?1.1:hy,tender?0:-hz);anchorHawse[1].position.set(hx,hy,hz);
  lampP.scale.setScalar(tender?.4:1);lampS.scale.setScalar(tender?.4:1);lampM.scale.setScalar(tender?.45:1);
  lampM.position.set(tender?-1.6:2.6*SL,tender?2.2:11.75*hs,0);lampA.position.set(tender?-5.8:-17.15*SL,tender?1.4:5.95*hs,0); /* stern light on the aft edge of the first deck level */anchMast.position.set(tender?-2.2:-8*SL,tender?2.08:10.65*hs,0);anchMast.scale.x=anchMast.scale.z=tender?.5:1;
  while(fenderG.children.length){const ch=fenderG.children[0];fenderG.remove(ch);ch.geometry.dispose();}
  // long fenders hanging from the rail to the waterline, so they sit between hull and quay
  const fr=tender?.16:.42,fl=tender?.85:2.3;FEND_D=fr*1.8;
  for(const fx of FENDX)for(const sd of [-1,1]){const m=new T3.Mesh(new T3.CylinderGeometry(fr,fr,fl,12),fendMat[sd>0?1:0]);
    m.position.set(fx*LEN/2,fl/2+.12,sd*(BEAM*.5*(fx<-.7?.95:1)+fr*.95));m.userData.b=m.position.clone();fenderG.add(m);}
}
// smoke and flame for the bad days
const puffs=[];
const streakTex=new T3.CanvasTexture((()=>{const w=128,h=32,c=document.createElement('canvas');c.width=w;c.height=h;const g=c.getContext('2d');
  const lg=g.createLinearGradient(0,0,w,0);lg.addColorStop(0,'rgba(255,255,255,0)');lg.addColorStop(.25,'rgba(255,255,255,.7)');lg.addColorStop(.7,'rgba(255,255,255,1)');lg.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle=lg;g.fillRect(0,0,w,h);g.globalCompositeOperation='destination-in';const vg=g.createLinearGradient(0,0,0,h);vg.addColorStop(0,'rgba(0,0,0,0)');vg.addColorStop(.5,'rgba(0,0,0,1)');vg.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=vg;g.fillRect(0,0,w,h);return c;})());
function puff(x,y,z,fire){
  let q=puffs.find(o=>o.life<=0);
  if(!q){if(puffs.length>=190)return null;q={life:0,sp:new T3.Sprite(new T3.SpriteMaterial({map:foamTex,transparent:true,depthWrite:false}))};scene3.add(q.sp);puffs.push(q);}
  q.life=q.max=fire?rnd(.45,.9):rnd(3,5.5);q.fire=fire;q.x=x+rnd(-1,1);q.y=y;q.z=z+rnd(-1,1);q.vy=fire?rnd(2,4.5):rnd(1.6,3.2);q.s=fire?rnd(1.6,2.8):rnd(1.6,2.6);
  q.spray=false;q.mist=false;q.streak=false;q.jet=false;q.hitWater=false;q.exh=false;q.dk=false;q.faint=false;q.dr=0;q.g=9.8;q.sp.material.map=foamTex;q.sp.material.rotation=0;q.sp.material.blending=fire?T3.AdditiveBlending:T3.NormalBlending;q.sp.material.color.setHex(fire?0xff6a14:0x17191b);q.sp.visible=true;q.ex=false;return q;
}
const cnt2=q=>{const n=Math.floor(q);return n+(Math.random()<q-n?1:0);};
function updateSmoke(dt){
  if(dt<=0)return;
  // heavy weather: when the bow drops hard into a sea, a sheet of spray goes up and blows back over the foredeck
  /* heavy-weather spray is triggered by how deep the bow digs into a sea (see updateBowWave) */
  if(S.sprayQ&&!hold){const Q=S.sprayQ;Q.t+=dt;
    const c0=Math.cos(S.psi),s0=Math.sin(S.psi),bvx=S.u*c0-S.v*s0,bvz=S.u*s0+S.v*c0,pPort=.5+.42*Q.bias;
    for(let i=0,n=cnt2((8+20*Q.k)*dt/Q.dur);i<n;i++){
      const sd=Math.random()<pPort?-1:1,weather=(sd<0)===(Q.bias>0),ph=Math.pow(Math.random(),.7)*Math.min(1,Q.t/Q.dur);
      const xm=LEN/2-(.4+Math.pow(Math.random(),.8)*5)*SL,lift=.2+ph*2.2*SL*Q.peak*rnd(.5,1);
      v3a.set(xm,lift,sd*(hullHW(xm)*.85+.25)).applyMatrix4(own.matrixWorld);const q=puff(v3a.x,v3a.y,v3a.z,false);if(!q)break;
      const mist=Math.random()<.94,side=weather?1.25:.55,out=rnd(.4,2)*side,up=(rnd(1.2,4)+ph*3.2*Q.peak)*(.7+.3*Q.k)*side;
      q.spray=true;q.mist=mist;q.dr=mist?rnd(1.2,2):rnd(.4,.9);q.g=mist?3:9.8;
      q.streak=!mist;if(!mist)q.sp.material.map=streakTex;q.sp.material.color.setHex(mist?0xe7eef1:0xf4f8f9);q.life=q.max=mist?rnd(1.2,2):rnd(.5,.8);q.s=(mist?rnd(.4,.85):rnd(.15,.3))*(.75+.25*Math.min(1.4,Q.k));
      q.vx=bvx*.85-s0*sd*out;q.vz=bvz*.85+c0*sd*out;q.vy=up*(mist?.7:1);}
    if(Q.t>Q.dur)S.sprayQ=null;}
  // exhaust outlets low on each side, aft: bubbles when a sea covers them; one subtle black plume when the throttles hit full
  if(state==='play'&&!hold&&shipId!=='tender'){const c0=Math.cos(S.psi),s0=Math.sin(S.psi),n0=Math.abs(S.rpm[0]),n1=Math.abs(S.rpm[1]),nMax=Math.max(n0,n1);
    const ez=hullHW(-19*SL)+.06,ox=-s0,oy=c0; /* outlets on the hull sides; (ox,oy) points out to starboard */
    for(let i=0;i<2;i++){const n=i?n1:n0,sd=i?1:-1;v3a.set(-19*SL,.46*SL,sd*ez).applyMatrix4(own.matrixWorld);
      if(v3a.y<waveH(v3a.x,v3a.z)+.12)for(let j=0,m=cnt2(dt*(4+22*n));j<m;j++){const o=rnd(.3,1.2),a=rnd(.2,1.4);
        spawn(Math.random()<.6?1:0,v3a.x+sd*ox*o-c0*a,v3a.z+sd*oy*o-s0*a,sd*ox*rnd(.4,1)-c0*rnd(.2,.8)+S.u*c0*.5,sd*oy*rnd(.4,1)-s0*rnd(.2,.8)+S.u*s0*.5,rnd(.18,.36)*(.7+.5*n),rnd(.6,1.3),.35);}}
    if(nMax<.7)S.plumeArm=true;
    if(S.plumeArm&&nMax>.92){S.plumeArm=false;S.plumeT=0;S.plumeSide=n0>.92&&n1>.92?-(S.plumeSide||1):n0>.92?-1:1;} /* one plume, from the side whose engine hit full (alternating when both do) */
    if(S.plumeT!=null){S.plumeT+=dt;if(S.plumeT>.8)S.plumeT=null;
      else if(Math.random()<dt*16){const sd=S.plumeSide;v3a.set(-19*SL,.5*SL,sd*(ez+.15)).applyMatrix4(own.matrixWorld);
        if(v3a.y>=waveH(v3a.x,v3a.z)){const q=puff(v3a.x,v3a.y,v3a.z,false);
          if(q){q.x=v3a.x;q.z=v3a.z;q.ex=true;q.exh=true;q.dk=true;const out=rnd(1.2,2);q.vx=sd*ox*out-c0*rnd(.2,.6)+(S.u*c0-S.v*s0)*.6;q.vz=sd*oy*out-s0*rnd(.2,.6)+(S.u*s0+S.v*c0)*.6;q.vy=rnd(.7,1.1);
            q.s=rnd(.55,.85)*Math.sqrt(SL);q.life=q.max=rnd(2.2,3.2);q.sp.material.color.setHex(0x1b1d20);}}}}}
  if(state==='play'&&!hold&&shipId!=='tender'&&Math.random()<dt*.6){v3a.set(-.95*SL,12.75*SL,0).applyMatrix4(own.matrixWorld);const q=puff(v3a.x,v3a.y,v3a.z,false);
    if(q){q.x=v3a.x;q.z=v3a.z;q.ex=true;q.exh=true;q.faint=true;q.vx=0;q.vz=0;q.vy=rnd(.6,1);q.s=rnd(.4,.6);q.life=q.max=rnd(2,3);q.sp.material.color.setHex(0xa9b1b6);}}
  // generator cooling water: a steady jet from the starboard quarter
  if(state==='play'&&!hold&&shipId!=='tender'){for(let i=0,n=cnt2(dt*20);i<n;i++){const xm=-17*SL,c0=Math.cos(S.psi),s0=Math.sin(S.psi);
    v3a.set(xm,.6,hullHW(xm)+.05).applyMatrix4(own.matrixWorld);const q=puff(v3a.x,v3a.y,v3a.z,false);if(!q)break;
    const out=rnd(1.1,1.4),bvx=S.u*c0-S.v*s0,bvz=S.u*s0+S.v*c0;q.x=v3a.x;q.z=v3a.z;q.y=v3a.y;
    q.spray=true;q.streak=true;q.dr=.15;q.g=9.8;q.vx=bvx-s0*out;q.vz=bvz+c0*out;q.vy=rnd(-.2,.25);q.life=q.max=rnd(.4,.5);q.s=rnd(.1,.14);q.jet=true;
    q.sp.material.map=streakTex;q.sp.material.color.setHex(0xe8f1f4);}
    if(Math.random()<dt*3){v3a.set(-17*SL,0,hullHW(-17*SL)+.7).applyMatrix4(own.matrixWorld);spawn(1,v3a.x,v3a.z,rnd(-.2,.2),rnd(-.2,.2),rnd(.2,.32),rnd(.8,1.3),.2);}}
  if(S.boom){for(let i=0;i<8;i++)puff(S.boom.x,1+rnd(0,1.8),S.boom.y,true);for(let i=0;i<7;i++)puff(S.boom.x,1.6,S.boom.y,false);S.boom=null;}
  if(S.fire&&state==='play'){
    v3a.set(S.fire.a,deckY+.6,S.fire.b).applyMatrix4(own.matrixWorld);const k=Math.max(.6,Math.min(1.6,SL));
    if(Math.random()<dt*14)puff(v3a.x,v3a.y+1,v3a.z,false);if(Math.random()<dt*26)puff(v3a.x,v3a.y,v3a.z,true);
    for(const q of puffs)if(q.life===q.max)q.s*=k;
  }
  const wd=windTo(),wsA=windSpd(),ws=wsA*.6,wvx=wd[0]*wsA,wvz=wd[1]*wsA;
  let waterCeiling=KW.on?KW.A:0;for(const wave of WV)waterCeiling+=wave.amp;
  for(const q of puffs){if(q.life<=0)continue;q.life-=dt;if(q.life<=0){q.sp.visible=false;continue;}
    if(q.spray){const dr=q.dr||0;q.vy-=(q.g||9.8)*dt;q.vx+=(wvx-q.vx)*dr*dt;q.vz+=(wvz-q.vz)*dr*dt;q.vy*=1-dr*.25*dt;q.x+=q.vx*dt;q.y+=q.vy*dt;q.z+=q.vz*dt;
      if(!q.hitWater&&q.vy<0&&q.y<=waterCeiling+.05&&q.y<=waveH(q.x,q.z)+.03){q.hitWater=true;q.life=Math.min(q.life,.15);
        if(!q.jet)spawn(1,q.x,q.z,q.vx*.1,q.vz*.1,clamp(q.s*.35,.12,.45),.7,.2);}
      const f=q.life/q.max;q.sp.position.set(q.x,q.y,q.z);
      if(q.streak){v3a.set(q.x,q.y,q.z).project(camera);v3b.set(q.x+q.vx*.06,q.y+q.vy*.06,q.z+q.vz*.06).project(camera);
        const dx=(v3b.x-v3a.x)*AW,dy=(v3b.y-v3a.y)*AH,spd=Math.hypot(q.vx,q.vy,q.vz);q.sp.material.rotation=Math.atan2(dy,dx);
        const L=q.s*(2.2+spd*.45)*(1+(1-f)*.5),W=q.s*(q.jet?.9:.55)*(1+(1-f)*1.2);q.sp.scale.set(L,W,1);
        q.sp.material.opacity=(q.jet?.35:.75)*Math.min(1,f*2.2)*Math.min(1,(q.max-q.life)*10);}
      else{const sc=q.s*(1+(1-f)*(q.mist?2.4:1.4));q.sp.scale.set(sc,sc,1);q.sp.material.opacity=(q.mist?.22:.6)*Math.min(1,f*2.5)*Math.min(1,(q.max-q.life)*8);}
      continue;}
    if(q.exh){q.vx+=(wvx-q.vx)*.9*dt;q.vz+=(wvz-q.vz)*.9*dt;q.x+=q.vx*dt;q.y+=q.vy*dt;q.z+=q.vz*dt;const f=q.life/q.max,sc=q.s*(1+(1-f)*(q.faint?2:1.8));
      q.sp.position.set(q.x,q.y,q.z);q.sp.scale.set(sc,sc,1);q.sp.material.opacity=(q.faint?.07:q.dk?.3:.22)*f*Math.min(1,(q.max-q.life)*4);continue;}
    q.y+=q.vy*dt;q.x+=wd[0]*ws*dt;q.z+=wd[1]*ws*dt;const f=q.life/q.max,sc=q.s*(q.fire?.6+f:1+(1-f)*3.2);
    q.sp.position.set(q.x,q.y,q.z);q.sp.scale.set(sc,sc,1);q.sp.material.opacity=(q.fire?f*.9:.6*f*Math.min(1,(q.max-q.life)*3))*(q.ex?(q.dk?.5:.32):1);}
}
const handF=[makeFigure('#ff8a3d'),makeFigure('#ff8a3d')];handF.forEach(f=>scene3.add(f));
// mooring lines
const ropeM=new T3.MeshBasicMaterial({color:col(0xf3ead0)}),ropeHot=new T3.MeshBasicMaterial({color:col(0xffb547)}),ropeRed=new T3.MeshBasicMaterial({color:col(0xff2a1a)});
const mkRope=()=>{const m=new T3.Mesh(new T3.BufferGeometry(),ropeM);m.visible=false;m.frustumCulled=false;scene3.add(m);return m;};
const ropes=[0,1,2,3,4,5].map(mkRope),leads=[0,1,2,3,4,5].map(mkRope);
const whip=[mkRope(),mkRope()];whip.forEach(w=>w.material=ropeRed);
const chainM=mkRope(),chainM2=mkRope(); // kept as stand-ins; the chain itself is drawn as links below
const LINK_MAX=220,chainLinks=new T3.InstancedMesh(new T3.TorusGeometry(.085,.028,5,10).scale(1.75,1,1),new T3.MeshStandardMaterial({color:0xffffff,roughness:.45,metalness:.55}),LINK_MAX);
/* at night the chain glows softly in its own colours (paint marks included) so it stays readable against dark water */
chainLinks.material.emissive.setRGB(0,0,0);
chainLinks.material.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace('#include <emissivemap_fragment>','#include <emissivemap_fragment>\n#ifdef USE_COLOR\n totalEmissiveRadiance*=vColor.rgb*.7+.3;\n#endif');};
chainLinks.instanceMatrix.setUsage(T3.DynamicDrawUsage);
chainLinks.instanceColor=new T3.InstancedBufferAttribute(new Float32Array(LINK_MAX*3).fill(.4),3).setUsage(T3.DynamicDrawUsage);chainLinks.frustumCulled=false;chainLinks.count=0;scene3.add(chainLinks);const _lm=new T3.Matrix4(),_lc=new T3.Color();
function uploadActive(attribute,count){
  if(count<=0)return;
  attribute.clearUpdateRanges();attribute.addUpdateRange(0,count*attribute.itemSize);attribute.needsUpdate=true;
}
const MARKS=['#ff3b30','#ffd60a','#2f7bff','#ffffff','#34c759'],MARKN=['red','yellow','blue','white','green'],markC=MARKS.map(h=>new T3.Color(h)),chainC=new T3.Color(0x5a636a),chainL=new T3.Color(0x6b747b);
const chainMark=L=>{const k=Math.floor(L/10);return k<1?'under 10 m':MARKN[(k-1)%5]+' passed';};
function ropeGeo(N,R,colors){const g=new T3.BufferGeometry(),pos=new Float32Array((N+1)*R*3),idx=[];
  for(let i=0;i<N;i++)for(let j=0;j<R;j++){const a=i*R+j,b=i*R+(j+1)%R,c=(i+1)*R+j,d=(i+1)*R+(j+1)%R;idx.push(a,c,b,b,c,d);}
  g.setAttribute('position',new T3.BufferAttribute(pos,3).setUsage(T3.DynamicDrawUsage));if(colors)g.setAttribute('color',new T3.BufferAttribute(new Float32Array((N+1)*R*3),3).setUsage(T3.DynamicDrawUsage));g.setIndex(idx);g.userData.rope={N,R};return g;}
const _t=new T3.Vector3(),_n=new T3.Vector3(),_b=new T3.Vector3(),_up=new T3.Vector3(0,1,0),_q=new T3.Vector3();
// fill a rope mesh along the quadratic curve a -> c -> b (c is the control point)
function setTube(m,a,c,b,rad,N,R){N=N||14;R=R||5;let g=m.geometry;
  if(!g.userData.rope||g.userData.rope.N!==N||g.userData.rope.R!==R){g.dispose();g=m.geometry=ropeGeo(N,R,m.userData.colors);}
  const pos=g.attributes.position.array;
  for(let i=0;i<=N;i++){const t=i/N,u=1-t;
    _q.set(u*u*a.x+2*u*t*c.x+t*t*b.x,u*u*a.y+2*u*t*c.y+t*t*b.y,u*u*a.z+2*u*t*c.z+t*t*b.z);
    _t.set(2*u*(c.x-a.x)+2*t*(b.x-c.x),2*u*(c.y-a.y)+2*t*(b.y-c.y),2*u*(c.z-a.z)+2*t*(b.z-c.z)).normalize();
    _n.crossVectors(_t,_up);if(_n.lengthSq()<1e-6)_n.set(1,0,0);_n.normalize();_b.crossVectors(_t,_n);
    for(let j=0;j<R;j++){const an=j/R*TAU,ca=Math.cos(an)*rad,sa=Math.sin(an)*rad,o=(i*R+j)*3;
      pos[o]=_q.x+_n.x*ca+_b.x*sa;pos[o+1]=_q.y+_n.y*ca+_b.y*sa;pos[o+2]=_q.z+_n.z*ca+_b.z*sa;}}
  g.attributes.position.needsUpdate=true;return g;}
// wash: flat soft quads riding the surface
const foamTex=new T3.CanvasTexture(sprite((g,n)=>{const r=g.createRadialGradient(n/2,n/2,0,n/2,n/2,n/2);r.addColorStop(0,'rgba(255,255,255,1)');r.addColorStop(.5,'rgba(255,255,255,.45)');r.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=r;g.fillRect(0,0,n,n);}));
// one atlas, three looks: soft cloud (sediment), foam lace, spiral eddy
const MAXW=4200,washTex=new T3.CanvasTexture((()=>{
  const n=128,t=document.createElement('canvas');t.width=n*4;t.height=n;const g=t.getContext('2d');
  const fade=(ox,inner)=>{g.globalCompositeOperation='destination-in';const r=g.createRadialGradient(ox+n/2,n/2,n*inner,ox+n/2,n/2,n*.5);r.addColorStop(0,'rgba(0,0,0,1)');r.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=r;g.fillRect(ox,0,n,n);g.globalCompositeOperation='source-over';};
  // 0 soft cloud, slightly mottled
  for(let i=0;i<26;i++){const x=n*(.2+Math.random()*.6),y=n*(.2+Math.random()*.6),r=n*(.12+Math.random()*.2),q=g.createRadialGradient(x,y,0,x,y,r);q.addColorStop(0,'rgba(255,255,255,.3)');q.addColorStop(1,'rgba(255,255,255,0)');g.fillStyle=q;g.fillRect(0,0,n,n);}
  fade(0,.15);
  // 1 foam lace: bubble rims with open water between
  g.save();g.beginPath();g.rect(n,0,n,n);g.clip();
  for(let i=0;i<70;i++){const x=n+n*Math.random(),y=n*Math.random(),r=2+Math.random()*9;g.strokeStyle='rgba(255,255,255,'+(.35+Math.random()*.6)+')';g.lineWidth=.8+Math.random()*1.8;g.beginPath();g.arc(x,y,r,0,6.2832);g.stroke();}
  for(let i=0;i<60;i++){g.fillStyle='rgba(255,255,255,'+(.4+Math.random()*.6)+')';g.beginPath();g.arc(n+n*Math.random(),n*Math.random(),.6+Math.random()*1.6,0,6.2832);g.fill();}
  g.restore();fade(n,.22);
  // 2 eddy: spiral arms of foam
  g.save();g.beginPath();g.rect(n*2,0,n,n);g.clip();g.lineCap='round';
  for(let arm=0;arm<3;arm++)for(let pass=0;pass<3;pass++){g.beginPath();const a0=arm*2.094+Math.random()*.4;
    for(let i=0;i<=60;i++){const u=i/60,r=n*(.05+.4*u),a=a0+u*5.2,x=n*2.5+Math.cos(a)*r,y=n/2+Math.sin(a)*r;i?g.lineTo(x,y):g.moveTo(x,y);}
    g.strokeStyle='rgba(255,255,255,'+[.18,.32,.6][pass]+')';g.lineWidth=[9,5,1.8][pass];g.stroke();}
  g.restore();fade(n*2,.25);
  // 3 crisp foam clumps
  for(let i=0;i<90;i++){const a=Math.random()*6.28,d=Math.pow(Math.random(),.7)*n*.4,r=1.5+Math.random()*n*.07*(1-d/(n*.45));g.fillStyle='rgba(255,255,255,'+(.35+Math.random()*.65)+')';g.beginPath();g.arc(n*3.5+Math.cos(a)*d,n/2+Math.sin(a)*d,r,0,6.2832);g.fill();}
  return t;})());
const FW=340,FR=waterTier.foamResolution,FOAM_STEP=1/30,mkRT=()=>new T3.WebGLRenderTarget(FR,FR,{minFilter:T3.LinearFilter,magFilter:T3.LinearFilter,depthBuffer:false,stencilBuffer:false});
let foamAccumulator=0,foamLife=0;
let rtA=mkRT(),rtB=mkRT();const fC=new T3.Vector2(),fPrev=new T3.Vector2(),fScene=new T3.Scene(),fCam=new T3.Camera();
// pass 1: carry last frame's foam forward (shifted as the window follows the boat), spread it a touch and let it die away
const fadeMat=new T3.ShaderMaterial({uniforms:{tPrev:{value:null},uShift:{value:new T3.Vector2()},uDecay:{value:.9},uTexel:{value:1/FR},uSpread:{value:0}},depthTest:false,depthWrite:false,
  vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
  fragmentShader:`uniform sampler2D tPrev;uniform vec2 uShift;uniform float uDecay,uTexel,uSpread;varying vec2 vUv;
  void main(){vec2 u=vUv+uShift;vec4 c=vec4(0.);float e=uTexel;
    if(u.x>e&&u.x<1.-e&&u.y>e&&u.y<1.-e)c=texture2D(tPrev,u)*(1.-4.*uSpread)+(texture2D(tPrev,u+vec2(e,0.))+texture2D(tPrev,u-vec2(e,0.))+texture2D(tPrev,u+vec2(0.,e))+texture2D(tPrev,u-vec2(0.,e)))*uSpread;
    gl_FragColor=c*uDecay;}`});
const fQuad=new T3.Mesh(new T3.PlaneGeometry(2,2),fadeMat);fQuad.frustumCulled=false;fScene.add(fQuad);
// pass 2: stamp every wash particle in (red = foam, green = dark churned water)
const sGeo=new T3.InstancedBufferGeometry();sGeo.setAttribute('position',new T3.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));
sGeo.setAttribute('uv',new T3.Float32BufferAttribute([0,0,1,0,1,1,0,1],2));sGeo.setIndex([0,1,2,0,2,3]);
const sP=new T3.InstancedBufferAttribute(new Float32Array(MAXW*4),4).setUsage(T3.DynamicDrawUsage),sC=new T3.InstancedBufferAttribute(new Float32Array(MAXW*3),3).setUsage(T3.DynamicDrawUsage);
sGeo.setAttribute('aP',sP);sGeo.setAttribute('aC',sC);
const stampMat=new T3.ShaderMaterial({uniforms:{map:{value:washTex},uC:{value:new T3.Vector3(0,0,FW)}},blending:T3.AdditiveBlending,transparent:true,depthTest:false,depthWrite:false,
  vertexShader:`attribute vec4 aP;attribute vec3 aC;uniform vec3 uC;varying vec2 vUv,vI;
  void main(){float c=cos(aP.w),s=sin(aP.w);vec2 q=vec2(c*position.x-s*position.y,s*position.x+c*position.y)*aP.z+aP.xy;
    vUv=vec2((uv.x*.96+.02+aC.z)/4.,uv.y);vI=aC.xy;gl_Position=vec4((q-uC.xy)/(uC.z*.5),0.,1.);}`,
  fragmentShader:`uniform sampler2D map;varying vec2 vUv,vI;void main(){gl_FragColor=vec4(vI*texture2D(map,vUv).a,0.,1.);}`});
const stamps=new T3.Mesh(sGeo,stampMat);stamps.frustumCulled=false;stamps.renderOrder=1;fScene.add(stamps);
function foamPass(dt){
  // Keep the previous world-space foam field frozen while paused, including during camera movement.
  if(!(dt>0)||!Number.isFinite(dt))return;
  foamAccumulator+=Math.min(MAX_FRAME_TIME,dt);
  const ticks=Math.min(4,Math.floor((foamAccumulator+1e-9)/FOAM_STEP));
  foamAccumulator=Math.max(0,foamAccumulator-ticks*FOAM_STEP);
  for(let tick=0;tick<ticks;tick++)advanceFoam();
}
function advanceFoam(){
  const {decay:keep,stampWeight:add,spread}=foamParameters(FOAM_STEP),tx=FW/FR;
  fC.set(Math.round(cam.x/tx)*tx,Math.round(cam.y/tx)*tx);
  fadeMat.uniforms.tPrev.value=rtA.texture;fadeMat.uniforms.uShift.value.set((fC.x-fPrev.x)/FW,(fC.y-fPrev.y)/FW);fadeMat.uniforms.uDecay.value=keep;
  fadeMat.uniforms.uSpread.value=spread*(FR/512)**2;
  let n=0;
  for(const q of parts){if(q.k===2||q.k===3||n>=MAXW)continue;
    const f=q.life/q.max,a=Math.min(1,(q.max-q.life)*(q.k===1?5:2))*f*add;
    sP.setXYZW(n,q.x,q.y,q.size,q.k===4?q.s+q.w*(q.max-q.life):q.s);
    if(q.k===0)sC.setXYZ(n,.3*a,0,0);else if(q.k===1)sC.setXYZ(n,.95*a,0,3);else if(q.k===4)sC.setXYZ(n,.12*a,1.1*a,2);else sC.setXYZ(n,.1*a,.8*a,1);
    n++;}
  sGeo.instanceCount=n;stamps.visible=n>0;uploadActive(sP,n);uploadActive(sC,n);stampMat.uniforms.uC.value.set(fC.x,fC.y,FW);
  if(n)foamLife=3;
  else if(foamLife>0){foamLife=Math.max(0,foamLife-FOAM_STEP);if(!foamLife){clearFoamField();return;}}
  else return;
  const previousTarget=renderer.getRenderTarget();
  try{renderer.setRenderTarget(rtB);renderer.render(fScene,fCam);}finally{renderer.setRenderTarget(previousTarget);}
  const t=rtA;rtA=rtB;rtB=t;fPrev.copy(fC);U.tFoam.value=rtA.texture;U.uFoamC.value.set(fC.x,fC.y,FW);
}
// distant cliffs, lost in the murk
(()=>{const pos=[],N=260,ridge=a=>Math.max(0,(.55+.5*Math.sin(a*3+1)+.3*Math.sin(a*7+2)+.18*Math.sin(a*17))*150*(.5+.5*Math.sin(a*1.5+.4)>.22?1:0));
  for(let i=0;i<N;i++){const a0=i/N*TAU,a1=(i+1)/N*TAU,r0=1150+90*Math.sin(a0*5),r1=1150+90*Math.sin(a1*5),h0=ridge(a0),h1=ridge(a1);
    const x0=Math.cos(a0)*r0,z0=Math.sin(a0)*r0,x1=Math.cos(a1)*r1,z1=Math.sin(a1)*r1;
    pos.push(x0,-5,z0,x1,-5,z1,x1,h1,z1,x0,-5,z0,x1,h1,z1,x0,h0,z0);}
  const g=new T3.BufferGeometry();g.setAttribute('position',new T3.Float32BufferAttribute(pos,3));
  scene3.add(new T3.Mesh(g,new T3.MeshBasicMaterial({color:col(0x1d2529),side:T3.DoubleSide})));})();
// berth marker
const slipG=new T3.Group(),slipFill=new T3.MeshBasicMaterial({color:0xffb547,transparent:true,opacity:.14,depthWrite:false,fog:false}),slipLine=new T3.LineBasicMaterial({color:0xffb547,fog:false});
scene3.add(slipG);
let lvG=null,pirate=null,mooringLines=null;
/* Quay detail along every water-facing edge near the harbour: a dark weed line at the waterline and timber fenders
   down the face, all in one instanced draw. A faint wash shows at the foot of the wall only when a wave crest reaches it. */
const lapMat=new T3.ShaderMaterial({uniforms:U,transparent:true,depthWrite:false,fog:false,side:T3.DoubleSide,
  vertexShader:`uniform float uT;`+WATER_GLSL+`attribute float aAlong;varying vec2 vL;varying float vH,vA;
  void main(){vec3 o,tx,tz;waterSurface(position.xz,o,tx,tz);float a=0.;for(int i=0;i<${uW.length};i++)a+=uW[i].w;vA=a*waterShelter(position.xz).x;
    vH=o.y;vL=vec2(aAlong,uv.y);gl_Position=projectionMatrix*viewMatrix*vec4(position.x,o.y+.04,position.z,1.);}`,
  fragmentShader:`uniform float uT,uNight;varying vec2 vL;varying float vH,vA;
  float h1(float x){return fract(sin(x*127.1)*43758.5);}
  float n1(float x){float i=floor(x),f=fract(x);return mix(h1(i),h1(i+1.),f*f*(3.-2.*f));}
  void main(){float hit=smoothstep(.5,.95,vH/max(vA,.02))*smoothstep(.07,.32,vA);if(hit<=0.)discard;
    float br=n1(vL.x*.9+uT*.6)*n1(vL.x*2.3-uT*.4+vL.y*3.);
    gl_FragColor=vec4(vec3(.86,.92,.94)*(1.-.62*uNight),pow(1.-vL.y,2.6)*hit*(.35+.65*br)*.42);}`});
/* buildings: a grid of windows on every wall, and at night a scatter of them glow warm */
const buildingMat=new T3.MeshStandardMaterial({roughness:.9});sharedMaterials.add(buildingMat);
buildingMat.onBeforeCompile=sh=>{sh.uniforms.uNight=U.uNight;
  sh.vertexShader=sh.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vWP,vWN;').replace('#include <project_vertex>',`#include <project_vertex>
    vec4 bw=vec4(transformed,1.);vec3 bn=objectNormal;
    #ifdef USE_INSTANCING
    bw=instanceMatrix*bw;bn=mat3(instanceMatrix)*bn;
    #endif
    vWP=(modelMatrix*bw).xyz;vWN=normalize(mat3(modelMatrix)*bn);`);
  sh.fragmentShader=sh.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vWP,vWN;uniform float uNight;float winMask;vec2 winCell;').replace('#include <color_fragment>',`#include <color_fragment>
    {float vert=step(abs(vWN.y),.5);vec2 w=vec2(dot(vWP.xz,vec2(-vWN.z,vWN.x)),vWP.y-1.6);vec2 f=fract(w/vec2(2.6,3.2));winCell=floor(w/vec2(2.6,3.2));
     winMask=vert*step(.24,f.x)*step(f.x,.76)*step(.34,f.y)*step(f.y,.78)*step(.5,winCell.y);
     diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.07,.09,.11),winMask*.85);
     diffuseColor.rgb*=mix(1.,.82,vert*step(fract(w.y/3.2),.05));}`).replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
    totalEmissiveRadiance+=vec3(1.,.6,.28)*winMask*step(.62,fract(sin(dot(winCell+floor(vWP.xz*.013),vec2(12.9898,78.233)))*43758.5))*uNight*.42;`);};
/* the island's hill: a low, uneven mound of scrub and grass with bare rock showing near the top, set back from the beach */
function makeIsleHill(o){
  const R=o.ir*.74,H=Math.min(11,o.ir*.3),cx=o.ix+o.ir*.2,cz=o.iy+o.ir*.1,RINGS=12,SEG=44,pos=[],colA=[],idx=[];
  const nz=(a,t)=>.55*Math.sin(a*3+1.3)+.3*Math.sin(a*7+t*4+.4)+.18*Math.sin(a*13-t*6+2.1);
  const grass=new T3.Color('#5c7444'),scrub=new T3.Color('#4a5d38'),rock=new T3.Color('#8a8678'),sandC=new T3.Color('#cdbb8f'),c=new T3.Color();
  pos.push(cx,1.4+H*(1+.06*nz(0,0)),cz);colA.push(rock.r,rock.g,rock.b);
  for(let i=1;i<=RINGS;i++){const t=i/RINGS;for(let j=0;j<SEG;j++){const a=j/SEG*TAU,rr=R*t*(1+.16*nz(a,t)),h=H*Math.pow(.5+.5*Math.cos(Math.PI*Math.min(1,t)),1.15)*(1+.12*nz(a+1,t));
    pos.push(cx+Math.cos(a)*rr,1.4+h,cz+Math.sin(a)*rr);
    const k=Math.max(0,Math.sin(a*5+t*9)*.5+.5);c.copy(grass).lerp(scrub,k*.7);if(t<.35&&nz(a*2,t)>.15)c.lerp(rock,.75);if(t>.9)c.lerp(sandC,(t-.9)*7);colA.push(c.r,c.g,c.b);}}
  for(let j=0;j<SEG;j++)idx.push(0,1+(j+1)%SEG,1+j);
  for(let i=1;i<RINGS;i++)for(let j=0;j<SEG;j++){const a=1+(i-1)*SEG+j,b=1+(i-1)*SEG+(j+1)%SEG,c2=a+SEG,d=b+SEG;idx.push(a,b,d,a,d,c2);}
  const g=new T3.BufferGeometry();g.setAttribute('position',new T3.Float32BufferAttribute(pos,3));g.setAttribute('color',new T3.Float32BufferAttribute(colA,3));g.setIndex(idx);g.computeVertexNormals();
  return new T3.Mesh(g,new T3.MeshStandardMaterial({vertexColors:true,roughness:.95,side:T3.DoubleSide}));
}
function buildQuayDetail(rand){
  const box=[],ribbon=[],along=[],uvs=[],idx=[],near=(x,y,r)=>allSlips.some(q=>Math.hypot(x-q.x,y-q.y)<r);
  for(const o of obstacles){if(o.kind!=='land'&&o.kind!=='pier')continue;const P=o.p,top=o.kind==='land'?1.6:1.2;
    for(let i=0;i<P.length;i++){const a=P[i],b=P[(i+1)%P.length],ex=b[0]-a[0],ey=b[1]-a[1],L=Math.hypot(ex,ey);if(L<4)continue;
      let nx=-ey/L,ny=ex/L;if((o.cx-(a[0]+b[0])/2)*nx+(o.cy-(a[1]+b[1])/2)*ny>0){nx=-nx;ny=-ny;} /* (nx,ny) points out into the water */
      const ux=ex/L,uy=ey/L,ang=-Math.atan2(uy,ux);
      /* walk the edge in pieces, keeping only stretches that face open water near the harbour */
      let run=null;const flush=()=>{if(!run)return;const [s0,s1]=run,len=s1-s0,mx=a[0]+ux*(s0+s1)/2,my=a[1]+uy*(s0+s1)/2;
        box.push([mx+nx*.04,.12,my+ny*.04,len,.85,.1,ang,.17,.19,.15]);               /* weed line */
        {const base=ribbon.length/3;let k=0;for(let d=s0;d<=s1+.01;d+=3,k++){const t=Math.min(d,s1),x=a[0]+ux*t+nx*.05,y=a[1]+uy*t+ny*.05;
          ribbon.push(x,0,y,x+nx*1.4,0,y+ny*1.4);along.push(t,t);uvs.push(0,0,0,1);if(k)idx.push(base+2*k-2,base+2*k-1,base+2*k+1,base+2*k-2,base+2*k+1,base+2*k);}}
        for(let d=s0+3;d<s1-1;d+=6.5)box.push([a[0]+ux*d+nx*.14,top-.85,a[1]+uy*d+ny*.14,.32,1.5,.26,ang,.16,.13,.1]); /* timber fenders */
        run=null;};
      for(let d=0;d<L;d+=4){const x=a[0]+ux*(d+2)+nx*2,y=a[1]+uy*(d+2)+ny*2;
        const ok=near(x,y,460)&&!obstacles.some(q=>q!==o&&q.kind!=='boat'&&q.kind!=='isle'&&inside([x,y],q.p));
        if(ok){if(run)run[1]=Math.min(L,d+4);else run=[d,Math.min(L,d+4)];}else flush();}
      flush();}}
  if(box.length){const bm=new T3.InstancedMesh(new T3.BoxGeometry(1,1,1),new T3.MeshStandardMaterial({roughness:.92}),box.length),m=new T3.Matrix4(),r=new T3.Matrix4(),cc=new T3.Color();
    box.forEach((q,i)=>{m.makeRotationY(q[6]).multiply(r.makeScale(q[3],q[4],q[5]));m.setPosition(q[0],q[1],q[2]);bm.setMatrixAt(i,m);bm.setColorAt(i,cc.setRGB(q[7],q[8],q[9]));});lvG.add(bm);}
  if(ribbon.length){const g=new T3.BufferGeometry();g.setAttribute('position',new T3.Float32BufferAttribute(ribbon,3));g.setAttribute('aAlong',new T3.Float32BufferAttribute(along,1));g.setAttribute('uv',new T3.Float32BufferAttribute(uvs,2));g.setIndex(idx);
    const lap=new T3.Mesh(g,lapMat);lap.frustumCulled=false;lap.renderOrder=2;lvG.add(lap);}
}
function updateMooringLines(){
  if(!mooringLines)return;const arr=mooringLines.geometry.attributes.position.array;let o3=0;
  for(const o of obstacles){if(!o.lines)continue;o.mesh.updateMatrixWorld();
    for(const [lx,lz,b] of o.lines){v3a.set(lx,3.1+SHEER(lx),lz).applyMatrix4(o.mesh.matrixWorld);const top=(b.top||1.6)+.55;
      v3c.set((v3a.x+b.x)/2,Math.min(v3a.y,top)-.9,(v3a.z+b.y)/2);
      arr[o3++]=v3a.x;arr[o3++]=v3a.y;arr[o3++]=v3a.z;arr[o3++]=v3c.x;arr[o3++]=v3c.y;arr[o3++]=v3c.z;
      arr[o3++]=v3c.x;arr[o3++]=v3c.y;arr[o3++]=v3c.z;arr[o3++]=b.x;arr[o3++]=top;arr[o3++]=b.y;}}
  mooringLines.geometry.attributes.position.needsUpdate=true;
}
function build3D(){
  if(lvG)disposeTransientGroup(lvG);
  lvG=new T3.Group();scene3.add(lvG);
  let seed=7+lvI*13;const rand=()=>(seed=(seed*16807)%2147483647)/2147483647;
  const blocks=[];
  for(const o of obstacles){
    if(o.kind==='boat'){const moored=!o.tr;o.mesh=makeYacht(o.look,o.l);o.mesh.scale.set(o.l/50,o.l/50,o.b/9.4);o.mesh.rotation.order='YZX';lvG.add(o.mesh);
      if(moored){const c=Math.cos(o.psi),sn=Math.sin(o.psi),side=sd=>{const off=o.b/2+3,x=o.x-sn*sd*off,y=o.y+c*sd*off;return obstacles.some(q=>q.kind!=='boat'&&q.kind!=='isle'&&inside([x,y],q.p));};
        const sd=side(1)?1:side(-1)?-1:0;o.quay=sd;
        if(sd){
          /* bow and stern lines to the nearest bollards ahead of the bow and astern of the stern */
          const pick=(lx)=>{const tx=o.x+c*lx*o.l/50*1.35,ty=o.y+sn*lx*o.l/50*1.35;let best=null,bd=28;for(const q of bollards){const d=Math.hypot(q.x-tx,q.y-ty);if(d<bd){bd=d;best=q;}}return best;};
          o.lines=[[21,1.9*sd,pick(21)],[-24,3.9*sd,pick(-24)]].filter(l=>l[2]);}}
      continue;}
    if(o.kind==='isle'){ // sand shelving into the water, a grassy top
      const sg=new T3.CylinderGeometry(o.ir*.86,o.ir*1.12,3.4,32),gg=new T3.CylinderGeometry(o.ir*.55,o.ir*.7,.5,32);
      const sand=new T3.Mesh(sg,M('#d9c79c',.95));sand.position.set(o.ix,-.1,o.iy);lvG.add(sand);gg.dispose();
      lvG.add(makeIsleHill(o));continue;}
    const land=o.kind==='land',g=slabG(polyShape(o.p),land?1.6:1.2,land?-4:-.4);
    lvG.add(new T3.Mesh(g,land?M('#b3ad9c',.95):M('#8f7550',.9)));
    if(land){let x0=1e9,x1=-1e9,y0=1e9,y1=-1e9;for(const v of o.p){x0=Math.min(x0,v[0]);x1=Math.max(x1,v[0]);y0=Math.min(y0,v[1]);y1=Math.max(y1,v[1]);}
      for(let x=x0+30;x<x1-30;x+=27)for(let y=y0+30;y<y1-30;y+=25)if(allSlips.some(q=>Math.hypot(x-q.x,y-q.y)<420)&&rand()<.62&&blocks.length<220)blocks.push([x,y,13+rand()*9,11+rand()*8,5+rand()*11,rand()]);}
  }
  pirate=null;
  for(const q of buoys){const g=new T3.Group(),red=q.t==='red',grn=q.t==='green';
    if(q.t==='east'){const yel=M('#f2c230',.6),blk=M('#16181b',.6);
      const p1=new T3.Mesh(new T3.CylinderGeometry(.5,.6,1.2,10),blk);p1.position.y=.6;const p2=new T3.Mesh(new T3.CylinderGeometry(.5,.5,1.2,10),yel);p2.position.y=1.8;
      const p3=new T3.Mesh(new T3.CylinderGeometry(.42,.5,1,10),blk);p3.position.y=2.9;
      const c1=new T3.Mesh(new T3.ConeGeometry(.45,.6,10),blk);c1.position.y=3.9;c1.rotation.x=Math.PI;const c2=new T3.Mesh(new T3.ConeGeometry(.45,.6,10),blk);c2.position.y=4.55;
      g.add(p1,p2,p3,c1,c2);}
    else{const m=M(red?'#d23a2c':'#1f9a4a',.55),body=new T3.Mesh(new T3.CylinderGeometry(.55,.7,2.2,12),m);body.position.y=1.1;g.add(body);
      const top=red?new T3.Mesh(new T3.CylinderGeometry(.5,.5,.9,12),m):new T3.Mesh(new T3.ConeGeometry(.55,1.1,12),m);top.position.y=red?2.65:2.75;g.add(top);
      const lamp=new T3.Mesh(new T3.SphereGeometry(.14,8,6),new T3.MeshBasicMaterial({color:red?0xff4a3a:0x40ff80}));lamp.position.y=red?3.25:3.45;g.add(lamp);}
    g.position.set(q.x,0,q.y);lvG.add(g);q.m=g;}
  const isle=obstacles.find(o=>o.kind==='isle');
  if(isle){
    const trunkM=M('#8a6a45',.9),leafM=Object.assign(M('#3f7a3a',.8),{side:T3.DoubleSide}),nutM=M('#5a3f22',.8);
    const seg=new T3.CylinderGeometry(.22,.3,2.4,7),leaf=new T3.BoxGeometry(3.4,.06,.75).translate(1.7,0,0),nut=new T3.SphereGeometry(.28,8,6);
    /* a few palms on the beach facing the anchorage; the hill rises behind them */
    const spots=[[2.55,.3],[2.95,-.25],[3.4,.45],[3.8,-.1]].map(([ang,lean])=>[Math.cos(ang)*23,Math.sin(ang)*23,lean]);
    spots.forEach(([dx,dy,lean],n)=>{
      const pg=new T3.Group();pg.position.set(isle.ix+dx*isle.ir/30,1.9,isle.iy+dy*isle.ir/30);pg.rotation.y=n*1.3;
      let y=0,x=0;for(let k=0;k<4;k++){const m=new T3.Mesh(seg,trunkM);x+=lean*.45*k;m.position.set(x,y+1.2,0);m.rotation.z=-lean*(.25+k*.12);pg.add(m);y+=2.25;}
      for(let k=0;k<8;k++){const f=new T3.Mesh(leaf,leafM);f.position.set(x,y+.2,0);f.rotation.set(0,k/8*TAU+n,-.35-.2*(k%2));pg.add(f);}
      lvG.add(pg);});

  }
  if(blocks.length){const bm=new T3.InstancedMesh(new T3.BoxGeometry(1,1,1),buildingMat,blocks.length),m=new T3.Matrix4(),cc=new T3.Color();
    const PAL=[[.86,.84,.79],[.9,.87,.8],[.82,.76,.66],[.78,.62,.5],[.88,.86,.83],[.74,.72,.68]];
    blocks.forEach((b,i)=>{m.makeScale(b[2],b[4],b[3]);m.setPosition(b[0],1.6+b[4]/2,b[1]);bm.setMatrixAt(i,m);const p=PAL[Math.floor(b[5]*PAL.length*7)%PAL.length],v=.42+.18*b[5];bm.setColorAt(i,cc.setRGB(p[0]*v,p[1]*v,p[2]*v));});lvG.add(bm);}
  buildQuayDetail(rand);
  {const n=obstacles.reduce((k,o)=>k+(o.lines?o.lines.length:0),0);mooringLines=null;
   if(n){const g=new T3.BufferGeometry();g.setAttribute('position',new T3.Float32BufferAttribute(new Float32Array(n*2*3*3),3).setUsage(T3.DynamicDrawUsage));
     mooringLines=new T3.LineSegments(g,new T3.LineBasicMaterial({color:0xd8d0bc}));mooringLines.frustumCulled=false;lvG.add(mooringLines);}}
  if(bollards.length){const bm=new T3.InstancedMesh(new T3.CylinderGeometry(.24,.3,.7,8),M('#22282d',.5),bollards.length),m=new T3.Matrix4();
    bollards.forEach((q,i)=>{q.top=q.h<.5?1.2:1.6;m.makeTranslation(q.x,q.top+.35,q.y);bm.setMatrixAt(i,m);});lvG.add(bm);}
  shC.x=slip.x;shC.y=slip.y;buildSlipMarker();
}
function buildSlipMarker(){
  while(slipG.children.length){const ch=slipG.children[0];slipG.remove(ch);ch.geometry.dispose();}
  const L=slip.len/2,Wd=slip.wid/2;
  if(slip.circle){slipG.add(new T3.Mesh(new T3.CircleGeometry(L,64).rotateX(-Math.PI/2),slipFill));const pc=[];for(let k=0;k<64;k++){const a=k/64*TAU;pc.push(new T3.Vector3(Math.cos(a)*L,0,Math.sin(a)*L));}slipG.add(new T3.LineLoop(new T3.BufferGeometry().setFromPoints(pc),slipLine));slipG.position.set(slip.x,.9,slip.y);slipG.rotation.y=0;return;}
  slipG.add(new T3.Mesh(new T3.PlaneGeometry(slip.len,slip.wid).rotateX(-Math.PI/2),slipFill));
  const pts=[[-L,-Wd],[L,-Wd],[L,Wd],[-L,Wd]].map(v=>new T3.Vector3(v[0],0,v[1]));
  slipG.add(new T3.LineLoop(new T3.BufferGeometry().setFromPoints(pts),slipLine));
  if(!slip.either){const a=[];for(let i=0;i<2;i++){const x=L-6-i*5;a.push(new T3.Vector3(x-3.5,0,-3.2),new T3.Vector3(x,0,0),new T3.Vector3(x,0,0),new T3.Vector3(x-3.5,0,3.2));}
    slipG.add(new T3.LineSegments(new T3.BufferGeometry().setFromPoints(a),slipLine));}
  slipG.position.set(slip.x,.9,slip.y);slipG.rotation.y=-slip.h;
}
const newDyn=()=>({y:0,vy:0,rx:0,vrx:0,rz:0,vrz:0,pu:0,acc:0});
function pose(g,st,x,z,psi,l,b,roll,pitch,dt,gn){gn=gn||1;
  const cs=Math.cos(psi),sn=Math.sin(psi),hl=l*.4,hb=b*.45,k=Math.min(1,22/l)*.6+.3;
  const hf=waveH(x+cs*hl,z+sn*hl),ha=waveH(x-cs*hl,z-sn*hl),hp=waveH(x+sn*hb,z-cs*hb),hs=waveH(x-sn*hb,z+cs*hb);
  const ty=(waveH(x,z)*.4+(hf+ha+hp+hs)*.15)*k*Math.min(gn,1.5),trx=-Math.atan2(hs-hp,2*hb)*k*1.1*gn-roll,trz=Math.atan2(hf-ha,2*hl)*k*1.2*gn+pitch;
  // each boat has its own roll, pitch and heave period, so it lags the wave and overshoots
  const wr=TAU/(1.6*Math.sqrt(b)),wp=TAU/(.5*Math.sqrt(l)),wh=TAU/2.2;
  stepDampedSpring(st,'rx','vrx',trx,wr,.22,dt);
  stepDampedSpring(st,'rz','vrz',trz,wp,.35,dt);
  stepDampedSpring(st,'y','vy',ty,wh,.5,dt);
  g.position.set(x,st.y,z);g.rotation.set(st.rx,-psi,st.rz);
}
const ownDyn=newDyn();
const resetClearColor=new T3.Color();
function resetVisuals(){
  Object.assign(ownDyn,newDyn());ownDyn.pu=S.u;
  own.position.set(S.x,0,S.y);own.rotation.set(0,-S.psi,0);
  crew[0].position.set(S.bowX*SL,deckY+sheerAt(S.bowX*SL),S.bowY*SB);
  crew[1].position.set(-22.5*SL,deckY+sheerAt(-22.5*SL),-2.8*SB);
  crew[2].position.set(-22.5*SL,deckY+sheerAt(-22.5*SL),2.8*SB);
  crew.forEach(person=>{person.visible=shipId!=='tender';});own.updateMatrixWorld(true);
  for(const obstacle of obstacles)if(obstacle.kind==='boat')obstacle.dyn=newDyn();
  for(const puff of puffs){puff.life=0;puff.sp.visible=false;}
  for(const wake of U.uWake.value)wake.set(0,0,0,0);
  wkI=0;wkX=S.x;wkY=S.y;wkT=T;
  chainLinks.count=0;[...ropes,...leads,...whip,chainM,chainM2,hose].forEach(mesh=>{mesh.visible=false;});
  sGeo.instanceCount=0;stamps.visible=false;foamAccumulator=0;foamLife=0;fC.set(cam.x,cam.y);fPrev.copy(fC);
  U.uFoamC.value.set(fC.x,fC.y,FW);U.tFoam.value=rtA.texture;
  shC.x=slip.x;shC.y=slip.y;
  clearFoamField();
}
function clearFoamField(){
  // Clear both ping-pong targets so old wash cannot bleed into a restarted berth.
  if(renderer.getContext().isContextLost())return;
  const previousTarget=renderer.getRenderTarget(),previousAlpha=renderer.getClearAlpha();
  renderer.getClearColor(resetClearColor);
  try{
    renderer.setClearColor(0x000000,0);
    renderer.setRenderTarget(rtA);renderer.clear(true,false,false);
    renderer.setRenderTarget(rtB);renderer.clear(true,false,false);
  }finally{
    renderer.setClearColor(resetClearColor,previousAlpha);renderer.setRenderTarget(previousTarget);
  }
}
function resize(){
  AW=Math.max(1,app.clientWidth);AH=Math.max(60,app.clientHeight-topH);glc.style.top=topH+'px';glc.style.height=AH+'px';
  const pr=renderPixelRatio(AW,AH,devicePixelRatio||1,qual);
  if(bufferWidth!==AW||bufferHeight!==AH||bufferRatio!==pr){
    bufferWidth=AW;bufferHeight=AH;bufferRatio=pr;renderer.setPixelRatio(pr);renderer.setSize(AW,AH,false);
  }
  projectionDirty=true;
}
const v3a=new T3.Vector3(),v3b=new T3.Vector3(),v3c=new T3.Vector3(),v3d=new T3.Vector3(),m4=new T3.Matrix4(),cTmp=new T3.Color();
/* mission set pieces: a fuel truck, the yard's gantry and crew, and the owner's jet */
const fxG=new T3.Group();scene3.add(fxG);
const box=(w,h,d,hex,r)=>new T3.Mesh(new T3.BoxGeometry(w,h,d),M(hex,r||.6));
const truck=new T3.Group();{
  const cab=box(2.3,2.4,2.4,'#c8372d');cab.position.set(3.4,1.7,0);
  const tank=new T3.Mesh(new T3.CylinderGeometry(1.25,1.25,6.2,14).rotateZ(Math.PI/2),M('#c9d0d4',.3));tank.position.set(-.6,2,0);
  const bed=box(8.4,.4,2.3,'#22282d');bed.position.set(.2,.75,0);truck.add(cab,tank,bed);
  for(const x of [-3,-1.4,3.2])for(const z of [-1.1,1.1]){const w=new T3.Mesh(new T3.CylinderGeometry(.5,.5,.4,10).rotateX(Math.PI/2),M('#14181b',.8));w.position.set(x,.5,z);truck.add(w);}
  truck.position.set(-175,1.6,192);fxG.add(truck);}
const hose=mkRope();hose.material=new T3.MeshBasicMaterial({color:col(0x1b1f22)});
const crane=new T3.Group();{
  for(const z of [-11.5,11.5]){const leg=box(.9,17,.9,'#2f6fb0');leg.position.set(0,10.1,z);const foot=box(4,.6,1.4,'#244f7c');foot.position.set(0,1.9,z);crane.add(leg,foot);}
  const beam=box(1.4,1.2,25,'#2f6fb0');beam.position.set(0,18.6,0);const hoist=box(1.6,1,1.6,'#f0c23a');hoist.position.set(0,17.4,0);
  const wire=box(.12,5,.12,'#14181b');wire.position.set(0,14.6,0);crane.add(beam,hoist,wire);crane.position.set(214,0,0);fxG.add(crane);}
const yardCrew=[0,1,2].map(i=>{const f=makeFigure('#ffd23f');f.position.set(165+i*14,1.6,i%2?-10.2:10.2);fxG.add(f);return f;});
const jet=new T3.Group();{
  const wh='#f4f6f7',fus=new T3.Mesh(new T3.CylinderGeometry(.95,.95,11,14).rotateZ(Math.PI/2),M(wh,.35));
  const nose=new T3.Mesh(new T3.ConeGeometry(.95,3,14).rotateZ(-Math.PI/2),M(wh,.35));nose.position.x=7;
  const tailc=new T3.Mesh(new T3.ConeGeometry(.95,3.4,14).rotateZ(Math.PI/2),M(wh,.35));tailc.position.x=-7.2;
  const wing=box(2.6,.22,14.5,wh,.4);wing.position.set(-.6,-.5,0);
  const fin=box(2.4,2.8,.2,'#0f2a3a',.4);fin.position.set(-6.6,1.9,0);const stab=box(1.6,.16,5,wh,.4);stab.position.set(-7,3.2,0);
  const win=box(8,.34,1.94,'#0c1821',.15);win.position.set(.8,.35,0);
  jet.add(fus,nose,tailc,wing,fin,stab,win);
  for(const z of [-1.5,1.5]){const e=new T3.Mesh(new T3.CylinderGeometry(.42,.42,2.4,10).rotateZ(Math.PI/2),M('#aeb9c0',.3));e.position.set(-4.6,.7,z);jet.add(e);}
  for(const [x,z] of [[4.5,0],[-1,-1.6],[-1,1.6]]){const g=box(.25,1.1,.25,'#14181b');g.position.set(x,-1.4,z);jet.add(g);}
  jet.rotation.order='YZX';jet.visible=false;fxG.add(jet);}
const ownerF=makeFigure('#f7f3e8');ownerF.scale.setScalar(.85);ownerF.visible=false;fxG.add(ownerF);
function fxUpdate(dt){
  fxG.visible=!!stops;const party=!!stops&&(S.stage>=3||(S.done&&S.stage>=2));
  // party lights once the owner is aboard
  const pk=S.partyK==null?1:S.partyK;
  if(party&&pk>0){ownGlass.emissive.setHSL((T*.25)%1,.7,.45).multiplyScalar((.42+.12*Math.sin(T*4))*pk).lerp(col('#3d5470'),1-pk);discoL.color.setHSL((T*.25+.3)%1,.7,.5);discoL.intensity=(.35+.15*Math.sin(T*3))*pk*PARTY_LIGHT_SCALE;}
  else if(party){ownGlass.emissive.copy(col('#3d5470'));discoL.intensity=0;}
  else{ownGlass.emissive.copy(col('#1c2633'));discoL.intensity=0;}
  hose.visible=false;if(!stops)return;
  const svc=S.svc!=null;
  // fuel truck: comes along the quay to the stern, runs a hose aboard, leaves when she is full
  {const want=S.stage===0&&(S.inPos||svc),G=GEO,tx=want?clamp(S.x-Math.cos(S.psi)*25*SL,-150*G,95*G):-175*G,dx=tx-truck.position.x;
    truck.position.x+=clamp(dx,-11*dt,11*dt);truck.position.z=192*G;if(Math.abs(dx)>.3)truck.rotation.y=dx>0?0:Math.PI;
    if(S.stage===0&&svc&&Math.abs(dx)<1){hose.visible=true;v3a.set(truck.position.x-1,3.1,192.6*G);
      const qs=(-(truck.position.x-S.x)*Math.sin(S.psi)+(192*G-S.y)*Math.cos(S.psi))>0?1:-1; // which quarter faces the quay
      v3b.set(-24.4*SL,deckY+.5,qs*BEAM*.4).applyMatrix4(own.matrixWorld);
      v3c.addVectors(v3a,v3b).multiplyScalar(.5);v3c.y=Math.max(v3a.y,v3b.y)+1.7+.12*Math.sin(T*6);setTube(hose,v3a,v3c,v3b,.11);}}
  // shipyard: the gantry rolls out over her, the crew get busy and sparks fly
  {const G=GEO,work=S.stage===1&&svc,cx=work?clamp(S.x+12*Math.sin(T*.5),158*G,212*G):214*G;crane.scale.z=G;crane.position.x+=clamp(cx-crane.position.x,-4*dt,4*dt);
    yardCrew.forEach((f,i)=>{const z0=(i%2?-10.2:10.2)*G;f.position.x=(165+i*14)*G+(work?4*Math.sin(T*1.3+i*2):0);f.position.z=z0+(work?(i%2?1:-1)*(1.2+.8*Math.sin(T*2+i)):0);f.position.y=1.6+(work?Math.abs(Math.sin(T*6+i))*.12:0);});
    if(work&&Math.random()<dt*16){const sd=Math.random()<.5?-1:1;puff(S.x+rnd(-20,20)*SL,2+rnd(0,2.5),S.y+sd*BEAM*.55,true);}}
  // owner: the jet comes in along the north quay, he walks to the stern and steps aboard
  {const G=GEO,on=S.stage>=2&&(svc||S.done||S.stage>2),t=(S.done||S.stage>2)?99:(S.svc||0);jet.visible=on;ownerF.visible=on&&t>=8&&t<13.4;
    if(on){let x=20,alt=0,pitch=0;
      if(t<5){const q=t/5;x=560-410*q;alt=58*(1-q)*(1-q);pitch=.05+.07*(1-q);}else if(t<8){const q=(t-5)/3;x=150-130*(1-(1-q)*(1-q));}
      jet.position.set(x*G,3.55+alt,-186*G);jet.rotation.set(0,Math.PI,-pitch);
      if(ownerF.visible){const q=clamp((t-8.3)/4.8,0,1);ownerF.position.set((20-18*q)*G,1.6+Math.abs(Math.sin(T*9))*.08,(-186-15.4*q)*G);}}}
}
// night: the sun sets into a moonlit, glassy calm
const SUN0=SUN.clone(),MOON=new T3.Vector3(.42,.36,-.83).normalize(),FOG0=FOG.clone(),FOGN=new T3.Color(.03,.045,.075);
let nightEnv0=null;
function applyNight(n){
  const e=n*n*(3-2*n);U.uNight.value=e;chainLinks.material.emissive.setScalar(.95*e);
  SUN.copy(SUN0).lerp(MOON,e).normalize();sunL.position.copy(SUN).multiplyScalar(100);
  sunL.intensity=(.85-.55*e)*LIGHT_SCALE;sunL.color.setRGB(1-.25*e,.94-.12*e,.86+.14*e);
  hemiL.intensity=(.62-.46*e)*LIGHT_SCALE;hemiL.color.setRGB(.72-.4*e,.77-.37*e,.79-.21*e);
  FOG.copy(FOG0).lerp(FOGN,e);scene3.fog.color.copy(FOG);
  if(nightEnv0){env.wk=nightEnv0.wk*(1-e);env.sh=nightEnv0.sh*(1-e);}
}
function startNight(){if(S.nightOn)return;S.nightOn=true;S.night=S.night||0;nightEnv0={wk:env.wk,sh:env.sh};}
// safety net: if a bad number ever gets into the physics, put her back where she last was rather than lose the picture
let physGood=null,physWarned=false;
function physGuard(){
  const ok=isFinite(S.x+S.y+S.u+S.v+S.r+S.psi+S.roll);
  if(ok){physGood={x:S.x,y:S.y,psi:S.psi};return;}
  if(!physWarned){physWarned=true;try{console.warn('Stern-To physics recovered',JSON.stringify({lines:lines.map(l=>[l.state,l.L0,l.tl,l.strain]),anchors:S.anchors,fend:[S.fend,S.fendN,S.fStress],rpm:S.rpm,thr:S.thrAct,rud:S.rud}));}catch(e){}}
  const g=physGood||{x:LV.start[0]*GEO,y:LV.start[1]*GEO,psi:LV.start[2]*D2R};
  S.x=g.x;S.y=g.y;S.psi=g.psi;S.u=S.v=S.r=0;S.roll=0;S.thrAct=0;S.rpm=S.rpm.map(v=>isFinite(v)?v:0);
  for(const l of lines){if(!isFinite(l.L0))l.L0=10;if(!isFinite(l.ten))l.ten=0;if(!isFinite(l.tl))l.tl=0;if(!isFinite(l.strain))l.strain=0;}
  S.anchors=S.anchors.filter(a=>isFinite(a.x+a.y+a.L0));
  toast('Steadied · something jumped in the physics',1600);
}
const hullHW=xm=>{const x=xm/SL,P=[[25,0],[19,2.9],[10,4.5],[-5,4.7],[-25,4.3]];if(x>=25)return 0;if(x<=-25)return 4.3*SB;
  for(let i=0;i<P.length-1;i++)if(x<=P[i][0]&&x>=P[i+1][0]){const t=(P[i][0]-x)/(P[i][0]-P[i+1][0]);return (P[i][1]+(P[i+1][1]-P[i][1])*t)*SB;}return 4.5*SB;};
// a point just outboard of the hull at a fairlead: lines and chain start here, so they never cut through the ship
const fairPt=(xm,sd,lift)=>v3a.set(xm,(shipId==='tender'?deckY-.25:deckY-.46*SL)+sheerAt(xm)+(lift||0),sd*(HULL_SIDE(xm/SL)*SB+.14)).applyMatrix4(own.matrixWorld);
// Weather and mission clocks advance with the simulation, including during frame catch-up.
function advanceMissionEnvironment(dt){
  if(stops&&stops[S.stage].anchor&&!S.nightOn&&state==='play'){
    const d=Math.hypot(slip.x-S.x,slip.y-S.y);if(!S.leg0)S.leg0={d:Math.max(d,80),wk:env.wk,sh:env.sh};
    const f=clamp(1-d/S.leg0.d,0,1),ss=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);},up=ss(0,.3,f),down=ss(.55,1,f);
    const storm=up*(1-down);
    if(!S.kingDone&&f>.38&&f<.62&&storm>.6){S.kingDone=true;const sw=swellTo();KW.d=[sw[0],sw[1]];KW.A=3.6*SL**.25;KW.pos=S.x*KW.d[0]+S.y*KW.d[1]-260;KW.on=true;S.kingSaid=0;toast('A big set is building on the horizon',3000);}env.sh=S.leg0.sh*((1+5.5*up)*(1-down)+.08*down);env.wk=S.leg0.wk*((1+1.9*up)*(1-down))+6*down;
    if(storm>.7&&!S.stormSaid){S.stormSaid=true;toast('Weather building · hold her steady',2600);}
    S.night=.85*ss(.3,1,f);applyNight(S.night);S.uw=ss(.6,1,f);S.partyK=1-ss(.3,.65,f);S.legF=f;
  }
  if(S.nightOn&&S.night<1){S.night=Math.min(1,S.night+dt/6);applyNight(S.night);}
  if(S.nightOn){S.uw=Math.min(1,(S.uw||0)+dt/3);S.partyK=Math.max(0,(S.partyK==null?1:S.partyK)-dt/3);}
  if(S.cineT!=null){
    if(!S.cineView){
      S.cineView={pitch,zoomMul,rotv,topDown,chase,x:camOff.x,y:camOff.y};
      if(!reduceMotion){topDown=false;chase=false;}
      releaseControls();S.lever=[0,0];refreshModalState();
      toast('Anchorage secured · mission complete',4500);
    }
    S.cineT+=dt;
    if(S.cineT>=(reduceMotion?0:4.5)&&!S.cineDone){S.cineDone=true;finish('mission');refreshModalState();}
  }
  if(S.nightOn&&S.night>=1)S.calmT=(S.calmT||0)+dt;
  const blend=1-Math.exp(-dt*.3);shC.x+=(slip.x-shC.x)*blend;shC.y+=(slip.y-shC.y)*blend;U.uSlip.value.set(shC.x,shC.y,GEO);
}
/* a single gull wheels wide over the harbour by day: one instanced draw, wings flap and glide */
const GULLS=1,gullGeo=new T3.BufferGeometry();gullGeo.setAttribute('position',new T3.Float32BufferAttribute([0,0,.1, -.15,.02,-.15, 0,0,-.05, 0,0,.1, 0,0,-.05, .15,.02,-.15, -.15,.02,-.15, -.85,.18,-.05, -.05,0,-.02, .15,.02,-.15, .05,0,-.02, .85,.18,-.05],3));gullGeo.computeVertexNormals();
const gulls=new T3.InstancedMesh(gullGeo,new T3.MeshBasicMaterial({color:0xe9eef0,side:T3.DoubleSide}),GULLS);gulls.frustumCulled=false;scene3.add(gulls);
const gullState=Array.from({length:GULLS},(_,i)=>({a:i*2.7+.8,r:70+i*40,h:22+i*6,w:.07,ph:i*2.1})),_gm=new T3.Matrix4(),_gr=new T3.Matrix4(),_gs=new T3.Vector3(),_gp=new T3.Vector3();
function updateGulls(dt){
  const show=(S?.night||0)<.35&&env.sh<1.1;gulls.visible=show;if(!show)return;
  const cx=cam.x,cy=cam.y;
  gullState.forEach((g,i)=>{g.a+=g.w*dt*(i%2?-1:1);const flap=Math.max(0,Math.sin(T*1.7+g.ph))>.2?Math.sin(T*9+g.ph):0;
    _gp.set(cx+Math.cos(g.a)*g.r,g.h+Math.sin(T*.4+g.ph)*1.5,cy+Math.sin(g.a)*g.r);
    _gs.set(1.6,1+.9*flap,1.6);_gm.makeRotationY((i%2?Math.PI:0)-g.a).multiply(_gr.makeRotationZ(Math.sin(T*.7+g.ph)*.25)).scale(_gs).setPosition(_gp);gulls.setMatrixAt(i,_gm);});
  gulls.instanceMatrix.needsUpdate=true;
}
function updateBowWave(dt){
  /* Built in world space on the real water surface, so the curl rides the waves instead of the hull. Its foam streams
     aft at exactly the speed the water passes the hull. How deep the bow digs into a sea drives a surge and a burst of
     spray that then fades. */
  const spd=S.u,fl=S.foil||0,sc=clamp(Math.sqrt(SL)*1.1,.45,1.35),k=state==='play'||state==='menu'?clamp((spd-.8)/3,0,1)*(1-fl):0;
  own.updateMatrixWorld();
  v3a.set(LEN/2-.8*SL,0,0).applyMatrix4(own.matrixWorld);
  const dive=Math.max(0,waveH(v3a.x,v3a.z)-v3a.y-.08)*(1-fl),rising=dive-(S.bowDive||0);S.bowDive=dive;
  if(state==="play"&&!hold&&dive>.15*Math.sqrt(SL)&&rising>0&&spd>1.5&&T-(S.sprayT||0)>.45){ /* the bow buries: throw spray in proportion to the depth */
    const sw=windTo(),wl=-sw[0]*Math.sin(S.psi)+sw[1]*Math.cos(S.psi);S.sprayT=T;
    S.sprayQ={t:0,k:clamp(dive*1.6/Math.sqrt(SL),.25,1.6)*clamp(spd/5,.5,1.3),bias:clamp(-wl*.5,-1,1),dur:rnd(.25,.45),peak:clamp(dive*1.4,.5,1.3)};}
  S.bowSurge=Math.max((S.bowSurge||0)-dt*2.4,Math.min(1.6,dive*2.4/Math.sqrt(SL)));
  bowWaveMat.opacity=.9*k;bowWave.forEach(m=>{m.visible=k>.01;});if(k<=.01)return;
  const texLen=7*sc;bowWaveTex.offset.x-=spd*dt/texLen;
  const h0=Math.min(1.8,.024*spd*spd)*sc*(1+S.bowSurge*.75),Lw=LEN*(.12+.22*clamp(spd/8,0,1));
  const c=Math.cos(RP),sn=Math.sin(RP),ox=own.position.x,oz=own.position.z;
  for(const m of bowWave){const sd=m.userData.sd,pa=m.geometry.attributes.position,arr=pa.array,ua=m.geometry.attributes.uv.array;
    /* the side moving into the water, and the outside of a turn, push up a bigger wave */
    const side=clamp(1+sd*(S.v*.7+S.r*LEN*.25)/Math.max(spd,1),.45,1.6),h=h0*side;
    for(let i=0;i<BW_N;i++){const t=i/(BW_N-1),x=LEN/2-.5*SL-t*Lw;
      const hp=h*(t<.28?Math.sin(t/.28*Math.PI/2):Math.pow(Math.cos((t-.28)/.72*Math.PI/2),1.3));
      const zb=sd*(HULL_SIDE(x/SL)*SB+.06),spread=sd*t*Lw*.16,wx=ox+x*c-zb*sn,wz=oz+x*sn+zb*c,wy=waveH(wx,wz);
      const rows=[[0,0,-.25],[0,sd*.1*hp+spread*.4,.42*hp],[.08*hp,sd*.42*hp+spread*.8,hp],[-.25*hp,sd*hp+spread,.62*hp]];
      for(let r=0;r<4;r++){const o=(i*4+r)*3,dx=x+rows[r][0],dz=zb+rows[r][1];
        arr[o]=ox+dx*c-dz*sn;arr[o+1]=wy+rows[r][2];arr[o+2]=oz+dx*sn+dz*c;ua[(i*4+r)*2]=t*Lw/texLen;}}
    pa.needsUpdate=true;m.geometry.attributes.uv.needsUpdate=true;
    /* a little mist and a few droplets come off the curling lip, more in a breeze or when she buries her bow */
    if(spd>3&&Math.random()<dt*(spd-3)*(.8+S.bowSurge*3)*sc){const i=2+Math.floor(Math.random()*5),o=(i*4+3)*3;
      const q=puff(arr[o],arr[o+1],arr[o+2],false);
      if(q){const c0=Math.cos(S.psi),s0=Math.sin(S.psi),out=rnd(.6,1.6)*(1+S.bowSurge*.6);
        q.spray=true;q.mist=true;q.dr=rnd(1.3,2.1);q.g=2.2;q.streak=false;q.sp.material.color.setHex(0xf1f6f7);
        q.life=q.max=rnd(1,1.7);q.s=rnd(.28,.6)*sc*(1+S.bowSurge*.35);
        q.vx=S.u*c0*.75-s0*sd*out;q.vz=S.u*s0*.75+c0*sd*out;q.vy=rnd(.6,1.8)*(1+S.bowSurge*.6);}}}
  const nv=U.uNight.value;bowWaveMat.color.setRGB(1-.62*nv,1-.6*nv,1-.55*nv);
}
function sync3D(dt){
  if(pirate){pirate.arm.rotation.z=-.4+Math.sin(T*6)*.9;pirate.arm.rotation.x=Math.sin(T*3)*.3;pirate.g.position.y=1.9+Math.abs(Math.sin(T*3))*.25;}
  // The camera and lights follow the fixed-step mission state.
  if(S.cineT!=null&&S.cineView&&!reduceMotion){
    const blend=1-Math.exp(-dt*.7);
    pitch+=(.24-pitch)*blend;zoomMul+=(.65-zoomMul)*blend;
    camOff.x+=((slip.x-S.x)*.25-camOff.x)*blend;camOff.y+=((slip.y-S.y)*.25-camOff.y)*blend;
    rotv+=dt*(S.cineT<4.5?.1:.035);
  }
  {const q=S.cineT==null?0:clamp((S.cineT-1.2)/2.2,0,1);anchMast.scale.y=Math.max(.001,q);anchMast.visible=q>0;anchLamp.visible=q>=1;}
  {const nv=U.uNight.value;navGlow.forEach(g=>{g.material.opacity=nv*.55;g.visible=nv>.02;});}
  U.uUW.value=S.uw||0;
  U.uT.value=T;setWaves();updateWakeBounds();U.uKing.value.set(KW.d[0],KW.d[1],KW.pos,KW.on?KW.A:0);U.uSlip.value.set(shC.x,shC.y,GEO);
  // heel in the turn, trim with the throttle, and a lurch when she hits something
  ownDyn.acc+=((S.u-ownDyn.pu)/Math.max(dt,.001)-ownDyn.acc)*(1-Math.exp(-dt*3));ownDyn.pu=S.u;
  if(S.kick){ownDyn.vrx+=(Math.random()<.5?-1:1)*Math.min(.25,S.kick*.12);ownDyn.vrz-=.04*Math.min(2,S.kick);S.kick=0;}
  /* Displacement yachts heel outward in a turn (centripetal load below a high centre of gravity) and trim a little
     by the stern as they approach hull speed. The planing tender banks into its turns, and lifts its bow over the
     hump before settling flatter once it is on the plane. */
  const fr=Math.max(0,S.u)/Math.sqrt(9.81*LEN),ac=S.u*S.r,ss=(a,b,x)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);};
  const fl=S.foil||0; /* flying, the tender throws itself into banked turns */
  const heel=shipId==='tender'?-clamp(ac*(.05+.06*fl),-(.14+.3*fl),.14+.3*fl):clamp(ac*.055,-.07,.07);
  const trim=clamp(ownDyn.acc*.03,-.04,.04)+(shipId==='tender'?.09*ss(.2,.5,fr)*(1-.55*ss(.55,1,fr))*(1-fl)+.38*fl*(1-fl)+.02*fl:.012*ss(.12,.4,fr));
  if(!isFinite(ownDyn.y+ownDyn.rx+ownDyn.rz+ownDyn.acc))Object.assign(ownDyn,newDyn());
  pose(own,ownDyn,RX,RY,RP,LEN,BEAM,S.roll*.6+heel-(S.listV||0),trim,dt,1-.75*fl);stepDampedSpring(S,'foilH','foilVH',(S.rideH||0)-Math.abs(heel)*1.1*fl,6.5,.38,dt);own.position.y+=S.foilH; /* she leaps up with a bounce, flies high and sinks on the inside of a hard turn */
  updateBowWave(dt);
  if(ownModel&&ownModel.userData.radar)ownModel.userData.radar.rotation.y+=dt*2.6;
  updateGulls(dt);
  for(const o of obstacles)if(o.kind==='boat'&&o.mesh.userData.radar)o.mesh.userData.radar.rotation.y+=dt*2.2;
  for(const q of buoys)if(q.m){const water=waveSampleAt(q.x,q.y);q.m.position.y=water.height-.2;q.m.rotation.x=clamp(-Math.atan(water.slopeZ),-.25,.25);q.m.rotation.z=clamp(Math.atan(water.slopeX),-.25,.25);}
  for(const o of obstacles)if(o.kind==='boat'){o.dyn=o.dyn||newDyn();
    // moored boats surge on their lines with each swell, and roll and pitch more freely than a boat under way
    const moving=o.tr&&o.tr.st==='go',w0=WV[0],sg=moving?0:w0.amp*shelter(o.x,o.y)*1.6*Math.sin(w0.k*(w0.dx*o.x+w0.dz*o.y)-w0.om*T-.8);
    pose(o.mesh,o.dyn,o.x+w0.dx*sg,o.y+w0.dz*sg,o.psi,o.l,o.b,0,0,dt,moving?1:2.4);}
  updateMooringLines();
  U.uShip.value.set(S.x,S.y,Math.cos(S.psi),Math.sin(S.psi));{const fl=S.foil||0;U.uSlop.value=Math.min(.22,Math.abs(ownDyn.vy)*.45+Math.abs(ownDyn.vrx)*1.4)*(1-fl);U.uHull.value.set(LEN/2,BEAM/2,S.u*(1-.8*fl),S.v*(1-.8*fl));U.uProp.value.set((S.rpm[0]+S.rpm[1])/2*(1-.6*fl),S.thrAct);}
  // foam thrown off the bow as it drops into a wave
  if(state==='play'&&(S.foil||0)<.5&&ownDyn.vrz<-.02&&Math.hypot(S.u,S.v)>1&&Math.random()<dt*40){const c0=Math.cos(S.psi),s0=Math.sin(S.psi),sd=Math.random()<.5?-1:1;
    spawn(1,S.x+c0*LEN*.46-s0*sd*1.5,S.y+s0*LEN*.46+c0*sd*1.5,S.u*c0*.4-s0*sd*rnd(1,2.5),S.u*s0*.4+c0*sd*rnd(1,2.5),rnd(.6,1.1)*Math.max(.5,Math.sqrt(SL)),rnd(1.5,3),.5);}
  crew[0].position.set(S.bowX*SL,deckY+sheerAt(S.bowX*SL),S.bowY*SB);crew[1].position.y=deckY+sheerAt(crew[1].position.x);crew[2].position.y=deckY+sheerAt(crew[2].position.x);
  {const tender=shipId==='tender';
    for(let i=0;i<(tender?1:2);i++){const m=anchorModels[i],sd=tender?0:i?1:-1,st=anchorHawse[i].position,A=S.anchors.find(a=>a.side===sd),seatY=st.y-ANCHOR_EYE_Y*m.scale.y;let ay=seatY,av=true;
      if(A){A.t+=dt;const q=Math.min(1,A.t/.9);ay=seatY-q*q*(seatY+3);av=q<1;}
      else if(S.weigh[sd]>0){S.weigh[sd]-=dt/1.2;ay=seatY-Math.max(0,S.weigh[sd])*(seatY+3);
        if(ay>-.3&&ay<seatY-.4&&Math.random()<dt*30){v3a.set(st.x,ay,st.z).applyMatrix4(own.matrixWorld);const q=puff(v3a.x,v3a.y,v3a.z,false);if(q){q.spray=true;q.sp.material.color.setHex(0xdfe8ec);q.life=q.max=rnd(.5,.9);q.s=rnd(.25,.45);q.vx=rnd(-.3,.3);q.vz=rnd(-.3,.3);q.vy=rnd(-.5,.3);}}}
      m.visible=av;m.position.set(st.x,ay,st.z);m.rotation.set(0,sd*HAWSE.yaw,0);}}
  hands.forEach((h,i)=>{if(handF[i]){handF[i].visible=true;handF[i].position.set(h.x+.9,h.h<.5?1.2:1.6,h.y);}});
  for(let i=hands.length;i<2;i++)handF[i].visible=false;
  own.updateMatrixWorld();fxUpdate(dt);
  // fenders squash on contact, glow red as they are overloaded, and a burst one flies off
  fenderG.children.forEach((m,i)=>{const sd=i&1,out=(i>>1)+1<=S.fendN[sd]+.001,pt=S.fPop[i],b=m.userData.b;
    if(pt>0){S.fPop[i]=pt+dt;m.visible=out&&pt<1.3;m.material=fendRed;m.position.set(b.x,b.y+11*pt-12*pt*pt,b.z+(sd?1:-1)*7*pt);m.rotation.set(pt*14,0,pt*9);m.scale.setScalar(Math.max(.2,1-pt*.6));}
    else{const q=S.fSq[sd];m.visible=out;m.material=fendMat[sd];m.position.copy(b);m.rotation.set(0,0,0);m.scale.set(1+q*.35,1,1-q*.5);}});
  for(let i=0;i<2;i++){const k=clamp((S.fStress[i]-.9)/1.1,0,1);fendMat[i].color.setRGB(.014+.9*k,.02,.024);fendMat[i].emissive.setRGB(.5*k*(.6+.4*Math.sin(T*18)),0,0);}
  let nLinks=0;chainM.visible=chainM2.visible=false;
  for(let i=0,tnd=shipId==='tender';i<(tnd?1:2);i++){const sd=tnd?0:i?1:-1,A=S.anchors.find(a=>a.side===sd),movingEye=A?A.t<.95:S.weigh[sd]>0;if(!A&&!movingEye)continue;
    const hp=anchorHawse[i].position;anchorHawse[i].getWorldPosition(v3a);
    // Both ends inherit their real object transforms, including hull scale, heel and pitch.
    if(movingEye)anchorEyes[i].getWorldPosition(v3b);
    let taut=1;
    if(!movingEye){
      /* The chain leaves the hawse at the angle a hanging chain would take: straight up and down while the
         anchor is under the bow, opening out progressively as she falls back, and pulling straight when tight. */
      const dh=Math.hypot(A.x-v3a.x,A.y-v3a.z),depth=7*Math.sqrt(Math.max(.25,SL)),rise=Math.max(.5,v3a.y)+depth;
      const slack=Math.max(0,A.L0-Math.hypot(dh,rise));taut=clamp(1-slack/(rise*.8+2),0,1);
      const tanA=dh/rise*Math.pow(taut,1.3),drop=Math.max(.5,v3a.y+2.5);
      v3d.set(A.x,v3a.y,A.y);own.worldToLocal(v3d);let lx=v3d.x-hp.x,lz=v3d.z-hp.z;const ll=Math.hypot(lx,lz);
      const out=Math.min(drop*tanA,dh);lx=ll>1e-4?lx/ll*out:0;lz=ll>1e-4?lz/ll*out:0;
      if(!tnd){ /* hang just clear of the hull side: when the chain leads aft, where the hull widens, push it out far enough to clear it */
        const hz0=Math.abs(hp.z),clr=x=>HULL_SIDE(clamp(x/SL,-25,25))*SB+.3-hz0,xe=hp.x+lx,xm=hp.x+lx*.5;
        const need=Math.max(.35,clr(xe),2*clr(xm),clr(hp.x+lx*.25)*4);if(lz*sd<need)lz=sd*need;}
      v3b.set(hp.x+lx,hp.y-drop,hp.z+lz);own.localToWorld(v3b);v3b.y=-2.5;
    }
    const span=v3a.distanceTo(v3b);if(span<1e-5)continue;
    /* slack chain drops from the hawse before curving away; tight chain runs straight */
    v3c.addVectors(v3a,v3b).multiplyScalar(.5);if(!movingEye){v3c.x+=(v3a.x-v3c.x)*(1-taut)*.6;v3c.z+=(v3a.z-v3c.z)*(1-taut)*.6;}
    /* links ride on the chain itself: as chain pays out or heaves in they slide out of / back into the pocket, and the paint marks travel with them */
    const Lc=v3a.distanceTo(v3c)+v3c.distanceTo(v3b),ls=tnd?.5:1,P=.2*ls;
    const V=movingEye?Lc:Math.max(A.L0,Lc),limit=Math.min(LINK_MAX,nLinks+LINK_MAX/(tnd?1:2)); /* keep a link budget for each hawse */
    // Draw from the pocket downward, so a full pool can only shorten the submerged tail.
    for(let j=Math.ceil(V/P),j0=Math.max(0,Math.ceil((V-Lc)/P));j>=j0&&nLinks<limit;j--){
      const c=j*P,t=clamp((V-c)/Lc,0,1),u=1-t;
      _q.set(u*u*v3a.x+2*u*t*v3c.x+t*t*v3b.x,u*u*v3a.y+2*u*t*v3c.y+t*t*v3b.y,u*u*v3a.z+2*u*t*v3c.z+t*t*v3b.z);
      _t.set(2*u*(v3c.x-v3a.x)+2*t*(v3b.x-v3c.x),2*u*(v3c.y-v3a.y)+2*t*(v3b.y-v3c.y),2*u*(v3c.z-v3a.z)+2*t*(v3b.z-v3c.z)).normalize();
      if(c>V)_q.addScaledVector(_t,V-c); // the next link slides inside the pocket; the visible run never floats clear of it
      _n.crossVectors(_t,_up);if(_n.lengthSq()<1e-6)_n.set(1,0,0);_n.normalize();_b.crossVectors(_t,_n);
      if(j%2)_lm.makeBasis(_t,_b,_n.negate());else _lm.makeBasis(_t,_n,_b);_lm.scale(v3d.set(ls,ls,ls));_lm.setPosition(_q);
      chainLinks.setMatrixAt(nLinks,_lm);const kk=Math.floor(c/10),m=c-kk*10;
      chainLinks.setColorAt(nLinks,kk>=1&&m<2?markC[(kk-1)%5]:(j%2?chainC:chainL));nLinks++;}
  }
  chainLinks.count=nLinks;uploadActive(chainLinks.instanceMatrix,nLinks);if(chainLinks.instanceColor)uploadActive(chainLinks.instanceColor,nLinks);
  lines.forEach((ln,i)=>{
    const r=ropes[i],ld=leads[i],st=ln.state;r.visible=st==='haul'||st==='fast';ld.visible=st==='throw'||st==='haul';
    if(!r.visible&&!ld.visible)return;
    {const lat=-(ln.bol.x-S.x)*Math.sin(S.psi)+(ln.bol.y-S.y)*Math.cos(S.psi);fairPt(ln.a,lat>=0?1:-1);}v3b.set(ln.bol.x,(ln.bol.top||1.6)+.5,ln.bol.y);
    if(st==='throw'){
      if(!ln.good){const d=ln.dist||1;v3b.set(ln.fx+(ln.bol.x-ln.fx)/d*ln.reach,.2,ln.fy+(ln.bol.y-ln.fy)/d*ln.reach);}
      const t=Math.min(1,ln.t),arc=Math.sin(Math.PI*t)*5;v3b.lerpVectors(v3a,v3b,t);v3b.y+=arc*.4;v3c.addVectors(v3a,v3b).multiplyScalar(.5);v3c.y+=arc;
      setTube(ld,v3a,v3c,v3b,.03);
    }else if(st==='haul'){
      v3c.addVectors(v3a,v3b).multiplyScalar(.5);v3c.y=Math.max(.2,v3c.y-1.2);setTube(ld,v3a,v3c,v3b,.03);
      const t=Math.max(.03,ln.prog),u1=1-t;v3d.copy(v3a).multiplyScalar(u1*u1).addScaledVector(v3c,2*u1*t).addScaledVector(v3b,t*t);
      v3c.lerpVectors(v3a,v3c,t);setTube(r,v3a,v3c,v3d,.07);r.material=ropeM;
    }else{
      const d=Math.hypot(ln.bol.x-ln.fx,ln.bol.y-ln.fy);v3c.addVectors(v3a,v3b).multiplyScalar(.5);v3c.y=Math.max(.2,v3c.y-Math.min(3,Math.sqrt(Math.max(0,ln.L0-d)*d)*.35));
      const sx=ln.strain||0;v3c.y+=Math.sin(T*70)*sx*.3;setTube(r,v3a,v3c,v3b,.07+Math.min(.12,sx*.09));r.material=sx>.35?ropeRed:ln.ten>50e3*LK?ropeHot:ropeM;
    }
  });
  // a parted line whips back from both ends
  if(S.snap){const sn=S.snap;sn.t+=dt;const q=sn.t/1.1;whip[0].visible=whip[1].visible=q<1;
    if(q<1){const e=1-q,w=Math.sin(sn.t*16)*7*e,mx=(sn.ax+sn.bx)/2,mz=(sn.ay+sn.by)/2;
      v3a.set(sn.a,deckY+.15,sn.b).applyMatrix4(own.matrixWorld);
      v3b.set(v3a.x+(mx-v3a.x)*e+w*.5,v3a.y+2+6*e*Math.abs(Math.sin(sn.t*11)),v3a.z+(mz-v3a.z)*e-w*.5);v3c.set((v3a.x+v3b.x)/2-w,v3a.y+5*e,(v3a.z+v3b.z)/2+w);setTube(whip[0],v3a,v3c,v3b,.13);
      v3a.set(sn.bx,sn.top+.5,sn.by);v3b.set(sn.bx+(mx-sn.bx)*e-w*.5,sn.top+1+6*e*Math.abs(Math.cos(sn.t*11)),sn.by+(mz-sn.by)*e+w*.5);v3c.set((v3a.x+v3b.x)/2+w,sn.top+5*e,(v3a.z+v3b.z)/2-w);setTube(whip[1],v3a,v3c,v3b,.13);}
    else S.snap=null;}
  else whip[0].visible=whip[1].visible=false;
  slipG.visible=!(stops&&S.done);
  const hex=S.inPos?0x3ddc84:0xffb547;slipFill.color.setHex(hex);slipLine.color.setHex(hex);slipFill.opacity=S.inPos?.16+.25*S.hold/3:.13;
  foamPass(dt);
}

/* ---------- readouts ---------- */
const PTS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
const pt=d=>PTS[Math.round(d/22.5)%16];
const lat=v=>Math.abs(v)<.05?'0.0':(v<0?'◀\uFE0E ':'')+Math.abs(v).toFixed(1)+(v>0?' ▶\uFE0E':'');
const lv=[$('lvP'),$('lvS')],LV_TRACK=lv.map(e=>e.querySelector('.track')),LV_K=lv.map(e=>e.querySelector('.knob')),LV_R=lv.map(e=>e.querySelector('.rpm')),LV_V=lv.map(e=>e.querySelector('.val')),FEND_BTNS=[...document.querySelectorAll('[data-fender]')],ANCH_BTNS=[...document.querySelectorAll('[data-anchor]')],ACT_METER=$('actBox').querySelector('.meter'),RUD_G=document.querySelector('.dock .rudrow svg'),lnBtns=[...document.querySelectorAll('.ln')],hullMeter=document.querySelector('.dmg');
let hudKey='';
function hudFast(){
  const key=S.lever[0]+'|'+S.lever[1]+'|'+S.rpm[0].toFixed(3)+'|'+S.rpm[1].toFixed(3)+'|'+S.thr+'|'+S.rud+'|'+sync;if(key===hudKey)return;hudKey=key;
  for(let i=0;i<2;i++){
    const l=S.lever[i],n=S.rpm[i],el=lv[i];
    LV_K[i].style.top=(1-l)*50+'%';el.classList.toggle('neutral',l===0);
    const r=LV_R[i];r.style.height=Math.abs(n)*50+'%';r.style.top=n>=0?(50-Math.abs(n)*50)+'%':'50%';
    LV_V[i].textContent=l===0?'STOP':(l>0?'AHD ':'AST ')+Math.round(Math.abs(l)*100);
    LV_TRACK[i].setAttribute('aria-valuenow',Math.round(l*100));
    LV_TRACK[i].setAttribute('aria-valuetext',l===0?'Neutral':(l>0?'Ahead ':'Astern ')+Math.round(Math.abs(l)*100)+' percent');
  }
  $('thL').classList.toggle('on',S.thr<0);$('thR').classList.toggle('on',S.thr>0);
  $('rudG').style.transform='rotate('+S.rud+'deg)';
  $('syncBtn').classList.toggle('on',sync);$('syncBtn').setAttribute('aria-pressed',String(sync));
  $('rud').setAttribute('aria-valuetext',S.rud===0?'Midships':Math.round(Math.abs(S.rud))+' degrees '+(S.rud<0?'port':'starboard'));
  {const ri=$('rud'),md=Math.round(S.rud)===0,g=RUD_G;ri.classList.toggle('mid',md);ri.parentElement.classList.toggle('mid',md);
   const t=(+ri.value+35)/70,a=Math.min(t,.5),b=Math.max(t,.5),pc=x=>'calc(17px + (100% - 34px) * '+x+')';
   if(g)g.style.left=pc(t);ri.style.setProperty('--fa',pc(a));ri.style.setProperty('--fb',pc(b));}
}
function updateAnchorageGoal(){
  const box=$('anchorGoal'),show=state==='play'&&stops&&stops[S.stage].anchor&&!S.done;
  box.hidden=!show;if(!show)return;
  const goal=anchorageStatus(),paid=Math.floor(Math.max(0,goal.current)*10+1e-8)/10;
  const setText=(id,text)=>{const el=$(id);if(el.textContent!==text)el.textContent=text;};
  setText('anchorNeed',String(goal.target));setText('anchorHint',goal.status);
  const progress=$('anchorProgress');progress.setAttribute('aria-valuemax',goal.target);progress.setAttribute('aria-valuenow',Math.min(goal.target,paid));
  progress.firstElementChild.style.width=Math.min(100,100*goal.current/goal.target)+'%';
  box.classList.toggle('ready',goal.inside&&goal.held&&goal.current>=goal.target);
}
function updateMooringUI(){
  updateAnchorageGoal();
  lnBtns.forEach((b,i)=>{const st=lines[i].state;
    const cls='ln'+(i>3?' sp':'')+(st==='throw'||st==='haul'?' t':st==='fast'?' f':'')+(sel===i?' sel':''),tx=st==='fast'?'✓':st==='stowed'?'+':'…',mark=b.querySelector('.line-state');
    if(b.className!==cls)b.className=cls;if(mark&&mark.textContent!==tx)mark.textContent=tx;
    b.setAttribute('aria-pressed',String(sel===i));b.setAttribute('aria-label',LINE_DEF[i][0]+' line: '+(st==='fast'?'made fast':st==='stowed'?'stowed':'working')+(sel===i?', selected':''));});
  for(const button of FEND_BTNS){
    const value=+button.dataset.fender,side=value===1||value===2,chosen=side?!!(S.fend&value):value===S.fend;
    button.classList.toggle('on',chosen);button.setAttribute('aria-pressed',String(chosen));
    if(!side)continue;
    const index=value===1?0:1,n=S.fendN[index],working=Math.abs(n-(chosen?4:0))>.001,count=fendOK(index);
    const mark=button.querySelector('.equipment-state'),text=count||working?count+'/4':'In';
    if(mark&&mark.textContent!==text)mark.textContent=text;
    button.classList.toggle('deployed',count>0);button.classList.toggle('working',working);
    button.setAttribute('aria-label',(index?'Starboard':'Port')+' fenders: '+count+' of 4 out'+(working?', '+(chosen?'rigging':'stowing'):''));
  }
  const out=lines.filter(l=>l.state!=='stowed'),fast=out.filter(l=>l.state==='fast'),a=S.anchors[0];
  const statuses={anchors:S.anchorCmd?'Working':S.anchors.some(a=>a.weighing)?'Weighing':S.anchors.length>1?'Both':a?(a.side<0?'Port':a.side>0?'Starboard':'Bow'):'',lines:out.length?out.length+' '+(fast.length===out.length?'fast':'out'):'',fenders:FENDL[S.fend]||(S.fendN.some(n=>n>0)?'Stowing':'')};
  for(const section of ['anchors','lines','fenders']){const text=statuses[section],status=$(section+'Status');if(status.textContent!==text)status.textContent=text;$(section+'T').classList.toggle('has-equipment',!!text);}
  {const diagram=$('anchorDiagram'),tender=shipId==='tender',mode=tender?'bow':'paired';
    if(diagram.dataset.mode!==mode)diagram.dataset.mode=mode;
    for(const button of ANCH_BTNS){
      const value=+button.dataset.anchor,chosen=tender?value===0:S.anchSel===2||S.anchSel===value;
      button.hidden=button.disabled=tender&&value!==0;
      button.classList.toggle('on',chosen);button.setAttribute('aria-pressed',String(chosen));
      if(value===2)continue;
      const side=tender?0:value===0?-1:1,A=S.anchors.find(anchor=>anchor.side===side),pending=(S.dropSides||[]).includes(side),working=pending||!!A?.weighing;
      const label=button.querySelector('.equipment-label'),name=tender?'Bow':value===0?'Port':'Starboard';
      if(value===0&&label&&label.textContent!==name)label.textContent=name;
      const mark=button.querySelector('.equipment-state'),text=working?'…':A?.drag?'!':A?'Out':'In';
      if(mark&&mark.textContent!==text)mark.textContent=text;
      button.classList.toggle('deployed',!!A);button.classList.toggle('working',working);button.classList.toggle('dragging',!!A?.drag);
      button.setAttribute('aria-label',name+' anchor: '+(pending?'preparing':A?.weighing?'bringing in':A?.drag?'dragging':A?.set?'holding':A?'down':'stowed'));
    }
    const sides=anchSides(),anchors=selectedAnchors(),pending=(S.dropSides||[]).filter(sd=>sides.includes(sd)),retrieving=anchors.some(a=>a.weighing);
    const drop=$('anchDrop'),weigh=$('anchWeigh'),lock=$('anchLock'),missing=sides.some(sd=>!S.anchors.some(a=>a.side===sd)&&!pending.includes(sd));
    const paying=anchors.some(a=>a.paying),locked=anchors.length>0&&anchors.every(a=>a.held&&!a.paying&&!a.weighing);
    drop.disabled=!missing&&!anchors.some(a=>!a.paying&&a.L0<140);
    const dropText=pending.length?'Drop…':missing?'Drop':'Pay out';if(drop.textContent!==dropText)drop.textContent=dropText;drop.classList.toggle('on',paying);
    lock.disabled=!anchors.length;lock.classList.toggle('on',locked);lock.setAttribute('aria-pressed',String(locked));
    weigh.disabled=!anchors.length;const weighText=retrieving?'Stop':'Bring in';if(weigh.textContent!==weighText)weigh.textContent=weighText;weigh.classList.toggle('on',retrieving);
    $('chIn').disabled=$('chOut').disabled=!anchors.length;
    const length=A=>(Math.floor(A.L0*10+1e-8)/10).toFixed(1)+' m',chain=$('anchorChain');
    const chainText=sides.length===1?(anchors[0]?length(anchors[0]).replace(' m',''):'—'):sides.map(sd=>{const A=anchors.find(a=>a.side===sd);return(sd<0?'P':'S')+(A?length(A).replace(' m',''):'—');}).join('\n');
    if(chain.textContent!==chainText)chain.textContent=chainText;
    chain.setAttribute('aria-label',sides.map(sd=>{const A=anchors.find(a=>a.side===sd);return(sd<0?'Port':sd>0?'Starboard':'Bow')+': '+(A?length(A)+' of chain out':'stowed');}).join('; '));
    const tx=$('scopeTx'),dragging=anchors.some(a=>a.drag),holding=anchors.length&&anchors.every(a=>a.set&&!a.drag),sc=Math.ceil(18*Math.max(.7,SL));
    const text=pending.length?'Preparing anchor'+(pending.length>1?'s':''):paying?'Paying out':retrieving?'Bringing in':dragging?'Dragging':!anchors.length?'Stowed':holding?'Holding':anchors.some(a=>a.L0<sc)?'Locked · pay out more':'Locked';
    if(tx.textContent!==text)tx.textContent=text;tx.className='lt'+(holding?' ok':dragging?' bad':'');
  }
  const one=sel>=0&&lines[sel].state==='fast'?lines[sel]:null,hd=mooringSection==='lines'&&fast.length>0,ab=$('actBox');
  if(!hd&&!ab.hidden)releaseMooringInputs('haul');if(ab.hidden!==!hd)ab.hidden=!hd;
  if(hd){const tn=one?one.ten:Math.max(...lines.map(l=>l.state==='fast'?l.ten:0)),tx=one?one.name:'All lines';
    ACT_METER.hidden=false;if($('lgBtn').textContent!=='Let go')$('lgBtn').textContent='Let go';
    $('actFill').style.width=Math.min(100,tn/(67e3*LK)*100)+'%';$('actFill').style.background=lines.some(l=>l.strain>.35)?'var(--port)':'var(--amber)';const nm=$('actName');if(nm.textContent!==tx)nm.textContent=tx;
    $('hvBtn').classList.toggle('on',haul>0);$('slBtn').classList.toggle('on',haul<0);}
}
function hud(){
  hudFast();const now=performance.now();if(now-hudLast<1000/15)return;hudLast=now;
  $('bTime').textContent=fmt(S.t);$('dmgBar').style.width=(100-S.damage)+'%';$('dmgBar').style.background=S.damage>60?'var(--port)':S.damage>25?'var(--amber)':'var(--stbd)';hullMeter.setAttribute('aria-valuenow',Math.round(100-S.damage));
  const u=S.u*KN;$('iSpd').firstChild.nodeValue=(Math.abs(u)<.05?'0.0':(u<0?'▼ ':'')+Math.abs(u).toFixed(1));
  $('iBow').textContent=lat((S.v+S.r*20*SL)*KN);$('iStern').textContent=lat((S.v-S.r*22*SL)*KN);
  $('iRud').textContent=Math.round(Math.abs(S.rud))+'°'+(S.rud<0?' P':S.rud>0?' S':'');$('rudN').style.transform='rotate('+S.rud+'deg)';
  $('iHdg').textContent=String(Math.round((((S.psi/D2R+90)%360)+360)%360)%360).padStart(3,'0')+'°';
  $('iWind').textContent=Math.round(windSpd()*KN);$('wArrow').style.transform='rotate('+(env.wFrom+180+yawE/D2R)+'deg)';$('nMark').style.transform='rotate('+yawE/D2R+'deg)';
  $('iDist').firstChild.nodeValue=Math.round(Math.hypot(slip.x-S.x,slip.y-S.y));
  {const tg=target(),dx=tg[0]-S.x,dz=tg[1]-S.y,c0=Math.cos(yawE),s0=Math.sin(yawE);
    $('navA').style.transform='rotate('+Math.atan2(dx*c0-dz*s0,-dx*s0-dz*c0)+'rad)';
    const lb=stops?(S.svc!=null?stops[S.stage].doing+' '+Math.round(S.svc/stops[S.stage].dur*100)+'%':stops[S.stage].name):S.mode==='depart'?(S.voyage?'To '+nextName():'Way out'):'Berth',nl=$('navL');if(nl.textContent!==lb)nl.textContent=lb;
    $('navD').textContent=Math.round(Math.hypot(dx,dz))+' m';}
  updateMooringUI();
  $('rudV').textContent=S.rud===0?'midships':Math.round(Math.abs(S.rud))+'° '+(S.rud<0?'port':'stbd');
}

/* ---------- loop ---------- */
let last=performance.now(),acc=0,topH=0,botH=0,viewOffsetX=0,RX=0,RY=0,RP=0,hudLast=-Infinity;
let rafId=0,renderUntil=0,frameEpoch=0,initialFrameDrawn=false,contextUnavailable=false,drawingFrame=false;
let layoutDirty=true,projectionDirty=true,bufferWidth=0,bufferHeight=0,bufferRatio=0;
const qualityController=new AdaptiveQuality();
function resetFrameClock(){
  last=performance.now();acc=0;frameEpoch++;hudLast=-Infinity;qualityController.resetTiming();
  if(S){S.px=S.x;S.py=S.y;S.ppsi=S.psi;}
}
function invalidateFrame(){
  renderUntil=performance.now()+750;
  if(!rafId&&!drawingFrame&&!document.hidden&&!contextUnavailable){last=performance.now();rafId=requestAnimationFrame(frame);}
}
function invalidateLayout(){layoutDirty=true;invalidateFrame();}
function syncMooringLayout(){
  const wide=!!mooringSection&&app.clientWidth>=640&&app.clientWidth>app.clientHeight&&app.clientHeight<=520;
  if(app.classList.contains('mooring-split')!==wide)releaseControls();
  app.classList.toggle('mooring-wide',wide);app.classList.toggle('mooring-split',wide);
}
function measureLayout(){
  if(!layoutDirty)return;layoutDirty=false;
  syncMooringLayout();
  topH=hudEl.offsetHeight;const ar=app.getBoundingClientRect(),dr=$('dock').getBoundingClientRect();
  botH=Math.max(0,Math.round(app.clientHeight-dr.top+ar.top));
  // In short landscape, frame the boat over the helm side, clear of the open equipment card.
  viewOffsetX=app.classList.contains('mooring-split')?Math.round(app.clientWidth/2-(dr.left-ar.left+dr.width/2)):0;
  app.style.setProperty('--bot',botH+'px');app.style.setProperty('--top',topH+'px');resize();
}
function frame(now){
  rafId=0;if(document.hidden||contextUnavailable)return;
  drawingFrame=true;
  try{
    drawFrame(now);
    if(!initialFrameDrawn){initialFrameDrawn=true;lifecycle.onReady?.();refreshModalState();}
  }catch(error){contextUnavailable=true;setPaused(true,false);lifecycle.onError?.(error);}
  finally{drawingFrame=false;}
  if(!rafId&&!document.hidden&&!contextUnavailable&&((state==='play'&&!hold)||now<renderUntil))rafId=requestAnimationFrame(frame);
}
// Crew work changes anchors and fender protection, so it uses the fixed simulation clock.
function advanceDeckWork(dt){
  for(const h of hands){const dx=h.tx-h.x,dy=h.ty-h.y,d=Math.hypot(dx,dy);if(d>.05){const m=Math.min(d,3.5*dt);h.x+=dx/d*m;h.y+=dy/d*m;}}
  const act=l=>l.state==='queued'||l.state==='throw',by=act(lines[0])?-1.3:act(lines[1])?1.3:lines[0].state==='fast'&&lines[1].state!=='fast'?-1.3:lines[1].state==='fast'&&lines[0].state!=='fast'?1.3:0;
  S.bowY+=clamp((S.anchorCmd||S.anchors.some(a=>!a.held)?0:by)-S.bowY,-1.5*dt,1.5*dt);
  // bow hand walks forward to let the anchor go
  /* crew go inside while she is under way, and come back out as she nears the berth or there is work on deck */
  var goIn=Math.hypot(slip.x-S.x,slip.y-S.y)>Math.max(80,LEN*1.8)&&!lines.some(l=>l.state!=='stowed')&&!S.anchors.length&&!S.anchorCmd&&!S.fend&&S.fendN[0]+S.fendN[1]<.01;
  /* the bow hand only comes out to work the anchor or a bow line, then goes back in */
  const bowWork=S.anchorCmd||S.anchors.some(a=>!a.held||a.weighing||a.paying)||[0,1].some(i=>{const st=lines[i].state;return st==='throw'||st==='haul'||st==='queued';});
  const bxT=S.anchorCmd||S.anchors.some(a=>!a.held)?23.2:bowWork?19.5:13.8;S.bowX+=clamp(bxT-S.bowX,-3*dt/SL,3*dt/SL);
  crew[0].visible=bowWork||(shipId!=='tender'&&!(Math.abs(S.bowX-13.8)<.2&&Math.abs(S.bowY)<.2));
  if(S.anchorCmd&&Math.abs(S.bowX-23.2)<.1){
    const c0=Math.cos(S.psi),s0=Math.sin(S.psi);S.anchorCmd=false;
    const dsides=(S.dropSides||[]).filter(sd=>!S.anchors.some(a=>a.side===sd));S.dropSides=null;
    for(const sd of dsides){const hp=hawseFor(sd),ax=S.x+hp[0]*c0-hp[1]*s0,ay=S.y+hp[0]*s0+hp[1]*c0;S.anchors.push({side:sd,x:ax,y:ay,L0:3,held:true,paying:true,t:0});}
    if(dsides.length){
      const nm=dsides.length>1?'Both anchors':['Port','Bow','Starboard'][dsides[0]+1]+' anchor';toast(nm+' away · paying out chain',1500);
      const ax=S.x+hawseFor(dsides[0])[0]*c0,ay=S.y+hawseFor(dsides[0])[0]*s0;
      for(let i=0;i<16;i++)spawn(1,ax+rnd(-1,1),ay+rnd(-1,1),rnd(-1.8,1.8),rnd(-1.8,1.8),rnd(.5,.9),rnd(1.2,2.6),.6);wakeDrop(ax,ay,1.3);
    }
    updateMooringUI();
  }
  // stern hands rig or strike the fenders one at a time, working forward
  for(let sdI=0;sdI<2;sdI++){
    const want=(S.fend&(sdI?2:1))?4:0,n=S.fendN[sdI],man=crew[1+sdI];let tx=goIn?-15.9*SL:-22.5*SL;
    if(n===0)for(let i=0;i<4;i++)S.fPop[i*2+sdI]=0; // fresh fenders next time they are rigged
    if(n!==want){const idx=want>n?Math.floor(n+.001):Math.ceil(n-.001)-1;tx=FENDX[clamp(idx,0,3)]*LEN/2;
      if(Math.abs(man.position.x-tx)<.5)S.fendN[sdI]=want>n?Math.min(want,n+dt/1.1):Math.max(want,n-dt/.8);}
    man.position.x+=clamp(tx-man.position.x,-2.6*dt,2.6*dt);
    {const x=man.position.x,sideZ=goIn?1.3*SB:x>-16*SL?Math.max(2.8*SB,hullHW(x)-.75*SB):2.8*SB,zt=(sdI?1:-1)*sideZ;man.position.z+=clamp(zt-man.position.z,-2.2*dt,2.2*dt);
     man.visible=!(goIn&&Math.abs(man.position.x-tx)<.3&&Math.abs(man.position.z-zt)<.3);}
  }
  if(shipId==='tender')for(const c of crew)c.visible=false; /* the foiler carries no visible crew; its gear still works on the same timing */
}
function drawFrame(now){
  const raw=Math.max(0,(now-last)/1000),rdt=Math.min(MAX_FRAME_TIME,raw),active=state==='play'&&!hold;
  let dt=active?rdt:0;last=now;measureLayout();
  if(active&&qualityController.sample(raw)){qual=qualityController.scale;applyWaterQuality(qualityController.low);resize();}
  else if(!active)qualityController.resetTiming();
  if(active){
    const plan=planSimulationSteps(acc,dt),epoch=frameEpoch;acc=plan.remainder;
    for(let i=0;i<plan.count;i++){
      S.px=S.x;S.py=S.y;S.ppsi=S.psi;heldKeys(FIXED_STEP);T+=FIXED_STEP;step(FIXED_STEP);physGuard();
      if(frameEpoch!==epoch||state!=='play'||hold){dt=0;break;}
    }
  }
  {const ok=active&&S.px!==undefined&&Math.hypot(S.x-S.px,S.y-S.py)<5,al=ok?clamp(acc/FIXED_STEP,0,1):1;RX=ok?S.px+(S.x-S.px)*al:S.x;RY=ok?S.py+(S.y-S.py)*al:S.y;RP=ok?S.ppsi+(S.psi-S.ppsi)*al:S.psi;}
  if(!isFinite(cam.x+cam.y)){cam.x=S.x;cam.y=S.y;}
  const wd=windTo(),wsp=windSpd()*.012;
  for(let i=parts.length-1;i>=0;i--){const p=parts[i];p.life-=dt;if(p.life<=0||p.k===3){parts[i]=parts[parts.length-1];parts.pop();continue;}
    const tb=p.k===2?0:1.1;
    p.vx+=(Math.cos(p.y*.4+T*1.3+p.s)*tb+wd[0]*wsp)*dt;p.vy+=(Math.sin(p.x*.4-T*1.1+p.s)*tb+wd[1]*wsp)*dt;
    p.x+=p.vx*dt;p.y+=p.vy*dt;const d=1-.75*dt;p.vx*=d;p.vy*=d;p.size+=p.g*dt;}
  const VW=AW;
  // leave ripples where the hull has been
  if(active&&dt>0){const sp=Math.hypot(S.u,S.v),c0=Math.cos(S.psi),s0=Math.sin(S.psi),act=Math.max(Math.abs(S.rpm[0]),Math.abs(S.rpm[1]));
    if(Math.hypot(S.x-wkX,S.y-wkY)>2.2||(T-wkT>.9&&(sp>.1||act>.05||Math.abs(S.thrAct)>.2))){
      wkX=S.x;wkY=S.y;wkT=T;const a=Math.min(1.4,.25+sp*.4)*Math.max(.5,Math.sqrt(SL));
      wakeDrop(S.x+c0*LEN*.44,S.y+s0*LEN*.44,a);
      if(wkI%2)wakeDrop(S.x-c0*LEN*.5,S.y-s0*LEN*.5,Math.min(1.4,a*.6+act*.9));
      if(Math.abs(S.thrAct)>.2)wakeDrop(S.x+c0*THR_X+s0*sgn(S.thrAct)*BEAM*.6,S.y+s0*THR_X-c0*sgn(S.thrAct)*BEAM*.6,.7);
    }}
  // orbit camera around the yacht
  const cs=Math.cos(RP),sn=Math.sin(RP),ld=Math.min(1.2,camD/160),lx=RX+(S.u*cs-S.v*sn)*ld+camOff.x,ly=RY+(S.u*sn+S.v*cs)*ld+camOff.y;
  {const k=1-Math.exp(-rdt*3);cam.x+=(lx-cam.x)*k;cam.y+=(ly-cam.y)*k;}
  yawE=rotv+(chase?Math.atan2(-cs,-sn):0);
  pitchE+=((topDown?1.5:pitch)-pitchE)*(1-Math.exp(-rdt*4));
  const dist=Math.hypot(slip.x-S.x,slip.y-S.y),near=clamp((dist-50)/140,0,1);
  const dT=(95+120*near)*clamp(Math.pow(SL,.7),.4,1.6)*(.7+.55*Math.sin(pitchE))/zoomMul*clamp(.62*AH/VW,1,1.8);camD+=(dT-camD)*(1-Math.exp(-rdt*2));
  S.shake=Math.max(0,S.shake-dt*2.5);const sh=reduceMotion?0:S.shake*1.2;
  const cp=Math.cos(pitchE);
  camera.position.set(cam.x+Math.sin(yawE)*cp*camD+rnd(-sh,sh),4+Math.sin(pitchE)*camD+rnd(-sh,sh),cam.y+Math.cos(yawE)*cp*camD);
  camera.up.set(0,1,0);camera.lookAt(cam.x,4,cam.y);
  // keep the boat in the middle of whatever screen the panels leave free
  if(projectionDirty){camera.aspect=AW/AH;camera.setViewOffset(AW,AH,viewOffsetX,Math.round(botH/2+AH*.035),AW,AH);projectionDirty=false;}
  camera.updateMatrixWorld();
  skyM.position.copy(camera.position);U.uCtr.value.set(cam.x,cam.y);
  sync3D(dt);updateSmoke(dt);
  // pointer to the berth when it is off screen
  const tg=target();v3a.set(tg[0],0,tg[1]).project(camera);let px=v3a.x,py=v3a.y;if(v3a.z>1){px=-px*50;py=-py*50;}
  const sx=(px*.5+.5)*AW,sy=topH+(-py*.5+.5)*AH,top=topH+14,bot=topH+AH-botH-14,acy=topH+(AH-botH)/2,acx=AW/2;
  const off=sx<10||sx>AW-10||sy<top||sy>bot;ptr.hidden=!off;
  if(off){ptr.style.left=clamp(sx,22,AW-22)+'px';ptr.style.top=clamp(sy,top+8,bot-8)+'px';ptr.style.transform='rotate('+Math.atan2(sy-acy,sx-acx)+'rad)';}
  renderer.render(scene3,camera);hud();
}
const hudEl=document.querySelector('.hud'),ptr=$('ptr'),compact=matchMedia('(orientation:landscape) and (max-height:520px)');

/* ---------- controls ---------- */
let sync=false;const held=Object.create(null),detent=[0,0];
const inputSources=new Map(),capturedPointers=new Map(),inputResetters=[],bumpResetters=[],mooringBindings=[],bumpOwned=[false,false];
let holdBinding=0;
const canDrive=()=>state==='play'&&!hold&&!(S.cineT!=null&&!S.cineDone);
function capturePointer(el,id){try{el.setPointerCapture(id);}catch(e){/* the pointer already ended */}capturedPointers.set(id,el);}
function forgetPointer(el,id){if(capturedPointers.get(id)===el)capturedPointers.delete(id);}
function applyHeldInputs(){
  let thr=0,lineHaul=0,anchorInput=null;const bumps=[null,null];
  for(const command of inputSources.values()){
    if(command.kind==='thruster')thr=command.direction;
    else if(command.kind==='haul')lineHaul=command.direction;
    else if(command.kind==='anchor'&&command.targets.some(a=>S.anchors.includes(a)))anchorInput=command;
    else if(command.kind==='bump'){
      if(sync)bumps[0]=bumps[1]=command.direction;
      else bumps[command.engine]=command.direction;
    }
  }
  if(!S)return;S.thr=thr;haul=lineHaul;anchorHold=anchorInput;
  for(let i=0;i<2;i++){
    if(bumps[i]!==null){S.lever[i]=bumps[i]*.32;bumpOwned[i]=true;}
    else if(bumpOwned[i]){S.lever[i]=0;bumpOwned[i]=false;}
  }
}
function setHeldInput(source,command){
  if(command){if(inputSources.has(source))return;inputSources.set(source,command);}
  else inputSources.delete(source);
  applyHeldInputs();
}
// One input owner per pointer/key prevents releasing one finger from cancelling another.
function bindHoldButton(button,command,before){
  const prefix='button:'+(holdBinding++)+':',active=new Set();
  const begin=source=>{if(!canDrive()||button.disabled||button.closest('[hidden],[inert]')||active.has(source)||before&&before()===false)return false;active.add(source);setHeldInput(source,command);button.classList.add('on');return true;};
  const end=source=>{if(!active.delete(source))return;setHeldInput(source,null);button.classList.toggle('on',active.size>0);};
  const clear=()=>{for(const source of [...active])end(source);};inputResetters.push(clear);if(command.kind==='bump')bumpResetters.push(clear);
  if(command.kind==='haul')mooringBindings.push({kind:'haul',button,clear});
  button.addEventListener('pointerdown',e=>{if(e.button!==0||!canDrive())return;e.preventDefault();e.stopPropagation();if(begin(prefix+'pointer:'+e.pointerId))capturePointer(button,e.pointerId);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>{end(prefix+'pointer:'+e.pointerId);forgetPointer(button,e.pointerId);});
  button.addEventListener('keydown',e=>{if(e.key!==' '&&e.key!=='Enter')return;e.preventDefault();e.stopPropagation();if(!e.repeat)begin(prefix+'key:'+e.key);});
  button.addEventListener('keyup',e=>{if(e.key!==' '&&e.key!=='Enter')return;e.preventDefault();e.stopPropagation();end(prefix+'key:'+e.key);});
  button.addEventListener('blur',()=>{for(const source of [...active])if(source.startsWith(prefix+'key:'))end(source);});
  button.addEventListener('click',e=>e.preventDefault());
}
// Tap changes chain by one metre. A deliberate hold then runs the same selected windlass(es).
function adjustAnchorChain(targets,direction){
  for(const A of targets)if(S.anchors.includes(A)){A.held=true;A.weighing=false;A.paying=false;A.tapHeave=direction>0;A.L0=clamp(A.L0-direction,2,140);}
  updateMooringUI();
}
function bindChainButton(button,direction){
  const prefix='anchor:'+(holdBinding++)+':',active=new Set();
  const targets=()=>canDrive()&&mooringSection==='anchors'&&!button.disabled&&!button.closest('[hidden],[inert]')?selectedAnchors():[];
  const begin=source=>{
    if(active.has(source))return false;const anchors=targets();if(!anchors.length)return false;
    adjustAnchorChain(anchors,direction);active.add(source);setHeldInput(source,{kind:'anchor',direction,targets:anchors,after:S.t+.35});button.classList.add('on');return true;
  };
  const end=source=>{if(!active.delete(source))return;setHeldInput(source,null);button.classList.toggle('on',active.size>0);};
  const clear=()=>{for(const source of [...active])end(source);};inputResetters.push(clear);mooringBindings.push({kind:'anchor',button,clear});
  button.addEventListener('pointerdown',e=>{if(e.button!==0||!canDrive())return;e.preventDefault();e.stopPropagation();if(begin(prefix+'pointer:'+e.pointerId))capturePointer(button,e.pointerId);});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])button.addEventListener(event,e=>{end(prefix+'pointer:'+e.pointerId);forgetPointer(button,e.pointerId);if(button.hasPointerCapture(e.pointerId))button.releasePointerCapture(e.pointerId);});
  button.addEventListener('keydown',e=>{if(e.key!==' '&&e.key!=='Enter')return;e.preventDefault();e.stopPropagation();if(!e.repeat)begin(prefix+'key:'+e.key);});
  button.addEventListener('keyup',e=>{if(e.key!==' '&&e.key!=='Enter')return;e.preventDefault();e.stopPropagation();end(prefix+'key:'+e.key);});
  button.addEventListener('blur',()=>{for(const source of [...active])if(source.startsWith(prefix+'key:'))end(source);});
  // Pointer activation was handled on down; a click without pointer detail supports assistive activation.
  button.addEventListener('click',e=>{e.preventDefault();if(e.detail||e.pointerType)return;const anchors=targets();if(anchors.length)adjustAnchorChain(anchors,direction);});
}
// Folding stops both kinds; changing an anchor or line target stops only its own momentary work.
function releaseMooringInputs(kind=null){
  const bindings=mooringBindings.filter(b=>!kind||b.kind===kind),buttons=new Set(bindings.map(b=>b.button));
  for(const binding of bindings)binding.clear();
  for(const [source,command] of inputSources)if((command.kind==='haul'||command.kind==='anchor')&&(!kind||command.kind===kind))inputSources.delete(source);
  for(const [id,el] of [...capturedPointers])if(buttons.has(el)){capturedPointers.delete(id);if(el.hasPointerCapture(id))el.releasePointerCapture(id);}
  for(const button of buttons)button.classList.remove('on');
  applyHeldInputs();
}
function releaseControls(){
  for(const resetInput of inputResetters)resetInput();
  inputSources.clear();applyHeldInputs();
  for(const key in held)delete held[key];detent.fill(0);
  pts.clear();drag=null;g2=null;
  for(const [id,el] of [...capturedPointers]){if(el.hasPointerCapture(id))el.releasePointerCapture(id);}capturedPointers.clear();
  if(S)S.thr=0;haul=0;anchorHold=null;hudKey='';
}
const putLever=(i,v)=>{if(sync)S.lever=[v,v];else S.lever[i]=v;};
const setLever=(i,v)=>{v=clamp(v,-1,1);putLever(i,Math.abs(v)<.03?0:Math.round(v*20)/20);};
function toggleSync(){if(!canDrive())return;sync=!sync;if(sync&&S){const m=(S.lever[0]+S.lever[1])/2;S.lever=[m,m];}applyHeldInputs();toast(sync?'Engines synced · either lever moves both':'Engines independent',1300);}
// keys are read every frame, so any number can be held together
function heldKeys(dt){
  const drive=(i,up,dn)=>{const d=(held[up]?1:0)-(held[dn]?1:0);if(!d){detent[i]=0;return;}if(detent[i])return;
    const v=S.lever[i],n=clamp(v+d*.55*dt,-1,1);
    if(v!==0&&Math.sign(n)!==Math.sign(v)){putLever(i,0);detent[i]=1;}else putLever(i,n);}; // stops in neutral until the key is pressed again
  drive(0,'w','s');if(!sync||!(held.w||held.s))drive(1,'ArrowUp','ArrowDown');
  const rd=(held.ArrowRight?1:0)-(held.ArrowLeft?1:0);if(rd)setRud(S.rud+rd*22*dt);
}
lv.forEach((el,i)=>{
  const tr=el.querySelector('.track');
  // grab anywhere on the track and slide: the lever moves by how far you drag, it never jumps to where you touched
  let g0=null;const raw=v=>v===0?0:sgn(v)*(.13+.87*Math.abs(v)),notch=v=>Math.abs(v)<.13?0:sgn(v)*(Math.abs(v)-.13)/.87;
  const set=e=>{if(!g0)return;const r=tr.getBoundingClientRect();setLever(i,notch(clamp(g0.v-2*(e.clientY-g0.y)/r.height,-1,1)));};
  inputResetters.push(()=>g0=null);
  tr.addEventListener('pointerdown',e=>{if(e.button!==0||!canDrive())return;capturePointer(el,e.pointerId);g0={id:e.pointerId,y:e.clientY,v:raw(S.lever[i])};tr.focus({preventScroll:true});e.preventDefault();});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])el.addEventListener(event,e=>{if(g0&&g0.id===e.pointerId)g0=null;forgetPointer(el,e.pointerId);});
  // bump: hold for a nudge at dead slow in gear, let go and she drops back to neutral
  el.querySelectorAll('.bmp').forEach(b=>bindHoldButton(b,{kind:'bump',engine:i,direction:+b.dataset.d}));
  el.addEventListener('pointermove',e=>{if(canDrive()&&g0&&g0.id===e.pointerId&&el.hasPointerCapture(e.pointerId))set(e);});
  tr.addEventListener('dblclick',()=>{if(canDrive())setLever(i,0);});
  tr.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const delta={ArrowUp:.05,ArrowRight:.05,ArrowDown:-.05,ArrowLeft:-.05,PageUp:.2,PageDown:-.2}[e.key];
    if(delta===undefined&&e.key!=='Home'&&e.key!=='End')return;e.preventDefault();e.stopPropagation();
    if(canDrive())setLever(i,e.key==='Home'?-1:e.key==='End'?1:S.lever[i]+delta);
  });
});
[['thL',-1],['thR',1]].forEach(([id,d])=>bindHoldButton($(id),{kind:'thruster',direction:d}));
{const ri=$('rud'),box=ri.parentElement,setX=e=>{const r=ri.getBoundingClientRect();const t=clamp((e.clientX-r.left-17)/Math.max(1,r.width-34),0,1);let v=Math.round(t*70-35);if(Math.abs(v)<=1)v=0;setRud(v);};
 box.addEventListener('pointerdown',e=>{if(e.button!==0||!canDrive())return;capturePointer(box,e.pointerId);setX(e);ri.focus({preventScroll:true});e.preventDefault();});
 box.addEventListener('pointermove',e=>{if(canDrive()&&box.hasPointerCapture(e.pointerId))setX(e);});
 for(const event of ['pointerup','pointercancel','lostpointercapture'])box.addEventListener(event,e=>forgetPointer(box,e.pointerId));
 ri.addEventListener('input',()=>{if(canDrive())setRud(+ri.value);else ri.value=S.rud;});
 box.addEventListener('click',e=>e.preventDefault());}
const setRud=v=>{S.rud=clamp(v,-35,35);$('rud').value=S.rud;};
const allStop=()=>{
  if(state!=='play')return;
  for(const key of ['w','s','ArrowUp','ArrowDown'])delete held[key];detent.fill(0);
  for(const clearBump of bumpResetters)clearBump();
  bumpOwned.fill(false);S.lever=[0,0];
}; // engines only; the rudder stays where it is (Midships centres it)
$('stop').onclick=allStop;$('syncBtn').onclick=toggleSync;
FEND_BTNS.forEach(button=>button.onclick=()=>{const value=+button.dataset.fender;setFenders(value===1||value===2?S.fend^value:value);});
ANCH_BTNS.forEach(button=>button.onclick=()=>setAnchorSelection(+button.dataset.anchor));
[['chIn',1],['chOut',-1]].forEach(([id,d])=>bindChainButton($(id),d));
$('anchDrop').onclick=dropAnchors;$('anchLock').onclick=lockAnchors;$('anchWeigh').onclick=bringInAnchors;
const actionTargetReady=()=>mooringSection==='lines'&&lines.some(l=>l.state==='fast');
[['hvBtn',1],['slBtn',-1]].forEach(([id,d])=>bindHoldButton($(id),{kind:'haul',direction:d},actionTargetReady));
$('lgBtn').onclick=()=>{if(actionTargetReady())letGo();};
lnBtns.forEach((b,i)=>b.onclick=()=>lineClick(i));

cv.addEventListener('wheel',e=>{zoomMul=clamp(zoomMul*(e.deltaY<0?1.1:1/1.1),.5,3);e.preventDefault();},{passive:false});
// view: drag orbits, right-drag (or shift-drag) pans, two fingers twist and pinch, double-click resets
const camOff={x:0,y:0},pts=new Map();let drag=null,g2=null;
const gest=()=>{const[a,b]=[...pts.values()];return{a:Math.atan2(b.y-a.y,b.x-a.x),d:Math.hypot(b.x-a.x,b.y-a.y)||1};};
cv.addEventListener('pointerdown',e=>{capturePointer(cv,e.pointerId);cv.focus({preventScroll:true});pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size===2){g2=gest();drag=null;}else drag={id:e.pointerId,x:e.clientX,y:e.clientY,t:e.button===2||e.shiftKey};});
cv.addEventListener('pointermove',e=>{
  if(!pts.has(e.pointerId))return;pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pts.size===2&&g2){const n=gest(),da=n.a-g2.a;rotv-=Math.atan2(Math.sin(da),Math.cos(da));zoomMul=clamp(zoomMul*n.d/g2.d,.4,4);g2=n;return;}
  if(!drag||drag.id!==e.pointerId)return;
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.x=e.clientX;drag.y=e.clientY;
  if(drag.t){const s=camD*.7/AH,c0=Math.cos(yawE),s0=Math.sin(yawE),f=dy*s/Math.max(.35,Math.sin(pitchE)),r=-dx*s;
    const nx=clamp(camOff.x+c0*r-s0*f,-300,300),ny=clamp(camOff.y-s0*r-c0*f,-300,300);cam.x+=nx-camOff.x;cam.y+=ny-camOff.y;camOff.x=nx;camOff.y=ny;}
  else{rotv-=dx*.006;pitch=clamp((topDown?1.5:pitch)+dy*.005,.1,1.5);topDown=false;}
});
['pointerup','pointercancel','lostpointercapture'].forEach(n=>cv.addEventListener(n,e=>{
  pts.delete(e.pointerId);forgetPointer(cv,e.pointerId);g2=null;drag=null;
  if(pts.size===1){const [id,p]=pts.entries().next().value;drag={id,x:p.x,y:p.y,t:false};}
  else if(pts.size===2)g2=gest();
}));
cv.addEventListener('contextmenu',e=>e.preventDefault());
cv.addEventListener('dblclick',()=>{camOff.x=camOff.y=0;zoomMul=1;rotv=0;pitch=.27;topDown=false;chase=false;});

function setMooringSection(section){
  const panels={anchors:'anchorBody',lines:'lnBody',fenders:'fenderBody'};
  if(section!==null&&!Object.hasOwn(panels,section))return;
  const previous=mooringSection,focused=previous&&$(panels[previous]).contains(document.activeElement);
  if(section!==previous){
    releaseMooringInputs();
    if(section==='anchors')sel=-1;
    mooringSection=section;
  }
  for(const [name,id] of Object.entries(panels)){$(id).hidden=name!==section;$(name+'T').setAttribute('aria-controls',id);$(name+'T').setAttribute('aria-expanded',String(name===section));}
  syncMooringLayout();updateMooringUI();invalidateLayout();
  if(focused&&section!==previous){const heading=$((section||previous)+'T');if(!heading.closest('[inert]'))heading.focus({preventScroll:true});}
}
for(const section of ['anchors','lines','fenders'])$(section+'T').onclick=()=>setMooringSection(mooringSection===section?null:section);
{const CORN=['c-tr','c-br','c-bl','c-tl'],g=$('gLines'),setC=c=>{CORN.forEach(k=>g.classList.toggle(k,k===c));try{localStorage.setItem('sternto-panel',c);}catch(e){}invalidateLayout();};
 try{const c=localStorage.getItem('sternto-panel');if(CORN.includes(c))setC(c);}catch(e){}
 $('cornerBtn').onclick=()=>{const cur=CORN.find(k=>g.classList.contains(k))||'c-tr';setC(CORN[(CORN.indexOf(cur)+1)%4]);};}
addEventListener('keydown',e=>{
  if(e.defaultPrevented||e.isComposing||e.ctrlKey||e.metaKey||e.altKey)return;
  const k=e.key.length===1?e.key.toLowerCase():e.key;
  const modal=currentModal();
  if(modal){
    if(k==='Tab'){trapModalFocus(e,modal);return;}
    if(k==='Escape'){
      if(modal===$('help'))closeHelp();else if(paused)resume();
      e.preventDefault();return;
    }
    // Native buttons keep their Enter/Space actions; Enter on the sheet itself starts play.
    if(k==='Enter'&&modal===$('menu')&&!e.target.closest('button,input,select,textarea,a,[contenteditable]')){paused?resume():start();e.preventDefault();}
    return;
  }
  if(e.target.closest('input,textarea,select,[contenteditable="true"]'))return;
  if((k===' '||k==='Enter')&&e.target.closest('button,a'))return;
  if(state==='play'){
    if(k==='Escape'){if(!e.repeat){if(mooringSection)setMooringSection(null);else openMenu();}e.preventDefault();return;}
    if(k==='p'){if(!e.repeat)togglePause();e.preventDefault();return;}
    if(hold||S.cineT!=null&&!S.cineDone)return;
    let used=true;
    // left hand: port engine and thruster; right hand: starboard engine and rudder
    if(k==='w'||k==='s'||k==='ArrowUp'||k==='ArrowDown'||k==='ArrowLeft'||k==='ArrowRight'){if(!e.repeat||held[k])held[k]=1;}
    else if(k==='c')setRud(0);else if(k==='q'){if(!e.repeat)toggleSync();}
    else if(k===' ')allStop();
    else if(k>='1'&&k<='6'){if(!e.repeat)lineClick(+k-1);}
    else if(k==='h'||k==='j'){if(!e.repeat||inputSources.has('shortcut:'+k))setHeldInput('shortcut:'+k,{kind:'haul',direction:k==='h'?1:-1});}
    else if(k==='g'){if(!e.repeat)letGo();}
    else if(k==='f'){if(!e.repeat)toggleFend();}
    else if(k==='x'){if(!e.repeat){if(selectedAnchors().some(a=>a.paying))lockAnchors();else dropAnchors();}}
    else if(k==='b'){if(!e.repeat)bringInAnchors();}
    else if(k==='z'){if(!e.repeat)cycleAnchSel();}
    else if(k==='a'||k==='d'){if(!e.repeat||inputSources.has('shortcut:'+k))setHeldInput('shortcut:'+k,{kind:'thruster',direction:k==='a'?-1:1});}
    else if(k==='r'){if(!e.repeat)start();}
    else if(k==='[')rotv-=.1;else if(k===']')rotv+=.1;else if(k==='t'){if(!e.repeat)topDown=!topDown;}else if(k==='v'){if(!e.repeat)chase=!chase;}
    else if(k==='='||k==='+')zoomMul=clamp(zoomMul*1.15,.5,3);else if(k==='-')zoomMul=clamp(zoomMul/1.15,.5,3);
    else used=false;
    if(used)e.preventDefault();
  }
});
addEventListener('keyup',e=>{const k=e.key.length===1?e.key.toLowerCase():e.key;
  delete held[k];
  if(k==='a'||k==='d'||k==='h'||k==='j')setHeldInput('shortcut:'+k,null);
});
addEventListener('blur',releaseControls);

/* ---------- menu ---------- */
let modalFocus=null,menuReturnFocus=null;
function currentModal(){return !$('help').hidden?$('help'):!$('menu').hidden?$('menu'):null;}
const modalItems=modal=>[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')].filter(el=>!el.closest('[hidden],[inert]')&&el.getClientRects().length);
function refreshModalState(preferred){
  const modal=currentModal();
  const cinematic=S&&S.cineT!=null&&!S.cineDone;
  for(const el of [hudEl,$('dock'),$('gLines'),$('result'),glc])el.inert=!!modal||!!(cinematic&&el!==hudEl&&el!==$('result'));
  $('menu').inert=modal===$('help');
  if(modal){
    if(modal!==modalFocus||!modal.contains(document.activeElement)||preferred){
      const focus=preferred&&modal.contains(preferred)?preferred:modal===$('help')?$('helpClose'):paused?$('resume'):$('go');
      (focus.disabled?modal:focus).focus({preventScroll:true});
    }
  }else if(modalFocus||preferred){
    const focus=preferred||menuReturnFocus;
    (focus&&focus.isConnected&&!focus.closest('[hidden],[inert]')?focus:glc).focus({preventScroll:true});
  }
  modalFocus=modal;
}
function trapModalFocus(e,modal){
  const items=modalItems(modal),i=items.indexOf(document.activeElement);
  if(!items.length){e.preventDefault();modal.focus({preventScroll:true});return;}
  if(e.shiftKey&&i<=0){e.preventDefault();items[items.length-1].focus();}
  else if(!e.shiftKey&&(i<0||i===items.length-1)){e.preventDefault();items[0].focus();}
}
function openHelp(){releaseControls();$('menu').hidden=true;$('result').hidden=true;$('help').hidden=false;refreshModalState();invalidateFrame();}
function closeHelp(){$('help').hidden=true;$('menu').hidden=false;refreshModalState($('helpBtn'));invalidateFrame();}
let wakeSentinel=null,wakeRequest=null;
const wantsWakeLock=()=>state==='play'&&!hold&&document.visibilityState==='visible';
function syncWakeLock(){
  if(!navigator.wakeLock)return;
  if(!wantsWakeLock()){
    if(wakeSentinel){const lock=wakeSentinel;wakeSentinel=null;lock.release().catch(()=>{});}
    return;
  }
  if(wakeSentinel||wakeRequest)return;
  wakeRequest=navigator.wakeLock.request('screen').then(async lock=>{
    if(!wantsWakeLock()){await lock.release();return;}
    wakeSentinel=lock;lock.addEventListener('release',()=>{if(wakeSentinel===lock)wakeSentinel=null;});
  }).catch(()=>{}).finally(()=>{wakeRequest=null;});
}
const bEl=$('berths');
LEVELS.forEach((L,i)=>{const b=document.createElement('button');b.className='bc'+(L.mission?' mission':'');b.type='button';
  b.innerHTML=`<strong>${L.name}</strong><span class="cond">${pt(L.wind[1])} ${L.wind[0]} kn · ${L.swell[0].toFixed(1)} m</span>`;
  b.onclick=()=>pick(i);bEl.appendChild(b);});
const sEl=$('shipSel');
Object.keys(SHIPS).forEach(id=>{const b=document.createElement('button');b.className='btn';b.type='button';b.textContent=SHIPS[id].name;b.onclick=()=>setShip(id);sEl.appendChild(b);});
function setShip(id){
  setShipParams(id);buildOwn();$('spec').textContent=SHIPS[id].spec;
  [...sEl.children].forEach((b,i)=>b.setAttribute('aria-pressed',Object.keys(SHIPS)[i]===id));
  pick(lvI);
}
function condLabels(){$('cWv').textContent=env.wk+' kn';$('cDv').textContent=pt(env.wFrom);$('cSv').textContent=env.sh.toFixed(1)+' m';}
function pick(i){
  nightEnv0=null;buildLevel(i);build3D();
  selectedWeather={wk:LV.wind[0],wFrom:LV.wind[1],sh:LV.swell[0],sFrom:LV.swell[1]};Object.assign(env,selectedWeather);
  $('cW').value=env.wk;$('cD').value=env.wFrom;$('cS').value=env.sh;condLabels();
  [...bEl.children].forEach((b,j)=>b.setAttribute('aria-pressed',j===i));
  $('mStart').hidden=!LEVELS[i].mission;
  $('bName').textContent=LV.name;reset();
  if(state==='menu'){paused=false;$('resume').hidden=true;$('go').classList.add('hot');}
}
$('cW').oninput=e=>{selectedWeather.wk=env.wk=+e.target.value;condLabels();};
$('cD').oninput=e=>{selectedWeather.wFrom=env.wFrom=+e.target.value;condLabels();};
$('cS').oninput=e=>{selectedWeather.sh=env.sh=+e.target.value;condLabels();};
// mission: start at any stop, as if she has just let go from the one before
let missionStart=0;
document.querySelectorAll('#mStart .btn').forEach(b=>b.onclick=()=>{missionStart=+b.dataset.k;document.querySelectorAll('#mStart .btn').forEach(x=>x.setAttribute('aria-pressed',x===b));});
function jumpStage(k){
  const pv=stops[k-1].slip;S.stage=k;setStop(k);S.x=pv.x;S.y=pv.y;S.psi=pv.h;S.u=S.v=S.r=0;S.legT0=S.t;cam.x=S.x;cam.y=S.y;mooredStart();
  toast(stops[k-1].done+' · next: '+stops[k].name+' · let go and follow the arrow',3200);
}
/* Shared public total: one count per successful new game; reads never increment. */
const PLAYS_URL='https://abacus.jasoncameron.dev/',PLAYS_KEY='sternto-dock-sim/plays';let displayedPlays=-1,playsReadPending=null,playsLastRead=-Infinity,playsRevision=0;
function playsStatus(text='',retry=false){
  const note=$('playsState');note.textContent=text;note.hidden=!text;$('playsRetry').hidden=!retry;invalidateFrame();
}
function showPlays(n){
  if(!Number.isSafeInteger(n)||n<0||n<displayedPlays)return;displayedPlays=n;playsRevision++;
  $('playsN').textContent=n.toLocaleString('en-AU');$('plays').hidden=false;
  playsStatus();
}
function plays(op,force=false){
  if(location.origin!=='https://fourstripes.github.io'||!/^\/stern-to\/(?:index\.html)?$/.test(location.pathname)||!['get','hit'].includes(op))return;
  if(op==='get'){
    if(playsReadPending)return playsReadPending;
    if(!force&&performance.now()-playsLastRead<5000)return;
    playsLastRead=performance.now();
    if(displayedPlays<0){$('playsN').textContent='Loading…';playsStatus();}
    $('playsRetry').hidden=true;$('plays').hidden=false;
  }
  const revision=playsRevision;
  const request=(async()=>{
    for(let attempt=0;attempt<(op==='get'?2:1);attempt++){
      if(op==='get')playsLastRead=performance.now();
      const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),30000);
      try{
        const response=await fetch(PLAYS_URL+op+'/'+PLAYS_KEY,{cache:'no-store',credentials:'omit',referrerPolicy:'no-referrer',signal:controller.signal});
        if(!response.ok)throw new Error('Counter unavailable');
        const data=await response.json();if(!Number.isSafeInteger(data.value)||data.value<0)throw new Error('Invalid counter value');showPlays(data.value);return;
      }catch{}finally{clearTimeout(timeout);}
      // A newer successful response owns the display; never replay an ambiguous increment.
      if(playsRevision!==revision)return;
      if(op==='get'&&attempt===0){
        playsStatus('Retrying…');await new Promise(resolve=>setTimeout(resolve,3000));
        if(playsRevision!==revision)return;
      }else if(op==='get'||!playsReadPending){
        if(displayedPlays<0)$('playsN').textContent='Unavailable';
        $('plays').hidden=false;playsStatus(displayedPlays<0?'':'Last known',true);
      }
    }
  })();
  if(op==='get'){playsReadPending=request;request.finally(()=>{playsReadPending=null;});}
  return request;
}
$('playsRetry').onclick=()=>plays('get',true);
addEventListener('online',()=>{if(!$('menu').hidden)plays('get',true);});
plays('get');
function start(){
  releaseControls();paused=false;
  camOff.x=camOff.y=0;$('menu').hidden=true;$('help').hidden=true;$('result').hidden=true;
  reset();state='play';acc=0;setPaused(false,false);refreshModalState(glc);
  toast(LV.sub,3200);if(stops&&missionStart>0)jumpStage(missionStart);syncWakeLock();invalidateFrame();plays('hit');
}
let paused=false,hold=false;
function setPaused(value,announce=true){
  hold=!!value;releaseControls();resetFrameClock();const b=$('pauseBtn');b.textContent=hold?'Play':'Pause';b.classList.toggle('on',hold);b.setAttribute('aria-pressed',String(hold));
  if(announce)toast(hold?'Paused':'Under way',hold?1e9:900);syncWakeLock();invalidateFrame();
}
function togglePause(){if(state==='play')setPaused(!hold);}
function openMenu(){
  if(state==='play'){paused=true;menuReturnFocus=document.activeElement;}releaseControls();state='menu';
  $('result').hidden=true;$('help').hidden=true;$('menu').hidden=false;$('resume').hidden=!paused;$('go').classList.toggle('hot',!paused);
  refreshModalState();syncWakeLock();invalidateFrame();plays('get');
}
function resume(){if(!paused)return;releaseControls();paused=false;state='play';resetFrameClock();$('menu').hidden=true;$('help').hidden=true;refreshModalState();syncWakeLock();invalidateFrame();}
function setSide(left){$('dock').classList.toggle('left',left);app.classList.toggle('dl',left);try{localStorage.setItem('sternto-dock',left?'l':'r');}catch(e){}}
$('rKeep').onclick=()=>{
  if(banner==='won')startDepart(false);
  else{
    if(banner==='dep'){S.mode='arrive';S.done=false;S.legT0=S.t;S.legHits0=S.hits;toast('Bring her back onto the berth',2400);}
    if(banner==='mission'){
      const view=S.cineView;if(view){({pitch,zoomMul,rotv,topDown,chase}=view);camOff.x=view.x;camOff.y=view.y;}
      S.cineT=null;refreshModalState(glc);
    }
    $('result').hidden=true;invalidateFrame();
  }
};
$('helpBtn').onclick=openHelp;$('helpClose').onclick=closeHelp;
$('go').onclick=start;$('resume').onclick=resume;$('pauseBtn').onclick=togglePause;
{const b=$('minBtn'),setMini=m=>{app.classList.toggle('mini',m);b.setAttribute('aria-pressed',m);b.textContent='Mirroring mode · '+(m?'on':'off');try{localStorage.setItem('sternto-mini',m?'1':'0');}catch(e){}};
 try{if(localStorage.getItem('sternto-mini')==='1')setMini(true);}catch(e){}
 b.onclick=()=>setMini(!app.classList.contains('mini'));
 ['dock','gLines'].forEach(id=>{const el=$(id);let t=0;el.addEventListener('pointerdown',()=>{el.classList.add('woke');clearTimeout(t);},true);
   ['pointerup','pointercancel'].forEach(n=>el.addEventListener(n,()=>{clearTimeout(t);t=setTimeout(()=>el.classList.remove('woke'),2200);},true));});}
{const P=['pos-m','pos-r','pos-l'],d=$('dock'),setP=c=>{P.forEach(k=>d.classList.toggle(k,k===c));try{localStorage.setItem('sternto-dockpos',c);}catch(e){}};
 try{const c=localStorage.getItem('sternto-dockpos');if(P.includes(c))setP(c);}catch(e){}
 $('dockPos').onclick=()=>{const cur=P.find(k=>d.classList.contains(k))||'pos-m';setP(P[(P.indexOf(cur)+1)%3]);};}$('menuBtn').onclick=openMenu;
$('midBtn').onclick=()=>{if(canDrive())setRud(0);};$('rMenu').onclick=openMenu;$('rRetry').onclick=start;
$('rNext').onclick=()=>{if(banner==='dep'){$('result').hidden=true;passage();}else startDepart(true);};

/* ---------- boot ---------- */
function boot(d){
  addEventListener('resize',invalidateLayout);
  const ro=new ResizeObserver(invalidateLayout);[app,hudEl,$('dock'),$('gLines')].forEach(el=>ro.observe(el));
  const mo=new MutationObserver(invalidateLayout);[app,$('dock')].forEach(el=>mo.observe(el,{attributes:true,attributeFilter:['class']}));
  for(const type of ['pointerdown','pointermove','pointerup','wheel','keydown','keyup','input','click','focusin'])document.addEventListener(type,invalidateFrame,{capture:true,passive:true});
  document.addEventListener('visibilitychange',()=>{
    releaseControls();resetFrameClock();
    if(document.hidden){if(state==='play'&&!hold)setPaused(true,false);cancelAnimationFrame(rafId);rafId=0;}
    else invalidateFrame();syncWakeLock();
  });
  addEventListener('pagehide',()=>{if(state==='play'&&!hold)setPaused(true,false);else releaseControls();cancelAnimationFrame(rafId);rafId=0;syncWakeLock();});
  addEventListener('pageshow',()=>{resetFrameClock();invalidateLayout();syncWakeLock();});
  lvI=d&&Number.isInteger(d.level)&&d.level>=0&&d.level<LEVELS.length?d.level:0;setShip(d&&SHIPS[d.ship]?d.ship:'super');
  resetFrameClock();invalidateLayout();
}
boot({});
}
