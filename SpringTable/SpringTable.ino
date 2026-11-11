// SpringTable | Teensy 4.1 | 16-pixel RGB WS2812-compatible rings
#include <Arduino.h>
#include <Wire.h>
#include <OctoWS2811.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "Config.h"
#include "Effects.h"
#include "PowerLimit.h"
#include "TouchBus.h"

constexpr unsigned BufferWords = (cfg::TotalPixels * 3 + 3) / 4;
DMAMEM int displayBuffer[BufferWords];
int drawingBuffer[BufferWords];
OctoWS2811 leds(cfg::PixelsPerLane, displayBuffer, drawingBuffer,
                WS2811_GRB | WS2811_800kHz, cfg::Rows, cfg::LedPins);
fx::Scene<cfg::Rows, cfg::Cols> scene;

enum class SensorState { Offline, Settling, Online };
struct RowState {
  SensorState state = SensorState::Offline;
  uint16_t mask = 0;
  uint8_t errors = 0;
  uint32_t lastAttempt = 0;
  bool attempted = false;
};
RowState sensors[cfg::Rows];
enum class Display { Play, Locate, Dark };
Display display = Display::Play;
int locatorRow = 0, locatorCol = 0;
char locatorChannel = 0;          // 0 selects the locator's four-color segments.
int diagnosticRow = -1, diagnosticCol = 0;
int diagnosticMin = 1024, diagnosticMax = -1024;
bool logEdges = false;
unsigned currentMode = cfg::BootMode;
bool ricochetSeeded = false;
bool interferencePaletteSeeded = false;
uint32_t lastPoll = 0, lastFrame = 0, lastDiagnostic = 0;
uint32_t requestedUA = powerlimit::estimatedMicroAmps(0, cfg::TotalPixels);
uint32_t outputUA = requestedUA;
uint32_t peakRequestedUA = 0, peakOutputUA = 0;
powerlimit::Gain frameGain = {1, 1};

void takeRowOffline(unsigned row, uint32_t now) {
  for (unsigned col = 0; col < cfg::Cols; ++col) scene.release(row, col);
  auto &s = sensors[row];
  s.mask = 0;
  s.state = SensorState::Offline;
  s.lastAttempt = now;
  if (Serial) Serial.printf("Row %u offline, retrying in 2 s.\n", row);
}

void pollRow(unsigned row, uint32_t now) {
  auto &s = sensors[row];
  const uint8_t channel = cfg::muxChannel(row);
  const uint8_t addr = cfg::sensorAddress(row);
  if (s.state == SensorState::Offline) {
    if (s.attempted && now - s.lastAttempt < 2000) return;
    s.attempted = true;
    s.lastAttempt = now;
    if (touchio::select(channel) && touchio::beginSensor(addr, cfg::TouchThreshold,
        cfg::ReleaseThreshold, cfg::Cols)) {
      s.errors = 0;
      s.state = SensorState::Settling;
    }
    return;
  }
  if (s.state == SensorState::Settling && now - s.lastAttempt < 400) return;

  uint16_t current = 0;
  if (!touchio::select(channel) || !touchio::readStatus(addr, current)) {
    // A missed read is not a release. Brief faults leave the previous state intact.
    if (++s.errors >= 3) takeRowOffline(row, now);
    return;
  }
  s.errors = 0;
  if (s.state == SensorState::Settling) {
    // Seed the edge detector. A finger already down at (re)connection must
    // lift before it can start a new wave.
    s.mask = current;
    s.state = SensorState::Online;
    if (Serial) Serial.printf("Row %u ready.\n", row);
    return;
  }
  const uint16_t changed = s.mask ^ current;
  s.mask = current;
  if (!changed) return;
  for (unsigned col = 0; col < cfg::Cols; ++col) {
    const uint16_t bit = 1u << cfg::electrode(row, col);
    if (!(changed & bit)) continue;
    const bool down = (current & bit) != 0;
    if (down) {
      if (currentMode == fx::Ricochet && !ricochetSeeded) {
        scene.setRicochetSeed(now * UINT32_C(0x9e3779b9) ^ (row * cfg::Cols + col + 1));
        ricochetSeeded = true;
      }
      if (!interferencePaletteSeeded && scene.getInterferenceRandom() &&
          (currentMode == fx::Interference || currentMode == fx::ReflectedInterference)) {
        scene.setInterferencePaletteSeed(now * UINT32_C(0x85ebca6b) ^ (row * cfg::Cols + col + 1));
        interferencePaletteSeeded = true;
      }
      scene.press(row, col, now);
    }
    else scene.release(row, col);
    if (logEdges && Serial) Serial.printf("%lu ms  (%u,%u) %s\n",
        (unsigned long)now, row, col, down ? "touch" : "release");
  }
}

