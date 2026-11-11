'use strict';
const assert=require('node:assert/strict');
const {performance}=require('node:perf_hooks');
global.window={};
require('../studio/interference.js'); require('../studio/engine.js');
const make=rings=>{const s=new window.SpringEngine.Scene(rings);s.setMode(10);return s;};
const releasePulse=(scene,index,now)=>{scene.press(index,now);scene.release(index);};

// Sample the signed cosine directly rather than mirroring a quarter lookup.
function oscillation(t) {
  if(t<0 || t>=1600)return 0;
  const real=120*Math.cos(2*Math.PI*t/400);
  const value=Math.sign(real)*Math.floor(Math.abs(real)+0.5);
  const numerator=Math.abs(value)*Math.min(400,1600-t);
  return Math.sign(value)*Math.floor(numerator/400+0.5);
}
function ink(sum) {
  const tint=sum>0?[40,210,255]:[95,65,190];
  return tint.map(c=>Math.round(c*Math.min(255,Math.abs(sum))/255));
}
function expectFrame(rings,launches,time,frame) {
  const sums=rings.map(()=>0); let active=0;
  for(const [source,born] of launches) {
    const ages=(time-born)>>>0;
    const d=rings.map(r=>Math.round(Math.hypot(r.x-rings[source].x,r.y-rings[source].y)*5/3));
    if(ages<1600+Math.max(...d)) active++;
    d.forEach((delay,i)=>sums[i]+=oscillation(ages-delay));
  }
  assert.equal(frame.activeWaves,active);
  sums.forEach((sum,i)=>{const rgb=ink(sum);
    for(let p=0;p<16;p++)for(let c=0;c<3;c++){
      assert.equal(frame.pixels[(i*16+p)*3+c],rgb[c]);
    }
  });
  return frame.pixels.length;
}
const bench=[{x:0,y:0},{x:60,y:0},{x:120,y:0}];
const ends=make(bench);
for(const i of [0,2])releasePulse(ends,i,0);
assert.deepEqual(Array.from(ends.frame(400,40000).pixels),new Array(144).fill(0));
assert.deepEqual(Array.from(ends.frame(500,40000).pixels.slice(48,51)),[38,198,240]);
// Opposite phasing must cancel before any per-channel rounding or clipping.
const cancellation=make([{x:0,y:0}]);
for(let i=0;i<3;i++)releasePulse(cancellation,0,0);
assert.deepEqual(Array.from(cancellation.frame(0,40000).pixels.slice(0,3)),[40,210,255]);
for(let i=0;i<2;i++)releasePulse(cancellation,0,200);
assert.deepEqual(Array.from(cancellation.frame(400,40000).pixels.slice(0,3)),ink(120));

let bytes=0;
const lone=[{x:70,y:-39}], scalar=make(lone);
scalar.press(0,0);scalar.press(0,10);scalar.release(0);
for(let t=0;t<=1600;t++)bytes+=expectFrame(lone,[[0,0]],t,scalar.frame(t,40000));
const spiral=Array.from({length:35},(_,i)=>({x:71+34*Math.sqrt(i)*Math.cos(i*2.4),y:-19+34*Math.sqrt(i)*Math.sin(i*2.4)}));
const hollow=Array.from({length:24},(_,i)=>({x:3400+360*Math.cos(i*Math.PI/12),y:-925+360*Math.sin(i*Math.PI/12)}));
const large=[{x:-100000,y:-100000},{x:100000,y:100000},{x:40000,y:-60000}];
const duplicate=[{x:11,y:42},{x:11,y:42},{x:60,y:71}];
const start=0xffffff9e;
for(const rings of [spiral,hollow,large,duplicate]){
  const s=make(rings), launches=[[0,start],[1,(start+61)>>>0],[rings.length-1,(start+102)>>>0]];
  for(const [i,t] of launches)releasePulse(s,i,t);
  const end=Math.max(...launches.map(([i,t])=>
    ((t-start)>>>0) + Math.max(...rings.map(r=>Math.round(Math.hypot(r.x-rings[i].x,r.y-rings[i].y)*5/3)))+1600));
  const times=new Set([102,1600,1701,1702,end-1,end,end+1]);
  for(let t=102;t<end;t+=Math.max(67,Math.floor(end/50)))times.add(t);
  for(const off of [...times].sort((a,b)=>a-b)) {
    const t=(start+off)>>>0;bytes+=expectFrame(rings,launches,t,s.frame(t,200000));
  }
}
const far=make(large);releasePulse(far,0,0);
const transit=Math.round(Math.hypot(200000,200000)*5/3);
assert(transit>65535);
assert.equal(far.frame(transit-1,40000).activeWaves,1);
assert.deepEqual(Array.from(far.frame(transit,40000).pixels.slice(48,51)),ink(120));
assert.equal(make([]).frame(0,40000).activeWaves,0);
const grid=Array.from({length:400},(_,i)=>({x:(i%20)*60,y:Math.floor(i/20)*60}));
const dense=make(grid), t0=performance.now();
for(let i=0;i<400;i++)releasePulse(dense,i,0);
const launch=performance.now()-t0;
assert.equal(dense.frame(100,40000).activeWaves,128);
assert.equal(dense.interference.waves[0].route,dense.interference.route(272));
const t1=performance.now();
let limited=0;
for(let i=0;i<150;i++){
  const f=dense.frame(i*16,7000);
  assert(f.sentMa<=7000 && f.sentMa<=f.requestedMa);limited+=Number(f.gain<1);
}
assert(limited);
const frameMs=(performance.now()-t1)/150;
dense.setMode(10);assert.equal(dense.frame(2400,40000).activeWaves,128);
dense.setMode(0);dense.setMode(10);assert.equal(dense.frame(2400,40000).activeWaves,0);
console.log(bytes,'RGB bytes exactly match analytic signed-cosine oracle over 1600 individual millisecond samples and custom layouts.');
console.log('Bench destructive/constructive, sum-before-clip, sign tint, taper, held/release, rollover, capacity, long delay, budget, re-entry checks passed.');
console.log('400 rings: burst launch of 400 origins '+launch.toFixed(2)+' ms; 128 active packets '+frameMs.toFixed(2)+' ms/frame (Node, simulation only).');
