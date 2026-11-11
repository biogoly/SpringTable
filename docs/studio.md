# SpringTable Studio

Brush across the virtual springs with a mouse or touch two springs at once on a touchscreen. For keyboard play, focus the table, move between springs with the arrow keys, and hold Enter or tap Space to pluck. [Open SpringTable Studio](https://biogoly.github.io/SpringTable/)

## Patterns

Choose a pattern by name in **Play → Pattern**. The mode numbers are for the Teensy's Serial Monitor. For example, `mode 9` selects Reflection.

| Mode | Pattern | What a pluck does |
| ---: | --- | --- |
| 0 | Ripple | Sends a colored pulse through nearby rings. |
| 1 | Spinner | Starts a comet circling the touched ring. It fades after release. |
| 2 | Solid | Fills the ring with color for as long as the spring is held, then fades. |
| 3 | Confetti | Scatters colored sparks around the touched ring. |
| 4 | Three-dot gear | Rotates three bright teeth around the ring. |
| 5 | Fire | Makes amber embers flicker around the ring. |
| 6 | Surface | Sends an expanding square outline across the table. |
| 7 | Ricochet | Launches a ball with a random color, speed, and direction. Its trail follows it around each rebound. |
| 8 | Drain | Pulls a trail into an accelerating inward spiral that ends in a white flash. |
| 9 | Reflection | Sends a ripple to the edges, where a paler echo races back to the spring. |
| 10 | Interference | Sends a train of ripples. Two crests reinforce each other, and equal crests and troughs cancel to black. |
| 11 | Reflected Interference | Reflects each wave at the edge. Returning ripples can reinforce or cancel waves still traveling outward. |

### Pluck a pair

Choose either interference pattern, select **Pick two springs**, and click two different rings. Both waves launch on the second click. In **Reflected Interference**, try one spring near the edge and one near the center to see how the first returning wave crosses the other. **Run demo** repeats a paired launch.

**Wave palette** controls the crest and trough colors. Choose a preset, edit either swatch, or select **Random per pluck pair**. Each new pair then draws fresh colors while earlier waves and their echoes keep theirs. **Keep these colors** turns the latest pair into a fixed palette. **Teensy command** shows the corresponding serial command. [See three palettes on the same frame](../Interference-palettes.png)

### Inspect a frame

Choose **Pause**, then **+16 ms** to advance one frame at a time. Select a ring and choose one of its 16 LEDs in **Pixel inspector** to see its output RGB. **Touch all** is a quick way to test the current budget. Compare **Requested**, **LED output**, and **Frame scale** as you change the budget. Studio estimates current from the pixel values and dims the whole frame when the requested load exceeds the budget.

## Layout and pattern design

In **Layout**, generate a rectangular grid, hexagonal lattice, circle, or spiral with up to 400 rings. Increase the spacing to give traveling waves more distance to cross. Drag a ring or enter its X and Y coordinates in millimeters. **Add ring** places a ring at the next click, **Undo layout** reverses an edit, and **Fit** brings the whole board back into view.

In **Pattern lab**, choose **Create a pattern**. A **Touch wave** has controls for shape, color, speed, reach, trail, and held glow. For a moving red dot, choose **Pixel formulas** and enter one expression per channel.

| Red | Green | Blue |
| --- | --- | --- |
| `if(held, 255 * (p == floor(t * 12) % 16), 0)` | `0` | `0` |

Select **Apply & test pattern** and hold a spring. The dot moves 12 LED positions per second. Here `p` is the LED index (0–15) and `t` is time in seconds. Expand **Variables & functions** for the other inputs. Custom layouts and patterns run in Studio. Running them on a physical table requires a firmware port.

## Save a project or open an example

**Save project** downloads a JSON file containing the layout, custom patterns, selected effect, palette, and current budget. Use **Open** to load a saved file. Studio also tries to restore the last project in the same browser.

The repository includes 100-ring spiral projects. Download an example from GitHub using **Download raw file**, then choose it with **Open** in Studio.

- Follow a bouncing ball or an inward spiral. [Ricochet](../Ricochet%20Spiral.json) · [Drain](../Drain%20Spiral.json)
- Compare a returning echo, two interfering waves, and both effects together. [Reflection](../Reflection%20Spiral.json) · [Interference](../Interference%20Spiral.json) · [Reflected Interference](../Reflected%20Interference%20Spiral.json)
- Try fixed colors or draw a new pair on every launch. [Amber and Blue](../Amber%20and%20Blue%20Spiral.json) · [Random Palette](../Random%20Palette%20Spiral.json)

For offline use, download and extract the repository ZIP, then open `SpringTable Studio.html` in a browser. The example JSON files are in the same folder. [Download the repository ZIP](https://github.com/biogoly/SpringTable/archive/refs/heads/master.zip)
