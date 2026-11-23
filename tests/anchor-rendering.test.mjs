import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createGameHarness } from './helpers/game-harness.mjs';

const ships=['tender','super','ls'];
const poses=[[0,0,0],[1.1,.18,-.12],[-2.3,-.2,.09]];

function game(t){const h=createGameHarness();t.after(()=>h.close());return h;}
function select(h,ship){h.run(`setShip(${JSON.stringify(ship)});`);}
function pose(h,[yaw,heel,pitch]=poses[1],heave=.37){
  h.run(`RX=S.x=123;RY=S.y=-87;RP=S.psi=${yaw};Object.assign(ownDyn,{y:${heave},rx:${heel},rz:${pitch},vy:0,vrx:0,vrz:0});sync3D(0);`);
}
function anchors(h,age=2){
  // Reverse the two-anchor array: the rendered side must follow the equipment, not its index.
  h.run(`S.anchors=(shipId==='tender'?[0]:[1,-1]).map(side=>{
    const hp=hawseFor(side),x=hp[0]+6,y=hp[1]+(side||1)*4,c=Math.cos(S.psi),s=Math.sin(S.psi);
    return {side,x:S.x+x*c-y*s,y:S.y+x*s+y*c,L0:24.07,held:true,t:${age}};
  });sync3D(0);`);
}
function equipment(h){return h.run(`({models:anchorModels,eyes:anchorEyes,sockets:anchorHawse,chain:chainLinks,model:ownModel,pockets:anchorPocketGeometries,count:shipId==='tender'?1:2})`);}
const world=object=>object.getWorldPosition(new THREE.Vector3());

function surfaceDistance(mesh,point){
  mesh.updateWorldMatrix(true,false);
  const p=mesh.worldToLocal(point.clone()),geometry=mesh.geometry,positions=geometry.attributes.position,index=geometry.index;
  const triangle=new THREE.Triangle(),closest=new THREE.Vector3();let distance=Infinity;
  for(let i=0,n=index?index.count:positions.count;i<n;i+=3){
    triangle.a.fromBufferAttribute(positions,index?index.getX(i):i);
    triangle.b.fromBufferAttribute(positions,index?index.getX(i+1):i+1);
    triangle.c.fromBufferAttribute(positions,index?index.getX(i+2):i+2);
    triangle.closestPointToPoint(p,closest);distance=Math.min(distance,p.distanceTo(closest));
  }
  return distance;
}

function closestLink(chain,point,envelope=false){
  chain.updateWorldMatrix(true,false);chain.geometry.computeBoundingBox();
  const instance=new THREE.Matrix4(),matrix=new THREE.Matrix4(),p=new THREE.Vector3();let distance=Infinity;
  for(let i=0;i<chain.count;i++){
    chain.getMatrixAt(i,instance);matrix.multiplyMatrices(chain.matrixWorld,instance);
    if(envelope){p.copy(point).applyMatrix4(matrix.invert());distance=Math.min(distance,chain.geometry.boundingBox.distanceToPoint(p));}
    else{p.setFromMatrixPosition(matrix);distance=Math.min(distance,p.distanceTo(point));}
  }
  return distance;
}

function attached(chain,socket,label){
  assert.ok(closestLink(chain,world(socket),true)<3e-5,`${label}: actual link geometry crosses the hawse opening`);
}
function finiteLinks(chain,scale){
  const matrix=new THREE.Matrix4(),a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3();
  for(let i=0;i<chain.count;i++){
    chain.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite),'finite link transform');
    matrix.extractBasis(a,b,c);
    for(const axis of [a,b,c])assert.ok(Math.abs(axis.length()-scale)<1e-6,'links keep their original size');
    assert.ok(Math.max(Math.abs(a.dot(b)),Math.abs(a.dot(c)),Math.abs(b.dot(c)))<1e-6,'link axes remain perpendicular');
  }
}

test('stowed anchor eyes meet the actual hull pocket through all vessel scales and poses',t=>{
  const h=game(t);
  for(const ship of ships){
    select(h,ship);
    for(const angles of poses){
      pose(h,angles);const e=equipment(h);
      assert.notEqual(e.eyes[0],e.eyes[1],'each anchor has its own shackle marker');
      for(let i=0;i<e.count;i++){
        const socket=world(e.sockets[i]),eye=world(e.eyes[i]);
        assert.ok(eye.distanceTo(socket)<1e-9,`${ship}: stowed shackle and hawse coincide`);
        const surface=ship==='tender'?e.model.children[0]:e.model.children.find(mesh=>mesh.geometry===e.pockets[i]);
        assert.ok(surfaceDistance(surface,socket)<1e-5,`${ship}: socket lies on the rendered hull or pocket surface`);
        assert.equal(e.models[i].visible,true);
      }
      assert.equal(e.chain.count,0,'stowed anchors leave no floating chain');
      if(ship==='tender')assert.equal(e.models[1].visible,false);
    }
  }
  assert.deepEqual(h.errors,[]);assert.equal(h.fetchCalls.length,0);
});

