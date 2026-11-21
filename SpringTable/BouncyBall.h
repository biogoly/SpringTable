#pragma once
#include <stdint.h>
#include <math.h>
#include <string.h>
#include "RingGeometry.h"

namespace bouncyball {

constexpr double gravity = 9810.0;
constexpr double restitution = 0.78;
constexpr double minimumApex = 0.5;
constexpr double fadeSeconds = 0.4;

struct Trajectory {
  double height, firstImpactSeconds, settleSeconds, lifeSeconds;
  unsigned bounceCount;
};

struct Sample {
  double height, velocity, brightness;
  unsigned bounce;
  bool settled;
};

inline Trajectory trajectory(double height) {
  if (!(height > 0) || !isfinite(height)) height = 0;
  const double fall = sqrt(2 * height / gravity);
  double settle = fall;
  double rebound = gravity * fall * restitution;
  unsigned count = 0;
  while (rebound * rebound / (2 * gravity) >= minimumApex) {
    settle += 2 * rebound / gravity;
    rebound *= restitution;
    ++count;
  }
  return {height, fall, settle, settle + fadeSeconds, count};
}

// A closed parabola per flight keeps bounces consistent after skipped frames.
// Positive velocity is down the display. Height is measured above the floor.
inline Sample sample(const Trajectory &path, double seconds) {
  if (seconds < 0) seconds = 0;
  if (seconds < path.firstImpactSeconds) {
    return {path.height - 0.5 * gravity * seconds * seconds,
            gravity * seconds, 1, 0, false};
  }
  if (seconds >= path.settleSeconds) {
    double fade = (path.lifeSeconds - seconds) / fadeSeconds;
    if (fade < 0) fade = 0;
    if (fade > 1) fade = 1;
    return {0, 0, pow(restitution, path.bounceCount / 2.0) * fade, path.bounceCount, true};
  }
  double remaining = seconds - path.firstImpactSeconds;
  double rebound = gravity * path.firstImpactSeconds * restitution;
  for (unsigned bounce = 1; bounce <= path.bounceCount; ++bounce) {
    const double duration = 2 * rebound / gravity;
    if (remaining < duration || bounce == path.bounceCount) {
      const double height = rebound * remaining - 0.5 * gravity * remaining * remaining;
      return {height > 0 ? height : 0, gravity * remaining - rebound,
              pow(restitution, bounce / 2.0), bounce, false};
    }
    remaining -= duration;
    rebound *= restitution;
  }
  return {0, 0, 0, path.bounceCount, true};
}

template<unsigned Rows, unsigned Cols, class Color>
class Field {
public:
  struct Ball {
    uint32_t born, age;
    double x, y, vx, vy;
    bool grounded;
    unsigned quiet;
    int fade;
    double brightness;
    unsigned historyIndex;
    double historyX[37], historyY[37];
    Color color;
  };

private:
  using Spot = ringgeom::GridSpot<Rows, Cols>;
  static const unsigned capacity = 128, history = 37;
  static constexpr double floorY = (Rows - 1) * 60.0 + 17;
  static constexpr double leftX = -17, rightX = (Cols - 1) * 60.0 + 17;
  static constexpr double step = 0.001, diameter = 36, pairRestitution = 0.9;
  static constexpr double sleepSpeed2 = 2 * gravity * minimumApex, epsilon = 1e-9;
  static const uint32_t defaultSeed = UINT32_C(0x6d2b79f5);
  Ball balls_[capacity] = {};
  Color pixels_[Rows * Cols * 16] = {};
  unsigned count_ = 0;
  uint32_t seed_ = defaultSeed;
  uint32_t lastNow_ = 0;
  bool clockStarted_ = false;
  unsigned collisionCount_ = 0, contactLimitCount_ = 0;
  uint8_t contacts_[capacity * capacity] = {}, blocked_[capacity] = {};
  uint8_t candidates_[capacity * (capacity - 1) / 2] = {};
  unsigned candidateStarts_[capacity + 1] = {};
  const uint32_t maxLifeMs_ = ceilingLife();

  static uint32_t ceilingLife() {
    const uint32_t result = static_cast<uint32_t>(ceil(trajectory(floorY).lifeSeconds * 4000));
    return result < 12000 ? 12000 : result;
  }

  uint32_t randomWord() {
    seed_ ^= seed_ << 13;
    seed_ ^= seed_ >> 17;
    seed_ ^= seed_ << 5;
    return seed_;
  }