void renderFrame(uint32_t now) {
  scene.frame(now);
  uint64_t frameDemand = 0;
  for (unsigned row = 0; row < cfg::Rows; ++row) {
    for (unsigned col = 0; col < cfg::Cols; ++col) {
      const unsigned start = cfg::firstPixel(row, col);
      for (unsigned p = 0; p < cfg::PixelsPerRing; ++p) {
        fx::Color color{};
        if (display == Display::Play) {
          color = scene.pixel(row, col, p, now);
        } else if (display == Display::Locate && int(row) == locatorRow && int(col) == locatorCol) {
          if (locatorChannel) {
            if (locatorChannel == 'r' || locatorChannel == 'w') color.r = 255;
            if (locatorChannel == 'g' || locatorChannel == 'w') color.g = 255;
            if (locatorChannel == 'b' || locatorChannel == 'w') color.b = 255;
          } else {
            // In increasing pixel order, 4 red, 4 green, 4 blue, 4 dark.
            if (p < 4) color.r = 255;
            else if (p < 8) color.g = 255;
            else if (p < 12) color.b = 255;
          }
        }
        frameDemand += powerlimit::demand(color.r, color.g, color.b);
        leds.setPixel(start + p, color.r, color.g, color.b);
      }
    }
  }
  // Octo draws into a separate buffer. Only the final, budgeted frame is sent.
  frameGain = powerlimit::fit(frameDemand, cfg::TotalPixels, cfg::PixelBudgetMilliAmps);
  requestedUA = powerlimit::estimatedMicroAmps(frameDemand, cfg::TotalPixels);
  uint64_t sentDemand = frameDemand;
  if (frameGain.numerator < frameGain.denominator) {
    uint8_t scaledCode[256];
    for (unsigned code = 0; code < 256; ++code) scaledCode[code] = frameGain.apply(code);
    sentDemand = 0;
    for (unsigned i = 0; i < cfg::TotalPixels; ++i) {
      const uint32_t rgb = leds.getPixel(i);   // Octo returns RGB regardless of wire order
      const uint8_t r = scaledCode[(rgb >> 16) & 255];
      const uint8_t g = scaledCode[(rgb >> 8) & 255];
      const uint8_t b = scaledCode[rgb & 255];
      leds.setPixel(i, r, g, b);
      sentDemand += powerlimit::demand(r, g, b);
    }
  }
  outputUA = powerlimit::estimatedMicroAmps(sentDemand, cfg::TotalPixels);
  if (requestedUA > peakRequestedUA) peakRequestedUA = requestedUA;
  if (outputUA > peakOutputUA) peakOutputUA = outputUA;
  leds.show();
}

void showPalette() {
  fx::Color crest, trough;
  scene.getInterferenceColors(crest, trough);
  Serial.printf("Interference palette (%s): crest #%02X%02X%02X, trough #%02X%02X%02X\n",
    scene.getInterferenceRandom() ? "random per group" : "fixed",
    unsigned(crest.r), unsigned(crest.g), unsigned(crest.b),
    unsigned(trough.r), unsigned(trough.g), unsigned(trough.b));
}

