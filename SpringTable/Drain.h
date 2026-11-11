#pragma once
#include <stdint.h>
#include <math.h>
#include "RingGeometry.h"

namespace drain {

template<unsigned Rows, unsigned Cols, class Color>
class Field {
  struct Comet {
    double radius, angle;
    uint32_t born;
    Color color;
    bool active;
  };
  struct Spot {
    double x, y, nearest2, lightRadius2;
  };
  struct CentralRing {
    unsigned firstPixel;
    double weights[16];
  };

  static const unsigned capacity = 128, travelMs = 1800, endMs = 2240;
  static constexpr double centerX = (Cols - 1) * 30.0;
  static constexpr double centerY = (Rows - 1) * 30.0;
  static constexpr double turn = 6.2831853071795864769;
  Comet comets_[capacity] = {};
  Color pixels_[Rows * Cols * 16] = {};
  CentralRing flash_[4] = {};
  unsigned next_ = 0, flashCount_ = 0;

  static int nearestIndex(double position, unsigned count) {
    int index = static_cast<int>(floor(position / 60 + 0.5));
    if (index < 0) return 0;
    return index < static_cast<int>(count) ? index : static_cast<int>(count) - 1;
  }

  static Spot spot(double x, double y, double lightRadius) {
    // All emitters of one angular index form a 60 mm grid. Subtract its
    // offset and round to find its closest emitter in O(1) per index.
    double nearest2 = 0;
    for (unsigned p = 0; p < 16; ++p) {
      const double ox = ringgeom::xOffset(p), oy = ringgeom::yOffset(p);
      const int c = nearestIndex(x - ox, Cols), r = nearestIndex(y - oy, Rows);
      const double dx = c * 60 + ox - x, dy = r * 60 + oy - y;
      const double d2 = dx * dx + dy * dy;
      if (p == 0 || d2 < nearest2) nearest2 = d2;
    }
    return {x, y, nearest2, lightRadius * lightRadius};
  }

  static double weight(const Spot &s, double x, double y) {
    const double dx = x - s.x, dy = y - s.y;
    const double value = 1 - (dx * dx + dy * dy - s.nearest2) / s.lightRadius2;
    return value <= 0 ? 0 : (value >= 1 ? 1 : value);
  }

  static uint8_t sum(uint8_t old, unsigned increment) {
    const unsigned total = old + increment;
    return static_cast<uint8_t>(total > 255 ? 255 : total);
  }

  static Spot trailSpot(const Comet &comet, unsigned age) {
    const double u = age / double(travelMs);
    const double r = comet.radius * (1 - u);
    const double angle = comet.angle + turn * (0.9 * u + 2.25 * u * u);
    const double growth = 0.10 * r;
    return spot(centerX + r * cos(angle), centerY + r * sin(angle), 20 + (growth < 26 ? growth : 26));
  }

  void drawTrail(const Comet &comet, unsigned age) {
    static const unsigned lag[3] = {0, 45, 90};
    static const double intensity[3] = {1, 0.55, 0.23};
    Spot taps[3];
    unsigned count = 0;
    double left = 0, right = 0, top = 0, bottom = 0;
    while (count < 3 && age >= lag[count]) {
      const Spot &tap = taps[count] = trailSpot(comet, age - lag[count]);
      // Include any ring whose outermost LED could lie inside the spot.
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
          const double value = weight(taps[t], x, y) * intensity[t];
          if (value > brightest) brightest = value;
        }
        if (brightest <= 0) continue;
        Color &out = pixels_[(row * Cols + col) * 16 + p];
        out.r = sum(out.r, static_cast<unsigned>(comet.color.r * brightest + 0.5));
        out.g = sum(out.g, static_cast<unsigned>(comet.color.g * brightest + 0.5));
        out.b = sum(out.b, static_cast<unsigned>(comet.color.b * brightest + 0.5));
      }
    }
  }

  void prepareFlash() {
    // At 60 mm pitch and 17 mm emitter radius, a 32 mm central flash
    // reaches only the one, two or four rings immediately around the center.
    const Spot flash = spot(centerX, centerY, 32);
    for (unsigned r = (Rows - 1) / 2; r <= Rows / 2; ++r) {
      for (unsigned c = (Cols - 1) / 2; c <= Cols / 2; ++c) {
        CentralRing &ring = flash_[flashCount_++];
        ring.firstPixel = (r * Cols + c) * 16;
        for (unsigned p = 0; p < 16; ++p) {
          ring.weights[p] = weight(flash, c * 60 + ringgeom::xOffset(p), r * 60 + ringgeom::yOffset(p));
        }
      }
    }
  }

  void drawFlash(unsigned age) {
    if (!flashCount_) prepareFlash();
    const double brightness = age < 1880 ? 255.0 : 255.0 * (endMs - age) / 360.0;
    for (unsigned i = 0; i < flashCount_; ++i) {
      const CentralRing &ring = flash_[i];
      for (unsigned p = 0; p < 16; ++p) {
        const unsigned white = static_cast<unsigned>(brightness * ring.weights[p] + 0.5);
        Color &out = pixels_[ring.firstPixel + p];
        out = {sum(out.r, white), sum(out.g, white), sum(out.b, white)};
      }
    }
  }

public:
  void clear() {
    for (Comet &comet : comets_) comet.active = false;
    for (Color &pixel : pixels_) pixel = {};
    next_ = 0;
  }
  void launch(unsigned row, unsigned col, uint32_t now, Color color) {
    const double dx = col * 60 - centerX, dy = row * 60 - centerY;
    const double r = sqrt(dx * dx + dy * dy);
    Comet &comet = comets_[next_];
    comet = {r < 1e-6 ? 17.0 : r, r < 1e-6 ? -turn / 4 : atan2(dy,dx), now, color, true};
    next_ = (next_ + 1) % capacity;
  }
  void frame(uint32_t now) {
    for (Color &pixel : pixels_) pixel = {};
    for (Comet &comet : comets_) if (comet.active) {
      const uint32_t age = now - comet.born;
      if (age >= endMs) comet.active = false;
      else if (age >= travelMs) drawFlash(age);
      else drawTrail(comet, age);
    }
  }
  Color pixel(unsigned row, unsigned col, unsigned p) const {
    return pixels_[(row * Cols + col) * 16 + p];
  }
};
}  // namespace drain
