'use strict';
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
global.window={};
require('../studio/ricochet.js'); require('../studio/drain.js'); require('../studio/engine.js');
const {Scene} = window.SpringEngine;
const make=rings=>{const s=new Scene(rings);s.setMode(8);return s;};
const cyan=[40,205,255], orange=[255,93,24];

// Brute force independent oracle. Examine every emitter for every trail point.
function geometry(rings) {
  const xs=rings.map(r=>r.x), ys=rings.map(r=>r.y);
  return {cx:(Math.max(...xs)+Math.min(...xs))/2,cy:(Math.max(...ys)+Math.min(...ys))/2,
    leds:rings.flatMap(({x,y})=>Array.from({length:16},(_,p)=>{
      const t=2*Math.PI*p/16;
      return [x+17*Math.sin(t),y-17*Math.cos(t)];
    }))};
}
function brute(shape,ring,rgb,age) {
  const {cx,cy,leds}=shape, result=new Uint8Array(leds.length*3);
  if(age>=2240)return result;
  const flash=age>=1800;
  const taps=flash?[[cx,cy,32,Math.min(1,(2240-age)/360)]]:[];
  if(!flash)for(const [lag,weight] of [[0,1],[45,.55],[90,.23]]) {
    if(lag>age)break;
    const a=(age-lag)/1800, start=Math.hypot(ring.x-cx,ring.y-cy);
    const r=(start<1e-6?17:start)*(1-a);
    const t=(start<1e-6?-Math.PI/2:Math.atan2(ring.y-cy,ring.x-cx))+2*Math.PI*(.9*a+2.25*a*a);
    taps.push([cx+r*Math.cos(t),cy+r*Math.sin(t),20+Math.min(26,.1*r),weight]);
  }
  const peaks=new Float64Array(leds.length);
  for(const [x,y,width,k] of taps) {
    const ds=leds.map(([px,py])=>(px-x)**2+(py-y)**2), closest=Math.min(...ds);
    for(let i=0;i<ds.length;i++)peaks[i]=Math.max(peaks[i],k*(1-(ds[i]-closest)/width**2));
  }
  for(let i=0;i<peaks.length;i++)for(let ch=0;ch<3;ch++)
    result[i*3+ch]=Math.round((flash?255:rgb[ch])*peaks[i]);
  return result;
}

const circle=Array.from({length:32},(_,i)=>{
  const a=i*2*Math.PI/32;return {x:1200*Math.cos(a),y:1200*Math.sin(a)};
});
const spiral=Array.from({length:45},(_,i)=>{
  const a=i*2.4, r=Math.sqrt(i)*52;return {x:r*Math.cos(a),y:r*Math.sin(a)};
});
const lone=[{x:551,y:-623}], line=[{x:100,y:-1},{x:100,y:700},{x:100,y:2000}];
const duplicate=[{x:1,y:2},{x:1,y:2},{x:1,y:2}];
let bytes=0, maxDelta=0;
for(const rings of [circle,spiral,lone,line,duplicate]) {
  const geom=geometry(rings), s=make(rings), start=0xfffffe06;
  s.press(0,start);s.press(0,start+1);s.release(0);
  for(const age of [0,1,15,44,45,89,90,180,944,1400,1799,1800,1879,1880,2000,2239,2240]) {
    const f=s.frame((start+age)>>>0,200000);
    assert.equal(f.activeOrbits,age<2240?1:0);
    const expected=brute(geom,rings[0],cyan,age);
    for(let i=0;i<expected.length;i++)maxDelta=Math.max(maxDelta,Math.abs(expected[i]-f.pixels[i]));
    bytes+=expected.length;
    if(age<1800) assert.equal(Math.max(...f.pixels),255); // Nearest LED gets peak even far from ring centers.
    if(age>=1800 && age<2240)for(let i=0;i<expected.length;i+=3) {
      assert.equal(f.pixels[i],f.pixels[i+1]);assert.equal(f.pixels[i],f.pixels[i+2]);
    }
  }
}
assert(maxDelta<=1);

const pair=[{x:-100,y:-80},{x:100,y:100}], sh=geometry(pair), overlap=make(pair);
overlap.press(0,0);overlap.release(0);overlap.press(1,650);overlap.release(1);
for(const time of [650,1350,1799,1800,2100,2240,2450]) {
  const f=overlap.frame(time,200000);
  const a=brute(sh,pair[0],cyan,time), b=brute(sh,pair[1],orange,time-650);
  for(let i=0;i<a.length;i++)assert(Math.abs(f.pixels[i]-Math.min(255,a[i]+b[i]))<=1);
}
overlap.setMode(0);overlap.setMode(8);assert.equal(overlap.frame(2580,40000).activeOrbits,0);
assert.equal(make([]).frame(30,40000).activeOrbits,0);
const square=Array.from({length:400},(_,i)=>({x:(i%20)*60,y:Math.floor(i/20)*60}));
const dense=make(square);
for(let i=0;i<400;i++){dense.press(i,0);dense.release(i);}
assert.equal(dense.frame(1,40000).activeOrbits,128);
assert.equal(dense.drain.orbits[0].color[0],[40,255,185,75,255,255][272%6]);
const t0=performance.now();
let limited=0;
for(let i=0;i<150;i++){
  const f=dense.frame(1+i*11,12000);
  assert.equal(f.activeOrbits,128);assert(f.sentMa<=12000);limited+=Number(f.gain<1);
}
assert(limited);
console.log('Irregular and degenerate layout oracle:',bytes,'post-budget color bytes examined, maximum byte difference',maxDelta);
console.log('Touch/release, overlapping orbits/flash, corner ages, rollover, capacity, reset and budget checks passed.');
console.log('400 rings, 128 colored orbits: '+((performance.now()-t0)/150).toFixed(2)+' ms/frame in Node (simulation only).');
