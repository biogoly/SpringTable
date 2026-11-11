'use strict';
const assert = require('node:assert/strict');
global.window={};
for (const file of ['ricochet','drain','reflection','interference','engine']) require('../studio/'+file+'.js');
const {Scene}=window.SpringEngine;
const rings=[{x:0,y:0},{x:60,y:0},{x:120,y:0}];
const lone=[{x:0,y:0}], calibration={idleMicroAmpsPerPixel:750,channelMicroAmps:[10000,20000,33000],ricochetSeed:8123};
const code=(tint,level)=>tint.map(ch=>Math.round(ch*level/255));
const pluck=(s,i,t)=>{s.press(i,t);s.release(i);};
const read=(f,i=0,p=0)=>Array.from(f.pixels.slice((i*16+p)*3,(i*16+p)*3+3));
function estimate(pixels) {
  let weighted=0;
  for(let i=0;i<pixels.length;i++) weighted+=pixels[i]*calibration.channelMicroAmps[i%3];
  return (pixels.length/3*750+Math.ceil(weighted/255))/1000;
}

for(const mode of [10,11]) {
  const scene=new Scene(lone,calibration);
  // The palette is also available to actors created after the first edit.
  const crest=new Uint8Array([201,37,4]), trough=[1,5,227];
  scene.setInterferenceColors(crest,trough);
  crest.fill(0);trough.fill(0);
  scene.setMode(mode);
  pluck(scene,0,0);
  const field=mode===10?scene.interference:scene.reflectedInterference;
  const launched=field.waves[0], route=launched.route;
  assert.deepEqual(read(scene.frame(0,40000)),code([201,37,4],120));
  assert.deepEqual(read(scene.frame(200,40000)),code([1,5,227],120));
  const deltaBefore=field.sums[0], oldPalette=scene.interferenceColors;
  for(const bad of [null,'#ff0000',new Uint16Array([0,256,0]),[.5,1,2],[1,,3],[NaN,1,2],[0,-1,0],[1,2],[]]) {
    assert.throws(()=>scene.setInterferenceColors([1,2,3],bad),RangeError);
    assert.throws(()=>scene.setInterferenceColors(bad,[7,8,9]),RangeError);
    assert.equal(scene.interferenceColors,oldPalette);
  }
  const white=new Uint8ClampedArray([255,255,255]), black=[0,0,0];
  scene.setInterferenceColors(black,white);
  white.fill(0);black.fill(255);
  assert.equal(field.sums[0],deltaBefore);
  assert.equal(field.waves[0],launched);
  assert.equal(field.waves[0].route,route);
  let f=scene.frame(200,40000);
  assert.equal(f.activeWaves,1);
  assert.deepEqual(read(f),[120,120,120]);
  assert.equal(f.requestedMa,estimate(f.pixels));
  const unlimited=f.requestedMa;
  f=scene.frame(200,25);
  assert.equal(f.requestedMa,unlimited);
  assert(f.gain<1 && f.sentMa<=25 && f.sentMa===estimate(f.pixels));
  f=scene.frame(0,40000);
  assert.deepEqual(read(f),[0,0,0]);
  assert.equal(f.requestedMa,12); // Dark pixels still draw modeled idle current.
  assert.equal(field.sums[0],120);
  scene.setInterferenceColors([70,130,255],[0,0,0]);
  f=scene.frame(0,40000);
  assert.deepEqual(read(f),code([70,130,255],120));
  assert.equal(f.requestedMa,estimate(f.pixels));
  assert.deepEqual(read(scene.frame(200,40000)),[0,0,0]);
  scene.setMode(mode===10?11:10);
  pluck(scene,0,600);
  assert.deepEqual(read(scene.frame(600,40000)),code([70,130,255],120));
  scene.setMode(mode);assert.equal(scene.frame(600,40000).activeWaves,0);
}

// Opposite phases cancel before either separately colored channel is mixed.
for(const [mode,time] of [[10,400],[11,292]]) {
  const s=new Scene(rings);
  s.setMode(mode);pluck(s,0,0);pluck(s,2,0);
  s.setInterferenceColors([255,0,0],[0,255,0]);
  const f=s.frame(time,40000);
  assert.deepEqual(read(f,1),[0,0,0]);assert.equal(f.activeWaves,2);
}
// A color edit must not change any older effect, even with actors in flight.
for(let mode=0;mode<=9;mode++) {
  const a=new Scene(rings,calibration), b=new Scene(rings,calibration);
  a.setMode(mode);b.setMode(mode);
  pluck(a,0,0);pluck(b,0,0);
  assert.deepEqual(a.frame(50,40000),b.frame(50,40000));
  a.setInterferenceColors([2,5,11],[130,110,217]);
  for(const t of [100,285,530,1900]) assert.deepEqual(a.frame(t,40000),b.frame(t,40000));
}
console.log('Custom tint checks passed for both modes: pre-launch and live edits, post-switch persistence, signed sums and cancellation, independent/black/white channels, defensive copies, invalid-pair atomicity, limiter and current telemetry. All ten previous modes unaffected.');
