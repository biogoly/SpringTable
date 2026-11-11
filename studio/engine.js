(() => {
  "use strict";

  const PALETTE = [[40,205,255], [255,93,24], [185,65,255],
                   [75,255,130], [255,70,148], [255,202,35]];
  const PITCH_MM = 60;
  const PIXELS = 16;
  const scale = (value, level) => Math.floor((value * level + 127) / 255);
  const elapsed = (now, start) => (now - start) >>> 0;

  function noise(seed) {
    seed ^= seed >>> 16;
    seed = Math.imul(seed, 0x7feb352d);
    seed ^= seed >>> 15;
    return seed >>> 24;
  }

  function streak(led, head) {
    const behind = (head - led) & 15;
    return behind === 0 ? 255 : behind === 1 ? 120 : behind === 2 ? 52 : behind === 3 ? 20 : 0;
  }

  function addColor(colors, index, color, level) {
    for (let ch = 0; ch < 3; ++ch) {
      const offset = index * 3 + ch;
      colors[offset] = Math.min(255, colors[offset] + scale(color[ch], level));
    }
  }

  function envelope(age, arrival, width, peak) {
    const time = age - arrival;
    if (time < 0 || time >= width) return 0;
    if (arrival === 0) return Math.floor(peak * (width - time) / width);
    const attack = Math.min(30, Math.floor(width / 2));
    if (time < attack) return Math.floor(peak * time / attack);
    return Math.floor(peak * (width - time) / (width - attack));
  }

  function customWave(definition) {
    const {shape, color, speed, width, reach, hold} = definition;
    if (!/^#[0-9a-f]{6}$/i.test(color) || !["radial", "square"].includes(shape) ||
        ![speed, width, reach, hold].every(Number.isFinite) ||
        speed <= 0 || width < 1 || reach < 0 || hold < 0 || hold > 100) {
      throw new RangeError("Invalid custom wave shape, color, speed, width, reach, or hold");
    }
    const value = parseInt(color.slice(1), 16);
    return {square: shape === "square", color: [value >>> 16, (value >>> 8) & 255, value & 255],
            speed, width: Math.round(width), reach, hold: Math.round(hold * 255 / 100)};
  }

  function applyBudget(pixels, budgetMa, idlePerPixel, channelUa) {
    const idle = pixels.length / 3 * idlePerPixel;
    let demand = 0;
    for (let i = 0; i < pixels.length; i += 3) {
      demand += pixels[i] * channelUa[0] + pixels[i + 1] * channelUa[1] + pixels[i + 2] * channelUa[2];
    }
    const dynamic = Math.ceil(demand / 255);
    const requested = idle + dynamic;
    const budget = Math.max(0, Math.floor(budgetMa)) * 1000;
    if (requested <= budget || demand === 0) {
      return {pixels, requestedMa: requested / 1000, sentMa: requested / 1000, gain: requested <= budget ? 1 : 0};
    }
    const available = Math.max(0, budget - idle);
    const scaled = new Uint8Array(256);
    for (let code = 0; code < scaled.length; ++code) scaled[code] = Math.floor(code * available / dynamic);
    let sent = 0;
    for (let i = 0; i < pixels.length; i += 3) {
      for (let ch = 0; ch < 3; ++ch) {
        pixels[i + ch] = scaled[pixels[i + ch]];
        sent += pixels[i + ch] * channelUa[ch];
      }
    }
    return {pixels, requestedMa: requested / 1000, sentMa: (idle + Math.ceil(sent / 255)) / 1000,
            gain: available / dynamic};
  }

  class Scene {
    // Calibration units match Config.h: idle per pixel, then the extra R/G/B
    // channel current at code 255, all in microamps.
    constructor(rings, calibration = {}) {
      this.rings = rings.map(({x, y, row, col}, index) => {
        if (![x, y].every(Number.isFinite)) throw new RangeError("Ring positions must be finite millimeters");
        return {x, y, row: row ?? 0, col: col ?? index};
      });
      this.idleUa = calibration.idleMicroAmpsPerPixel ?? 1000;
      this.channelUa = Array.from(calibration.channelMicroAmps ?? [20000,20000,20000]);
      if (this.channelUa.length !== 3 || ![this.idleUa, ...this.channelUa].every(
          value => Number.isInteger(value) && value >= 0 && value <= 65535)) {
        throw new RangeError("Calibration values must be unsigned 16-bit microamps");
      }
      this.touches = rings.map(() => ({
        pressedAt: 0, releasedAt: 0, color: PALETTE[0], held: false, wave: false, ever: false,
        stampRelease: false, fading: false
      }));
      this.colorIndex = 0;
      this.latestIndex = -1;
      this.heldCount = 0;
      this.mode = 0;
      this.ricochet = null;
      this.drain = null;
      this.reflection = null;
      this.interference = null;
      this.reflectedInterference = null;
      this.interferenceColors = undefined;
      this.interferencePalette = null;
      this.ricochetSeed = calibration.ricochetSeed;
      // Geometry is fixed for the life of a Scene. Coordinates and distances are mm.
      // Cache both metrics once so simultaneous plucks only evaluate the envelopes.
      this.distances = this.rings.map(source => {
        const radial = new Float64Array(rings.length), square = new Float64Array(rings.length);
        this.rings.forEach((target, i) => {
          const dx = Math.abs(source.x - target.x), dy = Math.abs(source.y - target.y);
          radial[i] = Math.hypot(dx, dy);
          square[i] = Math.max(dx, dy);
        });
        return {radial, square};
      });
    }

    setMode(mode) {
      if (!Number.isInteger(mode) || mode < 0 || mode > 11 || this.mode === mode) return;
      if (this.interferencePalette) this.interferencePalette.group = null;
      if (this.ricochet && (this.mode === 7 || mode === 7)) this.ricochet.balls.length = 0;
      if (this.drain && (this.mode === 8 || mode === 8)) this.drain.orbits.length = 0;
      if (this.reflection && (this.mode === 9 || mode === 9)) this.reflection.waves.length = 0;
      if (this.interference && (this.mode === 10 || mode === 10)) this.interference.waves.length = 0;
      if (this.reflectedInterference && (this.mode === 11 || mode === 11)) this.reflectedInterference.waves.length = 0;
      if (mode === 10 && !this.interference) this.interference = new window.SpringInterference(this.distances);
      if ((mode === 9 || mode === 11) && !this.reflection) this.reflection = new window.SpringReflection(this.rings,this.distances);
      if (mode === 11 && !this.reflectedInterference) {
        this.reflectedInterference = new window.SpringInterference(this.distances,this.reflection);
      }
      if (mode === 8 && !this.drain) this.drain = new window.SpringDrain(this.rings);
      if (mode === 7 && !this.ricochet) {
        let seed = this.ricochetSeed;
        if (seed === undefined) {
          seed = globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ??
                 Math.floor(Math.random() * 0x100000000);
        }
        this.ricochet = new window.SpringRicochet(this.rings, PALETTE, seed);
      }
      this.mode = mode;
    }

    setRicochetSeed(seed) {
      this.ricochetSeed = seed >>> 0;
      this.ricochet?.setSeed(this.ricochetSeed);
    }

    setInterferenceColors(crest, trough) {
      this.interferenceColors = window.SpringInterference.colors(crest, trough);
      if (this.interferencePalette) {
        const palette=this.interferencePalette;
        palette.manual=palette.current=this.interferenceColors;
        palette.random=false;
        palette.group=null;
      }
    }

    paletteState() {
      if (!this.interferencePalette) this.interferencePalette=window.SpringInterference.newPalette(this.interferenceColors);
      return this.interferencePalette;
    }

    getInterferenceColors() {
      const {crest,trough}=this.paletteState().current;
      return {crest:crest.slice(),trough:trough.slice()};
    }

    getInterferenceRandom() { return this.interferencePalette?.random ?? false; }

    setInterferenceRandom(random) {
      if (typeof random !== 'boolean') throw new TypeError('Random interference policy must be true or false');
      const palette=this.paletteState();
      if (random===palette.random) return;
      palette.random=random;
      palette.current=palette.manual;
      palette.group=null;
      // All already-visible waves keep their current fixed colors when arming.
      if (random) for (const field of [this.interference,this.reflectedInterference]) {
        if (field) for (const wave of field.waves) wave.colors=palette.manual;
      }
    }

    setInterferencePaletteSeed(seed) { this.paletteState().setSeed(seed); }

    beginInterferenceGroup() { this.paletteState().group=null; }

    press(index, now) {
      const touch = this.touches[index];
      if (!touch) return;
      if (this.mode >= 7 && touch.held) return;
      if (this.mode === 7) this.ricochet.launch(this.rings[index], now);
      touch.color = PALETTE[this.colorIndex % PALETTE.length];
      if (this.mode === 8) this.drain.launch(this.rings[index], touch.color, now);
      if (this.mode === 9) this.reflection.launch(index, touch.color, now);
      if (this.mode === 10 || this.mode === 11) {
        const field=this.mode===10 ? this.interference : this.reflectedInterference;
        const colors=this.paletteState().edge(index,now,this.heldCount);
        field.launch(index,now,colors);
      }
      this.colorIndex = (this.colorIndex + 1) >>> 0;
      touch.pressedAt = now >>> 0;
      if (!touch.held) ++this.heldCount;
      touch.ever = touch.held = touch.wave = true;
      this.latestIndex = index;
      touch.fading = touch.stampRelease = false;
    }

    release(index) {
      const touch = this.touches[index];
      if (touch && touch.held) { --this.heldCount; touch.held = false; touch.stampRelease = true; }
    }

    spread(index, age, touch, custom, colors) {
      const square = custom ? custom.square : this.mode === 6;
      const distances = this.distances[index][square ? "square" : "radial"];
      const reach = custom ? custom.reach : (square ? 2 : 2.5) * PITCH_MM;
      const width = custom ? custom.width : 200;
      const speed = custom ? custom.speed : PITCH_MM * 10;
      const color = custom ? custom.color : touch.color;
      if (touch.wave) for (let i = 0; i < distances.length; ++i) {
        const distance = distances[i];
        if (distance > reach) continue;
        const arrival = Math.round(distance * 1000 / speed);
        const peak = custom ? 255 - Math.floor(120 * distance / (reach || 1)) : 255 - Math.floor(arrival / 2);
        const level = envelope(age, arrival, width, peak);
        if (level > 0) addColor(colors, i, color, level);
      }
      if (touch.held) addColor(colors, index, color, custom ? custom.hold : 26);
    }

    local(index, touch, age, releasedAge, now, pixels) {
      if (!touch.held && !touch.fading) return;
      const level = touch.held ? 255 : Math.floor(255 * (450 - releasedAge) / 450);
      const color = touch.color.map(channel => scale(channel, level));
      const head = Math.floor(age / 47) & 15;
      const slot = (Math.floor(age / 80) + index * 59) >>> 0;
      for (let p = 0; p < PIXELS; ++p) {
        const offset = (index * PIXELS + p) * 3;
        if (this.mode === 5) {
          const ring = this.rings[index], fraction = now % 80;
          const fireSlot = (Math.floor(now / 80) + ring.row * 37 + ring.col * 23 + p * 193) >>> 0;
          const heat = 42 + Math.floor((noise(fireSlot) * (80 - fraction) + noise(fireSlot + 1) * fraction) / 100);
          pixels[offset] = scale(heat, level);
          pixels[offset + 1] = scale(Math.floor(heat * heat / 330), level);
          continue;
        }
        let strength = 255;
        if (this.mode === 1 || this.mode === 4) {
          strength = streak(p, head);
          if (this.mode === 4) strength += streak(p, head + 5) + streak(p, head + 11);
        } else if (this.mode === 3 && (noise(slot) & 15) !== p && noise(slot + 123 * p) >= 24) {
          continue;
        }
        for (let ch = 0; ch < 3; ++ch) pixels[offset + ch] = scale(color[ch], strength);
      }
    }

    formula(index, touch, age, now, paint, pixels) {
      const latest = this.latestIndex;
      const ring = this.rings[index];
      const context = {i: index, p: 0, x: ring.x, y: ring.y, t: now / 1000,
        age: touch.ever ? age / 1000 : -1, held: touch.held,
        d: latest < 0 ? 0 : this.distances[latest].radial[index],
        dt: latest < 0 ? -1 : elapsed(now, this.touches[latest].pressedAt) / 1000};
      for (let p = 0; p < PIXELS; ++p) {
        context.p = p;
        const rgb = paint(context);
        for (let ch = 0; ch < 3; ++ch) {
          const value = Number(rgb[ch]);
          pixels[(index * PIXELS + p) * 3 + ch] = Number.isNaN(value) ? 0 :
            Math.max(0, Math.min(255, Math.round(value)));
        }
      }
    }

    frame(time, budgetMa, customDefinition = null) {
      const now = time >>> 0;
      if (!Number.isFinite(budgetMa)) throw new RangeError("A finite LED current budget in mA is required");
      const formula = customDefinition && customDefinition.kind === "formula" ? customDefinition.paint : null;
      if (customDefinition && customDefinition.kind === "formula" && typeof formula !== "function") {
        throw new TypeError("Formula definition must supply a paint function");
      }
      const custom = customDefinition && !formula ? customWave(customDefinition) : null;
      const ricochet = !customDefinition && this.mode === 7;
      const drain = !customDefinition && this.mode === 8;
      const reflection = !customDefinition && this.mode === 9;
      const interference = !customDefinition && (this.mode === 10 ? this.interference :
                                                  this.mode === 11 ? this.reflectedInterference : null);
      const spatial = !formula && (custom !== null || this.mode === 0 || this.mode === 6);
      const lifetime = custom ? Math.round(custom.reach * 1000 / custom.speed) + custom.width :
                               (this.mode === 0 ? 450 : 425);
      const colors = spatial ? new Uint8Array(this.rings.length * 3) : null;
      const pixels = new Uint8Array(this.rings.length * PIXELS * 3);
      this.touches.forEach((touch, i) => {
        const age = elapsed(now, touch.pressedAt);
        if (age >= lifetime) touch.wave = false;
        if (touch.stampRelease) {
          touch.releasedAt = now;
          touch.stampRelease = false;
          touch.fading = true;
        }
        const releasedAge = elapsed(now, touch.releasedAt);
        if (releasedAge >= 450) touch.fading = false;
        if (formula) this.formula(i, touch, age, now, formula, pixels);
        else if (spatial) this.spread(i, age, touch, custom, colors);
        else if (this.mode < 7) this.local(i, touch, age, releasedAge, now, pixels);
      });
      if (spatial) for (let i = 0; i < this.rings.length; ++i) {
        const color = colors.subarray(i * 3, i * 3 + 3);
        for (let p = 0; p < PIXELS; ++p) pixels.set(color, (i * PIXELS + p) * 3);
      }
      const activeBalls = ricochet ? this.ricochet.render(now, pixels) : undefined;
      const activeOrbits = drain ? this.drain.render(now, pixels) : undefined;
      let activeWaves;
      if (reflection) activeWaves = this.reflection.render(now, pixels);
      if (interference) activeWaves = interference.render(now,pixels,this.interferenceColors,this.getInterferenceRandom());
      const result = applyBudget(pixels, budgetMa, this.idleUa, this.channelUa);
      if (ricochet) result.activeBalls = activeBalls;
      if (drain) result.activeOrbits = activeOrbits;
      if (reflection || interference) result.activeWaves = activeWaves;
      return result;
    }
  }
  window.SpringEngine = {Scene};
})();
