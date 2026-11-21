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

  // A lone live body still follows ballistic gravity and loses the specified
  // energy at its first floor bounce, rather than using a cosmetic reversal.
  static Field<10,10,fx::Color> isolated;
  isolated.launch(0,4,0,white);
  isolated.frame(100);
  auto body = isolated.bodyAt(0);
  assert(near(body.x,240) && near(body.y,9810*.1*.1/2,1e-7));
  assert(near(body.vx,0) && near(body.vy,981,1e-7));
  bool bounced = false;
  for (unsigned ms=101; ms<500; ++ms) {
    isolated.frame(ms); body=isolated.bodyAt(0);
    if (body.vy < 0) {
      const double reboundEnergy=557-body.y+body.vy*body.vy/(2*9810);
      // Half-kick CCD approximates acceleration during the impact millisecond.
      assert(near(reboundEnergy,557*.6084,557*.6084*.01));
      bounced=true; break;
    }
  }
  assert(bounced);

  // Height remains meaningful after replacing the independent paths with a
  // shared collision simulation: a low isolated drop dies much sooner.
  static Field<10,10,fx::Color> highDrop,lowDrop;
  highDrop.launch(0,0,0,white); lowDrop.launch(9,9,0,white);
  unsigned highEnd=0,lowEnd=0;
  for (unsigned ms=16;ms<=12000;ms+=16) {
    highDrop.frame(ms); lowDrop.frame(ms);
    if (!lowEnd && !lowDrop.activeCount()) lowEnd=ms;
    if (!highEnd && !highDrop.activeCount()) highEnd=ms;
  }
  assert(lowEnd && highEnd>lowEnd+1000);

  // An upper falling ball meets a lower rebounding ball. Equal-mass impulses
  // conserve momentum while removing the restitution loss from normal energy.
  static Field<10,10,fx::Color> meeting;
  meeting.launch(0,4,0,white); meeting.launch(5,4,0,white);
  bool exchanged=false;
  for (unsigned ms=1;ms<800;++ms) {
    meeting.frame(ms);
    if (meeting.collisionCount()) {
      assert(meeting.bodyAt(0).vy<0 && meeting.bodyAt(1).vy>0);
      exchanged=true; break;
    }
  }
  assert(exchanged);

  // Deliberately high opposing speeds would cross completely within one tick
  // without swept contact detection. Inject only initial state for this fixture.
  using TestField = Field<10,10,fx::Color>;
  static TestField fast;
  fast.launch(3,2,0,white); fast.launch(3,7,0,white);
  auto &fastA=const_cast<TestField::Ball&>(fast.bodyAt(0));
  auto &fastB=const_cast<TestField::Ball&>(fast.bodyAt(1));
  fastA.x=100; fastA.vx=200000; fastB.x=400; fastB.vx=-200000;
  fast.frame(1);
  assert(fast.collisionCount()==1 && fastA.x<fastB.x);
  assert(near(fastA.vx,-180000,1e-6) && near(fastB.vx,180000,1e-6));
  assert(near(fastA.vx+fastB.vx,0,1e-6));

  // Coincident plucks separate deterministically. A third ball then meets the
  // pair off-center and creates opposite sideways motion without a random kick.
  static Field<10,10,fx::Color> glancing;
  glancing.launch(0,4,0,white); glancing.launch(0,4,0,white);
  glancing.launch(4,4,0,white);
  bool sideways=false;
  for (unsigned ms=1;ms<1500;++ms) {
    glancing.frame(ms);
    for (unsigned i=0;i<glancing.activeCount();++i) {
      const auto s=glancing.bodyAt(i);
      assert(std::isfinite(s.x) && std::isfinite(s.y) && std::isfinite(s.vx) && std::isfinite(s.vy));
      assert(s.x>=-17.00001 && s.x<=557.00001 && s.y<=557.00001);
      if (std::abs(s.vx)>10) sideways=true;
    }
  }
  assert(sideways && glancing.collisionCount()>0);

  // A degenerate dense pile must not damp an unrelated falling ball.
  static TestField pile,apart;
  pile.launch(0,9,0,white); apart.launch(0,9,0,white);
  for(unsigned i=0;i<127;++i) pile.launch(9,0,0,white);
  pile.frame(100); apart.frame(100);
  assert(near(pile.bodyAt(0).x,apart.bodyAt(0).x));
  assert(near(pile.bodyAt(0).y,apart.bodyAt(0).y));
  assert(near(pile.bodyAt(0).vy,apart.bodyAt(0).vy));

  using Table = fx::Scene<10,10>;
  static Table frequent, skipped;
  for (Table *s : {&frequent,&skipped}) {
    s->setMode(fx::BouncyBall); s->setBouncyBallSeed(1234); s->press(0,4,100); s->press(5,4,100);
  }
  assert(energy(snapshot(frequent,100)) > 0);
  for (unsigned t=101; t<2023; t+=7) snapshot(frequent,t);
  assert(snapshot(frequent,2023) == snapshot(skipped,2023));
  assert(energy(snapshot(skipped,100000)) == 0); // held does not auto-repeat

  static Table held, repeated;
  for (Table *s : {&held,&repeated}) {
    s->setMode(fx::BouncyBall); s->setBouncyBallSeed(0); s->press(0,1,100);
  }
  repeated.press(0,1,200);
  assert(snapshot(held,300) == snapshot(repeated,300));
  held.release(0,1); repeated.release(0,1);
  repeated.press(0,1,300);
  const auto one = snapshot(held,300), two = snapshot(repeated,300);
  assert(energy(two) > energy(one));
  repeated.setMode(fx::Solid); repeated.setMode(fx::BouncyBall);
  assert(energy(snapshot(repeated,301)) == 0);
  repeated.press(0,1,302); assert(energy(snapshot(repeated,302)) == 0);
  repeated.release(0,1); repeated.press(0,1,303);
  assert(energy(snapshot(repeated,303)) > 0);

  // Absolute ages produce identical frames through the uint32 millisecond wrap.
  static Table wrapped, ordinary;
  const uint32_t base = UINT32_MAX-150u;
  for (Table *s : {&wrapped,&ordinary}) { s->setMode(fx::BouncyBall); s->setBouncyBallSeed(98765); }
  wrapped.press(0,5,base); ordinary.press(0,5,0);
  wrapped.press(5,5,base); ordinary.press(5,5,0);
  for (uint32_t age : {0u,149u,151u,343u,1000u,2000u,4000u})
    assert(snapshot(wrapped,base+age) == snapshot(ordinary,age));

  // Capacity, coincident launches, finite state, and a very long delayed frame
  // must remain bounded. No active object survives the conservative age guard.
  static Field<10,10,fx::Color> field;
  field.launch(0,9,0,white);
  for (unsigned i=1;i<128;++i) field.launch(9,0,0,white);
  assert(field.activeCount() == 128);
  field.frame(50);
  for (unsigned i=0;i<field.activeCount();++i) {
    const auto s=field.bodyAt(i);
    assert(std::isfinite(s.x) && std::isfinite(s.y) && std::isfinite(s.vx) && std::isfinite(s.vy));
  }
  field.frame(100000); assert(field.activeCount()==0);
  field.clear(); field.launch(0,9,0,white);
  for (unsigned i=1;i<128;++i) field.launch(0,0,0,white);
  field.launch(0,0,0,white); // all alive; oldest insertion is evicted, including ties
  assert(field.activeCount()==128);
  field.frame(0);
  for (unsigned r=0;r<10;++r) for (unsigned p=0;p<16;++p) assert(field.pixel(r,9,p).r==0);
  field.frame(100000); assert(field.activeCount()==0);

  // Real bouncy-ball output passes through the same total-current limiter.
  static Table crowded;
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
  std::printf("Bouncy Ball gravity, collision impulse, glancing deflection, lifetime, cadence, press edges, wrap, capacity and current limit. Scene bytes: %zu.\n",sizeof(Table));
}