  static uint8_t addScaled(uint8_t current, uint8_t color, double weight) {
    const unsigned total = current + static_cast<unsigned>(color * weight + 0.5);
    return static_cast<uint8_t>(total > 255 ? 255 : total);
  }

  static void clampBall(Ball &ball) {
    if (ball.x < leftX) ball.x = leftX;
    if (ball.x > rightX) ball.x = rightX;
    if (ball.y > floorY) ball.y = floorY;
    if (ball.y < floorY - 1e-7) ball.grounded = false;
  }

  void separate() {
    for (unsigned pass = 0; pass < 2; ++pass) for (unsigned i = 0; i < count_; ++i) {
      Ball &a = balls_[i];
      for (unsigned j = i + 1; j < count_; ++j) {
        Ball &b = balls_[j];
        const double dx = b.x - a.x, dy = b.y - a.y;
        if (fabs(dx) >= diameter || fabs(dy) >= diameter) continue;
        const double d2 = dx * dx + dy * dy;
        if (d2 >= diameter * diameter - 1e-7) continue;
        const double distance = sqrt(d2);
        const double nx = distance > epsilon ? dx / distance : 1;
        const double ny = distance > epsilon ? dy / distance : 0;
        const double correction = (diameter - distance + 1e-7) * 0.5;
        a.x -= nx * correction; a.y -= ny * correction;
        b.x += nx * correction; b.y += ny * correction;
        clampBall(a); clampBall(b);
      }
    }
  }

  static double pairTime(const Ball &a, const Ball &b, double remaining) {
    const double dx = b.x - a.x, dy = b.y - a.y, vx = b.vx - a.vx, vy = b.vy - a.vy;
    if (fabs(dx) > diameter + fabs(vx) * remaining ||
        fabs(dy) > diameter + fabs(vy) * remaining) return HUGE_VAL;
    const double approach = dx * vx + dy * vy;
    if (approach >= -epsilon) return HUGE_VAL;
    const double gap = dx * dx + dy * dy - diameter * diameter;
    if (gap <= 1e-7) return 0;
    const double speed2 = vx * vx + vy * vy;
    const double discriminant = approach * approach - speed2 * gap;
    if (discriminant < 0 || speed2 <= epsilon) return HUGE_VAL;
    const double time = gap / (-approach + sqrt(discriminant));
    return time <= remaining ? time : HUGE_VAL;
  }

  void impact(Ball &a, Ball &b) {
    const double dx = b.x - a.x, dy = b.y - a.y, distance = sqrt(dx * dx + dy * dy);
    const double nx = distance > epsilon ? dx / distance : 1;
    const double ny = distance > epsilon ? dy / distance : 0;
    const double relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (relative >= -epsilon) return;
    // The floor absorbs only the downward component. A supported ball can
    // still exchange horizontal momentum or receive an upward kick.
    const unsigned allowYA = a.grounded && ny < 0 ? 0 : 1;
    const unsigned allowYB = b.grounded && ny > 0 ? 0 : 1;
    const double inverseMass = 2 * nx * nx + (allowYA + allowYB) * ny * ny;
    if (inverseMass <= epsilon) return;
    const double impulse = -(1 + pairRestitution) * relative / inverseMass;
    a.vx -= impulse * nx; a.vy -= impulse * ny * allowYA;
    b.vx += impulse * nx; b.vy += impulse * ny * allowYB;
    Ball *contact[] = {&a, &b};
    for (Ball *ball : contact) {
      if (fabs(ball->vy) > epsilon) ball->grounded = false;
      if (ball->vx * ball->vx + ball->vy * ball->vy > sleepSpeed2) {
        ball->quiet = 0; ball->fade = -1;
      }
    }
    ++collisionCount_;
  }

  void buildCandidates() {
    double speed2 = 0;
    for (unsigned i = 0; i < count_; ++i)
      speed2 += balls_[i].vx * balls_[i].vx + balls_[i].vy * balls_[i].vy;
    // No impulse or wall can increase total kinetic energy during this drift.
    // Even after several contacts, no pair can cover more than this distance.
    const double reach = diameter + 2 * sqrt(speed2) * step + 1e-7;
    const double reach2 = reach * reach;
    unsigned candidateCount = 0;
    for (unsigned i = 0; i < count_; ++i) {
      candidateStarts_[i] = candidateCount;
      for (unsigned j = i + 1; j < count_; ++j) {
        const double dx = balls_[j].x - balls_[i].x, dy = balls_[j].y - balls_[i].y;
        if (dx * dx + dy * dy <= reach2) candidates_[candidateCount++] = static_cast<uint8_t>(j);
      }
    }
    candidateStarts_[count_] = candidateCount;
  }

