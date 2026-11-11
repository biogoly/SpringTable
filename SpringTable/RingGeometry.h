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
