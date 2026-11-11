#include "../../SpringTable/Effects.h"
#include <array>
#include <cassert>
#include <cstdio>

template<unsigned R, unsigned C>
using Bytes = std::array<uint8_t, R * C * 48>;
template<unsigned R, unsigned C>
Bytes<R,C> snapshot(fx::Scene<R,C> &scene, uint32_t now) {
  Bytes<R,C> bytes = {};
  scene.frame(now);
  unsigned index = 0;
  for (unsigned r = 0; r < R; ++r) for (unsigned c = 0; c < C; ++c)
    for (unsigned p = 0; p < 16; ++p) {
      auto pixel = scene.pixel(r,c,p,now);
      bytes[index++] = pixel.r; bytes[index++] = pixel.g; bytes[index++] = pixel.b;
    }
  return bytes;
}

template<size_t N> unsigned energy(const std::array<uint8_t,N> &a) {
  unsigned sum = 0;
  for (auto v : a) sum += v;
  return sum;
}
int main() {
  using Table = fx::Scene<10,10>;
  Table scene;
  const double low = -20, high = 80;
  assert(ricochet::reflect(-220,low,high) == -20);
  assert(ricochet::reflect(-120,low,high) == 80);
  assert(ricochet::reflect(-30,low,high) == -10);
  assert(ricochet::reflect(81,low,high) == 79);
  assert(ricochet::reflect(280,low,high) == 80);
  scene.setMode(7);
  assert(energy(snapshot(scene,0)) == 0);
  scene.press(4,4,1000);
  assert(energy(snapshot(scene,1000)) > 0);
  auto moving = snapshot(scene,1100);
  assert(energy(moving) > 0);
  bool split = false;
  for (unsigned ring = 0; ring < 100; ++ring)
    for (unsigned p = 1; p < 16; ++p)
      if (moving[ring*48 + 3*p] != moving[ring*48] ||
          moving[ring*48 + 3*p + 1] != moving[ring*48 + 1] ||
          moving[ring*48 + 3*p + 2] != moving[ring*48 + 2]) split = true;
  assert(split);
  // A re-pluck leaves the first trajectory alive. At the instant of the second
  // launch its light may only add to the old particle, never erase it.
  Table two, one;
  for (Table *s : {&one, &two}) {
    s->setMode(7); s->press(4,4,1000); s->release(4,4); snapshot(*s,1000);
  }
  two.press(4,4,1200);
  auto first = snapshot(one,1200), combined = snapshot(two,1200);
  assert(energy(first) > 0 && energy(combined) > energy(first));
  for (unsigned j = 0; j < first.size(); ++j) assert(first[j] <= combined[j]);
  assert(energy(snapshot(scene,100000)) == 0); // still held, no auto-repeat
  assert(energy(snapshot(scene,100100)) == 0);
  Table held, ignored;
  for (Table *s : {&held, &ignored}) {
    s->setMode(7); s->setRicochetSeed(0); s->press(1,2,900);
  }
  ignored.press(1,2,1050);
  assert(snapshot(held,1234) == snapshot(ignored,1234));
  assert(energy(snapshot(held,3501)) > 0);
  assert(energy(snapshot(held,900+4400)) == 0);
  ignored.setMode(1); ignored.setMode(7);
  assert(energy(snapshot(ignored,1250)) == 0);
  ignored.press(1,2,1251); assert(energy(snapshot(ignored,1251)) == 0);
  ignored.release(1,2); ignored.press(1,2,1252);
  assert(energy(snapshot(ignored,1252)) > 0);

  Table busy;
  busy.setMode(7);
  busy.press(9,9,0);
  for (unsigned i=1; i<128; ++i) { busy.press(0,0,0); busy.release(0,0); }
  auto atCapacity = snapshot(busy,0);
  bool finalCornerLit = false;
  for (unsigned i=99*48; i<100*48; ++i) finalCornerLit |= (atCapacity[i] > 0);
  assert(finalCornerLit);
  busy.press(0,0,0);
  auto evicted = snapshot(busy,0);
  for (unsigned i=99*48; i<100*48; ++i) assert(evicted[i] == 0);

  fx::Scene<1,3> bench;
  bench.setMode(7); bench.press(0,0,UINT32_MAX - 15u);
  auto atWrap = snapshot(bench,UINT32_MAX-15u);
  assert(energy(atWrap) > 0);
  auto afterWrap = snapshot(bench,120);
  assert(afterWrap != atWrap && energy(afterWrap) > 0);
  assert(energy(snapshot(bench,100000)) == 0);

  Table all;
  all.setMode(7);
  for (unsigned r=0; r<10; ++r) for (unsigned c=0; c<10; ++c) all.press(r,c,500);
  auto flash = snapshot(all,500);
  for (unsigned ring=0; ring<100; ++ring) {
    unsigned lit = 0;
    for (unsigned b=0; b<48; ++b) lit += flash[ring*48 + b];
    assert(lit > 0);
  }
  assert(energy(snapshot(all,100000)) == 0);
  std::printf("Ricochet flash, pixel locality, overlap/re-pluck, no held repeat, wrap, 100 simultaneous. Scene bytes: %zu.\n",sizeof all);
}
