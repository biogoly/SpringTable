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


  // Integer-millisecond ticks give identical physics across render cadences.
  // Swept contacts within each tick prevent fast balls passing through others.
  const STEP=0.001, DIAMETER=36, PAIR_RESTITUTION=0.9;
  const SLEEP_SPEED2=2*GRAVITY*MIN_APEX, HISTORY=37, EPSILON=1e-9;

  class BouncyBall {
    constructor(rings,palette,seed) {
      this.floor=rings.length?Math.max(...rings.map(r=>r.y))+17:0;
      this.left=rings.length?Math.min(...rings.map(r=>r.x))-17:-17;
      this.right=rings.length?Math.max(...rings.map(r=>r.x))+17:17;
      const top=rings.length?Math.min(...rings.map(r=>r.y)):0;
      // Retire old balls in a continuously replenished pile; normal drops settle
      // earlier. This ceiling scales with the physical height of the layout.
      this.maxLifeMs=Math.max(12000,Math.ceil(trajectory(this.floor-top).lifeSeconds*4000));
      this.palette=palette;this.balls=[];this.lastNow=null;
      this.collisionCount=0;this.contactLimitCount=0;
      this.contacts=new Uint8Array(MAX_BALLS*MAX_BALLS);
      this.blocked=new Uint8Array(MAX_BALLS);
      this.candidates=new Uint8Array(MAX_BALLS*(MAX_BALLS-1)/2);
      this.candidateStarts=new Uint16Array(MAX_BALLS+1);
      this.emitters=new window.SpringEmitters(rings);
      this.peaks=new Float64Array(rings.length*16);
      this.indices=new Uint32Array(this.peaks.length);this.setSeed(seed);
    }
    setSeed(seed){this.seed=(seed>>>0)||0x6d2b79f5;}
    next(){this.seed^=this.seed<<13;this.seed^=this.seed>>>17;this.seed^=this.seed<<5;return this.seed>>>=0;}
    launch(origin,now){
      if(!this.peaks.length)return;
      this.advance(now);
      if(this.balls.length===MAX_BALLS)this.balls.shift();
      this.balls.push({born:now>>>0,age:0,x:origin.x,y:origin.y,vx:0,vy:0,
        grounded:false,quiet:0,fade:-1,brightness:1,historyIndex:0,
        historyX:new Float64Array(HISTORY).fill(origin.x),historyY:new Float64Array(HISTORY).fill(origin.y),
        color:this.palette[this.next()%this.palette.length]});
    }
    constrain(ball){
      ball.x=Math.max(this.left,Math.min(this.right,ball.x));ball.y=Math.min(this.floor,ball.y);
      if(ball.y<this.floor-1e-7)ball.grounded=false;
    }
    separate(){
      // Resolve coincident input without consuming color RNG or kicking apart
      // contacts whose relative velocity already points away from each other.
      for(let pass=0;pass<2;pass++)for(let i=0;i<this.balls.length;i++){
        const a=this.balls[i];
        for(let j=i+1;j<this.balls.length;j++){
          const b=this.balls[j],dx=b.x-a.x,dy=b.y-a.y;
          if(Math.abs(dx)>=DIAMETER||Math.abs(dy)>=DIAMETER)continue;
          const d2=dx*dx+dy*dy;if(d2>=DIAMETER*DIAMETER-1e-7)continue;
          const distance=Math.sqrt(d2),nx=distance>EPSILON?dx/distance:1,ny=distance>EPSILON?dy/distance:0;
          const correction=(DIAMETER-distance+1e-7)*0.5;
          a.x-=nx*correction;a.y-=ny*correction;b.x+=nx*correction;b.y+=ny*correction;
          this.constrain(a);this.constrain(b);
        }
      }
    }
    pairTime(a,b,remaining){
      const dx=b.x-a.x,dy=b.y-a.y,vx=b.vx-a.vx,vy=b.vy-a.vy;
      if(Math.abs(dx)>DIAMETER+Math.abs(vx)*remaining||Math.abs(dy)>DIAMETER+Math.abs(vy)*remaining)return Infinity;
      const approach=dx*vx+dy*vy;if(approach>=-EPSILON)return Infinity;
      const gap=dx*dx+dy*dy-DIAMETER*DIAMETER;if(gap<=1e-7)return 0;
      const speed2=vx*vx+vy*vy,discriminant=approach*approach-speed2*gap;
      if(discriminant<0||speed2<=EPSILON)return Infinity;
      const time=gap/(-approach+Math.sqrt(discriminant));return time<=remaining?time:Infinity;
    }
    impact(a,b){
      const dx=b.x-a.x,dy=b.y-a.y,distance=Math.sqrt(dx*dx+dy*dy);
      const nx=distance>EPSILON?dx/distance:1,ny=distance>EPSILON?dy/distance:0;
      const relative=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;if(relative>=-EPSILON)return;
      // The floor absorbs a downward impulse, while a resting ball remains
      // free to exchange horizontal momentum or be knocked upward.
      const allowYA=a.grounded&&ny<0?0:1,allowYB=b.grounded&&ny>0?0:1;
      const inverseMass=2*nx*nx+(allowYA+allowYB)*ny*ny;
      if(inverseMass<=EPSILON)return;
      const impulse=-(1+PAIR_RESTITUTION)*relative/inverseMass;
      a.vx-=impulse*nx;a.vy-=impulse*ny*allowYA;
      b.vx+=impulse*nx;b.vy+=impulse*ny*allowYB;
      for(const ball of [a,b]){
        if(Math.abs(ball.vy)>EPSILON)ball.grounded=false;
        if(ball.vx*ball.vx+ball.vy*ball.vy>SLEEP_SPEED2){ball.quiet=0;ball.fade=-1;}
      }
      this.collisionCount++;
    }
    tick(){
      this.contacts.fill(0);
      this.blocked.fill(0);
      this.separate();
      for(const ball of this.balls){if(ball.grounded)ball.vx*=0.996;else ball.vy+=GRAVITY*STEP*0.5;}
      // Impacts cannot increase total kinetic energy. Even after a redirected
      // hit, no ball can travel farther than this energy bound within one tick.
      let speed2=0;
      for(const ball of this.balls)speed2+=ball.vx*ball.vx+ball.vy*ball.vy;
      const reach=DIAMETER+2*Math.sqrt(speed2)*STEP+1e-7,reach2=reach*reach;
      let candidateCount=0;
      for(let i=0;i<this.balls.length;i++){
        this.candidateStarts[i]=candidateCount;
        for(let j=i+1;j<this.balls.length;j++){
          const dx=this.balls[j].x-this.balls[i].x,dy=this.balls[j].y-this.balls[i].y;
          if(dx*dx+dy*dy<=reach2)this.candidates[candidateCount++]=j;
        }
      }
      this.candidateStarts[this.balls.length]=candidateCount;
      let remaining=STEP,events=0;const limit=this.balls.length*2+8;
      while(remaining>EPSILON){
        let soonest=remaining+EPSILON,first=-1,second=-1,wall=0;
        for(let i=0;i<this.balls.length;i++){
          if(this.blocked[i])continue;
          const ball=this.balls[i];let t=Infinity,side=0;
          if(ball.vx<-EPSILON){t=Math.max(0,(this.left-ball.x)/ball.vx);side=-1;}
          else if(ball.vx>EPSILON){t=Math.max(0,(this.right-ball.x)/ball.vx);side=1;}
          if(t<=remaining&&t<soonest){soonest=t;first=i;second=-1;wall=side;}
          if(ball.vy>EPSILON){t=Math.max(0,(this.floor-ball.y)/ball.vy);if(t<=remaining&&t<soonest){soonest=t;first=i;second=-1;wall=2;}}
          for(let pair=this.candidateStarts[i];pair<this.candidateStarts[i+1];pair++){
            const j=this.candidates[pair];
            if(this.blocked[j])continue;
            t=this.pairTime(ball,this.balls[j],Math.min(remaining,soonest));
            if(t<EPSILON&&this.contacts[i*MAX_BALLS+j])continue;
            if(t<soonest){soonest=t;first=i;second=j;wall=0;}
          }
        }
        const duration=first<0?remaining:soonest;
        for(let i=0;i<this.balls.length;i++)if(!this.blocked[i]){
          const ball=this.balls[i];ball.x+=ball.vx*duration;ball.y+=ball.vy*duration;
        }
        remaining=Math.max(0,remaining-duration);if(first<0)break;
        const ball=this.balls[first];
        if(second>=0){this.impact(ball,this.balls[second]);this.contacts[first*MAX_BALLS+second]=1;}
        else if(wall===2){
          ball.y=this.floor;ball.vy=-ball.vy*RESTITUTION;ball.vx*=0.9;
          ball.brightness=Math.max(0.12,ball.brightness*Math.sqrt(RESTITUTION));
          if(ball.vy*ball.vy<SLEEP_SPEED2){ball.vy=0;ball.grounded=true;}
        }else{ball.x=wall<0?this.left:this.right;ball.vx=-ball.vx*RESTITUTION;}
        if(++events>=limit){
          // Contain a jam to its contact participants for the rest of this tick.
          // Unrelated balls keep advancing under gravity without global damping.
          for(const index of second<0?[first]:[first,second]){
            this.blocked[index]=1;this.balls[index].vx*=0.5;this.balls[index].vy*=0.5;
          }
          this.contactLimitCount++;
        }
      }
      let active=0;
      for(const ball of this.balls){
        if(!ball.grounded)ball.vy+=GRAVITY*STEP*0.5;
        this.constrain(ball);ball.age++;
        const speed2=ball.vx*ball.vx+ball.vy*ball.vy;
        if(speed2<SLEEP_SPEED2)ball.quiet++;else{ball.quiet=0;ball.fade=-1;}
        if(ball.quiet>=120&&ball.fade<0)ball.fade=0;
        if(ball.fade>=0)ball.fade++;
        ball.historyIndex=(ball.historyIndex+1)%HISTORY;
        ball.historyX[ball.historyIndex]=ball.x;ball.historyY[ball.historyIndex]=ball.y;
        if(ball.age<this.maxLifeMs&&ball.fade<400)this.balls[active++]=ball;
      }
      this.balls.length=active;
    }
    advance(now){
      now>>>=0;if(this.lastNow===null){this.lastNow=now;return;}
      const elapsed=(now-this.lastNow)>>>0;this.lastNow=now;
      if(elapsed>=this.maxLifeMs){this.balls.length=0;return;}
      for(let ms=0;ms<elapsed&&this.balls.length;ms++)this.tick();
    }
    render(now,pixels){
      this.advance(now);
      for(const ball of this.balls){
        const fade=ball.fade<0?1:Math.max(0,1-ball.fade/400);
        const lifetimeFade=Math.min(1,(this.maxLifeMs-ball.age)/400),brightness=ball.brightness*fade*lifetimeFade;
        let count=0;
        for(let tap=0;tap<TAP_DELAYS.length&&ball.age>=TAP_DELAYS[tap];tap++){
          const h=(ball.historyIndex-TAP_DELAYS[tap]+HISTORY)%HISTORY;
          this.emitters.spot(ball.historyX[h],ball.historyY[h],LIGHT_RADIUS,(index,base)=>{
            const strength=base*TAP_WEIGHTS[tap];if(strength<=this.peaks[index])return;
            if(!this.peaks[index])this.indices[count++]=index;this.peaks[index]=strength;
          });
        }
        for(let j=0;j<count;j++){
          const index=this.indices[j],strength=this.peaks[index]*brightness;this.peaks[index]=0;
          for(let channel=0;channel<3;channel++){
            const offset=index*3+channel;pixels[offset]=Math.min(255,pixels[offset]+Math.round(ball.color[channel]*strength));
          }
        }
      }
      return this.balls.length;
    }
  }

  BouncyBall.trajectory = trajectory;
  BouncyBall.sample = sample;
  window.SpringBouncyBall = BouncyBall;
})();
