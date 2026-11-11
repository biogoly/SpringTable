'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
global.window={};
require('../studio/reflection.js'); require('../studio/engine.js');
const make=rings=>{const s=new window.SpringEngine.Scene(rings);s.setMode(9);return s;};
const cyan=[40,205,255], orange=[255,93,24];

// Independent oracle: every hull edge is a segment between two input centers.
// Intersect ALL center-to-center segments with the ray, retaining the farthest
// intersection. This works for circles, holed layouts, skinny polygons and lines.
function routeFor(rings,s,t) {
  const origin=rings[s], target=rings[t];
  const distances=rings.map(p=>Math.hypot(p.x-origin.x,p.y-origin.y));
  const far=Math.max(...distances), d=distances[t];
  const center=Math.max(220,Math.round((far+19)*(1000/600+1000/1500)));
  const out=Math.round(d*1000/600), life=center+160;
  if(d===0) return {out,back:center,life,width:160};
  const ux=(target.x-origin.x)/d,uy=(target.y-origin.y)/d;
  const aligned=rings.map(p=>{
    const x=p.x-origin.x,y=p.y-origin.y;
    const cross=x*uy-y*ux;
    return [x*ux+y*uy,Math.abs(cross)<=16*Number.EPSILON*(Math.abs(x*uy)+Math.abs(y*ux))?0:cross];
  });
  let end=d;
  for(let i=0;i<aligned.length;i++){
    const [pa,oa]=aligned[i];
    if(oa===0) end=Math.max(pa,end);
    for(let j=i+1;j<aligned.length;j++){
      const [pb,ob]=aligned[j];
      if((oa<0 && ob>0) || (oa>0 && ob<0)) end=Math.max(end,pa+(pb-pa)*oa/(oa-ob));
    }
  }
  const L=Math.min(far,end)+19;
  return {out,back:Math.round((L/600+(L-d)/1500)*1000),life,width:100};
}
function rgb(route,color,t) {
  if(t>=route.life) return [0,0,0];
  const env=(peak,width)=>t<peak||t>=peak+width ? 0 : Math.floor(255*(1-(t-peak)/width)+1e-10);
  const a=env(route.out,140), b=env(route.back,route.width);
  return color.map(c=>Math.max(Math.round(c*a/255),Math.round(Math.floor((2*c+255)/3)*b/255)));
}
function checkLayout(rings, sourceIds) {
  const s=make(rings);
  let routes=0;
  for(const i of sourceIds){
    const actual=s.reflection.route(i);
    for(let j=0;j<rings.length;j++){
      const r=routeFor(rings,i,j);
      assert.equal(actual.out[j],r.out);
      assert.equal(actual.back[j],r.back,'source '+i+' target '+j+' in '+JSON.stringify(rings));
      assert.equal(actual.lifetime,r.life);++routes;
    }
  }
  return routes;
}

const circle=Array.from({length:42},(_,i)=>({x:814+400*Math.cos(i*2*Math.PI/42),y:-747+400*Math.sin(i*2*Math.PI/42)}));
const spiral=Array.from({length:54},(_,i)=>({x:Math.cos(i*2.4)*26*Math.sqrt(i),y:Math.sin(i*2.4)*26*Math.sqrt(i)}));
const arc=Array.from({length:34},(_,i)=>({x:3+540*Math.cos((i-10)*.07),y:5+810*Math.sin((i-10)*.07)}));
const line=Array.from({length:13},(_,i)=>({x:215+73.2*i,y:-20+31.1*i}));
const large=[{x:100000,y:-100000},{x:-100000,y:100000},{x:-100000,y:-100000},
             {x:100000,y:100000},{x:87513,y:-87488},{x:0,y:0}];
const skinny=[{x:0,y:0},{x:99999,y:0},{x:99999,y:.0003},{x:2000,y:.0000006},{x:50000,y:.00015}];
const duplicates=[{x:-1,y:27},{x:-1,y:27},{x:21,y:-91},{x:21,y:-91}];
let routes=0;
for(const shape of [circle,spiral,arc,line,large,skinny,duplicates,[{x:1,y:2}]]){
  const selected=shape.length>20 ? [0,1,6,12,shape.length-1] : Array.from({length:shape.length},(_,i)=>i);
  routes+=checkLayout(shape,selected);
}
const s=make(spiral), start=0xfffffee0;
s.press(0,start);s.press(0,start+1);s.release(0);s.press(23,start+70);s.release(23);
const first=spiral.map((_,j)=>routeFor(spiral,0,j)), second=spiral.map((_,j)=>routeFor(spiral,23,j));
let bytes=0;
for(let t=70;t<=Math.max(first[0].life,second[0].life+70)+30;t+=19) {
  const f=s.frame((start+t)>>>0,200000);
  assert.equal(f.activeWaves,Number(t<first[0].life)+Number(t-70<second[0].life));
  for(let i=0;i<spiral.length;i++) {
    const a=rgb(first[i],cyan,t),b=rgb(second[i],orange,t-70);
    for(let p=0;p<16;p++)for(let c=0;c<3;c++){
      assert.equal(f.pixels[(i*16+p)*3+c],Math.min(255,a[c]+b[c]));++bytes;
    }
  }
}
const single=make([{x:140,y:-283}]);single.press(0,0);single.release(0);
const singleCodes=t=>Array.from(single.frame(t,40000).pixels.slice(0,3));
assert.deepEqual(singleCodes(0),cyan);assert.deepEqual(singleCodes(140),[0,0,0]);
assert.deepEqual(singleCodes(220),cyan.map(c=>Math.floor((2*c+255)/3)));
assert.deepEqual(singleCodes(380),[0,0,0]); assert.equal(single.frame(380,40000).activeWaves,0);
const huge=make(large);huge.press(0,0);huge.release(0);
assert(huge.reflection.route(0).out[1]>65535);
assert.deepEqual(Array.from(huge.frame(huge.reflection.route(0).out[1],40000).pixels.slice(48,51)),cyan);
assert.equal(make([]).frame(0,40000).activeWaves,0);

const bigCircle=Array.from({length:400},(_,i)=>({x:650*Math.cos(2*Math.PI*i/400),y:650*Math.sin(2*Math.PI*i/400)}));
const big=make(bigCircle);
let stamp=performance.now();
for(let i=0;i<400;i++){big.press(i,0);big.release(i);}
const launchMs=performance.now()-stamp;
assert.equal(big.frame(4,40000).activeWaves,128);
assert.equal(big.reflection.waves[0].route,big.reflection.route(272));
big.setMode(9);assert.equal(big.frame(40,40000).activeWaves,128);
let limited=0;
stamp=performance.now();
for(let j=0;j<120;j++){
  const f=big.frame(50+j*16,8000);
  assert.equal(f.activeWaves,128);
  assert(f.sentMa<=8000 && f.sentMa<=f.requestedMa);limited+=Number(f.gain<1);
}
assert(limited);
const frameMs=(performance.now()-stamp)/120;
big.setMode(0);big.setMode(9);assert.equal(big.frame(2100,40000).activeWaves,0);
console.log(routes,'source-target routes match independent all-pairs segment intersections;',bytes,'RGB bytes match analytic two-wave oracle.');
console.log('Verified held/release, echo timing, empty/single/duplicate, skinny/hollow/large/translated outlines, rollover, capacity, budget, re-entry.');
console.log('400-ring circle: building 400 source routes in one burst',launchMs.toFixed(1),'ms; rendering 128 active waves',frameMs.toFixed(2),'ms/frame (Node, simulation only).');
