#pragma once
#include <stdint.h>
#include <math.h>
#include "RingGeometry.h"

namespace bouncyball {

constexpr double gravity = 9810.0;
constexpr double restitution = 0.78;
constexpr double minimumApex = 0.5;
constexpr double fadeSeconds = 0.4;

struct Trajectory {
  double height, firstImpactSeconds, settleSeconds, lifeSeconds;
  unsigned bounceCount;
};

struct Sample {
  double height, velocity, brightness;
  unsigned bounce;
  bool settled;
};

inline Trajectory trajectory(double height) {
  if (!(height > 0) || !isfinite(height)) height = 0;
  const double fall = sqrt(2 * height / gravity);
  double settle = fall;
  double rebound = gravity * fall * restitution;
  unsigned count = 0;
  while (rebound * rebound / (2 * gravity) >= minimumApex) {
    settle += 2 * rebound / gravity;
    rebound *= restitution;
    ++count;
  }
  return {height, fall, settle, settle + fadeSeconds, count};
}

// A closed parabola per flight keeps bounces consistent after skipped frames.
// Positive velocity is down the display. Height is measured above the floor.
inline Sample sample(const Trajectory &path, double seconds) {
  if (seconds < 0) seconds = 0;
  if (seconds < path.firstImpactSeconds) {
    return {path.height - 0.5 * gravity * seconds * seconds,
            gravity * seconds, 1, 0, false};
  }
  if (seconds >= path.settleSeconds) {
    double fade = (path.lifeSeconds - seconds) / fadeSeconds;
    if (fade < 0) fade = 0;
    if (fade > 1) fade = 1;
    return {0, 0, pow(restitution, path.bounceCount / 2.0) * fade, path.bounceCount, true};
  }
  double remaining = seconds - path.firstImpactSeconds;
  double rebound = gravity * path.firstImpactSeconds * restitution;
  for (unsigned bounce = 1; bounce <= path.bounceCount; ++bounce) {
    const double duration = 2 * rebound / gravity;
    if (remaining < duration || bounce == path.bounceCount) {
      const double height = rebound * remaining - 0.5 * gravity * remaining * remaining;
      return {height > 0 ? height : 0, gravity * remaining - rebound,
              pow(restitution, bounce / 2.0), bounce, false};
    }
    remaining -= duration;
    rebound *= restitution;
  }
  return {0, 0, 0, path.bounceCount, true};
}

template<unsigned Rows, unsigned Cols, class Color>
class Field {
  struct Ball {
    double x;
    Trajectory path;
    uint32_t born;
    Color color;
  };
  using Spot = ringgeom::GridSpot<Rows, Cols>;
  static const unsigned capacity = 128;
  static constexpr double floorY = (Rows - 1) * 60.0 + 17;
  static const uint32_t defaultSeed = UINT32_C(0x6d2b79f5);
  Ball balls_[capacity] = {};
  Color pixels_[Rows * Cols * 16] = {};
  unsigned count_ = 0;
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

  void draw(const Ball &ball, uint32_t age) {
    static const unsigned delays[] = {0, 18, 36};
    static const double weights[] = {1, 0.35, 0.12};
    const double brightness = sample(ball.path, age / 1000.0).brightness;
    Spot taps[3];
    unsigned count = 0;
    double left = 0, right = 0, top = 0, bottom = 0;
    while (count < 3 && age >= delays[count]) {
      const Sample state = sample(ball.path, (age - delays[count]) / 1000.0);
      const Spot &tap = taps[count] = Spot::at(ball.x, floorY - state.height, 24);
      const double extent = sqrt(tap.nearest2 + tap.lightRadius2) + 17;
      if (!count || tap.x - extent < left) left = tap.x - extent;
      if (!count || tap.x + extent > right) right = tap.x + extent;
      if (!count || tap.y - extent < top) top = tap.y - extent;
      if (!count || tap.y + extent > bottom) bottom = tap.y + extent;
      ++count;
    }
    int xmin = static_cast<int>(ceil(left / 60)), xmax = static_cast<int>(floor(right / 60));
    int ymin = static_cast<int>(ceil(top / 60)), ymax = static_cast<int>(floor(bottom / 60));
    if (xmin < 0) xmin = 0;
    if (ymin < 0) ymin = 0;
    if (xmax >= static_cast<int>(Cols)) xmax = Cols - 1;
    if (ymax >= static_cast<int>(Rows)) ymax = Rows - 1;
    for (int row = ymin; row <= ymax; ++row) for (int col = xmin; col <= xmax; ++col) {
      for (unsigned p = 0; p < 16; ++p) {
        const double x = col * 60 + ringgeom::xOffset(p), y = row * 60 + ringgeom::yOffset(p);
        double brightest = 0;
        for (unsigned t = 0; t < count; ++t) {
          const double value = taps[t].weight(x, y) * weights[t];
          if (value > brightest) brightest = value;
        }
        if (brightest <= 0) continue;
        Color &out = pixels_[(row * Cols + col) * 16 + p];
        const double strength = brightest * brightness;
        out.r = addScaled(out.r, ball.color.r, strength);
        out.g = addScaled(out.g, ball.color.g, strength);
        out.b = addScaled(out.b, ball.color.b, strength);
      }
    }
  }

  void removeExpired(uint32_t now) {
    unsigned active = 0;
    for (unsigned i = 0; i < count_; ++i) {
      const uint32_t age = now - balls_[i].born;
      if (age / 1000.0 < balls_[i].path.lifeSeconds) balls_[active++] = balls_[i];
    }
    count_ = active;
  }

public:
  void setSeed(uint32_t seed) { seed_ = seed ? seed : defaultSeed; }
  unsigned activeCount() const { return count_; }

  void clear() {
    count_ = 0;
    for (Color &pixel : pixels_) pixel = {};
  }

  void launch(unsigned row, unsigned col, uint32_t now, Color (*palette)(unsigned)) {
    removeExpired(now);
    if (count_ == capacity) {
      for (unsigned i = 1; i < count_; ++i) balls_[i - 1] = balls_[i];
      --count_;
    }
    balls_[count_++] = {col * 60.0, trajectory(floorY - row * 60), now, palette(randomWord())};
  }

  void frame(uint32_t now) {
    for (Color &pixel : pixels_) pixel = {};
    removeExpired(now);
    for (unsigned i = 0; i < count_; ++i) draw(balls_[i], now - balls_[i].born);
  }

  Color pixel(unsigned row, unsigned col, unsigned p) const {
    return pixels_[(row * Cols + col) * 16 + p];
  }
};
}  // namespace bouncyball
