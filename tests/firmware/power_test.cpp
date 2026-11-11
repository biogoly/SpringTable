#include "../../SpringTable/PowerLimit.h"
#include <array>
#include <vector>
#include <algorithm>
#include <cassert>
#include <cstdio>
#include <cstdint>

using RGB = std::array<uint8_t, 3>;
static uint64_t units(const std::vector<RGB> &pixels) {
  uint64_t s = 0;
  for (const auto &c : pixels) s += c[0] + c[1] + c[2];
  return s;
}
static uint64_t estimate(const std::vector<RGB> &pixels) {
  return 1000u * pixels.size() + (20000u * units(pixels) + 254u) / 255u;
}
struct Result { unsigned whiteCode; uint64_t input, out; };

static Result check(const std::vector<RGB> &frame, uint32_t budgetMa) {
  uint64_t modelDemand = 0;
  for (const auto &c : frame) {
    uint32_t d = powerlimit::demand(c[0], c[1], c[2]);
    assert(d == 20000u * (c[0] + c[1] + c[2]));
    modelDemand += d;
  }
  const unsigned count = unsigned(frame.size());
  const uint64_t budget = uint64_t(budgetMa) * 1000u;
  const uint64_t idle = uint64_t(count) * 1000u;
  const uint64_t requested = estimate(frame);
  assert(powerlimit::estimatedMicroAmps(modelDemand, count) == requested);
  auto gain = powerlimit::fit(modelDemand, count, budgetMa);
  assert(gain.denominator != 0 && gain.numerator <= gain.denominator);
  std::vector<RGB> output = frame;
  for (auto &c : output) for (auto &v : c) {
    unsigned ideal = v;
    if (requested > budget) {
      ideal = budget <= idle ? 0 : unsigned(v * (budget - idle) * 255u / modelDemand);
    }
    unsigned result = gain.apply(v);
    assert(result == ideal || (requested > budget && result + 1 == ideal));
    v = uint8_t(result);
  }
  const uint64_t actual = estimate(output);
  assert(actual <= std::max(budget, idle));
  if (budget <= idle) assert(actual == idle);
  if (requested <= budget) assert(output == frame);
  for (unsigned i = 0; i < 255; ++i) {
    assert(gain.apply(uint8_t(i)) <= gain.apply(uint8_t(i + 1)));
    assert(gain.apply(uint8_t(i)) <= i);
  }
  return {unsigned(gain.apply(255)), requested, actual};
}

int main() {
  std::vector<RGB> full(1600, RGB{{255,255,255}}), bench(48, RGB{{255,255,255}});
  auto a = check(full, 40000);
  assert(a.whiteCode == 102 && a.input == 97600000 && a.out == 40000000);
  auto b = check(bench, 1500);
  assert(b.whiteCode == 128 && b.input == 2928000 && b.out == 1493648);
  std::printf("Full white: 1600 px requested %llu -> %llu uA (code %u); 48 px %llu -> %llu uA (code %u).\n",
              (unsigned long long)a.input, (unsigned long long)a.out, a.whiteCode,
              (unsigned long long)b.input, (unsigned long long)b.out, b.whiteCode);
  assert(check(full, 100000).out == 97600000);
  assert(check(full, 1600).whiteCode == 0);
  assert(check(full, 1599).out == 1600000);
  assert(check(full, 0).out == 1600000);
  assert(check(bench, UINT32_MAX).whiteCode == 255);
  assert(check({}, 0).out == 0);
  std::fill(full.begin(), full.end(), RGB{{0,0,0}});
  assert(check(full, 40000).out == 1600000);
  for (unsigned c = 0; c < 3; ++c) {
    std::vector<RGB> frame(1600);
    for (auto &p : frame) p[c] = 255;
    assert(check(frame, 40000).out == 33600000);
  }
  // Camera-ready full-color single-ring highlight, dark remainder: unity gain.
  std::fill(full.begin(), full.begin() + 16, RGB{{255,255,255}});
  assert(check(full, 40000).out == 2560000);
  // Pseudorandom deterministic RGB frames, both sides of budget, all mix ratios.
  uint32_t rng = 0xc870f09bu;
  for (unsigned pass = 0; pass < 200; ++pass) {
    unsigned n = pass % 2 ? 48u : 1600u;
    std::vector<RGB> mixed(n);
    for (auto &c : mixed) for (auto &v : c) {
      rng = 1664525u * rng + 1013904223u;
      v = uint8_t((rng >> 24) / (1 + (pass % 4)));
    }
    unsigned ma = unsigned(estimate(mixed) / 1000);
    check(mixed, n == 1600 ? 40000 : 1500);
    check(mixed, ma);
    check(mixed, ma + 1);
    check(mixed, ma / 2);
  }
  std::puts("Power model checks passed: idle, sparse highlights, primaries, limit boundary, mixed colors, 800 seeded mixed-frame cases.");
}
