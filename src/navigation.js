// Lightweight harbour traffic and route guidance. Metres, seconds and radians;
// x points east, y south, so positive heading changes turn to starboard.
const PI=Math.PI,DEG=PI/180,KNOTS=1.94384;
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const angle=a=>Math.atan2(Math.sin(a),Math.cos(a));
const position=v=>[v.x,v.y];
const velocity=v=>[v.vx??Math.cos(v.heading??0)*(v.speed??0),v.vy??Math.sin(v.heading??0)*(v.speed??0)];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const polygonBounds=new WeakMap();
function bounds(polygon){
  let b=polygonBounds.get(polygon);if(b)return b;
  b=[Infinity,Infinity,-Infinity,-Infinity];
  for(const p of polygon){b[0]=Math.min(b[0],p[0]);b[1]=Math.min(b[1],p[1]);b[2]=Math.max(b[2],p[0]);b[3]=Math.max(b[3],p[1]);}
  polygonBounds.set(polygon,b);return b;
}

function pointSegmentSquared(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,t=d?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d,0,1):0;
  return(p[0]-a[0]-dx*t)**2+(p[1]-a[1]-dy*t)**2;
}
function segmentsCross(a,b,c,d){
  const abx=b[0]-a[0],aby=b[1]-a[1],cdx=d[0]-c[0],cdy=d[1]-c[1],acx=c[0]-a[0],acy=c[1]-a[1],den=abx*cdy-aby*cdx;
  if(Math.abs(den)<1e-9)return false;
  const t=(acx*cdy-acy*cdx)/den,u=(acx*aby-acy*abx)/den;
  return t>=0&&t<=1&&u>=0&&u<=1;
}
function segmentDistanceSquared(a,b,c,d){
  if(segmentsCross(a,b,c,d))return 0;
  return Math.min(pointSegmentSquared(a,c,d),pointSegmentSquared(b,c,d),pointSegmentSquared(c,a,b),pointSegmentSquared(d,a,b));
}
function inside(point,polygon){
  let hit=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])hit=!hit;
  }
  return hit;
}

export function segmentClear(start,end,polygons,clearance=0){
  const r2=Math.max(0,clearance)**2+1e-8;
  const x0=Math.min(start[0],end[0])-clearance,y0=Math.min(start[1],end[1])-clearance,x1=Math.max(start[0],end[0])+clearance,y1=Math.max(start[1],end[1])+clearance;
  for(const polygon of polygons){
    const b=bounds(polygon);if(x1<b[0]||x0>b[2]||y1<b[1]||y0>b[3])continue;
    if(inside(start,polygon)||inside(end,polygon))return false;
    for(let i=0;i<polygon.length;i++)if(segmentDistanceSquared(start,end,polygon[i],polygon[(i+1)%polygon.length])<=r2)return false;
  }
  return true;
}

// A small visibility graph over authored clear-water junctions. This guides a
// skipper to an approach; it does not steer or assume the yacht's final heading.
export function planWaterRoute(start,goal,waypoints,polygons,clearance){
  if(segmentClear(start,goal,polygons,clearance))return[[...goal]];
  const nodes=[[...start],[...goal],...waypoints.filter(p=>segmentClear(p,p,polygons,clearance)).map(p=>[...p])];
  const cost=nodes.map(()=>Infinity),previous=nodes.map(()=>-1),visited=new Set();cost[0]=0;
  for(let count=0;count<nodes.length;count++){
    let current=-1;for(let i=0;i<nodes.length;i++)if(!visited.has(i)&&(current<0||cost[i]<cost[current]))current=i;
    if(current<0||!Number.isFinite(cost[current]))break;if(current===1)break;visited.add(current);
    for(let i=1;i<nodes.length;i++)if(!visited.has(i)&&i!==current&&segmentClear(nodes[current],nodes[i],polygons,clearance)){
      const next=cost[current]+distance(nodes[current],nodes[i]);if(next<cost[i]-1e-8){cost[i]=next;previous[i]=current;}
    }
  }
  if(!Number.isFinite(cost[1]))return[];
  const route=[];for(let at=1;at>0;at=previous[at])route.push(nodes[at]);return route.reverse();
}

export function closestApproach(own,other,horizon=24){
  const relative=sub(position(other),position(own)),v=sub(velocity(other),velocity(own)),v2=dot(v,v);
  const raw=v2>1e-8?-dot(relative,v)/v2:0,time=clamp(raw,0,horizon);
  return {time,distance:Math.hypot(relative[0]+v[0]*time,relative[1]+v[1]*time),range:Math.hypot(...relative),closing:dot(relative,v)<-1e-6,future:raw>=0&&raw<=horizon};
}

