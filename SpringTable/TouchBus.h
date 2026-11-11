#pragma once

#include <Arduino.h>
#include <Wire.h>

// MPR121 data sheet, sections 5 and 6; NXP AN3895 (I2C), AN3944 (baseline
// filters), and AN3892 (debounce). The MPR121 itself must be powered at 3.3 V
// for the autoconfiguration limits below.
namespace touchio {

namespace detail {
constexpr uint8_t kElectrodeConfig = 0x5E;
constexpr uint8_t kFilterConfig = 0x5D;
constexpr uint8_t kMaxElectrodes = 12;

inline bool writeBlock(uint8_t addr, uint8_t reg, const uint8_t *data, uint8_t count) {
  Wire.beginTransmission(addr);
  const bool queued = Wire.write(reg) == 1 && Wire.write(data, count) == count;
  const uint8_t error = Wire.endTransmission();
  return queued && error == 0;
}

inline bool writeRegister(uint8_t addr, uint8_t reg, uint8_t value) {
  return writeBlock(addr, reg, &value, 1);
}

inline bool readBlock(uint8_t addr, uint8_t reg, uint8_t *data, uint8_t count) {
  Wire.beginTransmission(addr);
  if (Wire.write(reg) != 1) {
    Wire.endTransmission();
    return false;
  }
  // Keep control of the bus from the register pointer through the read.
  if (Wire.endTransmission(false) != 0 || Wire.requestFrom(addr, count) != count) {
    return false;
  }
  for (uint8_t i = 0; i < count; ++i) {
    const int value = Wire.read();
    if (value < 0) return false;
    data[i] = static_cast<uint8_t>(value);
  }
  return true;
}
}  // namespace detail

inline bool select(uint8_t channel) {
  if (channel == 0xFF) return true;  // Direct bench connection, no switch fitted.
  if (channel > 7) return false;
  Wire.beginTransmission(0x70);
  const bool queued = Wire.write(static_cast<uint8_t>(1u << channel)) == 1;
  const uint8_t error = Wire.endTransmission();  // TCA9548A selects on STOP.
  return queued && error == 0;
}

inline bool beginSensor(uint8_t addr, uint8_t touchThreshold, uint8_t releaseThreshold,
                        uint8_t electrodeCount) {
  using namespace detail;
  if (electrodeCount == 0 || electrodeCount > kMaxElectrodes ||
      releaseThreshold == 0 || releaseThreshold >= touchThreshold) return false;

  if (!writeRegister(addr, 0x80, 0x63)) return false;  // Soft reset to Stop mode.
  delay(2);
  uint8_t filterConfig;
  if (!readBlock(addr, kFilterConfig, &filterConfig, 1) || filterConfig != 0x24) return false;

  // Follow a rise quickly after release, track falls slowly so a hand swipe
  // stays visible against the baseline. Registers start at MHD rising (0x2B).
  const uint8_t baselineFilter[] = {1, 1, 0, 0, 1, 1, 0xFF, 2};
  if (!writeBlock(addr, 0x2B, baselineFilter, sizeof baselineFilter)) return false;
  uint8_t thresholds[2 * kMaxElectrodes];
  for (uint8_t i = 0; i < electrodeCount; ++i) {
    thresholds[2 * i] = touchThreshold;
    thresholds[2 * i + 1] = releaseThreshold;
  }
  if (!writeBlock(addr, 0x41, thresholds, 2 * electrodeCount)) return false;

  // DR=DT=1: two consecutive detections. FFI=6, SFI=4, ESI=1 ms.
  // Global fallback settings are 16 uA and 0.5 us until per-pad tuning.
  const uint8_t sampling[] = {0x11, 0x10, 0x20};
  // BVA=11 matches ECR CL=11. Search both current and charge time, retry
  // on out-of-range. Limits for 3.3 V: upper 201, lower 131, target 181.
  const uint8_t autoconfig[] = {0x0F, 0x00, 201, 131, 181};
  if (!writeBlock(addr, 0x5B, sampling, sizeof sampling) ||
      !writeBlock(addr, 0x7B, autoconfig, sizeof autoconfig)) return false;

  // Write ECR last. Seed baseline from the first full sample, track drift,
  // and scan only the installed electrodes with the proximity channel off.
  const uint8_t runConfig = 0xC0 | electrodeCount;
  uint8_t actualConfig;
  return writeRegister(addr, kElectrodeConfig, runConfig) &&
         readBlock(addr, kElectrodeConfig, &actualConfig, 1) && actualConfig == runConfig;
}

inline bool readStatus(uint8_t addr, uint16_t &mask) {
  using namespace detail;
  uint8_t status[4], config;
  if (!readBlock(addr, 0x00, status, sizeof status) ||
      !readBlock(addr, kElectrodeConfig, &config, 1)) return false;

  const uint8_t count = config & 0x0F;
  if (count == 0 || count > kMaxElectrodes || (status[1] & 0x80)) return false;
  const uint16_t enabled = (1u << count) - 1u;
  const uint16_t outOfRange = status[2] | (uint16_t(status[3] & 0x0F) << 8);
  if (outOfRange & enabled) return false;

  // Publish the new mask only after the whole sample is known to be valid.
  // A brownout resets ECR to zero, even though the chip still answers I2C.
  mask = (status[0] | (uint16_t(status[1] & 0x0F) << 8)) & enabled;
  return true;
}

inline bool diagnostic(uint8_t addr, uint8_t electrode, uint16_t &baseline,
                       uint16_t &filtered) {
  if (electrode >= detail::kMaxElectrodes) return false;
  const uint8_t first = 0x04 + 2 * electrode;
  const uint8_t last = 0x1E + electrode;
  const uint8_t count = last - first + 1;
  // A single read from the filtered value through its matching baseline
  // captures both from the same sampling instant. At most 27 bytes.
  uint8_t sample[27];
  if (!detail::readBlock(addr, first, sample, count)) return false;
  filtered = sample[0] | (uint16_t(sample[1] & 0x03) << 8);
  baseline = uint16_t(sample[count - 1]) << 2;
  return true;
}

}  // namespace touchio
