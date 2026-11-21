'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {performance} = require('node:perf_hooks');

global.window = {};
require('../studio/drain.js');
require('../studio/bouncy-ball.js');
require('../studio/engine.js');
const {Scene} = window.SpringEngine;
const BouncyBall = window.SpringBouncyBall;
const {trajectory, sample} = BouncyBall;
const GRAVITY = 9810, DIAMETER = 36, PAIR_RESTITUTION = 0.90;
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `Expected ${expected} ± ${tolerance}, received ${actual}`);
const grid = Array.from({length:100}, (_, index) => ({x:(index % 10) * 60, y:Math.floor(index / 10) * 60}));
const palette = [[40,205,255],[255,93,24],[185,65,255],[75,255,130],[255,70,148],[255,202,35]];
const buffers = new WeakMap();
function scene(rings = grid, seed = 123456) {
  const result = new Scene(rings, {bouncyBallSeed:seed});
  result.setMode(12);
  return result;
}
function field(rings = [{x:-10000,y:0},{x:10000,y:10000}], seed = 123456) {
  const result = new BouncyBall(rings, palette, seed);
  buffers.set(result, new Uint8Array(rings.length * 16 * 3));
  return result;
}
function advance(result, now) {
  const pixels = buffers.get(result); pixels.fill(0);
  return result.render(now >>> 0, pixels);
}
function launch(result, x, y, now = 0) {
  result.launch({x,y}, now >>> 0);
  return result.balls.at(-1);
}
function state(result) {
  return result.balls.map(({x,y,vx,vy,color}) => ({x,y,vx,vy,color}));
}
function finite(result) {
  for (const ball of result.balls) {
    assert.ok([ball.x,ball.y,ball.vx,ball.vy].every(Number.isFinite));
    assert.ok(ball.y <= result.floor + 1e-6, 'No ball may escape through the floor');
  }
}

test('isolated drops retain ballistic acceleration and the expected rebound height', () => {
  const result = field(grid), ball = launch(result, 240, 0);
  const height = result.floor;
  const path = trajectory(height);
  for (const now of [1,17,63,100,200]) {
    advance(result, now);
    const expected = sample(path, now / 1000);
    close(ball.y, result.floor - expected.height, 1e-7);
    close(ball.vy, expected.velocity, 1e-7);
    close(ball.x, 240);
    close(ball.vx, 0);
  }
  let impact = path.firstImpactSeconds, apexHeight = height;
  for (let bounce = 1; bounce <= 3; bounce++) {
    apexHeight *= 0.78 ** 2;
    const ascent = Math.sqrt(2 * apexHeight / GRAVITY);
    advance(result, Math.round((impact + ascent) * 1000));
    // The 1 ms collision solver approximates impact timing; compare against
    // the independent ballistic apex without requiring the same phase bit.
    close(result.floor - ball.y, apexHeight, 5);
    close(ball.vy, 0, 60);
    impact += 2 * ascent;
  }
});

test('higher real drops bounce longer, then settle and fade completely', () => {
  const lifetimes = [];
  for (const height of [17,77,557]) {
    const result = field(grid);
    launch(result, 240, result.floor - height);
    let now = 0;
    for (; now <= 10000 && advance(result, now); now += 8) finite(result);
    assert.ok(now < 10000, 'Isolated balls must finish without waiting for the safety lifetime');
    assert.ok(now > trajectory(height).firstImpactSeconds * 1000 + 400);
    assert.ok(buffers.get(result).every(value => value === 0));
    lifetimes.push(now);
  }
  assert.ok(lifetimes[0] < lifetimes[1] && lifetimes[1] < lifetimes[2], lifetimes.join(', '));
});

test('head-on collisions conserve momentum and lose the specified normal energy', () => {
  const result = field(), a = launch(result,-20,100), b = launch(result,20,100);
  a.vx = 3000; b.vx = -3000;
  advance(result, 1);
  close(a.vx, -3000 * PAIR_RESTITUTION, 1e-6);
  close(b.vx, 3000 * PAIR_RESTITUTION, 1e-6);
  close(a.vx + b.vx, 0, 1e-6);
  close(a.vy + b.vy, 2 * GRAVITY / 1000, 1e-6);
  close(a.vx ** 2 + b.vx ** 2, 2 * 3000 ** 2 * PAIR_RESTITUTION ** 2, 0.01);
  assert.ok(b.x - a.x >= DIAMETER - 1e-6);
});

test('glancing collisions send balls sideways with conserved pair momentum', () => {
  const result = field(), a = launch(result,-20,100), b = launch(result,20,124);
  a.vx = 10000; b.vx = -10000;
  advance(result, 1);
  assert.ok(a.vy < -1000 && b.vy > 1000, 'A glancing impact must transfer transverse velocity');
  close(a.vx + b.vx, 0, 1e-6);
  close(a.vy + b.vy, 2 * GRAVITY / 1000, 1e-6);
  const energy = a.vx ** 2 + b.vx ** 2 + (a.vy - GRAVITY/1000) ** 2 + (b.vy - GRAVITY/1000) ** 2;
  assert.ok(energy < 2 * 10000 ** 2 && energy > 0);
  assert.ok(Math.hypot(b.x-a.x,b.y-a.y) >= DIAMETER - 1e-6);
});