test('deployed chain stays attached throughout pay-out phases without stretching its links',t=>{
  const h=game(t);
  for(const ship of ships){
    select(h,ship);pose(h);anchors(h);
    const e=equipment(h),matrixBuffer=e.chain.instanceMatrix,colorBuffer=e.chain.instanceColor;
    for(const phase of [0,.01,.049,.099,.149,.199]){
      h.run(`for(const A of S.anchors)A.L0=24+${phase};sync3D(0);`);
      for(let i=0;i<e.count;i++)attached(e.chain,e.sockets[i],`${ship}, phase ${phase}`);
      assert.ok(e.chain.count>0&&e.chain.count<=h.run('LINK_MAX'));
      finiteLinks(e.chain,ship==='tender'?.5:1);
      assert.equal(e.chain.instanceMatrix,matrixBuffer);assert.equal(e.chain.instanceColor,colorBuffer);
      assert.deepEqual(h.read('chainLinks.instanceMatrix.updateRanges'),[{start:0,count:e.chain.count*16}]);
      assert.deepEqual(h.read('chainLinks.instanceColor.updateRanges'),[{start:0,count:e.chain.count*3}]);
    }
  }
  assert.deepEqual(h.errors,[]);
});

test('falling chain follows each transformed shackle through the underwater visibility transition',t=>{
  const h=game(t);
  for(const ship of ships){
    select(h,ship);pose(h,poses[2]);anchors(h,0);
    const e=equipment(h);assert.equal(e.chain.count,0,'release begins with the eye seated in its pocket');
    for(const age of [.005,.3,.899,.901,.949]){
      h.run(`for(const A of S.anchors)A.t=${age};sync3D(0);`);
      for(let i=0;i<e.count;i++){
        assert.ok(closestLink(e.chain,world(e.eyes[i]))<3e-5,`${ship}, age ${age}: chain ends at its matching shackle`);
        attached(e.chain,e.sockets[i],`${ship}, age ${age}`);
        assert.equal(e.models[i].visible,age<.9);
      }
      finiteLinks(e.chain,ship==='tender'?.5:1);
    }
    h.run('for(const A of S.anchors)A.t=.95;sync3D(0);');
    for(let i=0;i<e.count;i++){attached(e.chain,e.sockets[i],`${ship}: settled chain`);assert.equal(e.models[i].visible,false);}
    finiteLinks(e.chain,ship==='tender'?.5:1);
  }
  assert.deepEqual(h.errors,[]);
});

test('the retrieval animation keeps its chain connected until the anchor reaches its pocket',t=>{
  const h=game(t);
  for(const ship of ships){
    select(h,ship);pose(h);const e=equipment(h);
    for(const progress of [1,.6,.02]){
      h.run(`S.anchors=[];S.weigh={'-1':${progress},'0':${progress},'1':${progress}};sync3D(0);`);
      for(let i=0;i<e.count;i++){
        attached(e.chain,e.sockets[i],`${ship}: retrieval ${progress}`);
        assert.ok(closestLink(e.chain,world(e.eyes[i]))<3e-5,'retrieval chain reaches the actual anchor eye');
        assert.equal(e.models[i].visible,true);
      }
    }
    h.run("S.weigh={'-1':0,'0':0,'1':0};sync3D(0);");
    assert.equal(e.chain.count,0);
    for(let i=0;i<e.count;i++)assert.ok(world(e.eyes[i]).distanceTo(world(e.sockets[i]))<1e-9);
  }
  assert.deepEqual(h.errors,[]);
});

test('link capacity preserves both hawse connections and reuses geometry across vessel changes',t=>{
  const h=game(t),initial=equipment(h),resources=new Set([...initial.pockets,...initial.models.flatMap(model=>model.children.filter(child=>child.isMesh).flatMap(mesh=>[mesh.geometry,mesh.material]))]);
  let disposed=0;for(const resource of resources)resource.addEventListener('dispose',()=>disposed++);
  const geometry=initial.chain.geometry,matrix=initial.chain.instanceMatrix,colors=initial.chain.instanceColor;
  for(const ship of ['super','tender','ls','super']){
    select(h,ship);pose(h,poses[1],100);anchors(h); // Stress only the visual pool; the simulation is not advanced.
    const e=equipment(h);assert.equal(e.chain.count,h.run('LINK_MAX'));
    for(let i=0;i<e.count;i++)attached(e.chain,e.sockets[i],`${ship}: full link pool`);
    assert.equal(e.chain.geometry,geometry);assert.equal(e.chain.instanceMatrix,matrix);assert.equal(e.chain.instanceColor,colors);
    assert.equal(e.sockets[0],initial.sockets[0]);assert.equal(e.sockets[1],initial.sockets[1]);
    finiteLinks(e.chain,ship==='tender'?.5:1);
  }
  assert.equal(disposed,0,'shared anchor and pocket resources survive vessel rebuilds');
  assert.deepEqual(h.errors,[]);assert.equal(h.fetchCalls.length,0);
});
