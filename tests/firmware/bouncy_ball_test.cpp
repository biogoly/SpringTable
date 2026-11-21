#include "../../SpringTable/Effects.h"
#include "../../SpringTable/PowerLimit.h"
#include <array>
#include <cassert>
#include <cmath>
#include <cstdio>

template<unsigned R, unsigned C>
using Bytes = std::array<uint8_t, R * C * 48>;
template<unsigned R, unsigned C>
Bytes<R,C> snapshot(fx::Scene<R,C> &scene, uint32_t now) {
  Bytes<R,C> bytes = {};
  scene.frame(now);
  unsigned i = 0;
  for (unsigned r = 0; r < R; ++r) for (unsigned c = 0; c < C; ++c)
    for (unsigned p = 0; p < 16; ++p) {
      const auto pixel = scene.pixel(r,c,p,now);
      bytes[i++] = pixel.r; bytes[i++] = pixel.g; bytes[i++] = pixel.b;
    }
  return bytes;
}
template<size_t N> unsigned energy(const std::array<uint8_t,N> &a) {
  unsigned sum = 0;
  for (auto v : a) sum += v;
  return sum;
}
bool near(double a, double b, double epsilon = 1e-9) { return std::abs(a-b) <= epsilon; }
fx::Color white(unsigned) { return {255,255,255}; }

