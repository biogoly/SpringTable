(() => {
  'use strict';
  const PERIOD = 400, PACKET_MS = 1600, MAX_PACKETS = 128;
  const DEFAULT_COLORS = Object.freeze({crest:Object.freeze([40,210,255]), trough:Object.freeze([95,65,190])});

  function rgbTriplet(value) {
    if (!(Array.isArray(value) || ArrayBuffer.isView(value)) || value.length !== 3) {
      throw new RangeError('An interference color needs three RGB channel codes');
    }
    const copy = Array.from(value);
    if (!copy.every(code => Number.isInteger(code) && code >= 0 && code <= 255)) {
      throw new RangeError('Interference RGB channel codes must be integers from 0 to 255');
    }
    return Object.freeze(copy);
  }

  function hueRGB(hue) {
    const m = Math.floor((223*(hue%256)+127)/255);
    const up=32+m, down=255-m;
    switch (Math.floor(hue/256)) {
      case 0: return [255,up,32];
      case 1: return [down,255,32];
      case 2: return [32,255,up];
      case 3: return [32,down,255];
      case 4: return [up,32,255];
      default: return [255,32,down];
    }
  }

  const equalRGB = (a,b) => a[0]===b[0] && a[1]===b[1] && a[2]===b[2];

  class GroupPalette {
    constructor(manual = DEFAULT_COLORS) {
      this.manual = this.current = manual;
      this.random = false;
      this.seed = null;
      this.lastHue = null;
      this.group = null;
    }

    setSeed(seed) {
      this.seed = (seed >>> 0) || 0x6d2b79f5;
      this.lastHue = this.group = null;
    }

    nextWord() {
      if (this.seed === null) {
        const word = globalThis.crypto?.getRandomValues(new Uint32Array(1))[0] ??
                     Math.floor(Math.random()*0x100000000);
        this.seed = word || 0x6d2b79f5;
      }
      let x = this.seed;
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return this.seed = x >>> 0;
    }

    roll() {
      const word=this.nextWord();
      let h = this.lastHue===null ? word%1536 : (this.lastHue+384+word%769)%1536;
      let other = (h+640+this.nextWord()%257)%1536;
      let crest=hueRGB(h), trough=hueRGB(other);
      while (equalRGB(crest,this.current.crest) || equalRGB(trough,this.current.trough)) {
        h=(h+384)%1536; other=(other+384)%1536;
        crest=hueRGB(h); trough=hueRGB(other);
      }
      this.lastHue=h;
      this.current=Object.freeze({crest:Object.freeze(crest),trough:Object.freeze(trough)});
    }

    edge(index, now, otherHeld) {
      if (!this.random) return this.manual;
      const group=this.group;
      if (!group || (!otherHeld && (group.multiple || index===group.first ||
                                    ((now-group.start)>>>0)>=250))) {
        this.roll();
        this.group={first:index,start:now>>>0,multiple:false};
      } else if (index!==group.first) group.multiple=true;
      return this.current;
    }
  }

  // Mirror one quarter-cycle so equal-strength samples half a period apart
  // cancel exactly. Fade rounding treats crests and troughs symmetrically.
  const quarter = Int16Array.from({length:101}, (_,i)=>
    Math.floor(120*Math.cos(Math.PI*i/200)+0.5));
  const packet = Int16Array.from({length:PACKET_MS}, (_,t)=>{
    const p=t%PERIOD;
    let v;
    if (p<100) v=quarter[p];
    else if (p<200) v=-quarter[200-p];
    else if (p<300) v=-quarter[p-200];
    else v=quarter[400-p];
    const envelope=Math.min(400,PACKET_MS-t);
    return Math.sign(v)*Math.floor((Math.abs(v)*envelope+200)/400);
  });

  class Interference {
    static newPalette(manual) { return new GroupPalette(manual); }

    static colors(crest, trough) {
      return Object.freeze({crest:rgbTriplet(crest), trough:rgbTriplet(trough)});
    }

    constructor(distances, reflection = null) {
      this.distances=distances;
      this.reflection=reflection;
      this.routes=new Map();
      this.waves=[];
      // At most 128 direct and 128 returned packets of magnitude 120
      // reach a ring together, for a signed peak of 30,720.
      this.sums=new Int16Array(distances.length);
      this.weights=null;
    }

    route(index) {
      if (this.routes.has(index)) return this.routes.get(index);
      const reflectedRoute=this.reflection?.route(index);
      const delays=reflectedRoute ? reflectedRoute.out :
        Uint32Array.from(this.distances[index].radial,d=>Math.round(d*1000/600));
      const returns=reflectedRoute?.back;
      let farthest=0;
      // Each returned path includes the outbound path plus the distance
      // traveled after the bounce. Its last arrival determines the lifetime.
      for (const delay of returns ?? delays) farthest=Math.max(farthest,delay);
      const route={delays,returns,lifetime:farthest+PACKET_MS};
      this.routes.set(index,route);
      return route;
    }

    launch(index,now,colors) {
      if (this.waves.length===MAX_PACKETS) this.waves.shift();
      this.waves.push({born:now>>>0,route:this.route(index),colors});
    }

    render(now,pixels,colors = DEFAULT_COLORS,random = false) {
      this.sums.fill(0);
      // Each ring uses two groups of four integers: total amplitude, then
      // amplitude-weighted R/G/B. Clearing is only needed in random mode.
      let weights=null;
      if (random) {
        if (!this.weights) this.weights=new Uint32Array(this.sums.length*8);
        weights=this.weights;
        weights.fill(0);
      }
      let active=0;
      for (const wave of this.waves) {
        const age=(now-wave.born)>>>0;
        if (age>=wave.route.lifetime) continue;
        this.waves[active++]=wave;
        const {delays,returns}=wave.route;
        for (let i=0;i<delays.length;i++) {
          const localTime=age-delays[i];
          let v=localTime>=0 && localTime<PACKET_MS ? packet[localTime] : 0;
          if (returns) {
            const echoTime=age-returns[i];
            if (echoTime>=0 && echoTime<PACKET_MS) v+=packet[echoTime];
          }
          this.sums[i]+=v;
          if (weights && v) {
            const off=i*8+(v<0 ? 4 : 0), w=Math.abs(v);
            const tint=v>0 ? wave.colors.crest : wave.colors.trough;
            weights[off]+=w;
            weights[off+1]+=w*tint[0]; weights[off+2]+=w*tint[1]; weights[off+3]+=w*tint[2];
          }
        }
      }
      this.waves.length=active;
      for (let i=0;i<this.sums.length;i++) {
        const sum=this.sums[i];
        if (!sum) continue; // Scene supplies a cleared frame.
        const level=Math.min(255,Math.abs(sum));
        let r,g,b;
        if (weights) {
          const off=i*8+(sum<0 ? 4 : 0);
          const denominator=255*weights[off];
          r=Math.round(level*weights[off+1]/denominator);
          g=Math.round(level*weights[off+2]/denominator);
          b=Math.round(level*weights[off+3]/denominator);
        } else {
          const tint=sum>0 ? colors.crest : colors.trough;
          r=Math.floor((tint[0]*level+127)/255);
          g=Math.floor((tint[1]*level+127)/255);
          b=Math.floor((tint[2]*level+127)/255);
        }
        for (let p=0, off=i*48; p<16; p++,off+=3) {
          pixels[off]=r; pixels[off+1]=g; pixels[off+2]=b;
        }
      }
      return active;
    }
  }
  window.SpringInterference=Interference;
})();