test('an oblique impact on a rolling floor ball transfers horizontal momentum without adding energy', () => {
  for(const reverse of [false,true])for(const sign of [-1,1]){
    const result=field();
    const airborne=launch(result,-sign*28.8,result.floor-21.6);
    const grounded=launch(result,0,result.floor);
    airborne.vy=500;grounded.vx=-sign*1000;grounded.grounded=true;
    const momentum=airborne.vx+grounded.vx;
    const kinetic=()=>airborne.vx**2+airborne.vy**2+grounded.vx**2+grounded.vy**2;
    const normalSpeed=()=>(grounded.vx-airborne.vx)*sign*.8+(grounded.vy-airborne.vy)*.6;
    const beforeEnergy=kinetic(),beforeNormal=normalSpeed();
    result.impact(...(reverse?[grounded,airborne]:[airborne,grounded]));
    close(airborne.vx+grounded.vx,momentum,1e-6);
    close(normalSpeed(),-PAIR_RESTITUTION*beforeNormal,1e-6);
    assert.ok(kinetic()<beforeEnergy,'The floor constraint cannot supply extra collision energy');
    assert.ok(Math.abs(grounded.vx+sign*1000)>100,'A supported ball still receives horizontal impulse');
    close(grounded.vy,0);assert.equal(grounded.grounded,true);
    assert.ok(airborne.vy<0);
    advance(result,1);
    finite(result);
    close(grounded.vy,0);
  }
});

test('swept collisions prevent high-speed tunneling and do not re-bounce separating contacts', () => {
  const result = field(), a = launch(result,-100,100), b = launch(result,100,100);
  a.vx = 500000; b.vx = -500000;
  advance(result, 1);
  assert.ok(a.x < b.x && a.vx < 0 && b.vx > 0, 'The balls must rebound before crossing');
  close(a.vx, -450000, 1e-6); close(b.vx, 450000, 1e-6);
  advance(result, 2);
  close(a.vx, -450000, 1e-6); close(b.vx, 450000, 1e-6);

  const separating = field(), left = launch(separating,-17,100), right = launch(separating,17,100);
  left.vx = -100; right.vx = 100;
  advance(separating, 1);
  close(left.vx, -100); close(right.vx, 100);
  assert.ok(right.x - left.x >= DIAMETER - 1e-6);
});

test('a fast impact can propagate through a previously stationary three-ball chain in one tick', () => {
  const result=field(),a=launch(result,0,100),b=launch(result,40,100),c=launch(result,80,100);
  a.vx=100000;
  advance(result,1);
  close(a.vx+b.vx+c.vx,100000,1e-6);
  assert.ok(c.vx>80000,'The newly moving middle ball must collide with the third ball in the same tick');
  assert.ok(a.x<b.x&&b.x<c.x);
  assert.ok(a.vx**2+b.vx**2+c.vx**2<100000**2);
  finite(result);
});

test('ordinary plucks collide after a floor rebound and spread across columns', () => {
  const result = field(grid), a = launch(result,240,0), b = launch(result,260,300);
  advance(result, 340);
  assert.ok(Math.abs(a.vx) > 100 && Math.abs(b.vx) > 100);
  assert.ok(a.vx * b.vx < 0, 'A glancing falling/rising encounter should push the balls apart');
  assert.ok(result.collisionCount > 0);
  finite(result);
  advance(result, 20000);
  assert.equal(result.balls.length, 0);
});

test('collision results are independent of frame cadence, pause calls and clock rollover', () => {
  const rings = [{x:0,y:0},{x:20,y:200},{x:45,y:0},{x:60,y:540},{x:-300,y:540},{x:300,y:540}];
  const events = [[0,0],[37,1],[61,2],[239,0],[300,1],[517,2]];
  for (const epoch of [0,0xfffffff0]) {
    const dense = scene(rings), sparse = scene(rings);
    let previous = 0;
    for (const [age,index] of events) {
      for (let t = previous; t < age; t++) dense.frame((epoch+t)>>>0,40000);
      dense.press(index,(epoch+age)>>>0); dense.release(index);
      sparse.press(index,(epoch+age)>>>0); sparse.release(index);
      previous = age;
    }
    for (let t = previous; t < 1500; t++) dense.frame((epoch+t)>>>0,40000);
    const now = (epoch+1500)>>>0;
    const expected = dense.frame(now,40000);
    assert.deepEqual(sparse.frame(now,40000), expected);
    assert.deepEqual(state(sparse.bouncyBall), state(dense.bouncyBall));
    assert.ok(dense.bouncyBall.collisionCount > 0);
    assert.deepEqual(sparse.frame(now,40000), expected, 'Paused evaluation must not integrate again');
  }
});