int main() {
  using namespace bouncyball;
  const auto high = trajectory(557), low = trajectory(17);
  assert(high.lifeSeconds > low.lifeSeconds && high.bounceCount > low.bounceCount);
  assert(near(high.firstImpactSeconds, std::sqrt(2 * 557.0 / 9810)));
  const auto start = sample(high,0), negative = sample(high,-1);
  assert(start.height == 557 && start.velocity == 0 && start.brightness == 1);
  assert(start.height == negative.height && start.velocity == negative.velocity);
  const auto fall = sample(high,high.firstImpactSeconds / 2);
  assert(near(fall.height,557*.75));
  assert(fall.velocity > 0 && !fall.settled && fall.bounce == 0);
  const auto impact = sample(high,high.firstImpactSeconds);
  assert(impact.height == 0 && impact.velocity < 0 && impact.bounce == 1);
  assert(near(impact.velocity,-std::sqrt(2*9810.0*557)*.78));
  const double apexTime = high.firstImpactSeconds - impact.velocity / 9810;
  const auto apex = sample(high,apexTime);
  assert(near(apex.height,557*.6084));
  assert(near(apex.velocity,0));
  assert(near(apex.brightness,std::sqrt(.78)));
  assert(sample(high,apexTime-.01).velocity < 0 && sample(high,apexTime+.01).velocity > 0);
  const auto settled = sample(high,high.settleSeconds);
  const auto fade = sample(high,high.settleSeconds+.2);
  assert(settled.settled && settled.height == 0 && settled.velocity == 0);
  assert(near(settled.brightness,std::pow(.78,high.bounceCount/2.0)));
  assert(near(fade.brightness,settled.brightness*.5));
  assert(sample(high,high.lifeSeconds).brightness == 0);
  assert(sample(high,high.lifeSeconds+100).brightness == 0);
  assert(trajectory(0).bounceCount == 0 && trajectory(-1).height == 0);
  assert(sample(trajectory(0),0).settled);
  assert(trajectory(.5/.6084-.000001).bounceCount == 0);
  assert(trajectory(.5/.6084+.000001).bounceCount == 1);
  // Energy is constant during a flight, changes by restitution^2 at impact,
  // and every computed position stays between the floor and the drop point.
  for (unsigned ms = 0; ms <= unsigned(std::ceil(high.lifeSeconds*1000)); ++ms) {
    const auto s = sample(high,ms/1000.0);
    assert(s.height >= 0 && s.height <= high.height);
    assert(s.brightness >= 0 && s.brightness <= 1);
    if (!s.settled) {
      const double conserved = s.height + s.velocity*s.velocity/(2*9810);
      assert(near(conserved,557*std::pow(.6084,s.bounce),1e-8));
    }
  }

  using Table = fx::Scene<10,10>;
  Table frequent, skipped;
  for (Table *s : {&frequent,&skipped}) {
    s->setMode(fx::BouncyBall); s->setBouncyBallSeed(1234); s->press(0,4,100);
  }
  assert(energy(snapshot(frequent,100)) > 0);
  for (unsigned t=101; t<2023; t+=7) snapshot(frequent,t);
  assert(snapshot(frequent,2023) == snapshot(skipped,2023));
  assert(energy(snapshot(skipped,100000)) == 0); // held does not auto-repeat

  Table held, repeated;
  for (Table *s : {&held,&repeated}) {
    s->setMode(fx::BouncyBall); s->setBouncyBallSeed(0); s->press(0,1,100);
  }
  repeated.press(0,1,200);
  assert(snapshot(held,300) == snapshot(repeated,300));
  held.release(0,1); repeated.release(0,1);
  repeated.press(0,1,300);
  const auto one = snapshot(held,300), two = snapshot(repeated,300);
  assert(energy(two) > energy(one));
  for (unsigned i=0;i<one.size();++i) assert(two[i]>=one[i]);
  repeated.setMode(fx::Solid); repeated.setMode(fx::BouncyBall);
  assert(energy(snapshot(repeated,301)) == 0);
  repeated.press(0,1,302); assert(energy(snapshot(repeated,302)) == 0);
  repeated.release(0,1); repeated.press(0,1,303);
  assert(energy(snapshot(repeated,303)) > 0);

  // Absolute ages produce identical frames through the uint32 millisecond wrap.
  Table wrapped, ordinary;
  const uint32_t base = UINT32_MAX-150u;
  for (Table *s : {&wrapped,&ordinary}) { s->setMode(fx::BouncyBall); s->setBouncyBallSeed(98765); }
  wrapped.press(0,5,base); ordinary.press(0,5,0);
  for (uint32_t age : {0u,149u,151u,343u,1000u,2000u,4000u})
    assert(snapshot(wrapped,base+age) == snapshot(ordinary,age));

  // An expired short drop must be removed before capacity eviction: the older
  // high drop on the right should remain when a new low ball is added on left.
  Field<10,10,fx::Color> field;
  field.launch(0,9,0,white);
  for (unsigned i=1;i<128;++i) field.launch(9,0,0,white);
  assert(field.activeCount() == 128);
  const auto afterLow = uint32_t(std::ceil(low.lifeSeconds*1000));
  assert(afterLow/1000.0 < high.lifeSeconds);
  field.launch(9,0,afterLow,white);
  assert(field.activeCount() == 2);
  field.frame(afterLow);
  unsigned rightEnergy=0;
  for (unsigned r=0;r<10;++r) for (unsigned p=0;p<16;++p) rightEnergy += field.pixel(r,9,p).r;
  assert(rightEnergy>0);
  field.clear(); field.launch(0,9,0,white);
  for (unsigned i=1;i<128;++i) field.launch(0,0,0,white);
  field.launch(0,0,0,white); // all alive; oldest insertion is evicted, including ties
  assert(field.activeCount()==128);
  field.frame(0);
  for (unsigned r=0;r<10;++r) for (unsigned p=0;p<16;++p) assert(field.pixel(r,9,p).r==0);
  field.frame(100000); assert(field.activeCount()==0);

  // Real bouncy-ball output passes through the same total-current limiter.
  Table crowded;
  crowded.setMode(fx::BouncyBall);
  for (unsigned r=0;r<10;++r) for (unsigned c=0;c<10;++c) crowded.press(r,c,0);
  const auto bright = snapshot(crowded,0);
  uint64_t demand=0;
  for (unsigned i=0;i<bright.size();i+=3) demand += powerlimit::demand(bright[i],bright[i+1],bright[i+2]);
  const auto gain=powerlimit::fit(demand,1600,5000);
  uint64_t limited=0;
  assert(gain.apply(255)<255);
  for (unsigned i=0;i<bright.size();i+=3)
    limited+=powerlimit::demand(gain.apply(bright[i]),gain.apply(bright[i+1]),gain.apply(bright[i+2]));
  assert(powerlimit::estimatedMicroAmps(limited,1600)<=5000000);
  std::printf("Bouncy Ball physics, energy, lifetime, cadence, press edges, wrap, expiry, capacity, current limit. Scene bytes: %zu.\n",sizeof(Table));
}
