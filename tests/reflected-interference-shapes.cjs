'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
global.window={};
require('../studio/reflection.js'); require('../studio/interference.js'); require('../studio/engine.js');
const make=rings=>{const s=new window.SpringEngine.Scene(rings);s.setMode(11);return s;};
const pluck=(s,i,t)=>{s.press(i,t);s.release(i);};
const hue=sum=>(sum>0?[40,210,255]:[95,65,190]).map(c=>Math.round(c*Math.min(255,Math.abs(sum))/255));

// Independent geometry, using ray intersections with every segment between
// two centers instead of either the production hull or the firmware routes.
function route(rings,index) {
  const s=rings[index], rel=rings.map(p=>[p.x-s.x,p.y-s.y]);
  const far=Math.max(...rel.map(([x,y])=>Math.hypot(x,y)));
  const f=rel.map(([dx,dy])=>{
    const d=Math.hypot(dx,dy);
    if(!d)return [0,Math.max(220,Math.round((far+19)*7/3))];
    const ux=dx/d,uy=dy/d;
    const vertices=rel.map(([x,y])=>{
      const across=x*uy-y*ux;
      return [x*ux+y*uy,Math.abs(across)<16*Number.EPSILON*(Math.abs(x*uy)+Math.abs(y*ux))?0:across];
    });
    let edge=d;
    for(let i=0;i<vertices.length;i++){
      const [a,g]=vertices[i];
      if(!g)edge=Math.max(edge,a);
      for(let j=i+1;j<vertices.length;j++){
        const [b,h]=vertices[j];
        if((g>0 && h<0) || (g<0 && h>0))edge=Math.max(edge,a+(b-a)*g/(g-h));
      }
    }
    const L=Math.min(far,edge)+19;
    return [Math.round(d*5/3),Math.round(L*5/3+(L-d)*2/3)];
  });
  return {f,lifetime:Math.max(...f.map(p=>p[1]))+1600};
}
function oscillate(t) {
  if(t<0||t>=1600)return 0;
  const x=120*Math.cos(2*Math.PI*t/400);
  const signed=Math.sign(x)*Math.floor(Math.abs(x)+0.5);
  return Math.sign(signed)*Math.floor(Math.abs(signed)*Math.min(400,1600-t)/400+0.5);
}
function verify(rings,events,now,frame) {
  const amplitudes=rings.map(()=>0);let active=0;
  for(const event of events){
    const age=(now-event.time)>>>0;
    if(age<event.route.lifetime)active++;
    event.route.f.forEach(([out,back],i)=>amplitudes[i]+=oscillate(age-out)+oscillate(age-back));
  }
  assert.equal(frame.activeWaves,active);
  amplitudes.forEach((sum,i)=>{
    const rgb=hue(sum);
    for(let p=0;p<16;p++)for(let ch=0;ch<3;ch++)
      assert.equal(frame.pixels[(i*16+p)*3+ch],rgb[ch]);
  });
  return frame.pixels.length;
}

const bench=[{x:0,y:0},{x:60,y:0},{x:120,y:0}], ends=make(bench);
pluck(ends,0,0);pluck(ends,2,0);
assert.deepEqual(Array.from(ends.frame(292,40000).pixels.slice(48,51)),[0,0,0]);
assert.deepEqual(Array.from(ends.frame(392,40000).pixels.slice(48,51)),hue(-60)); // Four negative samples reinforce.
const singleTouch=make(bench);
pluck(singleTouch,0,0);
assert.deepEqual(Array.from(singleTouch.frame(250,40000).pixels.slice(96,99)),hue(204));
const aligned=[{x:0,y:0},{x:152.42857142857143,y:0}];
const overlap=make(aligned);
for(let i=0;i<3;i++)pluck(overlap,0,0);
for(let i=0;i<2;i++)pluck(overlap,0,200);
assert.deepEqual(Array.from(overlap.frame(800,40000).pixels.slice(0,3)),hue(240));
const strongest=make(aligned);
for(let i=0;i<128;i++)pluck(strongest,0,0);
strongest.frame(400,40000);assert.equal(strongest.reflectedInterference.sums[0],30720);
strongest.frame(600,40000);assert.equal(strongest.reflectedInterference.sums[0],-30720);

const circle=Array.from({length:30},(_,i)=>({x:2000+495*Math.cos(i*2*Math.PI/30),y:-433+495*Math.sin(i*2*Math.PI/30)}));
const spiral=Array.from({length:40},(_,i)=>({x:11+35*Math.sqrt(i)*Math.cos(i*2.4),y:119+35*Math.sqrt(i)*Math.sin(i*2.4)}));
const long=[{x:-100000,y:-100000},{x:100000,y:100000},{x:-100000,y:-99999.97}];
const oblique=Array.from({length:8},(_,i)=>({x:i*18.3,y:30+i*22.54}));
const start=0xffffff31;let bytes=0;
for(const rings of [circle,spiral,oblique,long,[{x:1,y:1},{x:1,y:1}]]){
  const s=make(rings), events=[];
  for(const [i,dt] of [[0,0],[rings.length-1,90],[0,267]]){
    const time=(start+dt)>>>0;
    s.press(i,time);s.press(i,time+1);s.release(i);
    events.push({time,route:route(rings,i)});
  }
  const last=Math.max(...events.map(e=>((e.time-start)>>>0)+e.route.lifetime));
  const times=new Set([267,last-2,last-1,last,last+1]);
  for(let t=267;t<last;t+=Math.max(25,Math.floor(last/95)))times.add(t);
  for(const {time,route:rt} of events)for(const peak of rt.f[rt.f.length-1])
    times.add(Math.max(267,((time-start)>>>0)+peak));
  for(const off of [...times].sort((a,b)=>a-b)){
    const t=(start+off)>>>0;
    bytes+=verify(rings,events,t,s.frame(t,200000));
  }
}
// Account for release/re-arm, blank intervals, expiry and no leftover actors on transitions.
const lone=make([{x:-20,y:19}]);
lone.press(0,0);lone.press(0,250);lone.release(0);
assert.equal(lone.frame(1819,40000).activeWaves,1);
assert.equal(lone.frame(1820,40000).activeWaves,0);
lone.setMode(10);pluck(lone,0,2000);lone.setMode(11);assert.equal(lone.frame(2000,40000).activeWaves,0);
pluck(lone,0,2000);lone.setMode(9);lone.setMode(11);assert.equal(lone.frame(2000,40000).activeWaves,0);
assert.equal(make([]).frame(0,40000).activeWaves,0);
const big=make(Array.from({length:400},(_,i)=>({x:(i%20)*60,y:Math.floor(i/20)*60})));
for(let i=0;i<400;i++)pluck(big,i,0);
assert.equal(big.frame(10,40000).activeWaves,128);
assert.equal(big.reflectedInterference.waves[0].route,big.reflectedInterference.route(272));
const t0=performance.now();let limited=0;
for(let i=0;i<150;i++){
  const f=big.frame(i*16,7000);
  assert(f.sentMa<=7000 && f.sentMa<=f.requestedMa);limited+=Number(f.gain<1);
}
assert(limited);
console.log(bytes,'RGB bytes match independent segment-intersection and signed-cosine oracle.');
console.log('Verified direct/echo crest-trough annihilation, four-sample constructive reinforcement, signed ±30720 extremes, preclip cancellation, rollover, empty/degenerate/long-distance, capacity, budget, transitions and expiry.');
console.log('400 rings/128 plucks: '+((performance.now()-t0)/150).toFixed(2)+' ms/frame (Node, simulation only).');
