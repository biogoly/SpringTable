#pragma once
#include <stdint.h>
#include "Config.h"
#include "Drain.h"
#include "Interference.h"
#include "Reflection.h"
#include "Ricochet.h"

namespace fx {

struct Color { uint8_t r, g, b; };

inline Color scale(Color c, unsigned level) {
  return {static_cast<uint8_t>((c.r * level + 127u) / 255u),
          static_cast<uint8_t>((c.g * level + 127u) / 255u),
          static_cast<uint8_t>((c.b * level + 127u) / 255u)};
}

inline uint8_t cappedAdd(uint8_t a, uint8_t b) {
  unsigned sum = static_cast<unsigned>(a) + b;
  return static_cast<uint8_t>(sum > 255 ? 255 : sum);
}

inline void add(Color &dest, Color c) {
  dest = {cappedAdd(dest.r, c.r), cappedAdd(dest.g, c.g), cappedAdd(dest.b, c.b)};
}

enum Mode : uint8_t {
  Ripple, Spinner, Solid, Confetti, Gear, Fire, Surface, Ricochet, Drain,
  Reflection, Interference, ReflectedInterference
};

template<unsigned Rows, unsigned Cols>
class Scene {
  static_assert(Rows > 0 && Cols > 0, "A table needs at least one ring");
  struct Touch {
    uint32_t pressedAt, releasedAt;
    Color color;
    bool held, wave, stampRelease, fading;
  };
  struct Ring {
    Color color;
    uint8_t level, head;
    uint32_t slot;
  };

  Touch touches_[Rows * Cols] = {};
  Ring rings_[Rows * Cols] = {};
  ricochet::Field<Rows, Cols, Color> ricochet_;
  drain::Field<Rows, Cols, Color> drain_;
  reflection::Field<Rows, Cols, Color> reflection_;
  interference::Field<Rows, Cols, Color> interference_;
  interference::Palette<Color> wavePalette_;
  uint8_t mode_ = Ripple;
  unsigned colorIndex_ = 0;
  static const unsigned tailMs = 450;

  static bool usesInterference(uint8_t mode) {
    return mode == Interference || mode == ReflectedInterference;
  }
  static Color ink(unsigned index) {
    static const Color colors[] = {
      {40, 205, 255}, {255, 93, 24}, {185, 65, 255},
      {75, 255, 130}, {255, 70, 148}, {255, 202, 35}
    };
    return colors[index % 6];
  }

  static uint8_t noise(uint32_t seed) {
    seed ^= seed >> 16;
    seed *= UINT32_C(0x7feb352d);
    seed ^= seed >> 15;
    return static_cast<uint8_t>(seed >> 24);
  }

  // Distances 0, 1, sqrt(2), 2, and sqrt(5) occur in a 2.5-pitch radius.
  // A radial wave cannot cross a row boundary through LED strip ordering.
  static unsigned arrival(unsigned dx, unsigned dy, bool square) {
    static const uint16_t delays[] = {0, 100, 141, 0, 200, 224};
    if (square) return (dx > dy ? dx : dy) * 100;
    unsigned d2 = dx * dx + dy * dy;
    return d2 < 6 ? delays[d2] : 1000;
  }

  static unsigned waveLevel(unsigned age, unsigned delay) {
    if (age < delay || age >= delay + 200) return 0;
    unsigned time = age - delay;
    unsigned peak = 255 - delay / 2;
    // Direct contact flashes immediately. A neighboring ring has a soft attack.
    if (delay == 0) return peak * (200 - time) / 200;
    if (time < 30) return peak * time / 30;
    return peak * (200 - time) / 170;
  }

  void drawWave(unsigned row, unsigned col, const Touch &touch, unsigned age) {
    int top = row > 1 ? static_cast<int>(row) - 2 : 0;
    int left = col > 1 ? static_cast<int>(col) - 2 : 0;
    for (int y = top; y <= static_cast<int>(row) + 2 && y < static_cast<int>(Rows); ++y) {
      for (int x = left; x <= static_cast<int>(col) + 2 && x < static_cast<int>(Cols); ++x) {
        unsigned dy = y >= static_cast<int>(row) ? y - row : row - y;
        unsigned dx = x >= static_cast<int>(col) ? x - col : col - x;
        unsigned level = waveLevel(age, arrival(dx, dy, mode_ == Surface));
        if (level) add(rings_[y * Cols + x].color, scale(touch.color, level));
      }
    }
  }

  static unsigned streak(unsigned led, unsigned head) {
    static const uint8_t levels[] = {255, 120, 52, 20};
    unsigned behind = (head + 16 - led) & 15;
    return behind < 4 ? levels[behind] : 0;
  }

public:
  Scene() {
    resetInterferenceColors();
    setInterferenceRandom(cfg::InterferenceRandomPerPair);
  }

  void setInterferenceColors(Color crest, Color trough) {
    wavePalette_.setFixed(crest, trough);
  }
  void getInterferenceColors(Color &crest, Color &trough) const {
    const auto pair = wavePalette_.latest();
    crest = pair.crest;
    trough = pair.trough;
  }
  bool getInterferenceRandom() const { return wavePalette_.isRandom(); }
  void setInterferenceRandom(bool enabled) {
    if (enabled == wavePalette_.isRandom()) return;
    if (enabled) interference_.snapshotPalette(wavePalette_.latest());
    wavePalette_.setRandom(enabled);
  }
  void setInterferencePaletteSeed(uint32_t seed) { wavePalette_.setSeed(seed); }
  void beginInterferenceGroup() { wavePalette_.beginGroup(); }
  void resetInterferenceColors() {
    const auto &c = cfg::InterferenceCrestRGB;
    const auto &t = cfg::InterferenceTroughRGB;
    setInterferenceColors({c[0], c[1], c[2]}, {t[0], t[1], t[2]});
  }

