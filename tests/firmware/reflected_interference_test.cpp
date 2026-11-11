#include "../../SpringTable/Effects.h"
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <limits>
#include <vector>

struct Arrival { int direct, echo; };
template<unsigned R, unsigned C>
static std::array<Arrival,R*C> paths(unsigned src) {
  std::array<Arrival,R*C> times{};
  double x=double(src%C)*60, y=double(src/C)*60, far=0;
  for(unsigned i=0;i<R*C;++i) {
    if(i==src) continue;
    double dx=double(i%C)*60-x,dy=double(i/C)*60-y;
    double d=std::hypot(dx,dy),nx=dx/d,ny=dy/d;
    double hit=std::numeric_limits<double>::infinity();
    if(nx) hit=std::min(hit,(nx<0?-x:60.*(C-1)-x)/nx);
    if(ny) hit=std::min(hit,(ny<0?-y:60.*(R-1)-y)/ny);
    double edge=std::max(hit,d)+19;
    times[i]={int(std::lround(d/.6)),int(std::lround((edge/600.+(edge-d)/1500.)*1000.))};
    far=std::max(far,d);
  }
  times[src]={0,std::max(220,int(std::lround((far+19)*(1/.6+1/1.5))))};
  return times;
}
static int sample(int age) {
  if(age<0||age>=1600) return 0;
  const double phase=2*std::acos(-1.0)*age/400.;
  const double normalized=std::cos(phase);
  const int mag=int(std::lround(std::abs(normalized)*120));
  const int envelope=std::min(400,1600-age);
  return (normalized<0?-1:1)*((mag*envelope+200)/400);
}
static fx::Color tint(int signedSum) {
  int mag=std::min(255,std::abs(signedSum));
  std::array<int,3> color=signedSum<0 ? std::array<int,3>{{95,65,190}} : std::array<int,3>{{40,210,255}};
  return {uint8_t((color[0]*mag+127)/255),uint8_t((color[1]*mag+127)/255),uint8_t((color[2]*mag+127)/255)};
}
static bool equal(fx::Color a,fx::Color b) {return a.r==b.r&&a.g==b.g&&a.b==b.b;}
template<unsigned R, unsigned C>
static uint64_t verify() {
  fx::Scene<R,C> scene;
  uint64_t tested=0;
  for(unsigned src=0;src<R*C;++src) {
    scene.setMode(10);scene.setMode(11);
    uint32_t start=UINT32_MAX-100u+4000u*src;
    auto p=paths<R,C>(src);
    scene.press(src/C,src%C,start); scene.release(src/C,src%C);
    for(int age=0;age<=p[src].echo+1609;age+=7) {
      scene.frame(start+age);
      for(unsigned i=0;i<R*C;++i) {
        fx::Color expected=tint(sample(age-p[i].direct)+sample(age-p[i].echo));
        for(unsigned led=0;led<16;++led) {
          if(!equal(scene.pixel(i/C,i%C,led,start+age),expected)) {
            std::fprintf(stderr,"Mismatch %ux%u source %u target %u age %d\n",R,C,src,i,age); std::abort();
          }
          tested+=3;
        }
      }
    }
  }
  return tested;
}
int main() {
  using Bench=fx::Scene<1,3>;
  Bench bench;bench.setMode(11);
  bench.press(0,0,0);bench.press(0,2,0);
  bench.frame(292); assert(equal(bench.pixel(0,1,0,292),{}));
  Bench single;single.setMode(11);single.press(0,0,0);
  single.frame(622); assert(equal(single.pixel(0,2,0,622),{35,186,226}));
  single.frame(1800); assert(equal(single.pixel(0,2,0,1800),tint(sample(1556))));
  single.frame(3400); assert(equal(single.pixel(0,0,0,3400),{}));
  single.press(0,0,3500);single.frame(3500);assert(equal(single.pixel(0,0,0,3500),{}));
  single.release(0,0);single.press(0,0,3510);single.frame(3510);assert(equal(single.pixel(0,0,0,3510),{19,99,120}));
  single.setMode(10);single.frame(3511);assert(equal(single.pixel(0,0,0,3511),{}));
  single.release(0,0);single.press(0,0,3520);
  single.setMode(11);single.frame(3520);assert(equal(single.pixel(0,0,0,3520),{}));
  // 128 independent plucks at the same ring approach the maximum signed sum
  // when their outward and inward packets reinforce at the far end.
  Bench saturated;saturated.setMode(11);
  for(unsigned j=0;j<128;++j){saturated.press(0,0,0);saturated.release(0,0);}
  saturated.frame(622);assert(equal(saturated.pixel(0,2,0,622),{40,210,255}));
  saturated.frame(822);assert(equal(saturated.pixel(0,2,0,822),{95,65,190}));
  // Vary start times, origin, and phases. Exposure is the signed SUM from
  // all sources. This oracle never clips a source or a direct/echo pair.
  fx::Scene<10,10> mixed;mixed.setMode(11);
  struct Pluck {int start;unsigned origin;std::array<Arrival,100> times;};
  std::vector<Pluck> plucks;
  for(unsigned j=0;j<128;++j) {
    unsigned origin=(j*61u)%100u;
    int start=int(j*3);
    plucks.push_back({start,origin,paths<10,10>(origin)});
    mixed.press(origin/10,origin%10,start);mixed.release(origin/10,origin%10);
  }
  for(int age=384;age<3900;age+=19) {
    mixed.frame(uint32_t(age));
    for(unsigned i=0;i<100;++i) {
      int sum=0;
      for(const auto &p:plucks) {
        const int lifetime=p.times[p.origin].echo+1600;
        const int t=age-p.start;
        if(t<lifetime) sum+=sample(t-p.times[i].direct)+sample(t-p.times[i].echo);
      }
      assert(equal(mixed.pixel(i/10,i%10,0,age),tint(sum)));
    }
  }
  uint64_t tested=verify<10,10>()+verify<1,3>()+verify<3,1>()+verify<1,1>()+verify<3,4>();
  std::printf("%llu RGB bytes match independent ray + signed cosine oracle; 128 mixed sources, 292 ms cancellation, 622 ms reinforcement, taper, switching, hold and rollover passed. Host Scene %zu bytes + shared timing tables.\n",
              static_cast<unsigned long long>(tested),sizeof mixed);
}