export function classifyEncounter(own,other){
  const relative=sub(position(other),position(own)),bearing=angle(Math.atan2(relative[1],relative[0])-(own.heading??0));
  const reverse=angle(Math.atan2(-relative[1],-relative[0])-(other.heading??0)),course=Math.abs(angle((other.heading??0)-(own.heading??0)));
  const ours=Math.hypot(...velocity(own)),theirs=Math.hypot(...velocity(other)),cpa=closestApproach(own,other);
  const safe=(own.length+other.length)*.5+(own.beam+other.beam)*.5+5;
  const risk=cpa.closing&&cpa.future&&cpa.distance<safe||hullGap(own,other,0)<2;
  let kind='clear';
  if(theirs<.15)kind='stationary';
  else if(course>150*DEG&&Math.abs(bearing)<20*DEG&&Math.abs(reverse)<20*DEG)kind='head-on';
  else if(Math.abs(reverse)>112.5*DEG&&ours>theirs+.1)kind='overtaking';
  else if(Math.abs(bearing)>112.5*DEG&&theirs>ours+.1)kind='being-overtaken';
  else if(course>15*DEG&&Math.abs(bearing)<112.5*DEG)kind=bearing>=0?'give-way':'stand-on';
  return {kind,risk,bearing,...cpa};
}

function capsule(v,margin=1){
  const half=v.length*.5,c=Math.cos(v.heading)*half,s=Math.sin(v.heading)*half;
  return {a:[v.x-c,v.y-s],b:[v.x+c,v.y+s],radius:v.beam*.5+margin};
}
function clearHull(v,polygons,margin=1){const c=capsule(v,margin);return segmentClear(c.a,c.b,polygons,c.radius);}
function hullGap(a,b,margin=1){
  const ca=capsule(a,margin),cb=capsule(b,margin);
  return Math.sqrt(segmentDistanceSquared(ca.a,ca.b,cb.a,cb.b))-ca.radius-cb.radius;
}
function advance(v,heading,speed,dt){
  const nextSpeed=v.speed+clamp(speed-v.speed,-.7*dt,.35*dt),turn=.18*Math.sqrt(30/Math.max(12,v.length));
  const nextHeading=angle(v.heading+clamp(angle(heading-v.heading),-turn*dt,turn*dt)*clamp(nextSpeed/.8,0,1));
  return {...v,x:v.x+Math.cos(nextHeading)*nextSpeed*dt,y:v.y+Math.sin(nextHeading)*nextSpeed*dt,heading:nextHeading,speed:nextSpeed};
}
function advanceClear(v,heading,speed,dt,polygons){
  const next=advance(v,heading,speed,dt);if(clearHull(next,polygons,1.5))return next;
  // Near a quay, the stern also sweeps out while turning away. Ease the turn
  // until forward movement creates room, using the same rule in prediction.
  const turn=angle(next.heading-v.heading);
  for(const fraction of [.5,.25,0]){
    const eased=angle(v.heading+turn*fraction),candidate={...next,x:v.x+Math.cos(eased)*next.speed*dt,y:v.y+Math.sin(eased)*next.speed*dt,heading:eased};
    if(clearHull(candidate,polygons,1.5))return candidate;
  }
  return null;
}

function chooseControl(vessel,goal,contacts,polygons,memory){
  const wanted=Math.atan2(goal[1]-vessel.y,goal[0]-vessel.x),cruise=vessel.cruiseSpeed;
  const encounters=contacts.map(contact=>({contact,rule:classifyEncounter(vessel,contact)}));
  const risks=encounters.filter(e=>e.rule.risk).sort((a,b)=>a.rule.time-b.rule.time||String(a.contact.id).localeCompare(String(b.contact.id)));
  const primary=risks[0],rule=primary?.rule.kind??'clear',horizon=18;
  let starboardAvailable=true;
  if(rule==='head-on'||rule==='give-way'){
    let probe={...vessel};
    for(let i=0;i<8;i++){probe=advance(probe,angle(vessel.heading+30*DEG),cruise,1);if(!clearHull(probe,polygons,1.5)){starboardAvailable=false;break;}}
  }
  const offsets=[0,15,-15,30,-30,50,-50,75,-75,105,-105];
  const headings=offsets.map(offset=>angle(wanted+offset*DEG));
  if(rule==='head-on'||rule==='give-way')for(const turn of [0,15,30,50,75,105]){
    const heading=angle(vessel.heading+turn*DEG);if(!headings.some(h=>Math.abs(angle(h-heading))<1e-6))headings.push(heading);
  }
  let best=null;
  for(const heading of headings)for(const factor of [1,.55,0]){
    const offset=angle(heading-wanted)/DEG,turn=angle(heading-vessel.heading)/DEG,speed=cruise*factor;
    let future={...vessel},clear=true,minGap=Infinity,passingAhead=false;
    for(let elapsed=.75;elapsed<=horizon;elapsed+=.75){
      future=advanceClear(future,heading,speed,.75,polygons);
      if(!future){clear=false;break;}
      for(const {contact,rule:contactRule} of encounters){
        // A stand-on vessel holds course until avoiding action becomes necessary.
        const window=contactRule.kind==='stand-on'||contactRule.kind==='being-overtaken'?Math.max(7,vessel.speed/.7+3):horizon;
        if(elapsed>window)continue;
        const [vx,vy]=velocity(contact),other={...contact,x:contact.x+vx*elapsed,y:contact.y+vy*elapsed};
        const gap=hullGap(future,other,2);minGap=Math.min(minGap,gap);
        if(gap<0){clear=false;break;}
        if(contactRule.kind==='give-way'&&contactRule.risk&&gap<20){
          const along=(future.x-other.x)*Math.cos(other.heading)+(future.y-other.y)*Math.sin(other.heading);
          if(along>0)passingAhead=true;
        }
      }
      if(!clear)break;
    }
    if(!clear)continue;
    // The authored course is the normal action. Search alternatives only when
    // it is obstructed or an encounter requires an early give-way manoeuvre.
    if(offset===0&&factor===1&&(!primary||rule==='stand-on'||rule==='being-overtaken'))return{heading,speed,side:0,reason:'following',encounter:rule};
    const side=Math.sign(turn),starboardDuty=starboardAvailable&&(rule==='head-on'||rule==='give-way');
    let score=distance(position(future),goal)+Math.abs(offset)*.15+(cruise-speed)*12;
    if(starboardDuty&&turn<0)score+=250;
    if(passingAhead)score+=180;
    if((rule==='stand-on'||rule==='being-overtaken')&&primary.rule.time>9)score+=Math.abs(offset)*.6+(cruise-speed)*15;
    if(memory.hold>0&&side&&memory.side&&side!==memory.side)score+=35;
    if(Number.isFinite(minGap))score+=8/Math.max(1,minGap);
    if(!best||score<best.score)best={heading,speed,side,score};
  }
  if(!best)return{heading:vessel.heading,speed:0,side:memory.side??0,reason:'blocked',encounter:rule};
  return{...best,reason:best.speed<cruise*.2?'waiting':best.side?'avoiding':'following',encounter:rule};
}

