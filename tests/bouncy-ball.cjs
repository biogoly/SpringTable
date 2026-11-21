'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const {performance} = require('node:perf_hooks');

global.window = {};
require('../studio/drain.js');
require('../studio/bouncy-ball.js');
require('../studio/engine.js');
const {Scene} = window.SpringEngine;
const {trajectory, sample} = window.SpringBouncyBall;
const close = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `Expected ${expected}, received ${actual}`);
const grid = Array.from({length:100}, (_, index) => ({x:(index % 10) * 60, y:Math.floor(index / 10) * 60}));
function scene(rings = grid, seed = 123456) {
  const result = new Scene(rings, {bouncyBallSeed:seed});
  result.setMode(12);
  return result;
}

test('a resting drop accelerates with gravity and successive bounce apexes follow kinetic energy', () => {
  const height = 1000, gravity = 9810, restitution = 0.78;
  const path = trajectory(height);
  const firstFall = Math.sqrt(2 * height / gravity);
  close(path.firstImpactSeconds, firstFall);
  assert.deepEqual(sample(path, 0), {height, velocity:0, brightness:1, bounce:0, settled:false});
  for (const time of [0.01, 0.05, 0.1, 0.2]) {
    const state = sample(path, time);
    close(height - state.height, gravity * time * time / 2);
    close(state.velocity, gravity * time);
  }

  let impactAt = firstFall, reboundHeight = height;
  for (let bounce = 1; bounce <= path.bounceCount; bounce++) {
    reboundHeight *= restitution * restitution;
    const ascent = Math.sqrt(2 * reboundHeight / gravity);
    const apex = sample(path, impactAt + ascent);
    close(apex.height, reboundHeight);
    close(apex.velocity, 0);
    close(apex.brightness, Math.pow(restitution, bounce / 2));
    assert.equal(apex.bounce, bounce);
    assert.equal(apex.settled, false);
    close(sample(path, impactAt + 2 * ascent - 1e-8).height, 0, 0.0001);
    impactAt += 2 * ascent;
  }
  close(path.settleSeconds, impactAt);
  assert.ok(reboundHeight >= 0.5 && reboundHeight * restitution * restitution < 0.5);
  const settled = sample(path, path.settleSeconds);
  assert.equal(settled.settled, true);
  close(sample(path, path.settleSeconds + 0.2).brightness, settled.brightness / 2);
  close(sample(path, path.lifeSeconds).brightness, 0);
});

test('higher drops bounce higher and survive longer without a fixed expiry', () => {
  let previousLife = 0;
  for (const height of [0, 0.1, 17, 77, 557, 1400, 200017]) {
    const path = trajectory(height);
    assert.ok(path.lifeSeconds > previousLife);
    assert.ok(Number.isFinite(path.lifeSeconds) && path.bounceCount < 40);
    const samples = [0, path.firstImpactSeconds, path.settleSeconds, path.lifeSeconds + 1];
    for (const age of samples) {
      const state = sample(path, age);
      assert.ok([state.height, state.velocity, state.brightness].every(Number.isFinite));
      assert.ok(state.height >= 0 && state.height <= height && state.brightness >= 0 && state.brightness <= 1);
    }
    previousLife = path.lifeSeconds;
  }
  const low = trajectory(17), high = trajectory(557);
  assert.ok(high.bounceCount > low.bounceCount);
  assert.ok(sample(high, low.lifeSeconds).brightness > 0);
});

test('direct frame seeks match dense updates, paused frames, and timer rollover', () => {
  for (const born of [0, 0xfffffff0]) {
    const dense = scene(), sparse = scene();
    dense.press(4,born); sparse.press(4,born);
    dense.release(4); sparse.release(4);
    for (let age = 0; age < 1000; age++) dense.frame((born + age) >>> 0, 40000);
    const now = (born + 1000) >>> 0;
    const frame = sparse.frame(now, 40000);
    assert.deepEqual(dense.frame(now, 40000), frame);
    assert.deepEqual(sparse.frame(now, 40000), frame);
    const end = (born + Math.ceil(sparse.bouncyBall.balls[0].trajectory.lifeSeconds * 1000)) >>> 0;
    const expired = sparse.frame(end, 40000);
    assert.equal(expired.activeBalls, 0);
    assert.ok(expired.pixels.every(value => value === 0));
  }
});

