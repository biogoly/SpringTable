(() => {
  'use strict';
  const PAD_MM = 19, MAX_WAVES = 128;
  const scale = (code, level) => Math.floor((code*level+127)/255);
  const pulse = (age, peak, width) => {
    const t = age-peak;
    return t < 0 || t >= width ? 0 : Math.floor(255*(width-t)/width);
  };

  // Only discard collinearity within floating-point roundoff. A physically
  // narrow triangle still has two distinct sides for calculating a return.
  function hull(rings) {
    const sorted = rings.slice().sort((a,b)=>a.x-b.x || a.y-b.y)
      .filter((p,i,a)=>!i || p.x!==a[i-1].x || p.y!==a[i-1].y);
    if (sorted.length < 3) return sorted;
    function half(points) {
      const chain = [];
      for (const p of points) {
        while (chain.length > 1) {
          const a = chain[chain.length-2], b = chain[chain.length-1];
          const left = (b.x-a.x)*(p.y-a.y), right = (b.y-a.y)*(p.x-a.x);
          if (left-right > 8*Number.EPSILON*(Math.abs(left)+Math.abs(right))) break;
          chain.pop();
        }
        chain.push(p);
      }
      chain.pop();
      return chain;
    }
    return half(sorted).concat(half(sorted.reverse()));
  }

  class Outline {
    constructor(rings) {
      this.points = hull(rings);
      this.edges = this.points.map((p,i) => {
        const q = this.points[(i+1) % this.points.length];
        return {p, q, nx:p.y-q.y, ny:q.x-p.x};
      });
      // This also covers horizontal and vertical single-row boards.
      if (this.points.length && this.edges.every(e=>!e.nx || !e.ny)) {
        const xs=this.points.map(p=>p.x), ys=this.points.map(p=>p.y);
        this.rect = [Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];
      }
    }

    rayFrom(source) {
      if (this.rect) {
        const [left,right,top,bottom] = this.rect;
        return (dx,dy,d) => {
          const tx = dx ? ((dx>0 ? right : left)-source.x)/dx : Infinity;
          const ty = dy ? ((dy>0 ? bottom : top)-source.y)/dy : Infinity;
          return Math.max(d,Math.min(tx,ty)*d);
        };
      }
      if (this.points.length === 2) {
        const [a,b] = this.points;
        return (dx,dy,d) => Math.max(d, ((a.x-source.x)*dx+(a.y-source.y)*dy)/d,
                                           ((b.x-source.x)*dx+(b.y-source.y)*dy)/d);
      }

      const faces = this.edges.map(e=>({...e, gap:(source.x-e.p.x)*e.nx+(source.y-e.p.y)*e.ny}));
      // On detailed hulls, index edges by angle as seen from this source. A
      // sector includes its neighbors to keep grazing and vertex hits covered.
      const sectors = faces.length > 12 ? this.indexFaces(faces,source) : null;
      return (dx,dy,d) => {
        const candidates = sectors ? sectors[this.sector(dx,dy)] : faces;
        let t = this.exitFactor(candidates,dx,dy);
        if (!Number.isFinite(t) && sectors) t=this.exitFactor(faces,dx,dy);
        return Number.isFinite(t) ? Math.max(d,t*d) : d;
      };
    }

    sector(dx,dy) {
      const n = Math.floor(Math.atan2(dy,dx)*(32/Math.PI));
      return (n+64) % 64;
    }

    indexFaces(faces, source) {
      const sectors = Array.from({length:64},()=>[]);
      for (const face of faces) {
        const ax=face.p.x-source.x, ay=face.p.y-source.y;
        const bx=face.q.x-source.x, by=face.q.y-source.y;
        if ((ax===0 && ay===0) || (bx===0 && by===0)) continue;
        const first = this.sector(ax,ay), last = this.sector(bx,by);
        const count = Math.min(64, ((last-first+64)%64)+3);
        for (let i=0;i<count;i++) sectors[(first-1+i+64)%64].push(face);
      }
      return sectors;
    }

    exitFactor(faces,dx,dy) {
      let t=Infinity;
      for (const {nx,ny,gap} of faces) {
        const du=dx*nx, dv=dy*ny, towards=-(du+dv);
        if (towards > 8*Number.EPSILON*(Math.abs(du)+Math.abs(dv))) t=Math.min(t,gap/towards);
      }
      return t;
    }
  }

  class Reflection {
    constructor(rings, distances) {
      this.rings=rings;
      this.distances=distances;
      this.outline=new Outline(rings);
      this.routes=new Map();
      this.waves=[];
      this.colors=new Uint8Array(rings.length*3);
    }

    route(index) {
      if (this.routes.has(index)) return this.routes.get(index);
      const source=this.rings[index], distances=this.distances[index].radial;
      let farthest=0;
      for (const d of distances) farthest=Math.max(farthest,d);
      const centerPeak=Math.max(220,Math.round((farthest+PAD_MM)*(1000/600+1000/1500)));
      const route = {out:new Uint32Array(distances.length), back:new Uint32Array(distances.length),
                     distances, lifetime:centerPeak+160};
      const exit=this.outline.rayFrom(source);
      for (let i=0;i<distances.length;i++) {
        const d=distances[i];
        route.out[i]=Math.round(d*1000/600);
        if (d===0) { route.back[i]=centerPeak; continue; }
        const dx=this.rings[i].x-source.x, dy=this.rings[i].y-source.y;
        // The hull lies inside the farthest-vertex circle around this source.
        // Clamp roundoff on nearly parallel edges before converting to time.
        const edge=Math.min(farthest,exit(dx,dy,d))+PAD_MM;
        route.back[i]=Math.round((edge/600+(edge-d)/1500)*1000);
      }
      this.routes.set(index,route);
      return route;
    }

    launch(index,color,now) {
      if (this.waves.length===MAX_WAVES) this.waves.shift();
      this.waves.push({born:now>>>0, route:this.route(index), color,
                       echo:color.map(code=>Math.floor((2*code+255)/3))});
    }

    render(now,pixels) {
      const colors=this.colors;
      colors.fill(0);
      let active=0;
      for (const wave of this.waves) {
        const age=(now-wave.born)>>>0, route=wave.route;
        if (age>=route.lifetime) continue;
        this.waves[active++]=wave;
        for (let i=0;i<this.rings.length;i++) {
          const out=pulse(age,route.out[i],140);
          const back=pulse(age,route.back[i],route.distances[i]===0 ? 160 : 100);
          if (!out && !back) continue;
          for (let ch=0;ch<3;ch++) {
            const amount=Math.max(scale(wave.color[ch],out),scale(wave.echo[ch],back));
            const off=i*3+ch;
            colors[off]=Math.min(255,colors[off]+amount);
          }
        }
      }
      this.waves.length=active;
      for (let i=0;i<this.rings.length;i++) {
        const color=colors.subarray(i*3,i*3+3);
        for (let p=0;p<16;p++) pixels.set(color,(i*16+p)*3);
      }
      return active;
    }
  }
  window.SpringReflection=Reflection;
})();
