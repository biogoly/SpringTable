#include "../../SpringTable/Effects.h"
#include <algorithm>
#include <array>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <limits>

static int envelope(int now, int peak, int length) {
  return now < peak || now >= peak + length ? 0 : 255 * (peak + length - now) / length;
}
struct Peaks { int out, back; };
template<unsigned R, unsigned C>
static unsigned verify() {
  const std::array<std::array<int,3>,6> palette = {{{40,205,255},{255,93,24},{185,65,255},
                                                    {75,255,130},{255,70,148},{255,202,35}}};
  fx::Scene<R,C> scene;
  unsigned checked = 0;
  for (unsigned src=0; src<R*C; ++src) {
    double x0=src%C*60., y0=src/C*60.;
    std::array<Peaks,R*C> peaks{};
    double farthest = 0;
    for (unsigned i=0; i<R*C; ++i) {
      if (i==src) continue;
      double dx=i%C*60.-x0, dy=i/C*60.-y0;
      double d=std::hypot(dx,dy), nx=dx/d, ny=dy/d;
      double exit=std::numeric_limits<double>::infinity();
      if (nx) exit=std::min(exit,(nx<0 ? -x0 : (C-1)*60. - x0)/nx);
      if (ny) exit=std::min(exit,(ny<0 ? -y0 : (R-1)*60. - y0)/ny);
      double edge=std::max(exit,d) + 19;
      peaks[i].out=static_cast<int>(std::lround(d/0.6));
      peaks[i].back=static_cast<int>(std::lround((edge/600.+(edge-d)/1500.)*1000.));
      farthest=std::max(farthest,d);
    }
    peaks[src].back=std::max(220,int(std::lround((farthest+19)*(1/.6+1/1.5))));
    scene.setMode(0); scene.setMode(9);
    uint32_t start = UINT32_MAX - 123u + 3000u*src;
    scene.press(src/C,src%C,start); scene.release(src/C,src%C);
    for (int age=0; age<=peaks[src].back+165; age+=5) {
      scene.frame(start+age);
      for (unsigned i=0; i<R*C; ++i) {
        const auto &p = palette[src%6];
        const int out=envelope(age,peaks[i].out,140);
        const int in=envelope(age,peaks[i].back, i==src?160:100);
        int expect[3]{};
        for (unsigned ch=0; ch<3; ++ch) {
          int pastel=(2*p[ch]+255)/3;
          expect[ch]=std::max((p[ch]*out+127)/255,(pastel*in+127)/255);
        }
        for (unsigned led=0; led<16; ++led) {
          auto c=scene.pixel(i/C,i%C,led,start+age);
          if (c.r!=expect[0] || c.g!=expect[1] || c.b!=expect[2]) {
            std::fprintf(stderr,"Mismatch at %ux%u: origin %u target %u age %d, peaks %d/%d. RGB %u,%u,%u expected %d,%d,%d\n",R,C,src,i,age,peaks[i].out,peaks[i].back,c.r,c.g,c.b,expect[0],expect[1],expect[2]);
            assert(false);
          }
          checked += 3;
        }
      }
    }
  }
  return checked;
}

static unsigned energy(fx::Color c) { return c.r + c.g + c.b; }
int main() {
  const unsigned channels=verify<10,10>()+verify<1,3>()+verify<3,1>()+verify<1,1>()+verify<3,4>();
  fx::Scene<1,3> bench;
  bench.setMode(9); bench.press(0,0,0); bench.release(0,0);
  bench.frame(100); assert(energy(bench.pixel(0,1,1,100))==500); // 40+205+255
  for(auto check : {Peaks{2,244},Peaks{1,284},Peaks{0,324}}) {
    bench.frame(check.back);
    auto c=bench.pixel(0,check.out,0,check.back);
    assert(c.r==111 && c.g==221 && c.b==255);
  }
  fx::Scene<1,1> one;
  one.setMode(9); one.press(0,0,100);
  one.frame(239); assert(energy(one.pixel(0,0,0,239))>0);
  one.frame(240); assert(energy(one.pixel(0,0,0,240))==0);
  one.frame(319); assert(energy(one.pixel(0,0,0,319))==0);
  one.frame(320); assert(energy(one.pixel(0,0,0,320))==111+221+255);
  one.frame(480); assert(energy(one.pixel(0,0,0,480))==0);
  one.press(0,0,500); one.frame(500); assert(energy(one.pixel(0,0,0,500))==0);
  one.release(0,0); one.press(0,0,501); one.frame(501); assert(energy(one.pixel(0,0,0,501))>0);
  one.setMode(0); one.setMode(9); one.frame(501); assert(energy(one.pixel(0,0,0,501))==0);

  fx::Scene<10,10> busy;
  busy.setMode(9); busy.press(9,9,0); busy.release(9,9);
  for(unsigned i=1;i<128;++i) {busy.press(0,0,0);busy.release(0,0);}
  busy.frame(0); assert(energy(busy.pixel(9,9,0,0))>0);
  auto merged=busy.pixel(0,0,0,0); assert(merged.r==255 && merged.g==255 && merged.b==255);
  busy.press(0,0,0); busy.frame(0); assert(energy(busy.pixel(9,9,0,0))==0);
  std::printf("%u RGB bytes match direct forward/return geometry. Correction of elapsed wrap, duplicate-held suppression, eviction, same-ring pulses and mode clearing passed. Scene %zu bytes.\n",channels,sizeof busy);
}
