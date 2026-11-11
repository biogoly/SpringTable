'use strict';
const assert = require('node:assert/strict');
const {performance} = require('node:perf_hooks');
global.window = {};
require('../studio/ricochet.js');
require('../studio/engine.js');
const {Scene} = window.SpringEngine;
const seed = 123456;
const make = rings => {
  const scene = new Scene(rings, {ricochetSeed: seed});
  scene.setMode(7);
  return scene;
};
const energy = pixels => pixels.reduce((a,b) => a+b, 0);

function validatePath(scene, ball) {
  const planes = scene.ricochet.arena.walls;
  const path = ball.path;
  assert(path.length > 0 && path.length < 1000);
  for (let j=0; j<path.length; j++) {
    const p = path[j], end = path[j+1]?.at ?? 4400;
    assert(end > p.at);
    const ex = p.x + p.vx*(end-p.at), ey = p.y + p.vy*(end-p.at);
    for (const w of planes) {
      for (const [x,y] of [[p.x,p.y],[ex,ey]]) {
        assert((x-w.x)*w.nx + (y-w.y)*w.ny >= -20.000001);
      }
    }
    if (j+1 < path.length) {
      const q = path[j+1];
      assert(Math.abs(Math.hypot(p.vx,p.vy)-Math.hypot(q.vx,q.vy)) < 1e-8);
      assert(Math.hypot(ex-q.x,ey-q.y) < 1e-5);
    }
  }
}

const spiral = Array.from({length:48}, (_,i) => {
  const angle = 2.4*i, dist = 32*Math.sqrt(i);
  return {x: dist*Math.cos(angle), y: dist*Math.sin(angle)};
});
const irregular = make(spiral);
for (let i=0; i<spiral.length; i++) { irregular.press(i,0); irregular.release(i); }
assert(irregular.ricochet.arena.walls.some(w => Math.abs(w.nx*w.ny)>0.1));
for (const ball of irregular.ricochet.balls) validatePath(irregular,ball);
for (let age=0; age<4400; age+=44) {
  const f=irregular.frame(age,40000);
  assert.equal(f.activeBalls,48);
  assert(f.sentMa <= 40000 && f.sentMa <= f.requestedMa);
}
assert.equal(irregular.frame(4400,40000).activeBalls,0);

// Lines at arbitrary angles, duplicate points, true corners and tiny intervals.
const oblique = Array.from({length:10},(_,i)=>({x:10+i*17.3, y:-7+i*37.1}));
for (const rings of [oblique,[oblique[0],oblique[0],oblique[9]],
                      [{x:0,y:0},{x:91,y:0},{x:4,y:93}], [{x:-4,y:-4},{x:-4,y:4},{x:-2,y:-4}]]) {
  const scene=make(rings);
  for(let i=0;i<100;i++){scene.press(i%rings.length,0);scene.release(i%rings.length);}
  for(const ball of scene.ricochet.balls) validatePath(scene,ball);
}
const one=make([{x:0,y:0}]); one.press(0,0xfffffff0); one.release(0);
assert.deepEqual(one.ricochet.arena.rect,[-20,20,-20,20]);
assert.equal(one.frame(18,40000).activeBalls,1);
const spatial = one.frame(117,40000);
assert(energy(spatial.pixels)>0);
assert(new Set(Array.from({length:16},(_,i)=>spatial.pixels.slice(3*i,3*i+3).join(','))).size>1);
assert.equal(one.frame(4384,40000).activeBalls,0);
const empty=make([]); assert.equal(empty.frame(40,40000).activeBalls,0);

// Large installation, rapid launches and deterministic entry/reset.
const square=Array.from({length:400},(_,i)=>({x:(i%20)*60,y:Math.floor(i/20)*60}));
const full=make(square);
for(let i=0;i<400;i++) {full.press(i,0);full.press(i,1);full.release(i);}
assert.equal(full.frame(30,40000).activeBalls,128);
assert.equal(full.ricochet.balls[0].x,square[272].x);
assert.equal(full.ricochet.balls[0].y,square[272].y);
const start=performance.now();
let limited=0;
for(let i=0;i<120;i++) {
  const frame=full.frame(30+i*18,12000);
  assert.equal(frame.activeBalls,128);
  assert(frame.sentMa<=12000);
  limited += frame.gain<1;
}
assert(limited>0);
const cost=(performance.now()-start)/120;
full.setMode(7); assert.equal(full.frame(2200,40000).activeBalls,128);
full.setMode(0); full.setMode(7); assert.equal(full.frame(2200,40000).activeBalls,0);
const reset=make(square); full.setRicochetSeed(0); reset.setRicochetSeed(0x6d2b79f5);
full.press(0,2500);reset.press(0,2500);
assert.deepEqual(full.frame(2600,40000).pixels,reset.frame(2600,40000).pixels);
console.log('Custom Ricochet checks passed: spiral, oblique/duplicate points, skinny hull, single, rollover, zero layout, 400 launches, slot cap, reseed and mode re-entry.');
console.log('400 rings, 128 active balls: '+cost.toFixed(2)+' ms/frame in Node on this machine (simulation only).');
