(() => {
  'use strict';

  const GRAVITY = 9810, RESTITUTION = 0.78, MIN_APEX = 0.5, FADE_SECONDS = 0.4;
  const MAX_BALLS = 128, LIGHT_RADIUS = 24;
  const TAP_DELAYS = [0, 18, 36], TAP_WEIGHTS = [1, 0.35, 0.12];

  function trajectory(height) {
    const firstImpactSeconds = Math.sqrt(2 * height / GRAVITY);
    let settleSeconds = firstImpactSeconds, bounceCount = 0;
    let speed = GRAVITY * firstImpactSeconds * RESTITUTION;
    while (speed * speed / (2 * GRAVITY) >= MIN_APEX) {
      settleSeconds += 2 * speed / GRAVITY;
      bounceCount++;
      speed *= RESTITUTION;
    }
    return {height, firstImpactSeconds, settleSeconds,
      lifeSeconds: settleSeconds + FADE_SECONDS, bounceCount};
  }

  // Every frame evaluates the same ballistic path directly from its age.
  // Pausing or skipping a frame cannot alter a rebound's height or timing.
  function sample(path, seconds) {
    const age = Math.max(0, seconds);
    if (age < path.firstImpactSeconds) {
      return {height: Math.max(0, path.height - 0.5 * GRAVITY * age * age),
        velocity: GRAVITY * age, brightness: 1, bounce: 0, settled: false};
    }
    if (age >= path.settleSeconds) {
      return {height: 0, velocity: 0,
        brightness: Math.pow(RESTITUTION, path.bounceCount / 2) *
          Math.max(0, Math.min(1, (path.lifeSeconds - age) / FADE_SECONDS)),
        bounce: path.bounceCount, settled: true};
    }
    let remaining = age - path.firstImpactSeconds;
    let speed = GRAVITY * path.firstImpactSeconds * RESTITUTION;
    for (let bounce = 1; bounce <= path.bounceCount; bounce++) {
      const duration = 2 * speed / GRAVITY;
      if (remaining < duration || bounce === path.bounceCount) {
        return {height: Math.max(0, speed * remaining - 0.5 * GRAVITY * remaining * remaining),
          velocity: GRAVITY * remaining - speed,
          brightness: Math.pow(RESTITUTION, bounce / 2), bounce, settled: false};
      }
      remaining -= duration;
      speed *= RESTITUTION;
    }
  }

  class BouncyBall {
    constructor(rings, palette, seed) {
      this.floor = rings.length ? Math.max(...rings.map(ring => ring.y)) + 17 : 0;
      this.palette = palette;
      this.balls = [];
      this.emitters = new window.SpringEmitters(rings);
      this.peaks = new Float64Array(rings.length * 16);
      this.indices = new Uint32Array(this.peaks.length);
      this.setSeed(seed);
    }

    setSeed(seed) { this.seed = (seed >>> 0) || 0x6d2b79f5; }

    next() {
      this.seed ^= this.seed << 13;
      this.seed ^= this.seed >>> 17;
      this.seed ^= this.seed << 5;
      this.seed >>>= 0;
      return this.seed;
    }

    launch(origin, now) {
      if (!this.peaks.length) return;
      // Low drops can finish before older high drops. Reclaim expired entries
      // before evicting the oldest surviving ball at the capacity limit.
      this.balls = this.balls.filter(ball => ((now - ball.born) >>> 0) / 1000 < ball.trajectory.lifeSeconds);
      if (this.balls.length === MAX_BALLS) this.balls.shift();
      this.balls.push({born: now >>> 0, x: origin.x,
        color: this.palette[this.next() % this.palette.length],
        trajectory: trajectory(Math.max(0, this.floor - origin.y))});
    }

    render(now, pixels) {
      let active = 0;
      for (const ball of this.balls) {
        const age = (now - ball.born) >>> 0;
        if (age / 1000 >= ball.trajectory.lifeSeconds) continue;
        this.balls[active++] = ball;
        const current = sample(ball.trajectory, age / 1000);
        let count = 0;
        for (let tap = 0; tap < TAP_DELAYS.length && age >= TAP_DELAYS[tap]; tap++) {
          const past = sample(ball.trajectory, (age - TAP_DELAYS[tap]) / 1000);
          this.emitters.spot(ball.x, this.floor - past.height, LIGHT_RADIUS, (index, base) => {
            const strength = base * TAP_WEIGHTS[tap];
            if (strength <= this.peaks[index]) return;
            if (!this.peaks[index]) this.indices[count++] = index;
            this.peaks[index] = strength;
          });
        }
        for (let j = 0; j < count; j++) {
          const index = this.indices[j], strength = this.peaks[index] * current.brightness;
          this.peaks[index] = 0;
          for (let channel = 0; channel < 3; channel++) {
            const offset = index * 3 + channel;
            pixels[offset] = Math.min(255, pixels[offset] + Math.round(ball.color[channel] * strength));
          }
        }
      }
      this.balls.length = active;
      return active;
    }
  }

  BouncyBall.trajectory = trajectory;
  BouncyBall.sample = sample;
  window.SpringBouncyBall = BouncyBall;
})();
