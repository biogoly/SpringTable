#include "../../SpringTable/Effects.h"
#include <cassert>
#include <cstdio>

static unsigned energy(fx::Color c) { return c.r + c.g + c.b; }

template<unsigned R, unsigned C>
unsigned lit(const fx::Scene<R, C> &scene, unsigned row, unsigned col, uint32_t now) {
  unsigned count = 0;
  for (unsigned p = 0; p < 16; ++p) count += energy(scene.pixel(row, col, p, now)) > 0;
  return count;
}

template<unsigned R, unsigned C>
unsigned total(const fx::Scene<R, C> &scene, unsigned row, unsigned col, uint32_t now) {
  unsigned sum = 0;
  for (unsigned p = 0; p < 16; ++p) sum += energy(scene.pixel(row, col, p, now));
  return sum;
}

int main() {
  fx::Scene<10, 10> scene;
  for (uint8_t mode = 0; mode < 7; ++mode) {
    scene.setMode(mode);
    scene.frame(0);
    for (unsigned y = 0; y < 10; ++y) for (unsigned x = 0; x < 10; ++x)
      assert(lit(scene, y, x, 0) == 0);
  }

  scene.setMode(fx::Ripple);
  scene.press(9, 0, 1000);
  scene.frame(1000);
  assert(lit(scene, 9, 0, 1000) == 16);
  assert(lit(scene, 9, 1, 1000) == 0);
  unsigned initial = total(scene, 9, 0, 1000);
  scene.frame(1130);
  assert(lit(scene, 9, 1, 1130) == 16);
  assert(total(scene, 9, 1, 1130) < initial);
  assert(lit(scene, 8, 1, 1130) == 0);  // diagonal arrives after cardinal
  assert(lit(scene, 8, 9, 1130) == 0);  // no serpentine edge wrap
  scene.frame(1180);
  assert(lit(scene, 8, 1, 1180) == 16);
  scene.frame(1254);
  assert(lit(scene, 7, 1, 1254) == 16);
  assert(lit(scene, 7, 2, 1254) == 0);  // outside circle
  scene.frame(1500);
  assert(lit(scene, 9, 0, 1500) == 16 && total(scene, 9, 0, 1500) < initial / 4);
  scene.release(9, 0);
  scene.frame(1501);
  assert(lit(scene, 9, 0, 1501) == 0);
  scene.press(9, 0, 1502);
  scene.frame(1502);
  assert(total(scene, 9, 0, 1502) > 16 * 255);

  fx::Scene<1, 3> wave;
  wave.press(0, 0, 0);
  wave.frame(130);
  fx::Color single = wave.pixel(0, 1, 0, 130);
  wave.press(0, 2, 0);
  wave.frame(130);
  fx::Color both = wave.pixel(0, 1, 0, 130);
  assert(both.r > single.r && both.g >= single.g && both.b >= single.b);

  for (uint8_t mode = 1; mode < 7; ++mode) {
    fx::Scene<5, 5> effect;
    effect.setMode(mode);
    const uint32_t start = UINT32_MAX - 49;
    effect.press(2, 2, start);
    effect.frame(start);
    unsigned first = lit(effect, 2, 2, start);
    assert(first > 0);
    if (mode == fx::Spinner) assert(first == 4);
    if (mode == fx::Solid) assert(first == 16);
    if (mode == fx::Gear) assert(first == 12);
    if (mode == fx::Fire) assert(first == 16 && effect.pixel(2, 2, 0, start).b == 0);
    effect.frame(start + 120u);
    if (mode == fx::Spinner) {
      assert(energy(effect.pixel(2, 2, 2, start + 120u)) >
             energy(effect.pixel(2, 2, 0, start + 120u)));
    }
    if (mode == fx::Surface) assert(lit(effect, 1, 1, start + 120u) == 16);
    else assert(lit(effect, 1, 1, start + 120u) == 0);
    effect.release(2, 2);
    effect.frame(start + 121u);
    if (mode != fx::Surface) {
      effect.frame(start + 250u);
      assert(lit(effect, 2, 2, start + 250u) > 0);
    }
    effect.frame(start + 650u);
    assert(lit(effect, 2, 2, start + 650u) == 0);
    assert(lit(effect, 3, 2, start + 650u) == 0);
  }

  fx::Scene<1, 3> wrapped;
  uint32_t start = UINT32_MAX - 40;
  wrapped.press(0, 0, start);
  wrapped.release(0, 0);
  wrapped.frame(start + 5u);
  assert(lit(wrapped, 0, 0, start + 5u) > 0);
  wrapped.frame(start + 130u);
  assert(lit(wrapped, 0, 1, start + 130u) > 0);
  wrapped.frame(start + 1000u);
  assert(lit(wrapped, 0, 0, start + 1000u) == 0);
  wrapped.frame(start + 130u);  // expired wave must stay expired after a full wrap
  assert(lit(wrapped, 0, 1, start + 130u) == 0);

  // All 100 springs may fire together. No fixed event pool cuts off later presses.
  for (unsigned y = 0; y < 10; ++y) for (unsigned x = 0; x < 10; ++x) {
    scene.press(y, x, 5000);
  }
  scene.press(10, 0, 5000);
  scene.release(0, 10);
  scene.frame(5000);
  for (unsigned y = 0; y < 10; ++y) for (unsigned x = 0; x < 10; ++x)
    assert(lit(scene, y, x, 5000) == 16);
  scene.frame(5141);
  assert(energy(scene.pixel(5, 5, 0, 5141)) >= 255 * 2);
  assert(energy(scene.pixel(10, 1, 0, 5141)) == 0);
  assert(energy(scene.pixel(0, 0, 16, 5141)) == 0);
  std::printf("Effects passed; full-table scene uses %zu bytes on this host.\n", sizeof scene);
}