// Replans at a bounded rate, integrates every fixed step, then checks the actual
// swept motion before committing it. No random decisions or DOM dependencies.
export function planTrafficStep({vessel,goal,contacts=[],obstacles=[],dt,memory={}}){
  if(!(dt>0))return{x:vessel.x,y:vessel.y,heading:vessel.heading,speed:vessel.speed,memory:{...memory},reason:memory.reason??'waiting',encounter:memory.encounter??'clear'};
  const next={...memory,replan:(memory.replan??0)-dt,hold:Math.max(0,(memory.hold??0)-dt)};
  if(next.replan<=0||!Number.isFinite(next.heading)){
    const choice=chooseControl(vessel,goal,contacts,obstacles,next);
    if(choice.side&&choice.side!==next.side)next.hold=2;
    Object.assign(next,choice,{replan:.2});
  }
  let moved=advanceClear(vessel,next.heading,next.speed,dt,obstacles),blocked=!moved;
  if(!moved)moved={...vessel,speed:0};
  for(const fraction of [.5,1]){
    const sample={...moved,x:vessel.x+(moved.x-vessel.x)*fraction,y:vessel.y+(moved.y-vessel.y)*fraction,heading:angle(vessel.heading+angle(moved.heading-vessel.heading)*fraction)};
    if(!clearHull(sample,obstacles,.35)){blocked=true;break;}
    for(const contact of contacts){const [vx,vy]=velocity(contact),other={...contact,x:contact.x+vx*dt*fraction,y:contact.y+vy*dt*fraction};if(hullGap(sample,other,.35)<0){blocked=true;break;}}
    if(blocked)break;
  }
  if(blocked){moved={...vessel,speed:0};next.speed=0;next.replan=Math.max(.1,next.replan);next.reason='blocked';}
  return{x:moved.x,y:moved.y,heading:moved.heading,speed:moved.speed,memory:next,reason:next.reason,encounter:next.encounter};
}

export function navigationAdvice(own,contacts,{harbour=false,speedLimit=6}={}){
  const risk=contacts.map(other=>({...classifyEncounter(own,other),id:other.id})).filter(rule=>rule.risk).sort((a,b)=>a.time-b.time||a.range-b.range)[0];
  const messages={'head-on':'Head-on traffic · turn to starboard','give-way':'Crossing traffic · give way and pass astern','stand-on':'Crossing traffic · hold course and keep watch',overtaking:'Overtaking · keep clear','being-overtaken':'Being overtaken · hold course',stationary:'Stopped vessel · keep clear'};
  const speed=Math.hypot(...velocity(own))*KNOTS,overspeed=harbour&&speed>speedLimit+.3;
  return{text:risk?(messages[risk.kind]??'Close traffic · keep clear'):overspeed?'Harbour speed · '+speedLimit+' kn':'',kind:risk?.kind??(overspeed?'speed':'clear'),risk:!!risk,contactId:risk?.id??null,speedLimit:harbour?speedLimit:null,overspeed};
}
