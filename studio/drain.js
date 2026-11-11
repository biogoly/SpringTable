(() => {
  'use strict';
  const ORBIT_MS = 1800, FLASH_HOLD_MS = 80, FLASH_FADE_MS = 360;
  const LIFE = ORBIT_MS + FLASH_HOLD_MS + FLASH_FADE_MS, MAX_ORBITS = 128;
  const TAP_DELAYS = [0,45,90], TAP_WEIGHTS = [1,0.55,0.23];
  const mid = 17 * Math.sin(Math.PI / 4), low = 17 * Math.sin(Math.PI / 8);
  const high = 17 * Math.sin(3 * Math.PI / 8);
  const offsets = [0,low,mid,high,17,high,mid,low,0,-low,-mid,-high,-17,-high,-mid,-low];
  const boxDistance = (node, x, y) => {
    const dx = Math.max(0, node.left-x, x-node.right);
    const dy = Math.max(0, node.top-y, y-node.bottom);
    return dx*dx + dy*dy;
  };

  // An orbit can cross empty space away from any ring. A bounded spatial
  // search finds the nearest actual LED and then the complete illuminated
  // neighborhood, even for hollow circles and widely separated islands.
  class Emitters {
    constructor(rings) {
      const n = rings.length*16;
      this.x = new Float64Array(n);
      this.y = new Float64Array(n);
      for (let i=0; i<n; i++) {
        const ring = rings[i >> 4];
        this.x[i] = ring.x+offsets[i & 15];
        this.y[i] = ring.y-offsets[(i+4) & 15];
      }
      this.root = n ? this.partition(Array.from({length:n}, (_,i)=>i)) : null;
    }

    partition(indices) {
      const node = {left:Infinity, right:-Infinity, top:Infinity, bottom:-Infinity};
      for (const i of indices) {
        node.left = Math.min(node.left,this.x[i]); node.right = Math.max(node.right,this.x[i]);
        node.top = Math.min(node.top,this.y[i]); node.bottom = Math.max(node.bottom,this.y[i]);
      }
      if (indices.length <= 16) node.indices = indices;
      else {
        const coord = node.right-node.left >= node.bottom-node.top ? this.x : this.y;
        indices.sort((a,b)=>coord[a]-coord[b]);
        const split = indices.length >> 1;
        node.a = this.partition(indices.slice(0,split));
        node.b = this.partition(indices.slice(split));
      }
      return node;
    }

    nearest(node, x, y, best) {
      if (boxDistance(node,x,y) >= best) return best;
      if (node.indices) {
        for (const i of node.indices) {
          const dx = this.x[i]-x, dy = this.y[i]-y;
          best = Math.min(best,dx*dx+dy*dy);
        }
        return best;
      }
      // Visit the nearer child first so its result prunes the farther one.
      const aFirst = boxDistance(node.a,x,y) <= boxDistance(node.b,x,y);
      best = this.nearest(aFirst ? node.a : node.b,x,y,best);
      return this.nearest(aFirst ? node.b : node.a,x,y,best);
    }

    matching(node, x, y, limit, visit) {
      if (boxDistance(node,x,y) >= limit) return;
      if (node.indices) {
        for (const i of node.indices) {
          const dx = this.x[i]-x, dy = this.y[i]-y, d2 = dx*dx+dy*dy;
          if (d2 < limit) visit(i,d2);
        }
      } else {
        this.matching(node.a,x,y,limit,visit);
        this.matching(node.b,x,y,limit,visit);
      }
    }

    spot(x, y, width, visit) {
      if (!this.root) return;
      const nearest = this.nearest(this.root,x,y,Infinity);
      const width2 = width*width;
      this.matching(this.root,x,y,nearest+width2,(i,d2)=>visit(i,1-(d2-nearest)/width2));
    }
  }

  class Drain {
    constructor(rings) {
      let left=Infinity, right=-Infinity, top=Infinity, bottom=-Infinity;
      for (const r of rings) {
        left=Math.min(left,r.x); right=Math.max(right,r.x);
        top=Math.min(top,r.y); bottom=Math.max(bottom,r.y);
      }
      this.cx = rings.length ? (left+right)/2 : 0;
      this.cy = rings.length ? (top+bottom)/2 : 0;
      this.orbits = [];
      this.emitters = new Emitters(rings);
      this.peaks = new Float64Array(rings.length*16);
      this.indices = new Uint32Array(this.peaks.length);
      this.flash = [];
      this.emitters.spot(this.cx,this.cy,32,(i,strength)=>this.flash.push({i,strength}));
    }

    launch(ring, color, now) {
      const dx = ring.x-this.cx, dy = ring.y-this.cy;
      const r = Math.hypot(dx,dy), central = r < 1e-6;
      if (this.orbits.length === MAX_ORBITS) this.orbits.shift();
      this.orbits.push({born:now >>> 0, color, radius:central ? 17 : r,
                        theta:central ? -Math.PI/2 : Math.atan2(dy,dx)});
    }

    comet(orbit, age, pixels) {
      let count = 0;
      for (let tap=0; tap<TAP_DELAYS.length && age>=TAP_DELAYS[tap]; tap++) {
        const u = (age-TAP_DELAYS[tap])/ORBIT_MS;
        const r = orbit.radius*(1-u);
        const theta = orbit.theta + 2*Math.PI*(0.9*u + 2.25*u*u);
        const x = this.cx+r*Math.cos(theta), y = this.cy+r*Math.sin(theta);
        const width = 20+Math.min(26,0.10*r);
        this.emitters.spot(x,y,width,(i,base)=>{
          const strength = base*TAP_WEIGHTS[tap];
          if (strength <= this.peaks[i]) return;
          if (!this.peaks[i]) this.indices[count++] = i;
          this.peaks[i] = strength;
        });
      }
      for (let j=0; j<count; j++) {
        const i = this.indices[j], strength = this.peaks[i];
        this.peaks[i] = 0;
        for (let ch=0; ch<3; ch++) {
          const off=i*3+ch;
          pixels[off] = Math.min(255,pixels[off]+Math.round(orbit.color[ch]*strength));
        }
      }
    }

    render(now, pixels) {
      let active = 0;
      for (const orbit of this.orbits) {
        const age = (now-orbit.born) >>> 0;
        if (age >= LIFE) continue;
        this.orbits[active++] = orbit;
        if (age < ORBIT_MS) this.comet(orbit,age,pixels);
        else {
          const fade = Math.min(1,(LIFE-age)/FLASH_FADE_MS);
          for (const {i,strength} of this.flash) {
            const white = Math.round(255*strength*fade), offset = i*3;
            for (let ch=0; ch<3; ch++) pixels[offset+ch] = Math.min(255,pixels[offset+ch]+white);
          }
        }
      }
      this.orbits.length = active;
      return active;
    }
  }
  window.SpringDrain = Drain;
})();
