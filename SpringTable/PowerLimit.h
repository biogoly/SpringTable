#pragma once
#include "Config.h"

namespace powerlimit {
// Keep the factor of 255 in the sum until the whole frame has been counted.
inline uint32_t demand(uint8_t r, uint8_t g, uint8_t b) {
  return uint32_t(r) * cfg::ChannelMicroAmps[0] +
         uint32_t(g) * cfg::ChannelMicroAmps[1] +
         uint32_t(b) * cfg::ChannelMicroAmps[2];
}

inline uint32_t estimatedMicroAmps(uint64_t frameDemand, unsigned pixels) {
  const uint64_t idle = uint64_t(pixels) * cfg::IdleMicroAmpsPerPixel;
  return uint32_t(idle + (frameDemand + 254) / 255);
}

struct Gain {
  uint32_t numerator, denominator;

  uint8_t apply(uint8_t code) const {
    // Round down so quantization cannot push the output over the budget.
    return uint8_t(uint64_t(code) * numerator / denominator);
  }
};

inline Gain fit(uint64_t frameDemand, unsigned pixels, uint32_t budgetMilliAmps) {
  const uint64_t budget = uint64_t(budgetMilliAmps) * 1000;
  const uint32_t idle = estimatedMicroAmps(0, pixels);
  const uint32_t requested = estimatedMicroAmps(frameDemand, pixels);
  if (requested <= budget) return {1, 1};
  if (budget <= idle) return {0, 1};
  return {uint32_t(budget - idle), requested - idle};
}
}  // namespace powerlimit
