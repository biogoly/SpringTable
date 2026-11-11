#pragma once
#include <stdint.h>

// Set to 1 after testing the three-ring row. The full profile drives 10 x 10 rings.
#ifndef SPRINGTABLE_FULL
#define SPRINGTABLE_FULL 0
#endif
// The bench wiring uses channel 0 of a TCA9548A. Set to 0 for a direct connection.
#ifndef SPRINGTABLE_BENCH_MUX
#define SPRINGTABLE_BENCH_MUX 1
#endif

namespace cfg {
constexpr unsigned Rows = SPRINGTABLE_FULL ? 10 : 1;
constexpr unsigned Cols = SPRINGTABLE_FULL ? 10 : 3;
constexpr unsigned PixelsPerRing = 16;
constexpr unsigned PixelsPerLane = Cols * PixelsPerRing;
constexpr unsigned TotalPixels = Rows * PixelsPerLane;
constexpr uint8_t LedPins[] = {2, 14, 7, 8, 6, 20, 21, 5, 3, 4};
// Estimated average current for all powered pixels, including dark ones.
// Set the budget to suit the actual supply and distribution wiring.
constexpr uint32_t PixelBudgetMilliAmps = SPRINGTABLE_FULL ? 40000 : 1500;
constexpr uint16_t IdleMicroAmpsPerPixel = 1000;
// Extra current at code 255 above idle, independently for red, green and blue.
constexpr uint16_t ChannelMicroAmps[3] = {20000, 20000, 20000};
// Peak RGB colors in modes 10 and 11. Serial palette changes last until reset.
constexpr uint8_t InterferenceCrestRGB[3] = {40, 210, 255};
constexpr uint8_t InterferenceTroughRGB[3] = {95, 65, 190};
constexpr bool InterferenceRandomPerPair = false;  // Roll one crest/trough pair per new touch group.
constexpr uint8_t TouchThreshold = 12;   // Baseline minus filtered, in MPR121 counts
constexpr uint8_t ReleaseThreshold = 6;
constexpr unsigned BootMode = 0;        // 0 = ripple

// Row zero is the top row as seen by a viewer facing the board.
// Set bit r if the LED data chain or electrode order runs right-to-left on row r.
constexpr uint16_t ReversedLedRows = 0;
constexpr uint16_t ReversedElectrodeRows = 0;

static_assert(Rows <= sizeof(LedPins) && Cols <= 12, "Check LED lanes and MPR121 capacity");
static_assert(uint64_t(PixelBudgetMilliAmps) * 1000 >= uint64_t(TotalPixels) * IdleMicroAmpsPerPixel,
              "Pixel budget must cover the idle draw of every powered pixel");
static_assert(TouchThreshold > ReleaseThreshold && ReleaseThreshold > 0, "Check touch hysteresis");
static_assert(BootMode <= 11, "Unknown effect");

inline uint8_t muxChannel(unsigned row) {
  return (SPRINGTABLE_FULL || SPRINGTABLE_BENCH_MUX) ? static_cast<uint8_t>(row / 2) : 0xFF;
}
inline uint8_t sensorAddress(unsigned row) { return static_cast<uint8_t>(0x5A + (row % 2)); }
inline unsigned electrode(unsigned row, unsigned col) {
  return (ReversedElectrodeRows & (1u << row)) ? Cols - 1 - col : col;
}
inline unsigned firstPixel(unsigned row, unsigned col) {
  const unsigned slot = (ReversedLedRows & (1u << row)) ? Cols - 1 - col : col;
  return row * PixelsPerLane + slot * PixelsPerRing;
}
}  // namespace cfg
