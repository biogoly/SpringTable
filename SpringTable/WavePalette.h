#pragma once
#include <stdint.h>

namespace interference {
template<class Color>
struct Pair { Color crest, trough; };

template<class Color>
class Palette {
  Pair<Color> manual_{}, latest_{};
  bool random_ = false, grouped_ = false, multiple_ = false, haveHue_ = false;
  unsigned firstRing_ = 0, previousHue_ = 0;
  uint32_t groupStart_ = 0, rng_ = UINT32_C(0x6d2b79f5);

  uint32_t word() {
    rng_ ^= rng_ << 13;
    rng_ ^= rng_ >> 17;
    rng_ ^= rng_ << 5;
    return rng_;
  }
  static Color wheel(unsigned hue) {
    const unsigned mix = (223 * (hue % 256) + 127) / 255;
    const uint8_t up = static_cast<uint8_t>(32 + mix), down = static_cast<uint8_t>(255 - mix);
    switch (hue / 256) {
      case 0: return {255,up,32};
      case 1: return {down,255,32};
      case 2: return {32,255,up};
      case 3: return {32,down,255};
      case 4: return {up,32,255};
      default: return {255,32,down};
    }
  }
  static bool same(Color a, Color b) { return a.r == b.r && a.g == b.g && a.b == b.b; }
  void roll() {
    unsigned crest = haveHue_ ? (previousHue_ + 384 + word() % 769) % 1536 : word() % 1536;
    unsigned trough = (crest + 640 + word() % 257) % 1536;
    Pair<Color> next{wheel(crest), wheel(trough)};
    while (same(next.crest, latest_.crest) || same(next.trough, latest_.trough)) {
      crest = (crest + 384) % 1536;
      trough = (trough + 384) % 1536;
      next = {wheel(crest), wheel(trough)};
    }
    latest_ = next;
    previousHue_ = crest;
    haveHue_ = true;
  }
public:
  bool isRandom() const { return random_; }
  Pair<Color> latest() const { return latest_; }
  void setFixed(Color crest, Color trough) {
    manual_ = latest_ = {crest, trough};
    random_ = grouped_ = false;
  }
  void setRandom(bool enabled) {
    if (random_ == enabled) return;
    random_ = enabled;
    latest_ = manual_;
    grouped_ = false;
  }
  void setSeed(uint32_t seed) {
    rng_ = seed ? seed : UINT32_C(0x6d2b79f5);
    haveHue_ = grouped_ = false;
  }
  void beginGroup() { grouped_ = false; }
  Pair<Color> onPress(unsigned ring, uint32_t now, bool otherHeld) {
    if (!random_) return latest_;
    if (!grouped_ || (!otherHeld && (multiple_ || ring == firstRing_ || now - groupStart_ >= 250))) {
      roll();
      grouped_ = true;
      multiple_ = false;
      firstRing_ = ring;
      groupStart_ = now;
    } else if (ring != firstRing_) {
      multiple_ = true;
    }
    return latest_;
  }
};
}  // namespace interference