  // The same integer-millisecond, swept-contact steps as Studio. Render calls
  // only choose how many complete steps to run, never the integration step size.
  void tick() {
    memset(contacts_, 0, sizeof contacts_);
    memset(blocked_, 0, sizeof blocked_);
    separate();
    for (unsigned i = 0; i < count_; ++i) {
      Ball &ball = balls_[i];
      if (ball.grounded) ball.vx *= 0.996;
      else ball.vy += gravity * step * 0.5;
    }
    buildCandidates();
    double remaining = step;
    unsigned events = 0;
    const unsigned limit = count_ * 2 + 8;
    while (remaining > epsilon) {
      double soonest = remaining + epsilon;
      int first = -1, second = -1, wall = 0;
      for (unsigned i = 0; i < count_; ++i) {
        if (blocked_[i]) continue;
        Ball &ball = balls_[i];
        double t = HUGE_VAL;
        int side = 0;
        if (ball.vx < -epsilon) {
          t = (leftX - ball.x) / ball.vx; if (t < 0) t = 0; side = -1;
        } else if (ball.vx > epsilon) {
          t = (rightX - ball.x) / ball.vx; if (t < 0) t = 0; side = 1;
        }
        if (t <= remaining && t < soonest) { soonest = t; first = i; second = -1; wall = side; }
        if (ball.vy > epsilon) {
          t = (floorY - ball.y) / ball.vy; if (t < 0) t = 0;
          if (t <= remaining && t < soonest) { soonest = t; first = i; second = -1; wall = 2; }
        }
        for (unsigned candidate = candidateStarts_[i]; candidate < candidateStarts_[i + 1]; ++candidate) {
          const unsigned j = candidates_[candidate];
          if (blocked_[j]) continue;
          t = pairTime(ball, balls_[j], remaining < soonest ? remaining : soonest);
          if (t < epsilon && contacts_[i * capacity + j]) continue;
          if (t < soonest) { soonest = t; first = i; second = j; wall = 0; }
        }
      }
      const double duration = first < 0 ? remaining : soonest;
      for (unsigned i = 0; i < count_; ++i) if (!blocked_[i]) {
        balls_[i].x += balls_[i].vx * duration;
        balls_[i].y += balls_[i].vy * duration;
      }
      remaining -= duration;
      if (remaining < 0) remaining = 0;
      if (first < 0) break;
      Ball &ball = balls_[first];
      if (second >= 0) {
        impact(ball, balls_[second]);
        contacts_[first * capacity + second] = 1;
      }
      else if (wall == 2) {
        ball.y = floorY; ball.vy = -ball.vy * restitution; ball.vx *= 0.9;
        ball.brightness *= sqrt(restitution);
        if (ball.brightness < 0.12) ball.brightness = 0.12;
        if (ball.vy * ball.vy < sleepSpeed2) { ball.vy = 0; ball.grounded = true; }
      } else {
        ball.x = wall < 0 ? leftX : rightX;
        ball.vx = -ball.vx * restitution;
      }
      if (++events >= limit) {
        // Contain a crowded contact without damping unrelated moving balls.
        blocked_[first] = 1;
        balls_[first].vx *= 0.5; balls_[first].vy *= 0.5;
        if (second >= 0) {
          blocked_[second] = 1;
          balls_[second].vx *= 0.5; balls_[second].vy *= 0.5;
        }
        ++contactLimitCount_;
      }
    }
    unsigned active = 0;
    for (unsigned i = 0; i < count_; ++i) {
      Ball &ball = balls_[i];
      if (!ball.grounded) ball.vy += gravity * step * 0.5;
      clampBall(ball); ++ball.age;
      const double speed2 = ball.vx * ball.vx + ball.vy * ball.vy;
      if (speed2 < sleepSpeed2) ++ball.quiet;
      else { ball.quiet = 0; ball.fade = -1; }
      if (ball.quiet >= 120 && ball.fade < 0) ball.fade = 0;
      if (ball.fade >= 0) ++ball.fade;
      ball.historyIndex = (ball.historyIndex + 1) % history;
      ball.historyX[ball.historyIndex] = ball.x;
      ball.historyY[ball.historyIndex] = ball.y;
      if (ball.age < maxLifeMs_ && ball.fade < 400) {
        if (active != i) balls_[active] = ball;
        ++active;
      }
    }
    count_ = active;
  }

