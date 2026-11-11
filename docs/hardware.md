# Building a SpringTable

Each metal spring connects to one MPR121 touch electrode. A Teensy 4.1 reads the touch state and sends RGB data to a 16-pixel ring around each spring. A three-ring row is enough to check touch response, neighboring ripples and LED wiring before building a larger surface.

| Firmware profile | Springs and rings | Touch sensors | LED data outputs | Default LED budget |
| --- | ---: | --- | ---: | ---: |
| Three-ring bench | 3 (48 pixels) | 1 MPR121, direct or through a TCA9548A | 1 | 1.5 A |
| Ten-row grid | 100 (1,600 pixels) | 10 MPR121s through 1 TCA9548A | 10 | 40 A |

Both profiles have compiled for Teensy 4.1 using Teensyduino 1.62.0 and OctoWS2811 1.5. Touch sensitivity, LED current and behavior on a wired installation still need physical verification.

## Three-ring bench

Use three spring door stoppers, three 5 V WS2812-compatible 16-pixel **RGB** rings, a Teensy 4.1, an MPR121 breakout and a regulated, current-limited 5 V LED supply. The LED data line needs a 74AHCT245 level shifter and a 330 Ω series resistor. The default wiring includes a TCA9548A I²C multiplexer. A single MPR121 can also connect directly.

With power disconnected, mount each spring inside its ring. Use an insulating panel or isolated bushings. Attach the electrode lead at the fixed metal base and use a continuity meter to check the exposed coil. Through its full swing each spring should stay electrically isolated from neighboring springs, shared metalwork, LED pads and ground. For moving effects, orient all rings with LED 0 at the top and pixel numbers increasing clockwise as viewed from the front.

| Signal | Bench connection |
| --- | --- |
| Touch power | Power both touch-side breakouts for 3.3 V operation according to their board pinouts. Keep SDA/SCL pull-ups on the Teensy and selected sensor branch at 3.3 V. |
| Touch bus, with mux | Teensy 18 (SDA) and 19 (SCL) → TCA9548A SDA/SCL. Tie A0–A2 low for `0x70` and hold RESET high. From channel 0, connect SD0/SC0 to MPR121 SDA/SCL at `0x5A`. |
| Touch bus, direct | Connect Teensy 18/19 to MPR121 SDA/SCL at `0x5A` and set `SPRINGTABLE_BENCH_MUX` to `0` in `Config.h`. |
| Spring electrodes | MPR121 ELE0, ELE1 and ELE2 → left, middle and right springs respectively. The firmware polls over I²C and leaves IRQ unused. |
| LED data | Teensy pin 2 → 74AHCT245 A1. Connect B1 through 330 Ω to the first ring's DIN, with the resistor near DIN. Chain each DOUT to the next DIN, left to right. Run data alongside ground. |
| Buffer and ring power | Supply 5 V to the rings and buffer. Set buffer DIR high (A → B), active-low OE low and spare A inputs to defined levels. Place 0.1 µF between buffer VCC and GND at the chip. Across the ring supply entry fit a polarized 500–1,000 µF capacitor rated at least 6.3 V. |