test('pluck edges, independent lifetimes, mode switches and full-frame power limiting work through Scene', () => {
  const result = scene();
  result.press(0,0);
  result.press(0,20);
  assert.equal(result.frame(20,40000).activeBalls, 1);
  result.release(0);
  result.press(0,30);
  result.press(90,40);
  assert.equal(result.frame(40,40000).activeBalls, 3);
  const bottomLife = result.bouncyBall.balls[2].trajectory.lifeSeconds;
  assert.equal(result.frame(40 + Math.ceil(bottomLife * 1000),40000).activeBalls, 2);
  for (let i = 0; i < 100; i++) { result.release(i); result.press(i,1000); }
  const limited = result.frame(1000,2000);
  assert.ok(limited.requestedMa > 2000 && limited.sentMa <= 2000);
  assert.ok(limited.pixels.some(value => value > 0));
  result.setMode(0);
  result.setMode(12);
  assert.equal(result.frame(1001,40000).activeBalls, 0);
  result.release(0); result.press(0,1002);
  assert.equal(result.frame(1002,40000).activeBalls, 1);
});

test('capacity reclaims finished low drops before retiring an older high drop', () => {
  const result = scene();
  result.press(0,0); result.release(0);
  const olderHigh = result.bouncyBall.balls[0];
  for (let i = 0; i < 127; i++) { result.press(90,1); result.release(90); }
  assert.equal(result.bouncyBall.balls.length, 128);
  const afterLow = Math.ceil(result.bouncyBall.balls[1].trajectory.lifeSeconds * 1000) + 1;
  result.press(1,afterLow); result.release(1);
  assert.equal(result.bouncyBall.balls.length, 2);
  assert.equal(result.bouncyBall.balls[0], olderHigh);
  for (let i = 0; i < 127; i++) { result.press(1,afterLow); result.release(1); }
  assert.equal(result.bouncyBall.balls.length, 128);
  assert.ok(!result.bouncyBall.balls.includes(olderHigh));
});

test('irregular and sparse layouts project each ball to actual LEDs and remain finite', () => {
  const cases = [
    [{x:0,y:0}],
    [{x:-100000,y:-100000}, {x:100000,y:100000}],
    Array.from({length:32}, (_, i) => ({x:1000*Math.sin(i*Math.PI/16), y:1000*Math.cos(i*Math.PI/16)})),
    Array.from({length:200}, (_, i) => ({x:48*Math.sqrt(i)*Math.cos(i*2.3999632297), y:48*Math.sqrt(i)*Math.sin(i*2.3999632297)}))
  ];
  for (const rings of cases) {
    const dense = scene(rings), sparse = scene(rings);
    const origin = rings.reduce((best,ring,i) => ring.y < rings[best].y ? i : best, 0);
    dense.press(origin,0); sparse.press(origin,0);
    const path = sparse.bouncyBall.balls[0].trajectory;
    const age = Math.floor(path.firstImpactSeconds * 500);
    for (let time = 0; time < age; time += 31) dense.frame(time,40000);
    const frame = sparse.frame(age,40000);
    assert.deepEqual(dense.frame(age,40000), frame);
    assert.ok(frame.pixels.some(value => value > 0));
    assert.ok([frame.requestedMa,frame.sentMa,frame.gain].every(Number.isFinite));
  }
  const empty = scene([]);
  empty.press(0,0);
  assert.equal(empty.frame(0,40000).activeBalls, 0);
});

test('random colors repeat with a seed and a 400-ring scene handles simultaneous drops', () => {
  const rings = Array.from({length:400}, (_,i) => ({x:(i%20)*60,y:Math.floor(i/20)*60}));
  const a = scene(rings), b = scene(rings);
  for (let i = 0; i < 128; i++) { a.press(i,0); b.press(i,0); }
  const colors = a.bouncyBall.balls.map(ball => ball.color.join(','));
  assert.ok(new Set(colors).size > 1);
  assert.deepEqual(a.frame(200,40000),b.frame(200,40000));
  const start = performance.now();
  for (let i = 0; i < 30; i++) a.frame(200+i*16,40000);
  console.log(`400 rings, 128 gravity drops: ${((performance.now()-start)/30).toFixed(2)} ms/frame in Node.`);
});
