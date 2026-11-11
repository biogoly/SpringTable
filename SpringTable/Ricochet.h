#pragma once
#include <stdint.h>
#include <math.h>
#include "RingGeometry.h"

namespace ricochet {

inline double reflect(double at, double low, double high) {
  const double span = high - low;
  double phase = fmod(at - low, 2 * span);
  if (phase < 0) phase += 2 * span;
  return low + (phase <= span ? phase : 2 * span - phase);
}

template<unsigned Rows, unsigned Cols, class Color>
class Field {
  struct Ball {
    double x, y, vx, vy;
    uint32_t born;
    Color color;
    bool active;
  };
  struct Tap { double x, y, weight; };

  static const unsigned capacity = 128, lifeMs = 4400;
  static const uint32_t defaultSeed = UINT32_C(0x6d2b79f5);
  Ball balls_[capacity] = {};
  Color pixels_[Rows * Cols * 16] = {};
  unsigned next_ = 0;
  uint32_t seed_ = defaultSeed;

  uint32_t randomWord() {
    seed_ ^= seed_ << 13;
    seed_ ^= seed_ >> 17;
    seed_ ^= seed_ << 5;
    return seed_;
  }

  static uint8_t addScaled(uint8_t current, uint8_t color, double weight) {
    const unsigned total = current + static_cast<unsigned>(color * weight + 0.5);
    return static_cast<uint8_t>(total > 255 ? 255 : total);
  }

  void draw(const Ball &ball, unsigned age) {
    static const unsigned delay[3] = {0, 65, 130};
    static const unsigned strength[3] = {255, 125, 52};
    const double fade = age <= 2600 ? 1.0 : (lifeMs - age) / 1800.0;
    Tap taps[3];
    unsigned count = 0;
    double left = 0, right = 0, top = 0, bottom = 0;
    while (count < 3 && age >= delay[count]) {
      const double seconds = (age - delay[count]) / 1000.0;
      Tap &tap = taps[count];
      tap.x = reflect(ball.x + ball.vx * seconds, -20, (Cols - 1) * 60 + 20);
      tap.y = reflect(ball.y + ball.vy * seconds, -20, (Rows - 1) * 60 + 20);
      tap.weight = strength[count] / 255.0;
      if (!count || tap.x < left) left = tap.x;
      if (!count || tap.x > right) right = tap.x;
      if (!count || tap.y < top) top = tap.y;
      if (!count || tap.y > bottom) bottom = tap.y;
      ++count;
    }

    // A ring can receive light only if its center lies within 52 + 17 mm of
    // a tap. Clip to that region before evaluating the per-LED radial falloff.
    int firstCol = static_cast<int>(ceil((left - 69) / 60));
    int lastCol = static_cast<int>(floor((right + 69) / 60));
    int firstRow = static_cast<int>(ceil((top - 69) / 60));
    int lastRow = static_cast<int>(floor((bottom + 69) / 60));
    if (firstCol < 0) firstCol = 0;
    if (firstRow < 0) firstRow = 0;
    if (lastCol >= static_cast<int>(Cols)) lastCol = Cols - 1;
    if (lastRow >= static_cast<int>(Rows)) lastRow = Rows - 1;
    for (int r = firstRow; r <= lastRow; ++r) for (int c = firstCol; c <= lastCol; ++c) {
      for (unsigned p = 0; p < 16; ++p) {
        const double x = c * 60 + ringgeom::xOffset(p);
        const double y = r * 60 + ringgeom::yOffset(p);
        double brightest = 0;
        for (unsigned t = 0; t < count; ++t) {
          const double dx = x - taps[t].x, dy = y - taps[t].y;
          const double intensity = (1 - (dx * dx + dy * dy) / (52 * 52)) * taps[t].weight;
          if (intensity > brightest) brightest = intensity;
        }
        if (brightest <= 0) continue;
        Color &dest = pixels_[(r * Cols + c) * 16 + p];
        const double weighted = brightest * fade;
        dest.r = addScaled(dest.r, ball.color.r, weighted);
        dest.g = addScaled(dest.g, ball.color.g, weighted);
        dest.b = addScaled(dest.b, ball.color.b, weighted);
      }
    }
  }

public:
  void setSeed(uint32_t seed) { seed_ = seed ? seed : defaultSeed; }

  void clear() {
    for (Ball &ball : balls_) ball.active = false;
    for (Color &pixel : pixels_) pixel = {};
    next_ = 0;
  }

  void launch(unsigned row, unsigned col, uint32_t now, Color (*palette)(unsigned)) {
    const double angle = (randomWord() & 65535u) * (6.2831853071795864769 / 65536.0);
    const unsigned speed = 430 + randomWord() % 211;
    const Color color = palette(randomWord());
    // Equal lifetimes and insertion order make the next slot the oldest when full.
    balls_[next_] = {col * 60.0, row * 60.0, speed * cos(angle), speed * sin(angle), now, color, true};
    next_ = (next_ + 1) % capacity;
  }

  void frame(uint32_t now) {
    for (Color &pixel : pixels_) pixel = {};
    for (Ball &ball : balls_) if (ball.active) {
      const uint32_t age = now - ball.born;
      if (age >= lifeMs) ball.active = false;
      else draw(ball, age);
    }
  }

  Color pixel(unsigned row, unsigned col, unsigned p) const {
    return pixels_[(row * Cols + col) * 16 + p];
  }
};
}  // namespace ricochet
