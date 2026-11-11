(() => {
  'use strict';
  const radiusMM = 19;
  const emitterRadiusMM = 17;
  const pixelsPerRing = 16;
  const positions = Array.from({length: pixelsPerRing}, (_, i) => {
    const theta = i * (2 * Math.PI / pixelsPerRing) - Math.PI / 2;
    return [Math.cos(theta), Math.sin(theta)];
  });
  const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
  const dot = (ctx, x, y, radius, color) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  };
  const rim = (ctx, x, y, radius, color, width) => {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  };

  class SpringBoard {
    constructor(canvas, handlers = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.base = document.createElement('canvas');
      this.handlers = handlers;
      this.rings = [];
      this.selected = -1;
      this.hover = -1;
      this.tool = 'play';
      this.center = {x: 0, y: 0};
      this.zoomFactor = 1;
      this.scale = 1;
      this.width = this.height = this.dpr = 0;
      this.staticDirty = true;
      this.owners = new Map();
      this.pointers = new Map();
      this.space = false;
      this.pannedWithSpace = false;
      this.pixels = new Uint8Array();
      this.held = new Set();
      this.listeners = new AbortController();
      const signal = this.listeners.signal;
      const on = (node, event, callback) => node.addEventListener(event, callback, {signal});
      canvas.tabIndex = 0;
      if (!canvas.hasAttribute('aria-label')) {
        canvas.setAttribute('aria-label', 'Interactive spring board. Use arrow keys to select and Enter or Space to pluck.');
      }
      canvas.style.touchAction = 'none';
      canvas.style.userSelect = canvas.style.webkitUserSelect = 'none';
      on(canvas, 'pointerdown', e => this.down(e));
      on(canvas, 'pointermove', e => this.move(e));
      on(canvas, 'pointerup', e => this.up(e));
      on(canvas, 'pointerleave', e => this.leave(e));
      on(canvas, 'pointercancel', e => this.forget(e.pointerId));
      on(canvas, 'lostpointercapture', e => {
        if (this.pointers.get(e.pointerId)?.kind !== 'hover') this.forget(e.pointerId);
      });
      on(canvas, 'keydown', e => this.keydown(e));
      on(window, 'keydown', e => {
        // A mouse user can begin a Space-drag before the first canvas click.
        // Leave native keyboard actions with any focused sidebar control.
        if (e.key === ' ' && document.activeElement === document.body && canvas.matches(':hover')) {
          canvas.focus({preventScroll: true});
          this.keydown(e);
        }
      });
      on(window, 'keyup', e => this.keyup(e));
      on(canvas, 'blur', () => this.resetInputs());
      on(window, 'blur', () => this.resetInputs());
      on(document, 'visibilitychange', () => { if (document.hidden) this.resetInputs(); });
      on(canvas, 'focus', () => this.repaint());
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
      on(window, 'resize', () => this.resize());
      this.resize();
    }

    setLayout(rings, fit = true) {
      const changedCount = rings.length !== this.rings.length;
      if (fit || changedCount) this.resetInputs();
      this.rings = rings;
      if (this.selected >= rings.length) this.selected = -1;
      this.staticDirty = true;
      if (fit) this.fit();
      else this.repaint();
    }

    setTool(tool) {
      if (!['play', 'move', 'add', 'pair'].includes(tool) || this.tool === tool) return;
      this.resetInputs();
      this.tool = tool;
      this.setCursor();
      this.repaint();
    }

    setSelected(index) {
      this.selected = Number.isInteger(index) && index >= 0 && index < this.rings.length ? index : -1;
      this.repaint();
    }

    bounds() {
      if (!this.rings.length) return {x: 0, y: 0, w: 250, h: 250};
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (const {x, y} of this.rings) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
      return {x: (left + right) / 2, y: (top + bottom) / 2,
              w: right - left + radiusMM * 2, h: bottom - top + radiusMM * 2};
    }

    fitScale(bounds = this.bounds()) {
      const pad = clamp(Math.min(this.width, this.height) * 0.055, 12, 36);
      return Math.max(0.001, Math.min((this.width - pad * 2) / bounds.w,
                                      (this.height - pad * 2) / bounds.h, 4.5));
    }

    fit() {
      const bounds = this.bounds();
      this.center = {x: bounds.x, y: bounds.y};
      this.zoomFactor = 1;
      this.scale = this.fitScale(bounds);
      this.staticDirty = true;
      this.repaint();
    }

    zoom(factor) {
      if (!(factor > 0 && Number.isFinite(factor))) return;
      const next = clamp(this.zoomFactor * factor, 0.35, 8);
      this.scale *= next / this.zoomFactor;
      this.zoomFactor = next;
      this.staticDirty = true;
      this.repaint();
    }

    resize() {
      const b = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      if (!b.width || !b.height || (this.width === b.width && this.height === b.height && this.dpr === dpr)) return;
      this.width = b.width; this.height = b.height; this.dpr = dpr;
      this.canvas.width = this.base.width = Math.max(1, Math.round(b.width * dpr));
      this.canvas.height = this.base.height = Math.max(1, Math.round(b.height * dpr));
      this.scale = this.fitScale() * this.zoomFactor;
      this.staticDirty = true;
      this.repaint();
    }

    world(e) {
      const b = this.canvas.getBoundingClientRect();
      return {x: this.center.x + (e.clientX - b.left - b.width / 2) / this.scale,
              y: this.center.y + (e.clientY - b.top - b.height / 2) / this.scale};
    }

    screen(point) {
      return {x: (point.x - this.center.x) * this.scale + this.width / 2,
              y: (point.y - this.center.y) * this.scale + this.height / 2};
    }

    hit(point) {
      const s = this.screen(point);
      if (s.x < 0 || s.y < 0 || s.x > this.width || s.y > this.height) return -1;
      let closest = -1, best = radiusMM ** 2;
      for (let i = 0; i < this.rings.length; i++) {
        const r = this.rings[i];
        const d = (r.x - point.x) ** 2 + (r.y - point.y) ** 2;
        if (d <= best) { closest = i; best = d; }
      }
      return closest;
    }

    notifyHover(index) {
      if (index === this.hover) return;
      this.hover = index;
      this.handlers.onHover?.(index);
      this.setCursor();
    }

    choose(index) {
      if (index < 0) return;
      this.setSelected(index);
      this.handlers.onSelect?.(index);
    }

    contact(owner, index) {
      const old = this.owners.get(owner) ?? -1;
      if (old === index) return;
      this.owners.delete(owner);
      if (old >= 0 && !Array.from(this.owners.values()).includes(old)) this.handlers.onRelease?.(old);
      if (index >= 0) {
        const first = !Array.from(this.owners.values()).includes(index);
        this.owners.set(owner, index);
        if (first) this.handlers.onPress?.(index);
      }
    }

    forget(id) {
      const p = this.pointers.get(id);
      if (!p) return;
      this.pointers.delete(id);
      clearTimeout(p.timer);
      this.contact(id, -1);
      if (this.canvas.hasPointerCapture(id)) this.canvas.releasePointerCapture(id);
      const remaining = [...this.pointers.values()].pop();
      this.notifyHover(remaining ? this.hit(remaining.point) : -1);
      this.setCursor();
    }

    resetInputs() {
      for (const id of [...this.pointers.keys()]) this.forget(id);
      for (const id of [...this.owners.keys()]) this.contact(id, -1);
      this.space = this.pannedWithSpace = false;
      this.notifyHover(-1);
      this.setCursor();
      this.repaint();
    }

    setCursor() {
      const active = [...this.pointers.values()];
      if (active.some(p => p.kind === 'pan' || p.kind === 'move')) this.canvas.style.cursor = 'grabbing';
      else if (this.space) this.canvas.style.cursor = 'grab';
      else if (this.tool === 'move') this.canvas.style.cursor = this.hover >= 0 ? 'grab' : 'default';
      else this.canvas.style.cursor = this.tool === 'add' || this.tool === 'pair' ? 'crosshair' : 'default';
    }

    down(e) {
      if (e.button !== 0 && e.button !== 1) return;
      e.preventDefault();
      this.canvas.focus({preventScroll: true});
      const point = this.world(e), index = this.hit(point);
      const p = this.pointers.get(e.pointerId) || {};
      clearTimeout(p.timer);
      Object.assign(p, {index, point, cx: e.clientX, cy: e.clientY});
      this.pointers.set(e.pointerId, p);
      this.canvas.setPointerCapture(e.pointerId);
      if (e.button === 1 || this.space) {
        p.kind = 'pan';
        this.pannedWithSpace = this.space;
        this.contact(e.pointerId, -1);
      } else if (this.tool === 'add') {
        p.kind = 'add';
        this.handlers.onAdd?.(point.x, point.y);
      } else if (this.tool === 'pair') {
        p.kind = 'pair';
        if (index >= 0) { this.choose(index); this.handlers.onPick?.(index); }
      } else if (this.tool === 'move') {
        p.kind = 'move';
        if (index >= 0) {
          p.dx = this.rings[index].x - point.x;
          p.dy = this.rings[index].y - point.y;
          this.choose(index);
        }
      } else {
        p.kind = 'play';
        this.choose(index);
        this.contact(e.pointerId, index);
      }
      this.notifyHover(index);
      this.setCursor();
    }

    cross(id, p, index) {
      if (p.index === index) return;
      p.index = index;
      clearTimeout(p.timer);
      this.contact(id, index);
      // Flying over a coil plucks it once. Pressing down adopts that contact
      // until this pointer leaves, even if a second pointer touches it too.
      if (p.kind === 'hover' && index >= 0) {
        p.timer = setTimeout(() => this.contact(id, -1), 90);
      }
    }

    move(e) {
      const point = this.world(e);
      let p = this.pointers.get(e.pointerId);
      if (!p && (e.pointerType === 'touch' || e.buttons)) return;
      if (!p) {
        p = {kind: 'hover', index: -1, point};
        this.pointers.set(e.pointerId, p);
      }
      if (p.kind === 'pan') {
        this.center.x -= (e.clientX - p.cx) / this.scale;
        this.center.y -= (e.clientY - p.cy) / this.scale;
        p.cx = e.clientX; p.cy = e.clientY;
        this.staticDirty = true;
        this.repaint();
        return;
      }
      const index = this.hit(point);
      if (p.kind === 'move' && p.index >= 0 && this.rings[p.index]) {
        this.handlers.onMove?.(p.index, point.x + p.dx, point.y + p.dy);
      } else if (this.tool === 'play' && (p.kind === 'play' || p.kind === 'hover') && !this.space) {
        const dx = point.x - p.point.x, dy = point.y - p.point.y;
        // Sparse mouse events still cross all the rings along a fast stroke.
        const steps = clamp(Math.ceil(Math.hypot(dx, dy) / (radiusMM / 2)), 1, 256);
        for (let i = 1; i <= steps; i++) {
          this.cross(e.pointerId, p, this.hit({x: p.point.x + dx * i / steps, y: p.point.y + dy * i / steps}));
        }
      }
      p.point = point;
      this.notifyHover(index);
    }

    up(e) {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (e.pointerType === 'touch') { this.forget(e.pointerId); return; }
      this.contact(e.pointerId, -1);
      p.kind = 'hover';
      p.point = this.world(e);
      p.index = this.hit(p.point);
      if (this.canvas.hasPointerCapture(e.pointerId)) this.canvas.releasePointerCapture(e.pointerId);
      this.notifyHover(p.index);
      this.setCursor();
    }

    leave(e) {
      const p = this.pointers.get(e.pointerId);
      if (p && (p.kind === 'pan' || p.kind === 'move') && this.canvas.hasPointerCapture(e.pointerId)) return;
      this.forget(e.pointerId);
    }

    neighbor(dx, dy) {
      if (this.selected < 0) return this.rings.length ? 0 : -1;
      const origin = this.rings[this.selected];
      if (!origin) return -1;
      let best = Infinity, index = this.selected;
      for (let i = 0; i < this.rings.length; i++) {
        const x = this.rings[i].x - origin.x, y = this.rings[i].y - origin.y;
        const along = x * dx + y * dy, across = Math.abs(x * dy - y * dx);
        if (along <= 0 || across > along * 1.5) continue;
        const score = Math.hypot(x, y) + 2 * across;
        if (score < best) { best = score; index = i; }
      }
      return index;
    }

    reveal(index) {
      if (index < 0) return;
      const {x, y} = this.screen(this.rings[index]);
      const margin = Math.min(radiusMM * this.scale + 5, this.width / 2, this.height / 2);
      const targetX = clamp(x, margin, this.width - margin);
      const targetY = clamp(y, margin, this.height - margin);
      if (targetX === x && targetY === y) return;
      this.center.x += (x - targetX) / this.scale;
      this.center.y += (y - targetY) / this.scale;
      this.staticDirty = true;
    }

    keydown(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const arrows = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
      if (arrows[e.key]) {
        e.preventDefault();
        const next = this.neighbor(...arrows[e.key]);
        this.reveal(next);
        this.choose(next);
        return;
      }
      if (e.key !== ' ' && e.key !== 'Enter') return;
      e.preventDefault();
      if (e.repeat) return;
      if (this.tool === 'pair') {
        if (this.selected < 0 && this.rings.length) this.choose(0);
        if (this.selected >= 0) this.handlers.onPick?.(this.selected);
        return;
      }
      if (e.key === ' ') {
        // Space doubles as a pan modifier; commit its pluck on release only
        // if no drag started. Enter provides immediate press-and-hold.
        this.space = true;
        this.pannedWithSpace = false;
        this.setCursor();
      } else if (this.tool === 'play' && this.rings.length) {
        if (this.selected < 0) this.choose(0);
        this.contact('Enter', this.selected);
      }
    }

    keyup(e) {
      if (e.key === 'Enter') this.contact('Enter', -1);
      if (e.key !== ' ' || !this.space) return;
      this.space = false;
      if (!this.pannedWithSpace && this.tool === 'play' && this.rings.length) {
        if (this.selected < 0) this.choose(0);
        this.contact('Space', this.selected);
        this.contact('Space', -1);
      }
      this.setCursor();
    }

    repaint() { if (this.width && this.height) this.draw(this.pixels, this.held); }

    paintBase() {
      const ctx = this.base.getContext('2d'), w = this.width, h = this.height;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const origin = this.screen({x: 0, y: 0});
      let grid = 25 * this.scale;
      while (grid < 15) grid *= 2;
      while (grid > 75) grid /= 2;
      const start = (n, step) => ((n % step) + step) % step;
      ctx.strokeStyle = 'rgba(158,185,177,.065)';
      ctx.lineWidth = 0.75; ctx.beginPath();
      for (let x = start(origin.x, grid); x <= w; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = start(origin.y, grid); y <= h; y += grid) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.strokeStyle = 'rgba(155,190,180,.27)'; ctx.lineWidth = 0.8; ctx.beginPath();
      for (let x = start(origin.x, grid * 4); x <= w; x += grid * 4) {
        for (let y = start(origin.y, grid * 4); y <= h; y += grid * 4) {
          ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y);
          ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3);
        }
      }
      ctx.stroke();
      const radius = this.scale * radiusMM;
      this.visible = [];
      for (let i = 0; i < this.rings.length; i++) {
        const {x, y} = this.screen(this.rings[i]);
        if (x < -radius * 1.5 || y < -radius * 1.5 || x > w + radius * 1.5 || y > h + radius * 1.5) continue;
        this.visible.push({i, x, y});
        this.paintRing(ctx, x, y, radius);
      }
      this.staticDirty = false;
    }

    paintRing(ctx, x, y, r) {
      const track = r * emitterRadiusMM / radiusMM, p = r * 0.093;
      rim(ctx, x, y, r * 0.84, '#0b1112', r * 0.33);
      rim(ctx, x, y, r, '#45514e', Math.max(0.5, r * 0.034));
      rim(ctx, x, y, r * 0.68, '#374541', Math.max(0.42, r * 0.029));
      rim(ctx, x, y, track, '#333e3a', r * 0.12);
      for (const [dx, dy] of positions) {
        dot(ctx, x + track * dx, y + track * dy, p * 1.10, '#151d1c');
        dot(ctx, x + track * dx, y + track * dy, p * 0.87, '#59635e');
      }
      const metal = ctx.createLinearGradient(x - r * 0.28, y - r * 0.30, x + r * 0.29, y + r * 0.26);
      metal.addColorStop(0, '#9aaba6'); metal.addColorStop(0.28, '#64746f');
      metal.addColorStop(0.60, '#35423e'); metal.addColorStop(1, '#687872');
      dot(ctx, x, y, r * 0.33, '#09100f');
      dot(ctx, x, y, r * 0.29, metal);
      rim(ctx, x, y, r * 0.212, '#25322f', Math.max(0.42, r * 0.03));
      dot(ctx, x, y, r * 0.145, metal);
    }

    draw(pixels = this.pixels, heldSet = this.held) {
      this.pixels = pixels;
      this.held = heldSet;
      if (!this.width || !this.height) return;
      if ((window.devicePixelRatio || 1) !== this.dpr) { this.resize(); return; }
      if (this.staticDirty) this.paintBase();
      const ctx = this.ctx, radius = radiusMM * this.scale, track = emitterRadiusMM * this.scale;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.drawImage(this.base, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      for (const {i, x, y} of this.visible) {
        if (this.tool !== 'play' && this.selected === i) {
          rim(ctx, x, y, radius * 1.15, '#e6ad70', 1.5);
        } else if (this.hover === i || (this.selected === i && this.canvas.matches(':focus-visible'))) {
          rim(ctx, x, y, radius * 1.13, 'rgba(226,175,115,.85)', 1.1);
        }
        const start = i * 48;
        if (pixels && pixels.length >= start + 48) {
          for (let j = 0; j < pixelsPerRing; j++) {
            const offset = start + j * 3;
            const r = pixels[offset], g = pixels[offset + 1], b = pixels[offset + 2];
            const peak = Math.max(r, g, b);
            if (!peak) continue;
            const [dx, dy] = positions[j];
            const px = x + dx * track, py = y + dy * track;
            const level = Math.sqrt(peak / 255), color = [r, g, b].map(c => Math.round(255 * c / peak)).join(',');
            dot(ctx, px, py, radius * 0.20, 'rgba(' + color + ',' + (level * 0.17) + ')');
            dot(ctx, px, py, radius * 0.135, 'rgba(' + color + ',' + (level * 0.36) + ')');
            dot(ctx, px, py, radius * 0.089, 'rgba(' + color + ',' + level + ')');
          }
        }
        if (heldSet?.has(i)) {
          rim(ctx, x, y, radius * 0.35, 'rgba(168,228,207,.8)', Math.max(1, radius * 0.045));
          dot(ctx, x, y, radius * 0.14, '#c5f3de');
        }
      }
      if (this.canvas.matches(':focus-visible')) {
        ctx.strokeStyle = '#dca56e'; ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, this.width - 2, this.height - 2);
      }
    }

    destroy() {
      this.resetInputs();
      this.listeners.abort();
      this.observer.disconnect();
    }
  }
  window.SpringBoard = SpringBoard;
})();
