#include "../../SpringTable/Effects.h"
#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <cassert>
#include <cstdio>

static int referenceSample(int localTime) {
  if(localTime<0 || localTime>=1600) return 0;
  const double cosine=std::cos(2*std::acos(-1.0)*localTime/400.0);
  const int rounded=static_cast<int>(std::lround(120*std::abs(cosine)));
  const int envelope=std::min(400,1600-localTime);
  const int amplitude=(rounded*envelope+200)/400;
  return cosine<0 ? -amplitude : amplitude;
}
static fx::Color referenceColor(int amplitude) {
  const int mag=std::min(255,std::abs(amplitude));
  const fx::Color tint=amplitude>0 ? fx::Color{40,210,255} : fx::Color{95,65,190};
  return {uint8_t((tint.r*mag+127)/255),uint8_t((tint.g*mag+127)/255),uint8_t((tint.b*mag+127)/255)};
}
static bool same(fx::Color a,fx::Color b) {return a.r==b.r && a.g==b.g && a.b==b.b;}
template<unsigned R, unsigned C>
static uint64_t verifyGrid() {
  fx::Scene<R,C> scene;
  unsigned origin=0;
  uint64_t checked=0;
  for(;origin<R*C;++origin) {
    int delays[R*C]{};
    for(unsigned i=0;i<R*C;++i) {
      double dx=(int(i%C)-int(origin%C))*60., dy=(int(i/C)-int(origin/C))*60.;
      delays[i]=static_cast<int>(std::lround(std::hypot(dx,dy)/.6));
    }
    scene.setMode(0); scene.setMode(10);
    uint32_t base=UINT32_MAX-351u+3200u*origin;
    scene.press(origin/C,origin%C,base); scene.release(origin/C,origin%C);
    const int farthest=*std::max_element(delays,delays+R*C);
    for(int age=0;age<=farthest+1620;age+=5) {
      scene.frame(base+age);
      for(unsigned i=0;i<R*C;++i) {
        fx::Color expected=referenceColor(referenceSample(age-delays[i]));
        for(unsigned p=0;p<16;++p) {
          auto actual=scene.pixel(i/C,i%C,p,base+age);
          if(!same(expected,actual)) {
            std::fprintf(stderr,"Mismatch %ux%u origin %u ring %u age %d\n",R,C,origin,i,age);
            std::abort();
          }
          checked+=3;
        }
      }
    }
  }
  return checked;
}
int main() {
  const auto &packet=interference::Packet::get();
  for(unsigned t=0;t<1600;++t) assert(packet.sample(t)==referenceSample(t));
  for(unsigned t=0;t<=1000;++t) assert(packet.sample(t)==-packet.sample(t+200));

  fx::Scene<1,3> bench;
  bench.setMode(10); bench.press(0,0,0); bench.press(0,2,0);
  bench.frame(0); assert(same(bench.pixel(0,0,0,0),{19,99,120}));
  bench.frame(400);
  assert(same(bench.pixel(0,0,0,400),{}));
  assert(same(bench.pixel(0,2,0,400),{}));
  bench.frame(500);
  assert(same(bench.pixel(0,1,0,500),{38,198,240}));
  bench.frame(2000); assert(same(bench.pixel(0,0,0,2000),{}));
  bench.press(0,0,2100); bench.frame(2100); assert(same(bench.pixel(0,0,0,2100),{}));
  bench.release(0,0); bench.press(0,0,2200); bench.frame(2200);
  assert(same(bench.pixel(0,0,0,2200),{19,99,120}));
  bench.setMode(4); bench.setMode(10); bench.frame(2201);
  assert(same(bench.pixel(0,0,0,2201),{}));

  // Three crests minus two troughs gives one crest. Earlier clipping would lose amplitude.
  fx::Scene<1,1> sum;
  sum.setMode(10);
  for(int i=0;i<3;++i){sum.press(0,0,0);sum.release(0,0);}
  for(int i=0;i<2;++i){sum.press(0,0,200);sum.release(0,0);}
  sum.frame(400);assert(same(sum.pixel(0,0,0,400),{19,99,120}));
  sum.frame(600);assert(same(sum.pixel(0,0,0,600),{45,31,89}));
  sum.frame(1800);assert(same(sum.pixel(0,0,0,1800),{}));

  // At 128 waves, the first source is still visible. The next edge replaces it.
  fx::Scene<10,10> busy;
  busy.setMode(10); busy.press(9,9,0); busy.release(9,9);
  for(unsigned i=1;i<128;++i) {busy.press(0,0,0);busy.release(0,0);}
  busy.frame(0); assert(same(busy.pixel(9,9,0,0),{19,99,120}));
  assert(same(busy.pixel(0,0,0,0),{40,210,255}));  // magnitude clips at 255 after signed accumulation
  busy.press(0,0,0);busy.frame(0);assert(same(busy.pixel(9,9,0,0),{}));
  const uint64_t checked=verifyGrid<10,10>()+verifyGrid<1,3>()+verifyGrid<3,1>()+verifyGrid<1,1>();
  std::printf("%llu RGB bytes match continuous-cosine reference. All 1600 packet entries, destructive/constructive display, clamp ordering, taper, wrap, mode clearing and overflow passed. Host Scene %zu bytes.\n",
              static_cast<unsigned long long>(checked),sizeof busy);
}
