#pragma once
#include <math.h>
#include <stdint.h>

namespace ringgeom {
// 17 mm emitter radius. Viewed from the front, LED 0 is at twelve o'clock
// and increasing indices go clockwise in the board's y-down coordinates.
inline double xOffset(unsigned p) {
  static const double x[16] = {0, 6.505618350206526, 12.020815280171307, 15.705952052691874,
    17, 15.705952052691874, 12.020815280171307, 6.505618350206526, 0,
    -6.505618350206526, -12.020815280171307, -15.705952052691874,
    -17, -15.705952052691874, -12.020815280171307, -6.505618350206526};
  return x[p & 15];
}

inline double yOffset(unsigned p) { return -xOffset(p + 4); }

// A moving spot stays visible across gaps by measuring falloff relative to
// its nearest physical emitter. All rings use the same 60 mm grid.
template<unsigned Rows, unsigned Cols>
struct GridSpot {
  double x, y, nearest2, lightRadius2;

  static int nearestIndex(double position, unsigned count) {
    int index = static_cast<int>(floor(position / 60 + 0.5));
    if (index < 0) return 0;
    return index < static_cast<int>(count) ? index : static_cast<int>(count) - 1;
  }

  static GridSpot at(double x, double y, double lightRadius) {
    double nearest2 = 0;
    for (unsigned p = 0; p < 16; ++p) {
      const double ox = xOffset(p), oy = yOffset(p);
      const int c = nearestIndex(x - ox, Cols), r = nearestIndex(y - oy, Rows);
      const double dx = c * 60 + ox - x, dy = r * 60 + oy - y;
      const double d2 = dx * dx + dy * dy;
      if (p == 0 || d2 < nearest2) nearest2 = d2;
    }
    return {x, y, nearest2, lightRadius * lightRadius};
  }

  double weight(double emitterX, double emitterY) const {
    const double dx = emitterX - x, dy = emitterY - y;
    const double value = 1 - (dx * dx + dy * dy - nearest2) / lightRadius2;
    return value <= 0 ? 0 : (value >= 1 ? 1 : value);
  }
};

// Equal displacements on the stock 60 mm grid share one distance and one
// 600 mm/s travel time. Both field modes use the same immutable table.
template<unsigned Rows, unsigned Cols>
class CenterTravel {
  CenterTravel() {
    for (unsigned r = 0; r < Rows; ++r) for (unsigned c = 0; c < Cols; ++c) {
      const unsigned key = r * Cols + c;
      mm[key] = 60.0 * sqrt(static_cast<double>(r * r + c * c));
      ms[key] = static_cast<uint16_t>(mm[key] * 1000 / 600 + 0.5);
    }
  }
public:
  double mm[Rows * Cols];
  uint16_t ms[Rows * Cols];
  static const CenterTravel &get() { static const CenterTravel table; return table; }
  static unsigned key(int dx, int dy) {
    unsigned x = static_cast<unsigned>(dx < 0 ? -dx : dx);
    unsigned y = static_cast<unsigned>(dy < 0 ? -dy : dy);
    return y * Cols + x;
  }
};
}  // namespace ringgeom