bool parsePaletteColor(const char *token, fx::Color &color) {
  if (*token == '#') ++token;
  if (strlen(token) != 6 || strspn(token, "0123456789ABCDEFabcdef") != 6) return false;
  const unsigned long rgb = strtoul(token, nullptr, 16);
  color = {uint8_t(rgb >> 16), uint8_t(rgb >> 8), uint8_t(rgb)};
  return true;
}

void handlePalette(const char *arguments) {
  char first[9], second[9], extra;
  const int fields = sscanf(arguments, "%8s %8s %c", first, second, &extra);
  if (fields <= 0) {
    showPalette();
    return;
  }
  if (fields == 1 && !strcmp(first, "reset")) {
    scene.resetInterferenceColors();
  } else if (fields == 1 && !strcmp(first, "random")) {
    scene.setInterferenceRandom(true);
  } else if (fields == 1 && !strcmp(first, "fixed")) {
    scene.setInterferenceRandom(false);
  } else {
    fx::Color crest, trough;
    if (fields != 2 || !parsePaletteColor(first, crest) || !parsePaletteColor(second, trough)) {
      Serial.println("Use palette RRGGBB RRGGBB, palette random, palette fixed, palette reset, or palette.");
      return;
    }
    scene.setInterferenceColors(crest, trough);
  }
  showPalette();
}

void showStatus() {
  Serial.printf("%ux%u rings, %u pixels, mode %u, LED budget %lu mA\n",
      cfg::Rows, cfg::Cols, cfg::TotalPixels, currentMode, (unsigned long)cfg::PixelBudgetMilliAmps);
  const unsigned gainPermille = uint64_t(frameGain.numerator) * 1000 / frameGain.denominator;
  Serial.printf("LED estimate mA: requested %lu, sent %lu, scale %u.%u%%; peaks since boot %lu / %lu mA\n",
      (unsigned long)((requestedUA + 999) / 1000), (unsigned long)((outputUA + 999) / 1000),
      gainPermille / 10, gainPermille % 10,
      (unsigned long)((peakRequestedUA + 999) / 1000), (unsigned long)((peakOutputUA + 999) / 1000));
  showPalette();
  for (unsigned r = 0; r < cfg::Rows; ++r) {
    auto &s = sensors[r];
    const char *state = s.state == SensorState::Online ? "ready" :
                        s.state == SensorState::Settling ? "settling" : "offline";
    Serial.printf("row %u  mux %d (-1=direct)  addr 0x%02X  LED pin %u  %s  mask 0x%03X\n",
      r, cfg::muxChannel(r) == 0xFF ? -1 : int(cfg::muxChannel(r)),
      cfg::sensorAddress(r), cfg::LedPins[r], state, s.mask);
  }
}

void showHelp() {
  Serial.println("status | events | diag ROW COL | diag off | loc ROW COL [r/g/b/w] | dark | play | mode N | palette | palette RRGGBB RRGGBB | palette random | palette fixed | palette reset | help");
  Serial.println("0 Ripple, 1 Spinner, 2 Solid, 3 Confetti, 4 Three-dot gear, 5 Fire, 6 Surface, 7 Ricochet, 8 Drain, 9 Reflection, 10 Interference, 11 Reflected Interference");
}