  void advance(uint32_t now) {
    if (!clockStarted_) { lastNow_ = now; clockStarted_ = true; return; }
    const uint32_t elapsed = now - lastNow_;
    lastNow_ = now;
    if (elapsed >= maxLifeMs_) { count_ = 0; return; }
    for (uint32_t ms = 0; ms < elapsed && count_; ++ms) tick();
  }

  void draw(const Ball &ball) {
    static const unsigned delays[] = {0, 18, 36};
    static const double weights[] = {1, 0.35, 0.12};
    double fade = ball.fade < 0 ? 1 : 1 - ball.fade / 400.0;
    if (fade < 0) fade = 0;
    double lifetimeFade = (maxLifeMs_ - ball.age) / 400.0;
    if (lifetimeFade > 1) lifetimeFade = 1;
    const double brightness = ball.brightness * fade * lifetimeFade;
    Spot taps[3];
    unsigned count = 0;
    double left = 0, right = 0, top = 0, bottom = 0;
    while (count < 3 && ball.age >= delays[count]) {
      const unsigned h = (ball.historyIndex + history - delays[count]) % history;
      const Spot &tap = taps[count] = Spot::at(ball.historyX[h], ball.historyY[h], 24);
      const double extent = sqrt(tap.nearest2 + tap.lightRadius2) + 17;
      if (!count || tap.x - extent < left) left = tap.x - extent;
      if (!count || tap.x + extent > right) right = tap.x + extent;
      if (!count || tap.y - extent < top) top = tap.y - extent;
      if (!count || tap.y + extent > bottom) bottom = tap.y + extent;
      ++count;
    }
    int xmin = static_cast<int>(ceil(left / 60)), xmax = static_cast<int>(floor(right / 60));
    int ymin = static_cast<int>(ceil(top / 60)), ymax = static_cast<int>(floor(bottom / 60));
    if (xmin < 0) xmin = 0;
    if (ymin < 0) ymin = 0;
    if (xmax >= static_cast<int>(Cols)) xmax = Cols - 1;
    if (ymax >= static_cast<int>(Rows)) ymax = Rows - 1;
    for (int row = ymin; row <= ymax; ++row) for (int col = xmin; col <= xmax; ++col) {
      for (unsigned p = 0; p < 16; ++p) {
        const double x = col * 60 + ringgeom::xOffset(p), y = row * 60 + ringgeom::yOffset(p);
        double brightest = 0;
        for (unsigned t = 0; t < count; ++t) {
          const double value = taps[t].weight(x, y) * weights[t];
          if (value > brightest) brightest = value;
        }
        if (brightest <= 0) continue;
        Color &out = pixels_[(row * Cols + col) * 16 + p];
        const double strength = brightest * brightness;
        out.r = addScaled(out.r, ball.color.r, strength);
        out.g = addScaled(out.g, ball.color.g, strength);
        out.b = addScaled(out.b, ball.color.b, strength);
      }
    }
  }

public:
  void setSeed(uint32_t seed) { seed_ = seed ? seed : defaultSeed; }
  unsigned activeCount() const { return count_; }
  unsigned collisionCount() const { return collisionCount_; }
  unsigned contactLimitCount() const { return contactLimitCount_; }
  const Ball &bodyAt(unsigned index) const { return balls_[index]; }

  void clear() {
    count_ = 0;
    clockStarted_ = false;
    collisionCount_ = contactLimitCount_ = 0;
    for (Color &pixel : pixels_) pixel = {};
  }

  void launch(unsigned row, unsigned col, uint32_t now, Color (*palette)(unsigned)) {
    advance(now);
    if (count_ == capacity) {
      for (unsigned i = 1; i < count_; ++i) balls_[i - 1] = balls_[i];
      --count_;
    }
    Ball &ball = balls_[count_++];
    ball = {};
    ball.born = now; ball.x = col * 60.0; ball.y = row * 60.0;
    ball.fade = -1; ball.brightness = 1;
    for (unsigned h = 0; h < history; ++h) { ball.historyX[h] = ball.x; ball.historyY[h] = ball.y; }
    ball.color = palette(randomWord());
  }

  void frame(uint32_t now) {
    for (Color &pixel : pixels_) pixel = {};
    advance(now);
    for (unsigned i = 0; i < count_; ++i) draw(balls_[i]);
  }

  Color pixel(unsigned row, unsigned col, unsigned p) const {
    return pixels_[(row * Cols + col) * 16 + p];
  }
};
}  // namespace bouncyball
