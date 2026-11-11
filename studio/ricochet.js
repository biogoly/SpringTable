(() => {
  'use strict';
  // Distances are millimeters and times are milliseconds. The grid uses the
  // same physical emitter positions, trajectories and falloff as the firmware.
  const LIFE = 4400, FADE = 2600, MAX_BALLS = 128;
  const PAD = 20, LED_RADIUS = 17, LIGHT = 52, LIGHT2 = LIGHT * LIGHT;
  const TAP_AGES = [0, 65, 130], TAP_WEIGHTS = [1, 125 / 255, 52 / 255];
  const directions = Array.from({length: 16}, (_, p) => {
    const angle = 2 * Math.PI * p / 16;
    return [LED_RADIUS * Math.sin(angle), -LED_RADIUS * Math.cos(angle)];
  });

  function hull(points) {
    const sorted = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
      .filter((p, i, a) => !i || p.x !== a[i-1].x || p.y !== a[i-1].y);
    if (sorted.length <= 2) return sorted;
    function chain(order) {
      const out = [];
      for (const p of order) {
        while (out.length >= 2) {
          const a = out[out.length-2], b = out[out.length-1];
          // Treat sub-micron floating point variation along a straight layout
          // as collinear instead of producing an almost infinitely sharp tip.
          const dx = b.x-a.x, dy = b.y-a.y;
          if (dx*(p.y-a.y) - dy*(p.x-a.x) > 1e-8*Math.hypot(dx,dy)) break;
          out.pop();
        }
        out.push(p);
      }
      out.pop();  // Both chains contribute their first endpoint.
      return out;
    }
    return chain(sorted).concat(chain(sorted.reverse()));
  }

  function makeArena(points) {
    const corners = hull(points);
    if (!corners.length) return null;
    const axesAligned = corners.every((p, i) => {
      const next = corners[(i + 1) % corners.length];
      return p.x === next.x || p.y === next.y;
    });
    if (axesAligned) {
      const xs = corners.map(p => p.x), ys = corners.map(p => p.y);
      return {rect: [Math.min(...xs)-PAD, Math.max(...xs)+PAD,
                     Math.min(...ys)-PAD, Math.max(...ys)+PAD]};
    }
    // Each half-plane is described by its inward unit normal and a point on
    // the original outline. Adjacent outward-shifted planes meet at a corner.
    if (corners.length === 2) {
      const [a, b] = corners, length = Math.hypot(b.x-a.x, b.y-a.y);
      const dx = (b.x-a.x)/length, dy = (b.y-a.y)/length;
      return {walls: [
        {x: a.x, y: a.y, nx: dx, ny: dy}, {x: b.x, y: b.y, nx: -dx, ny: -dy},
        {x: a.x, y: a.y, nx: -dy, ny: dx}, {x: a.x, y: a.y, nx: dy, ny: -dx}
      ]};
    }
    const walls = corners.map((p, i) => {
      const q = corners[(i+1) % corners.length], dx = q.x-p.x, dy = q.y-p.y;
      const length = Math.hypot(dx, dy);
      return {x: p.x, y: p.y, nx: -dy/length, ny: dx/length};
    });
    return {walls};
  }

  // Custom outlines use an exact piecewise-linear trajectory. Compute the
  // reflection points once on launch so sparse or paused frames can seek
  // directly to the head and both trail positions without stepping physics.
  function reflectedPath(ball, walls) {
    let {x,y,vx,vy} = ball, at = 0;
    const pieces = [];
    while (at < LIFE) {
      pieces.push({at, x, y, vx, vy});
      let first = Infinity, face = null, corner = false;
      for (const wall of walls) {
        const towards = -(vx*wall.nx + vy*wall.ny);
        if (towards <= 1e-12) continue;
        const gap = (x-wall.x)*wall.nx + (y-wall.y)*wall.ny + PAD;
        const time = Math.max(0, gap / towards);
        if (time < first - 1e-7) { first = time; face = wall; corner = false; }
        else if (Math.abs(first-time) <= 1e-7) corner = true;
      }
      if (!face || at + first >= LIFE) break;
      x += vx * first; y += vy * first; at += first;
      if (corner) { vx = -vx; vy = -vy; }
      else {
        const normal = vx * face.nx + vy * face.ny;
        vx -= 2 * normal * face.nx;
        vy -= 2 * normal * face.ny;
      }
      // Advance an imperceptible distance along the reflected path to avoid
      // re-hitting a vertex through floating-point cancellation.
      x += vx * 1e-7; y += vy * 1e-7; at += 1e-7;
    }
    return pieces;
  }

  function mirror(value, min, max) {
    const width = max-min, period = 2*width;
    let folded = (value-min) % period;
    if (folded < 0) folded += period;
    return min + (folded > width ? period-folded : folded);
  }

  function location(ball, arena, age) {
    if (arena.rect) {
      const [left,right,top,bottom] = arena.rect;
      return [mirror(ball.x+ball.vx*age, left,right), mirror(ball.y+ball.vy*age, top,bottom)];
    }
    const path = ball.path;
    let lo = 0, hi = path.length;
    while (lo+1 < hi) {
      const mid = (lo+hi) >> 1;
      if (path[mid].at <= age) lo = mid;
      else hi = mid;
    }
    const p = path[lo], dt = age-p.at;
    return [p.x+p.vx*dt, p.y+p.vy*dt];
  }

  class Ricochet {
    constructor(rings, palette, seed) {
      this.arena = makeArena(rings);
      this.palette = palette;
      this.balls = [];
      this.setSeed(seed);
      const count = rings.length * 16;
      this.x = new Float64Array(count);
      this.y = new Float64Array(count);
      this.peaks = new Float64Array(count);
      this.indices = new Uint32Array(count);
      this.cells = new Map();
      for (let i = 0; i < count; i++) {
        const ring = rings[i >> 4], [dx,dy] = directions[i & 15];
        const x = this.x[i] = ring.x+dx, y = this.y[i] = ring.y+dy;
        const key = Math.floor(x/LIGHT) + ',' + Math.floor(y/LIGHT);
        let cell = this.cells.get(key);
        if (!cell) this.cells.set(key, cell = []);
        cell.push(i);
      }
    }

    setSeed(seed) { this.seed = (seed >>> 0) || 0x6d2b79f5; }

    next() {
      let value = this.seed;
      value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
      this.seed = value >>> 0;
      return this.seed;
    }

    launch(origin, time) {
      const angle = (this.next() & 65535) * 2 * Math.PI / 65536;
      const speed = (430 + this.next() % 211) / 1000;
      const ball = {born: time >>> 0, x: origin.x, y: origin.y,
        vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, color: this.palette[this.next() % 6]};
      if (!this.arena.rect) ball.path = reflectedPath(ball, this.arena.walls);
      if (this.balls.length === MAX_BALLS) this.balls.shift();
      this.balls.push(ball);
    }

    deposit(x, y, weight, count) {
      const left = Math.floor((x-LIGHT)/LIGHT), top = Math.floor((y-LIGHT)/LIGHT);
      // Cell size equals kernel radius; only three cells on each axis can
      // intersect a tap. Each emitter lives in exactly one cell.
      for (let cy = top; cy <= top+2; cy++) {
        for (let cx = left; cx <= left+2; cx++) {
          const cell = this.cells.get(cx + ',' + cy);
          if (!cell) continue;
          for (const i of cell) {
            const dx = this.x[i]-x, dy = this.y[i]-y;
            const strength = weight * (1-(dx*dx+dy*dy)/LIGHT2);
            if (strength <= this.peaks[i]) continue;
            if (this.peaks[i] === 0) this.indices[count++] = i;
            this.peaks[i] = strength;
          }
        }
      }
      return count;
    }

    render(now, pixels) {
      let active = 0;
      for (const ball of this.balls) {
        const age = (now - ball.born) >>> 0;
        if (age >= LIFE) continue;
        this.balls[active++] = ball;
        const fade = age <= FADE ? 1 : (LIFE-age)/(LIFE-FADE);
        let count = 0;
        for (let tap = 0; tap < TAP_AGES.length && TAP_AGES[tap] <= age; tap++) {
          const [x,y] = location(ball, this.arena, age-TAP_AGES[tap]);
          count = this.deposit(x,y,TAP_WEIGHTS[tap],count);
        }
        for (let j = 0; j < count; j++) {
          const i = this.indices[j], strength = this.peaks[i]*fade;
          this.peaks[i] = 0;
          for (let ch = 0; ch < 3; ch++) {
            const offset = i*3+ch;
            pixels[offset] = Math.min(255,pixels[offset]+Math.round(ball.color[ch]*strength));
          }
        }
      }
      this.balls.length = active;
      return active;
    }
  }
  window.SpringRicochet = Ricochet;
})();
