'use strict';
const assert=require('node:assert/strict');
global.window={};
require('../studio/reflection.js');require('../studio/interference.js');require('../studio/engine.js');
const {Scene}=window.SpringEngine;
const bench=[{x:0,y:0},{x:60,y:0},{x:120,y:0}], defaults={crest:[40,210,255],trough:[95,65,190]};
const make=(mode=10)=>{const s=new Scene(bench);s.setMode(mode);return s;};
const pluck=(s,i,t)=>{s.press(i,t);s.release(i);};

// Independent uint32 stream using integer BigInt bit operations.
function generator(seed,initial=defaults) {
  let x=BigInt(seed>>>0 || 0x6d2b79f5), last=null, shown=initial;
  const mask=0xffffffffn;
  function word(){x=(x^(x<<13n))&mask;x^=x>>17n;x=(x^(x<<5n))&mask;return Number(x);}
  function hue(h){
    const sector=Math.trunc(h/256),t=(h%256)/255;
    const corners=[[255,32,32],[255,255,32],[32,255,32],[32,255,255],[32,32,255],[255,32,255],[255,32,32]];
    return corners[sector].map((a,i)=>Math.round(a*(1-t)+corners[sector+1][i]*t));
  }
  return ()=>{
    const v=word();
    let a=last===null?v%1536:(last+384+v%769)%1536, b=(a+640+word()%257)%1536;
    let c=hue(a),t=hue(b);
    while(c.join()===shown.crest.join() || t.join()===shown.trough.join()){
      a=(a+384)%1536;b=(b+384)%1536;c=hue(a);t=hue(b);
    }
    last=a;return shown={crest:c,trough:t};
  };
}
function level(t) {
  if(t<0 || t>=1600)return 0;
  const c=120*Math.cos(Math.PI*t/200);
  return Math.sign(c)*Math.floor(Math.round(Math.abs(c))*Math.min(400,1600-t)/400+0.5);
}
function oracle(events,t,mode,budgetMa) {
  let alive=0;
  const raw=new Uint8Array(144);
  for(const e of events){
    const far=Math.max(e.i,2-e.i)*60;
    const final=mode===10?Math.round(far*5/3):Math.max(220,Math.round((far+19)*7/3));
    if(t-e.t<final+1600)alive++;
  }
  for(let target=0;target<3;target++){
    const vs=events.map(({i,t:born})=>{
      const d=Math.abs(i-target)*60, x=i*60;
      const L=19+(target>i?120-x:x);
      const back=d?Math.round(L*5/3+(L-d)*2/3):Math.max(220,Math.round((Math.max(x,120-x)+19)*7/3));
      return level(t-born-Math.round(d*5/3))+(mode===11?level(t-born-back):0);
    });
    const sum=vs.reduce((a,b)=>a+b,0);
    const same=vs.filter(v=>v*sum>0).reduce((acc,v)=>acc+Math.abs(v),0);
    if(!same)continue;
    const rgb=[0,1,2].map(ch=>{
      const mix=vs.reduce((v,a,i)=>v+(a*sum>0?Math.abs(a)*events[i].c[sum>0?'crest':'trough'][ch]:0),0);
      return Math.round(mix*Math.min(255,Math.abs(sum))/(255*same));
    });
    for(let p=0;p<16;p++)raw.set(rgb,target*48+p*3);
  }
  const idle=48000, amps=bytes=>idle+Math.ceil(bytes.reduce((t,v)=>t+20000*v,0)/255);
  const requested=amps(raw);
  const sent=requested>budgetMa*1000?raw.map(v=>Math.floor(v*(budgetMa*1000-idle)/(requested-idle))):raw;
  return {raw:requested, sent:amps(sent), bytes:sent, alive};
}