Power the Teensy over USB, join the Teensy and LED grounds, and keep external +5 V isolated from Teensy VIN and USB 5 V in this arrangement. Power the LED rail before driving DIN. [Teensy power pins](https://www.pjrc.com/store/teensy41.html) · [74AHCT245 datasheet](https://www.ti.com/lit/ds/symlink/sn74ahct245.pdf) · [Adafruit pixel wiring](https://learn.adafruit.com/adafruit-neopixel-uberguide/best-practices)

1. Install the **Teensy** board package in Arduino IDE 2. The package includes Wire and OctoWS2811. [PJRC installation instructions](https://www.pjrc.com/teensy/td_download.html)
2. Open `SpringTable/SpringTable.ino`, select **Teensy 4.1** and **USB Type → Serial**. In `Config.h`, leave `SPRINGTABLE_FULL` at `0`, select the matching mux setting and set the LED budget to suit the supply and wiring. [Sketch](../SpringTable/SpringTable.ino) · [Configuration](../SpringTable/Config.h)
3. Verify and upload. Let the controller start with the springs untouched. In Serial Monitor select **115200** and **Newline**. Send `status` and look for row 0 to report `ready`.
4. Send `loc 0 1` to identify the middle ring. Its pixels should show four red, four green, four blue and four dark in sequence. If the colors are swapped, check the sketch's `WS2811_GRB` setting against the ring.
5. Send `play`, then `events`. Brush the middle spring. In the default Ripple mode, light should spread in both directions, with one touch event and one release event.

## Calibrate the springs

Send `diag 0 1` to read the middle electrode's baseline, filtered value, difference and recent range. Compare the untouched readings with the LEDs dark, with `loc 0 1` active and during animation. Try a light brush on the finished tip, a held touch, and a pluck that leaves the spring vibrating after release. Check neighboring springs for false presses.

The defaults are `TouchThreshold = 12` and `ReleaseThreshold = 6` in sensor counts. Choose a touch threshold above idle variations and below the smallest repeatable touch. Use a lower release threshold and check that lifting a hand reliably ends the touch. If idle and touch readings overlap, shorten electrode leads, move them away from LED power and data, or revise the contact surface. [NXP electrode layout](https://www.nxp.com/docs/en/application-note/AN4600.pdf) · [NXP touch and debounce](https://www.nxp.com/docs/en/application-note/AN3892.pdf)

## Ten-row grid

Set `SPRINGTABLE_FULL` to `1` and recompile. One MPR121 serves each row. Five channels of the TCA9548A each host two sensors, one at `0x5A` and one at `0x5B`. For typical breakouts, ADDR connects to ground for `0x5A` or to 3.3 V for `0x5B`. Check the board's address straps and existing pull-ups. [MPR121 address wiring](https://learn.adafruit.com/adafruit-mpr121-12-key-capacitive-touch-sensor-breakout-tutorial/wiring) · [TCA9548A datasheet](https://www.ti.com/lit/ds/symlink/tca9548a.pdf)

| Row from top | Mux channel | MPR121 address | Teensy LED pin |
| ---: | ---: | --- | ---: |
| 0 | 0 | `0x5A` | 2 |
| 1 | 0 | `0x5B` | 14 |
| 2 | 1 | `0x5A` | 7 |
| 3 | 1 | `0x5B` | 8 |
| 4 | 2 | `0x5A` | 6 |
| 5 | 2 | `0x5B` | 20 |
| 6 | 3 | `0x5A` | 21 |
| 7 | 3 | `0x5B` | 5 |
| 8 | 4 | `0x5A` | 3 |
| 9 | 4 | `0x5B` | 4 |

Across each row, ELE0–ELE9 correspond to columns 0–9 from the viewer's left. ELE10 and ELE11 are unused. Each LED pin drives its own buffered chain of ten rings with a series resistor at the first DIN. Two 74AHCT245s provide enough buffer channels for all ten parallel outputs. Set a row's bit in `ReversedLedRows` or `ReversedElectrodeRows` if the corresponding chain runs right to left. For example, `0x02AA` reverses rows 1, 3, 5, 7 and 9.

Add and test one row at a time. Use `events` and `loc ROW COL` to match both endpoints. An absent sensor retries every two seconds. If a row stays offline, check its mux channel, address straps and electrode isolation. After reconnection, lift and touch again to register a new press.

## LED current budget

The firmware estimates the current of each blended frame, including idle draw for every configured pixel. A single ripple can use full channel brightness. When the frame exceeds `PixelBudgetMilliAmps`, all channels scale together. The model defaults to 1 mA idle per pixel plus 20 mA for each channel at full intensity. Set the budget for the installation's continuous supply and wiring capacity, allowing headroom for other loads and current pulses. [Measured WS2812B current variation](https://www.pjrc.com/how-much-current-do-ws2812-neopixel-leds-really-use/)

For example, the model predicts **1.60 A** for 1,600 powered dark pixels and **97.60 A** for all-white at full brightness. With the 40 A profile budget, the latter frame goes out at RGB(102, 102, 102). Ten full-white rings concentrated on one row can still request **9.76 A**. Size wiring and connectors for local loads, fuse each branch near the distribution point, inject +5 V and ground at multiple points, and check voltage at the farthest lit ring. With multiple supplies, join the grounds and keep positive rails separate. [Adafruit power distribution guide](https://learn.adafruit.com/adafruit-neopixel-uberguide/powering-neopixels)

To calibrate, measure the 5 V feed to a single ring. Send `dark`, record idle current, then measure `loc 0 0 r`, `loc 0 0 g` and `loc 0 0 b` with `status` showing 100% scale. For `IdleMicroAmpsPerPixel`, divide the idle current in µA by 16. For each `ChannelMicroAmps` value, subtract the idle ring current from that color's reading and divide by 16, again in µA. Cross-check with `loc 0 0 w` and a completed row. Send `play` to resume.

## Serial controls

Send one command per line. Rows and columns start at zero. For pattern names and their corresponding mode numbers, see the [pattern catalog](studio.md#patterns).

| Command | Function |
| --- | --- |
| `help` | List available commands. |
| `status` / `events` | Report row health and estimated requested/sent current, frame scale and peaks / toggle the touch and release log. |
| `diag ROW COL` / `diag off` | Stream readings for one electrode / stop the stream. |
| `loc ROW COL [r/g/b/w]` | Identify a ring with color segments or fill it with one calibration color. |
| `dark` / `play` | Blank LEDs while touch scanning continues / resume animation. |
| `mode N` | Select a built-in pattern (0–11). Set `BootMode` for the startup selection. |
| `palette` / `palette RRGGBB RRGGBB` | Show the interference palette / set crest and trough colors in hex. |
| `palette random` / `palette fixed` / `palette reset` | Choose fresh colors for each pluck group / recall the manual pair / restore configured defaults. |

Serial palette choices last until restart. For startup colors change `InterferenceCrestRGB`, `InterferenceTroughRGB` or `InterferenceRandomPerPair` in `Config.h`.
