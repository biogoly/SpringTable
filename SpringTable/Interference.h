#pragma once
#include <stdint.h>
#include <math.h>
#include "Reflection.h"
#include "RingGeometry.h"
#include "WavePalette.h"

namespace interference {

// One finite wave packet, shared by every launch. Building the second half
// of each cycle from the first gives exact crest/trough cancellation.
class Packet {
  int8_t samples_[1600];
  Packet() {
    uint8_t quarter[101];
    for (unsigned i = 0; i <= 100; ++i) {
      quarter[i] = static_cast<uint8_t>(120 * cos(3.14159265358979323846 * i / 200) + 0.5);
    }
    for (unsigned t = 0; t < 1600; ++t) {
      const unsigned phase = t % 400, halfPhase = phase % 200;
      const unsigned magnitude = quarter[halfPhase <= 100 ? halfPhase : 200 - halfPhase];
      const unsigned envelope = t <= 1200 ? 400 : 1600 - t;
      const int sample = static_cast<int>((magnitude * envelope + 200) / 400);
      samples_[t] = static_cast<int8_t>(phase >= 100 && phase < 300 ? -sample : sample);
    }
  }
public:
  static const Packet &get() { static const Packet packet; return packet; }
  int sample(unsigned t) const { return samples_[t]; }
  int afterDelay(uint32_t age, unsigned delay) const {
    return age >= delay && age - delay < 1600 ? samples_[age - delay] : 0;
  }
};

template<unsigned Rows, unsigned Cols, class Color>
class Field {
  using Travel = ringgeom::CenterTravel<Rows, Cols>;
  using Return = reflection::ReturnTravel<Rows, Cols>;
  static const unsigned count = Rows * Cols, capacity = 128;
  struct Wave {
    uint32_t born;
    uint16_t endAge;
    uint8_t row, col;
    bool active;
    Pair<Color> colors;
  };
  Wave waves_[capacity] = {};
  Color rings_[count] = {};
  const Return *returns_ = nullptr;
  unsigned next_ = 0;

  static uint8_t tint(unsigned color, unsigned magnitude) {
    return static_cast<uint8_t>((color * magnitude + 127) / 255);
  }

public:
  void prepare(bool reflected = false) {
    (void)Travel::get();
    (void)Packet::get();
    returns_ = reflected ? &Return::get() : nullptr;
  }
  void clear() {
    for (Wave &wave : waves_) wave.active = false;
    for (Color &ring : rings_) ring = {};
    next_ = 0;
  }
  void snapshotPalette(Pair<Color> colors) {
    for (Wave &wave : waves_) if (wave.active) wave.colors = colors;
  }
  void launch(unsigned row, unsigned col, uint32_t now, Pair<Color> colors) {
    const unsigned farY = row >= Rows - 1 - row ? row : Rows - 1 - row;
    const unsigned farX = col >= Cols - 1 - col ? col : Cols - 1 - col;
    const unsigned origin = row * Cols + col;
    const unsigned last = returns_ ? returns_->delay(origin, origin) : Travel::get().ms[farY * Cols + farX];
    const unsigned end = last + 1600;
    waves_[next_] = {now, static_cast<uint16_t>(end), static_cast<uint8_t>(row), static_cast<uint8_t>(col), true, colors};
    next_ = (next_ + 1) % capacity;
  }
private:
  template<class Consume>
  void contributions(uint32_t now, Consume consume) {
    const auto &travel = Travel::get();
    const Packet &packet = Packet::get();
    for (Wave &wave : waves_) if (wave.active) {
      const uint32_t age = now - wave.born;
      if (age >= wave.endAge) { wave.active = false; continue; }
      const unsigned origin = wave.row * Cols + wave.col;
      for (unsigned i = 0; i < count; ++i) {
        const unsigned key = Travel::key(static_cast<int>(i % Cols) - wave.col,
                                         static_cast<int>(i / Cols) - wave.row);
        int contribution = packet.afterDelay(age, travel.ms[key]);
        if (returns_) contribution += packet.afterDelay(age, returns_->delay(origin, i));
        if (contribution) consume(i, contribution, wave);
      }
    }
  }

  struct Mixture {
    uint16_t weight = 0;
    uint32_t r = 0, g = 0, b = 0;
    void add(unsigned amplitude, Color c) {
      weight = static_cast<uint16_t>(weight + amplitude);
      r += amplitude * c.r; g += amplitude * c.g; b += amplitude * c.b;
    }
    Color scaled(unsigned magnitude) const {
      const uint32_t divisor = uint32_t(weight) * 255;
      auto channel = [=](uint32_t weighted) {
        return static_cast<uint8_t>((uint64_t(magnitude) * weighted + divisor / 2) / divisor);
      };
      return {channel(r), channel(g), channel(b)};
    }
  };
  void randomFrame(uint32_t now) {
    // Each original pluck combines its direct and return packet before choosing a tint.
    Mixture positive[count]{}, negative[count]{};
    contributions(now, [&](unsigned i, int value, const Wave &wave) {
      if (value > 0) positive[i].add(value, wave.colors.crest);
      else negative[i].add(-value, wave.colors.trough);
    });
    for (unsigned i = 0; i < count; ++i) {
      const int net = int(positive[i].weight) - int(negative[i].weight);
      if (!net) { rings_[i] = {}; continue; }
      unsigned magnitude = static_cast<unsigned>(net > 0 ? net : -net);
      rings_[i] = (net > 0 ? positive[i] : negative[i]).scaled(magnitude > 255 ? 255 : magnitude);
    }
  }
public:
  void frame(uint32_t now, const Palette<Color> &palette) {
    if (palette.isRandom()) { randomFrame(now); return; }
    // 128 sources with at most two packets of magnitude 120 each fit in int16_t.
    int16_t sums[count] = {};
    contributions(now, [&](unsigned i, int value, const Wave &) {
      sums[i] = static_cast<int16_t>(sums[i] + value);
    });
    const Pair<Color> fixed = palette.latest();
    for (unsigned i = 0; i < count; ++i) {
      const int value = sums[i];
      unsigned magnitude = static_cast<unsigned>(value < 0 ? -value : value);
      if (magnitude > 255) magnitude = 255;
      const Color color = value > 0 ? fixed.crest : fixed.trough;
      rings_[i] = {tint(color.r, magnitude), tint(color.g, magnitude), tint(color.b, magnitude)};
    }
  }
  Color ring(unsigned row, unsigned col) const { return rings_[row * Cols + col]; }
};
}  // namespace interference