let checked=0;
for(const mode of [10,11]){
  const s=make(mode), seed=87234, fixed={crest:[1,89,41],trough:[168,3,22]}, events=[];
  assert.deepEqual(s.getInterferenceColors(),defaults);assert.equal(s.getInterferenceRandom(),false);
  s.setInterferenceColors(fixed.crest,fixed.trough);
  pluck(s,0,0);events.push({i:0,t:0,c:fixed});
  s.setInterferencePaletteSeed(seed);s.setInterferenceRandom(true);
  assert.deepEqual(s.getInterferenceColors(),fixed);
  const roll=generator(seed,fixed), a=roll(),b=roll(),c=roll(),d=roll();
  for(const [index,t,color] of [[0,20,a],[2,40,a],[1,100,b],[1,130,c],[2,170,d]]){
    if(t===170)s.beginInterferenceGroup();
    pluck(s,index,t);
    assert.deepEqual(s.getInterferenceColors(),color);
    events.push({i:index,t,c:color});
  }
  s.setInterferenceRandom(true);assert.deepEqual(s.getInterferenceColors(),d); // Idempotent arm.
  const copy=s.getInterferenceColors();copy.crest.fill(9);copy.trough.fill(1);
  assert.deepEqual(s.getInterferenceColors(),d);
  for(let t=170;t<2400;t+=13){
    const budget=t%2?130:5000, expected=oracle(events,t,mode,budget),actual=s.frame(t,budget);
    assert.deepEqual(actual.pixels,expected.bytes);assert.equal(actual.activeWaves,expected.alive);
    assert.equal(actual.requestedMa,expected.raw/1000);assert.equal(actual.sentMa,expected.sent/1000);
    checked+=actual.pixels.length;
  }
  s.setInterferenceRandom(false);assert.deepEqual(s.getInterferenceColors(),fixed);
  assert.equal(s.getInterferenceRandom(),false);
}
const hold=make();hold.setInterferencePaletteSeed(0);hold.setInterferenceRandom(true);
const next=generator(0), expectedFirst=next();
hold.press(0,0xfffffff0);assert.deepEqual(hold.getInterferenceColors(),expectedFirst);
hold.press(1,280);assert.deepEqual(hold.getInterferenceColors(),expectedFirst); // Still held across rollover.
hold.release(0);hold.release(1);pluck(hold,2,281);assert.deepEqual(hold.getInterferenceColors(),next()); // Finished chord.
hold.press(0,531);assert.deepEqual(hold.getInterferenceColors(),next()); // 250ms is exclusive.
hold.beginInterferenceGroup();hold.press(0,532);hold.press(2,533); // duplicate does not consume force-next
assert.deepEqual(hold.getInterferenceColors(),next()); hold.release(0);hold.release(2);
const near=make();near.setInterferencePaletteSeed(0);near.setInterferenceRandom(true);
pluck(near,0,0xfffffff0);pluck(near,1,233);assert.deepEqual(near.getInterferenceColors(),expectedFirst); // 249 ms.
const initial=near.getInterferenceColors();near.setInterferencePaletteSeed(99);
assert.deepEqual(near.getInterferenceColors(),initial);pluck(near,2,234);
assert.deepEqual(near.getInterferenceColors(),generator(99,initial)());
near.setMode(11);assert.equal(near.getInterferenceRandom(),true);assert.equal(near.frame(235,5000).activeWaves,0);
near.setInterferenceColors([255,0,0],[0,255,0]);assert.equal(near.getInterferenceRandom(),false);
// Force a collision with the first seeded candidate to exercise the hue rotation.
const collide=make(), collision=generator(123)();
collide.setInterferenceColors(collision.crest,[1,2,3]);collide.setInterferenceRandom(true);
collide.setInterferencePaletteSeed(123);pluck(collide,0,0);
assert.deepEqual(collide.getInterferenceColors(),generator(123,{crest:collision.crest,trough:[1,2,3]})());
assert.notDeepEqual(collide.getInterferenceColors().crest,collision.crest);
// The first correction can hit the other deliberately chosen manual swatch.
const adversarial={crest:collision.crest,trough:collide.getInterferenceColors().trough};
collide.setInterferenceColors(adversarial.crest,adversarial.trough);
collide.setInterferenceRandom(true);collide.setInterferencePaletteSeed(123);pluck(collide,1,500);
const twice=generator(123,adversarial);
assert.deepEqual(collide.getInterferenceColors(),twice());
assert.notDeepEqual(collide.getInterferenceColors().crest,adversarial.crest);
assert.notDeepEqual(collide.getInterferenceColors().trough,adversarial.trough);
collide.beginInterferenceGroup();pluck(collide,2,510);assert.deepEqual(collide.getInterferenceColors(),twice());
// Manual still-live packets reseed/snapshot consistently when arming a second time.
const snap=make(11);pluck(snap,0,0);
const f0=snap.frame(230,5000);
snap.setInterferenceRandom(true);assert.deepEqual(snap.frame(230,5000),f0);
snap.setInterferencePaletteSeed(4);pluck(snap,2,250);
snap.setInterferenceColors([11,7,3],[1,2,6]);
const f1=snap.frame(400,5000);snap.setInterferenceRandom(true);assert.deepEqual(snap.frame(400,5000),f1);
assert.throws(()=>snap.setInterferenceRandom('false'),TypeError);
for(const mode of [10,11]){
  const nullNode=new Scene([{x:0,y:0},{x:600,y:0}]);nullNode.setMode(mode);
  nullNode.setInterferenceRandom(true);nullNode.setInterferencePaletteSeed(99);
  pluck(nullNode,0,0);const before=nullNode.getInterferenceColors();
  pluck(nullNode,0,200);assert.notDeepEqual(nullNode.getInterferenceColors(),before);
  // The return to this origin has not arrived. Two different palettes on
  // opposite phases must still cancel exactly, with zero light in all channels.
  const f=nullNode.frame(400,40000);assert.equal(f.activeWaves,2);
  assert.deepEqual(Array.from(f.pixels.slice(0,48)),new Array(48).fill(0));
}
console.log('Random groups, seeded hue collision, holds, rollover, forced next, manual snapshots, two modes, reseeding and copy safety verified.');
console.log(checked,'RGB bytes and all matching current estimates agree with independent seeded, signed, per-packet weighted-color oracle.');
