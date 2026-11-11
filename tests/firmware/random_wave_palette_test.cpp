#include "../../SpringTable/Effects.h"
#include <algorithm>
#include <cassert>
#include <cmath>
#include <cstdio>
#include <vector>
using RGB=fx::Color;
using Pair=interference::Pair<RGB>;
using Bench=fx::Scene<1,3>;
const Pair manual{{40,210,255},{95,65,190}}, firstPair{{255,61,32},{32,114,255}},
           secondPair{{112,32,255},{68,255,32}}, thirdPair{{32,255,72},{255,32,166}};
static bool eq(RGB x,RGB y){return x.r==y.r&&x.g==y.g&&x.b==y.b;}
static bool eq(Pair x,Pair y){return eq(x.crest,y.crest)&&eq(x.trough,y.trough);}
static Pair latest(Bench &s){Pair p; s.getInterferenceColors(p.crest,p.trough);return p;}
static void enter(Bench &s,unsigned mode=10) {
  s.resetInterferenceColors(); s.setMode(uint8_t(mode));s.setInterferencePaletteSeed(1);s.setInterferenceRandom(true);
}
static int amplitude(int t) {
  if (t<0||t>=1600) return 0;
  double v=std::cos(2*std::acos(-1.)*t/400.);
  int mag=(int(std::lround(120*std::abs(v)))*std::min(400,1600-t)+200)/400;
  return v<0?-mag:mag;
}
struct Source {int born,origin; Pair colors;};
static RGB oracle(const std::vector<Source> &sources,int mode,int ring,int now) {
  // Direct + return distances on an independently tabulated 1x3 fixture.
  const int returns[][3]={{324,284,244},{144,220,144},{244,284,324}};
  int total=0;
  int weights[2]={};uint64_t channels[2][3]={};
  for(size_t j=sources.size()>128?sources.size()-128:0; j<sources.size();++j){
    const auto &src=sources[j]; int t=now-src.born;
    int v=amplitude(t-100*std::abs(src.origin-ring));
    if(mode==11)v+=amplitude(t-returns[src.origin][ring]);
    total+=v; const int side=v<0;
    RGB color=side?src.colors.trough:src.colors.crest;
    int w=std::abs(v);weights[side]+=w;
    channels[side][0]+=w*color.r;channels[side][1]+=w*color.g;channels[side][2]+=w*color.b;
  }
  if(!total)return {};
  int side=total<0;
  auto channel=[&](unsigned ch){return uint8_t(std::lround(
       std::min(255,std::abs(total))*double(channels[side][ch])/(255.*weights[side])));};
  return {channel(0),channel(1),channel(2)};
}
static void grouping() {
  Bench s;enter(s);
  assert(eq(latest(s),manual));s.beginInterferenceGroup();assert(eq(latest(s),manual));
  s.press(0,0,100);assert(eq(latest(s),firstPair));
  s.press(0,0,700);s.setInterferenceRandom(true);assert(eq(latest(s),firstPair));
  s.press(0,1,800);assert(eq(latest(s),firstPair));
  s.release(0,1);s.release(0,0);s.press(0,2,801);assert(eq(latest(s),secondPair));
  s.release(0,2);s.press(0,0,1050);assert(eq(latest(s),secondPair)); // different ring, 249 ms
  s.release(0,0);s.press(0,1,1060);assert(eq(latest(s),thirdPair));
  s.setMode(11);s.press(0,2,1061);assert(!eq(latest(s),thirdPair)); // another key was still held
  s.setInterferenceRandom(false);assert(eq(latest(s),manual));
  s.setInterferenceColors({20,30,40},{50,60,70});s.setInterferenceRandom(true);
  s.setInterferenceRandom(false);assert(eq(latest(s),{{20,30,40},{50,60,70}}));
  s.resetInterferenceColors();assert(eq(latest(s),manual)&&!s.getInterferenceRandom());

  Bench edge;enter(edge);const uint32_t t=UINT32_MAX-100;
  edge.press(0,0,t);edge.release(0,0);edge.press(0,1,t+250);assert(eq(latest(edge),secondPair));
  edge.release(0,1);edge.press(0,1,t+251);assert(eq(latest(edge),thirdPair)); // same spring

  Bench collision;collision.setInterferenceColors(firstPair.crest,{1,2,3});collision.setMode(10);
  collision.setInterferencePaletteSeed(1);collision.setInterferenceRandom(true);collision.press(0,0,0);
  assert(eq(latest(collision),{{114,255,32},{255,32,226}}));
  Bench twice;twice.setInterferenceColors(firstPair.crest,{255,32,226});twice.setMode(10);
  twice.setInterferencePaletteSeed(1);twice.setInterferenceRandom(true);twice.press(0,0,0);
  assert(eq(latest(twice),{{32,226,255},{255,173,32}}));
  Bench zero;enter(zero);zero.setInterferencePaletteSeed(0);
  zero.press(0,0,0);assert(eq(latest(zero),{{255,32,228},{35,255,32}}));
}
static unsigned overlap(unsigned mode) {
  Bench s;enter(s,mode);std::vector<Source> src;
  const uint32_t base=UINT32_MAX-30;
  for(int i:{0,2}) {
    s.beginInterferenceGroup();s.press(0,i,base);s.release(0,i);
    src.push_back({0,i,latest(s)});
  }
  assert(eq(src[0].colors,firstPair)&&eq(src[1].colors,secondPair));
  unsigned n=0;
  auto compare=[&](int t) {
    s.frame(base+t);
    for(int ring=0;ring<3;++ring){
      RGB want=oracle(src,mode,ring,t);
      for(int p=0;p<16;++p){
        const RGB got=s.pixel(0,ring,p,base+t);
        if(!eq(got,want)){std::fprintf(stderr,"mode %u, t=%d, ring %d: %d/%d/%d expected %d/%d/%d\n",
             mode,t,ring,got.r,got.g,got.b,want.r,want.g,want.b);std::abort();}
        n+=3;
      }
    }
  };
  for(int t=0;t<1950;++t)compare(t);
  if(mode==10){assert(eq(oracle(src,mode,0,400),{}));assert(eq(oracle(src,mode,1,500),{173,44,135}));}
  else assert(eq(oracle(src,mode,1,292),{}));
  for(int i=0;i<156;++i) {
    int ring=i%3,t=2500+i*3;
    s.beginInterferenceGroup();s.press(0,ring,base+t);s.release(0,ring);
    src.push_back({t,ring,latest(s)});
  }
  for(int t=3000;t<5050;t+=7)compare(t);
  return n;
}
static void transition() {
  Bench aScene,fixed; aScene.resetInterferenceColors();fixed.resetInterferenceColors();
  for(Bench *s:{&aScene,&fixed}){s->setMode(10);s->press(0,0,0);s->release(0,0);s->frame(31);}
  aScene.setInterferenceRandom(true);
  for(int t:{31,69,100,240}){
    aScene.frame(t);fixed.frame(t);
    for(int c=0;c<3;++c)assert(eq(aScene.pixel(0,c,0,t),fixed.pixel(0,c,0,t)));
  }
  aScene.setInterferencePaletteSeed(1); aScene.press(0,2,242);fixed.press(0,2,242);
  aScene.setInterferenceRandom(false);aScene.frame(284);fixed.frame(284);
  for(int c=0;c<3;++c)assert(eq(aScene.pixel(0,c,0,284),fixed.pixel(0,c,0,284)));
  aScene.setInterferenceRandom(true);aScene.frame(300);fixed.frame(300);
  for(int c=0;c<3;++c)assert(eq(aScene.pixel(0,c,0,300),fixed.pixel(0,c,0,300)));
  aScene.setInterferenceColors({6,9,20},{0,80,13});fixed.setInterferenceColors({6,9,20},{0,80,13});
  assert(!aScene.getInterferenceRandom());
  for(int t:{300,600,900}){
    aScene.frame(t);fixed.frame(t);
    for(int c=0;c<3;++c)assert(eq(aScene.pixel(0,c,0,t),fixed.pixel(0,c,0,t)));
  }
}
int main() {
  Bench s;
  assert(s.getInterferenceRandom() == cfg::InterferenceRandomPerPair);
  grouping(); transition();unsigned n=overlap(10)+overlap(11);
  std::printf("%u channel values match signed color oracle; seed, forced group, wrap, stored colors, option transitions, all signs, 128 oldest passed.\n",n);
}