  void setMode(uint8_t mode) {
    if (mode > ReflectedInterference || mode == mode_) return;
    if (mode == Ricochet || mode_ == Ricochet) ricochet_.clear();
    if (mode == Drain || mode_ == Drain) drain_.clear();
    if (mode == Reflection || mode_ == Reflection) reflection_.clear();
    if (mode == Reflection) reflection_.prepare();
    if (usesInterference(mode) || usesInterference(mode_)) {
      interference_.clear();
      wavePalette_.beginGroup();
    }
    if (usesInterference(mode)) interference_.prepare(mode == ReflectedInterference);
    mode_ = mode;
  }

  void setRicochetSeed(uint32_t seed) { ricochet_.setSeed(seed); }

  void press(unsigned row, unsigned col, uint32_t now) {
    if (row >= Rows || col >= Cols) return;
    Touch &touch = touches_[row * Cols + col];
    if (mode_ >= Ricochet && touch.held) return;
    touch.color = ink(colorIndex_++);
    if (mode_ == Ricochet) ricochet_.launch(row, col, now, ink);
    if (mode_ == Drain) drain_.launch(row, col, now, touch.color);
    if (mode_ == Reflection) reflection_.launch(row, col, now, touch.color);
    if (usesInterference(mode_)) {
      bool anotherHeld = false;
      if (wavePalette_.isRandom()) {
        for (const Touch &existing : touches_) if (existing.held) { anotherHeld = true; break; }
      }
      const auto pair = wavePalette_.onPress(row * Cols + col, now, anotherHeld);
      interference_.launch(row, col, now, pair);
    }
    touch.pressedAt = now;
    touch.held = true;
    touch.wave = true;
    touch.fading = touch.stampRelease = false;
  }

  void release(unsigned row, unsigned col) {
    if (row >= Rows || col >= Cols) return;
    Touch &touch = touches_[row * Cols + col];
    if (touch.held) {
      touch.held = false;
      touch.stampRelease = true;
    }
  }

  // Prepare once for the whole table. Each wave visits at most 25 nearby rings.
  void frame(uint32_t now) {
    if (mode_ == Ricochet) ricochet_.frame(now);
    if (mode_ == Drain) drain_.frame(now);
    if (mode_ == Reflection) reflection_.frame(now);
    if (usesInterference(mode_)) interference_.frame(now, wavePalette_);
    for (Ring &ring : rings_) ring = {};
    for (unsigned i = 0; i < Rows * Cols; ++i) {
      Touch &touch = touches_[i];
      uint32_t age = now - touch.pressedAt;
      if (age >= 425) touch.wave = false;
      if (touch.stampRelease) {
        touch.releasedAt = now;
        touch.stampRelease = false;
        touch.fading = true;
      }
      uint32_t releasedAge = now - touch.releasedAt;
      if (releasedAge >= tailMs) touch.fading = false;
      Ring &ring = rings_[i];
      if (mode_ == Ripple || mode_ == Surface) {
        if (touch.wave) drawWave(i / Cols, i % Cols, touch, age);
        if (touch.held) add(ring.color, scale(touch.color, 26));
      } else if (mode_ < Ricochet && (touch.held || touch.fading)) {
        ring.level = touch.held ? 255 : static_cast<uint8_t>(255 * (tailMs - releasedAge) / tailMs);
        ring.color = scale(touch.color, ring.level);
        ring.head = static_cast<uint8_t>((age / 47) & 15u);
        ring.slot = age / 80 + i * 59u;
      }
    }
  }

  Color pixel(unsigned row, unsigned col, unsigned led, uint32_t now) const {
    if (row >= Rows || col >= Cols || led >= 16) return {};
    if (mode_ == Ricochet) return ricochet_.pixel(row, col, led);
    if (mode_ == Drain) return drain_.pixel(row, col, led);
    if (mode_ == Reflection) return reflection_.ring(row, col);
    if (usesInterference(mode_)) return interference_.ring(row, col);
    const Ring &ring = rings_[row * Cols + col];
    if (mode_ == Ripple || mode_ == Surface || mode_ == Solid) return ring.color;
    if (!ring.level) return {};
    if (mode_ == Spinner || mode_ == Gear) {
      unsigned level = streak(led, ring.head);
      if (mode_ == Gear) {
        level += streak(led, (ring.head + 5) & 15);
        level += streak(led, (ring.head + 11) & 15);
      }
      return scale(ring.color, level);
    }
    if (mode_ == Confetti) {
      return ((noise(ring.slot) & 15u) == led || noise(ring.slot + 123u * led) < 24)
          ? ring.color : Color{};
    }
    // Ember intensity varies continuously between two pseudo-random samples.
    uint32_t slot = now / 80 + row * 37u + col * 23u + led * 193u;
    unsigned fraction = now % 80;
    unsigned heat = 42 + (noise(slot) * (80 - fraction) + noise(slot + 1) * fraction) / 100;
    Color ember = {static_cast<uint8_t>(heat), static_cast<uint8_t>(heat * heat / 330), 0};
    return scale(ember, ring.level);
  }
};
}  // namespace fx