test('touch edges, mode switches and the shared current limit still apply', () => {
  const result = scene();
  result.press(0,0); result.press(0,20);
  assert.equal(result.frame(20,40000).activeBalls,1);
  result.release(0); result.press(0,30);
  assert.equal(result.frame(30,40000).activeBalls,2);
  for (let i=0;i<100;i++) { result.release(i); result.press(i,100); }
  const limited = result.frame(101,2000);
  assert.ok(limited.requestedMa > 2000 && limited.sentMa <= 2000);
  assert.ok(limited.pixels.some(value => value > 0));
  result.setMode(0); result.setMode(12);
  assert.equal(result.frame(102,40000).activeBalls,0);
  result.release(0); result.press(0,103);
  assert.equal(result.frame(103,40000).activeBalls,1);
});

test('capacity reclaims expired balls and bounds dense coincident launches', () => {
  const rings = [{x:0,y:0}, ...Array.from({length:127},(_,i)=>({x:100+(i*60),y:10000}))];
  const result = field(rings), olderHigh = launch(result,0,0);
  for (const ring of rings.slice(1)) launch(result,ring.x,ring.y,1);
  assert.equal(result.balls.length,128);
  launch(result,100,0,2000);
  assert.equal(result.balls.length,2);
  assert.equal(result.balls[0],olderHigh);
  for(let i=0;i<127;i++) launch(result,100,0,2000);
  assert.equal(result.balls.length,128);
  assert.ok(!result.balls.includes(olderHigh));
  advance(result,2001);
  finite(result);
  advance(result,0x7fffffff);
  assert.equal(result.balls.length,0,'A very long skipped interval must finish in bounded time');
});

test('a crowded floor pile cannot damp or freeze a distant falling ball', () => {
  const rings=[{x:-100,y:0},{x:6000,y:540}];
  const isolated=field(rings),crowded=field(rings);
  const reference=launch(isolated,5000,0),distant=launch(crowded,5000,0);
  for(const ring of grid)launch(crowded,ring.x,ring.y);
  for(const now of [100,250,500]){
    advance(isolated,now);advance(crowded,now);
    close(distant.x,reference.x,1e-6);close(distant.vx,reference.vx,1e-6);
    close(distant.y,reference.y,1e-6);close(distant.vy,reference.vy,1e-6);
  }
  assert.ok(crowded.contactLimitCount>0,'The fixture must exercise the contact-limit fallback');
});

test('a normal hundred-spring burst keeps meaningful motion beyond one second', () => {
  const result=scene();for(let i=0;i<100;i++)result.press(i,0);
  const frame=result.frame(1100,40000);
  assert.ok(frame.activeBalls>=10,'A table-wide launch must not collapse to darkness in one second');
  assert.ok(frame.pixels.some(value=>value>0));
  // A stack may briefly rest on lower balls; it should keep moving as those
  // supports fade, rather than freezing every remaining body indefinitely.
  let moving=false;
  for(let now=1100;now<=1600;now+=25){
    result.frame(now,40000);
    moving ||= result.bouncyBall.balls.some(ball=>Math.hypot(ball.vx,ball.vy)>100);
  }
  assert.ok(moving);
  finite(result.bouncyBall);
});

test('sparse, degenerate and irregular layouts stay finite and show the nearest LEDs', () => {
  const cases = [
    [{x:0,y:0}],
    [{x:-100000,y:-100000},{x:100000,y:100000}],
    Array.from({length:32},(_,i)=>({x:1000*Math.sin(i*Math.PI/16),y:1000*Math.cos(i*Math.PI/16)})),
    Array.from({length:200},(_,i)=>({x:48*Math.sqrt(i)*Math.cos(i*2.3999632297),y:48*Math.sqrt(i)*Math.sin(i*2.3999632297)}))
  ];
  for(const rings of cases) {
    const result = scene(rings);
    const origin = rings.reduce((best,ring,i)=>ring.y<rings[best].y?i:best,0);
    result.press(origin,0); result.release(origin);
    const height = result.bouncyBall.floor-rings[origin].y;
    const frame = result.frame(Math.floor(Math.sqrt(2*height/GRAVITY)*500),40000);
    assert.ok(frame.pixels.some(value=>value>0));
    assert.ok([frame.requestedMa,frame.sentMa,frame.gain].every(Number.isFinite));
    finite(result.bouncyBall);
  }
  const empty = scene([]); empty.press(0,0);
  assert.equal(empty.frame(0,40000).activeBalls,0);
});

test('seeded collisions repeat and a 400-ring scene handles 128 active bodies', () => {
  const rings = Array.from({length:400},(_,i)=>({x:(i%20)*60,y:Math.floor(i/20)*60}));
  const a=scene(rings),b=scene(rings);
  for(let i=0;i<128;i++){a.press(i,0);b.press(i,0);}
  assert.ok(new Set(a.bouncyBall.balls.map(ball=>ball.color.join(','))).size>1);
  assert.deepEqual(a.frame(200,40000),b.frame(200,40000));
  const start=performance.now();
  for(let i=0;i<30;i++)a.frame(200+i*16,40000);
  finite(a.bouncyBall);
  console.log(`400 rings, 128 colliding balls: ${((performance.now()-start)/30).toFixed(2)} ms/frame in Node.`);
});
