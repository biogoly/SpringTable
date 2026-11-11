#include "../../SpringTable/Effects.h"
#include <array>
#include <cassert>
#include <cstdio>
#include <algorithm>
#include <cmath>
#include <vector>

template<unsigned R, unsigned C>
static std::array<uint8_t, R*C*48> frame(fx::Scene<R,C> &scene, uint32_t now) {
  std::array<uint8_t,R*C*48> bytes{};
  scene.frame(now);
  unsigned out = 0;
  for (unsigned r=0; r<R; ++r) for (unsigned c=0; c<C; ++c) for (unsigned p=0; p<16; ++p) {
    const fx::Color rgb = scene.pixel(r,c,p,now);
    bytes[out++] = rgb.r; bytes[out++] = rgb.g; bytes[out++] = rgb.b;
  }
  return bytes;
}
template<size_t N> static unsigned energy(const std::array<uint8_t,N> &pixels) {
  unsigned sum = 0;
  for (uint8_t value : pixels) sum += value;
  return sum;
}

// Independent reference: store true sine/cosine emitters, find each closest LED
// by scanning the whole board, and sample every pixel with no bounding box.
struct Point { double x, y; };
static double distance2(Point a, Point b) {
  const double x = a.x - b.x, y = a.y - b.y;
  return x*x + y*y;
}
template<unsigned R, unsigned C>
static unsigned compare(unsigned sourceRow,unsigned sourceCol) {
  const double tau = 2 * std::acos(-1.0);
  std::vector<Point> emitters;
  for (unsigned r=0; r<R; ++r) for (unsigned c=0; c<C; ++c) for (unsigned p=0; p<16; ++p)
    emitters.push_back({c*60 + 17*std::sin(tau*p/16),r*60 - 17*std::cos(tau*p/16)});
  const Point center{(C-1)*30.,(R-1)*30.};
  const Point origin{sourceCol*60.,sourceRow*60.};
  const double r0 = std::sqrt(distance2(origin,center));
  const double startAngle = r0 == 0 ? -tau/4 : std::atan2(origin.y-center.y,origin.x-center.x);
  fx::Scene<R,C> scene;
  scene.setMode(8); scene.press(sourceRow,sourceCol,300);
  unsigned evaluated = 0;
  for (unsigned age : {0u,1u,30u,44u,45u,88u,90u,180u,330u,490u,760u,893u,1100u,1410u,
                       1700u,1799u,1800u,1879u,1880u,2060u,2200u,2239u,2240u}) {
    const auto actual = frame(scene,300+age);
    std::vector<double> gain(emitters.size(),0);
    const bool flash = age >= 1800;
    std::array<int,3> rgb = flash ? std::array<int,3>{{255,255,255}} :
                                    std::array<int,3>{{40,205,255}};
    for (unsigned trail = 0; trail < (flash ? 1u : 3u); ++trail) {
      if (age < trail*45 || age >= 2240) continue;
      Point point = center;
      double radius = 32, level = age < 1880 ? 1.0 : (2240-age)/360.0;
      if (!flash) {
        const double u = (age-45*trail)/1800.;
        const double r = (r0 == 0 ? 17.0 : r0)*(1-u);
        const double theta = startAngle + tau*(0.9*u+2.25*u*u);
        point = {center.x + r*std::cos(theta),center.y + r*std::sin(theta)};
        radius = 20 + std::min(26., r/10.);
        const double weights[] = {1.0,.55,.23};
        level = weights[trail];
      }
      double near2 = distance2(point,emitters[0]);
      for (Point e : emitters) near2 = std::min(near2,distance2(point,e));
      for (size_t p=0; p<emitters.size(); ++p)
        gain[p] = std::max(gain[p],level*(1-(distance2(point,emitters[p])-near2)/(radius*radius)));
    }
    for (size_t p=0; p<gain.size(); ++p) for (unsigned ch=0; ch<3; ++ch) {
      const int expected = static_cast<int>(std::floor(rgb[ch]*gain[p]+.5));
      assert(std::abs(int(actual[3*p+ch]) - expected) <= 1);
      ++evaluated;
    }
  }
  return evaluated;
}

int main() {
  using Full = fx::Scene<10,10>;
  Full one, two, ignored;
  for (Full *s : {&one,&two,&ignored}) {
    s->setMode(8);
    assert(energy(frame(*s,1000)) == 0);
    s->press(1,2,1000);
  }
  assert(energy(frame(one,1000)) > 0);
  ignored.press(1,2,1030);
  assert(frame(ignored,1060) == frame(one,1060)); // a held spring stays a single actor
  two.release(1,2); two.press(1,2,1080);
  auto original = frame(one,1080);
  auto overlap = frame(two,1080);
  for (unsigned i=0; i<original.size(); ++i) assert(overlap[i] >= original[i]);
  assert(energy(overlap) > energy(original));
  assert(energy(frame(one,30000)) == 0);
  ignored.setMode(2); ignored.setMode(8);
  assert(energy(frame(ignored,1070)) == 0);  // changes clear active actors
  ignored.press(1,2,1070); assert(energy(frame(ignored,1070)) == 0);
  ignored.release(1,2); ignored.press(1,2,1072); assert(energy(frame(ignored,1072)) > 0);

  fx::Scene<1,3> bench, wrapped;
  bench.setMode(8); wrapped.setMode(8);
  bench.press(0,0,100); wrapped.press(0,0,UINT32_MAX - 15u);
  for (unsigned dt : {0u,32u,180u,500u,1200u,2200u,4000u,10000u})
    assert(frame(bench,100+dt) == frame(wrapped,UINT32_MAX-15u+dt));
  const unsigned checked = compare<10,10>(0,0)+compare<10,10>(6,7)+compare<1,3>(0,1)+
                           compare<1,3>(0,2)+compare<1,1>(0,0)+compare<3,3>(1,1);
  // 129th launch evicts the oldest even when they have the same birth timestamp.
  Full busy;
  busy.setMode(8); busy.press(9,9,0);
  for (unsigned i = 1; i < 128; ++i) {busy.press(0,0,0); busy.release(0,0);}
  const auto before = frame(busy,0);
  busy.press(0,0,0); const auto after = frame(busy,0);
  unsigned corner = 0;
  for (unsigned i=99*48; i<100*48; ++i) {corner+=before[i]; assert(after[i]==0);}
  assert(corner>0);
  auto white = frame(busy,1800);
  for (unsigned p=0; p<1600; ++p) assert(white[3*p]==white[3*p+1] && white[3*p]==white[3*p+2]);
  assert(energy(white)>0);
  std::printf("%u RGB channels checked against brute-force irregular-time reference.\n",checked);
  std::printf("Drain overlap, duplicate suppression, mode switching, timer wrap and expiry passed. Host full scene %zu bytes.\n",sizeof one);
}