void handleCommand(const char *line) {
  int row, col, mode;
  char extra;
  if (!strcmp(line, "status")) showStatus();
  else if (!strncmp(line, "palette", 7) && (line[7] == '\0' || line[7] == ' ' || line[7] == '\t')) {
    handlePalette(line + 7);
  }
  else if (!strcmp(line, "events")) {
    logEdges = !logEdges;
    Serial.println(logEdges ? "Edge log on" : "Edge log off");
  } else if (!strcmp(line, "diag off")) {
    diagnosticRow = -1;
    Serial.println("Diagnostics off");
  } else if (!strcmp(line, "dark") || !strcmp(line, "play")) {
    display = !strcmp(line, "play") ? Display::Play : Display::Dark;
    Serial.println(line);
  } else if (sscanf(line, "mode %d %c", &mode, &extra) == 1 && mode >= 0 && mode <= fx::ReflectedInterference) {
    currentMode = unsigned(mode);
    scene.setMode(currentMode);
    display = Display::Play;
    Serial.printf("Playing mode %u\n", currentMode);
  } else if (!strncmp(line, "diag ", 5) || !strncmp(line, "loc ", 4)) {
    const bool diagnose = line[0] == 'd';
    char channel = 0;
    const int fields = sscanf(line + (diagnose ? 5 : 4), "%d %d %c %c", &row, &col, &channel, &extra);
    if (fields != 2 && (diagnose || fields != 3 || !strchr("rgbw", channel))) {
      showHelp();
    } else if (row < 0 || col < 0 || unsigned(row) >= cfg::Rows || unsigned(col) >= cfg::Cols) {
      Serial.println("Coordinates outside this profile");
    } else if (diagnose) {
      diagnosticRow = row;
      diagnosticCol = col;
      diagnosticMin = 1024;
      diagnosticMax = -1024;
      Serial.println("Streaming baseline, filtered, signed delta, delta range and touch state");
    } else {
      locatorRow = row;
      locatorCol = col;
      locatorChannel = channel;
      display = Display::Locate;
      Serial.printf("Locating (%d,%d)\n", row, col);
    }
  } else showHelp();
}

void readConsole() {
  static char line[48];
  static unsigned used = 0;
  static bool overflow = false;
  while (Serial.available()) {
    const char c = Serial.read();
    if (c == '\r' || c == '\n') {
      if (overflow) Serial.println("Command too long");
      else if (used) {
        line[used] = '\0';
        handleCommand(line);
      }
      used = 0;
      overflow = false;
    } else if (used < sizeof(line) - 1) line[used++] = c;
    else overflow = true;
  }
}

void sampleDiagnostic(uint32_t now) {
  if (!Serial || diagnosticRow < 0) return;
  const unsigned row = unsigned(diagnosticRow);
  const uint8_t electrode = cfg::electrode(row, unsigned(diagnosticCol));
  uint16_t baseline = 0, filtered = 0;
  const bool readable = touchio::select(cfg::muxChannel(row)) &&
      touchio::diagnostic(cfg::sensorAddress(row), electrode, baseline, filtered);
  const int delta = int(baseline) - int(filtered);
  if (readable) {
    if (delta < diagnosticMin) diagnosticMin = delta;
    if (delta > diagnosticMax) diagnosticMax = delta;
  }
  if (now - lastDiagnostic < 200) return;
  lastDiagnostic = now;
  if (!readable) Serial.printf("(%u,%d) diagnostic read failed\n", row, diagnosticCol);
  else Serial.printf("(%u,%d) ELE%u  base=%u filtered=%u delta=%d range=%d..%d touch=%d (-1=row unavailable)\n",
      row, diagnosticCol, electrode, baseline, filtered, delta, diagnosticMin, diagnosticMax,
      sensors[row].state == SensorState::Online ? int((sensors[row].mask >> electrode) & 1) : -1);
  diagnosticMin = 1024;
  diagnosticMax = -1024;
}

void setup() {
  Serial.begin(115200);
  Wire.begin();                  // Teensy 4.1 primary bus: SDA 18, SCL 19
  Wire.setClock(100000);
  leds.begin();
  leds.show();
  scene.setMode(cfg::BootMode);
}

void loop() {
  readConsole();
  uint32_t now = millis();
  if (now - lastPoll >= 8) {
    lastPoll = now;
    for (unsigned row = 0; row < cfg::Rows; ++row) pollRow(row, millis());
    sampleDiagnostic(millis());
  }
  now = millis();
  if (now - lastFrame >= 16 && !leds.busy()) {
    lastFrame = now;
    renderFrame(now);
  }
}
