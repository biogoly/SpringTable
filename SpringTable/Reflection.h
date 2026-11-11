#pragma once
#include <stdint.h>
#include <math.h>
#include "RingGeometry.h"

namespace reflection {

template<unsigned Rows, unsigned Cols>
class ReturnTravel {
  static const unsigned count = Rows * Cols;
  using Travel = ringgeom::CenterTravel<Rows, Cols>;
  uint16_t inbound_[count][count] = {};  // Ordered pair: launch ring, receiving ring.

  static uint16_t nearestMs(double time) { return static_cast<uint16_t>(time + 0.5); }
  ReturnTravel() {
    const auto &travel = Travel::get();
    for (unsigned origin = 0; origin < count; ++origin) {
      const int sx = static_cast<int>(origin % Cols), sy = static_cast<int>(origin / Cols);
      double farthest = 0;
      for (unsigned target = 0; target < count; ++target) {
        if (target == origin) continue;
        const int dx = static_cast<int>(target % Cols) - sx;
        const int dy = static_cast<int>(target / Cols) - sy;
        const double d = travel.mm[Travel::key(dx, dy)];
        if (d > farthest) farthest = d;

        // Ray through the target. Ignore axes parallel to it, including the
        // collapsed axis on a one-row or one-column bench.
        double exit = 0;
        if (dx != 0) {
          const int wall = dx > 0 ? static_cast<int>(Cols) - 1 : 0;
          exit = d * (wall - sx) / dx;
        }
        if (dy != 0) {
          const int wall = dy > 0 ? static_cast<int>(Rows) - 1 : 0;
          const double atY = d * (wall - sy) / dy;
          if (dx == 0 || atY < exit) exit = atY;
        }
        const double edge = (exit > d ? exit : d) + 19;
        inbound_[origin][target] = nearestMs((edge / 600 + (edge - d) / 1500) * 1000);
      }
      const uint16_t last = nearestMs((farthest + 19) * (1000.0/600 + 1000.0/1500));
      inbound_[origin][origin] = last < 220 ? 220 : last;
    }
  }
public:
  static const ReturnTravel &get() { static const ReturnTravel table; return table; }
  unsigned delay(unsigned origin, unsigned target) const { return inbound_[origin][target]; }
};

template<unsigned Rows, unsigned Cols, class Color>
class Field {
  static const unsigned count = Rows * Cols, capacity = 128;
  using Travel = ringgeom::CenterTravel<Rows, Cols>;
  using Return = ReturnTravel<Rows, Cols>;
  struct Wave {
    uint32_t born;
    unsigned origin;
    Color out, echo;
    bool active;
  };
  Wave waves_[capacity] = {};
  Color rings_[count] = {};
  unsigned next_ = 0;

  static unsigned level(unsigned age, unsigned peak, unsigned width) {
    if (age < peak || age - peak >= width) return 0;
    return 255 * (width - (age - peak)) / width;
  }
  static uint8_t blend(uint8_t previous, uint8_t out, unsigned outLevel, uint8_t echo, unsigned echoLevel) {
    // Select the stronger channel before rounding: equivalent to the max of
    // the two rounded values. Independent presses then add with saturation.
    const unsigned a = out * outLevel, b = echo * echoLevel;
    const unsigned combined = previous + ((a > b ? a : b) + 127) / 255;
    return static_cast<uint8_t>(combined > 255 ? 255 : combined);
  }
  static uint8_t pale(uint8_t channel) { return static_cast<uint8_t>((2u * channel + 255) / 3); }

public:
  void prepare() { (void)Return::get(); }
  void clear() {
    for (Wave &wave : waves_) wave.active = false;
    for (Color &ring : rings_) ring = {};
    next_ = 0;
  }
  void launch(unsigned row, unsigned col, uint32_t now, Color color) {
    waves_[next_] = {now, row * Cols + col, color, {pale(color.r), pale(color.g), pale(color.b)}, true};
    next_ = (next_ + 1) % capacity;
  }
  void frame(uint32_t now) {
    for (Color &ring : rings_) ring = {};
    const auto &travel = Travel::get();
    const auto &returns = Return::get();
    for (Wave &wave : waves_) if (wave.active) {
      const uint32_t age = now - wave.born;
      const unsigned origin = wave.origin;
      if (age >= returns.delay(origin, origin) + 160) { wave.active = false; continue; }
      const int sx = static_cast<int>(origin % Cols), sy = static_cast<int>(origin / Cols);
      for (unsigned i = 0; i < count; ++i) {
        const unsigned key = Travel::key(static_cast<int>(i % Cols) - sx, static_cast<int>(i / Cols) - sy);
        const unsigned out = level(age, travel.ms[key], 140);
        const unsigned echo = level(age, returns.delay(origin, i), i == origin ? 160 : 100);
        if (!out && !echo) continue;
        Color &dest = rings_[i];
        dest = {blend(dest.r, wave.out.r, out, wave.echo.r, echo),
                blend(dest.g, wave.out.g, out, wave.echo.g, echo),
                blend(dest.b, wave.out.b, out, wave.echo.b, echo)};
      }
    }
  }
  Color ring(unsigned row, unsigned col) const { return rings_[row*Cols+col]; }
};
}  // namespace reflection
