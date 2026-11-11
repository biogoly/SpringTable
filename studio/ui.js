(() => {
  "use strict";
  const $=id=>document.getElementById(id);
  const icons={folder:"M3 6h6l2 2h10v10H3z",download:"M12 3v11m-4-4 4 4 4-4M4 15v5h16v-5",play:"m8 5 11 7-11 7z",pause:"M8 5v14M16 5v14",layout:"M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",wave:"M2 12h4l3-8 5 16 3-8h5",sliders:"M3 7h7m4 0h7M3 17h11m4 0h3M10 4v6m5 4v6",pointer:"m5 3 14 11-7 1-3 7z",touch:"M9 15V7a2 2 0 0 1 4 0v6l2-2 5 3-2 7h-7l-6-7 2-2z",move:"M12 2v20M2 12h20M9 5l3-3 3 3M9 19l3 3 3-3M5 9l-3 3 3 3M19 9l3 3-3 3",plus:"M12 5v14M5 12h14",minus:"M4 12h16",undo:"M8 4 3 9l5 5M3 9h11a6 6 0 0 1 0 12"};
  const drawIcon=name=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+icons[name]+'"/></svg>';
  document.querySelectorAll("[data-icon]").forEach(el=>el.innerHTML=drawIcon(el.dataset.icon));
  const modes=["Ripple","Spinner","Solid","Confetti","Three-dot gear","Fire","Surface","Ricochet","Drain","Reflection","Interference","Reflected Interference"];
  const descriptions=["A colored wave spreads from each spring to its neighbors.","A comet circles the touched ring and fades after release.","Touched rings hold their color, then fade out.","Color sparks scatter around each touched ring.","Three bright teeth rotate around the touched ring.","Amber embers flicker across the touched ring.","A square wave expands around each touch.","Each pluck launches a colored ball. It rebounds off the outer edge, leaves a short trail, and fades. Brush several springs to fill the table.","A colored trail spirals inward from each pluck. It spins faster as it tightens, flashes white at the center, then fades to black.","A ripple spreads to the outer edges. A paler echo races back to the spring you touched."];
  descriptions.push("Each spring sends a train of ripples. Crests and troughs take the two palette colors. Equal, opposite waves cancel to black.");
  descriptions.push("Each ripple bounces once at the edge. Returning crests strengthen outgoing crests and cancel equal troughs. Pick two springs to launch both together.");
  const usesPairedWaves = mode => mode==="10" || mode==="11";
  const shapeNames={grid:"Grid",hex:"Hex lattice",circle:"Circle",spiral:"Spiral",custom:"Custom"};
  const key="springtable-studio-project-v1";
  let project=defaultProject(), restored=false;
  try{const saved=localStorage.getItem(key);if(saved){project=validateProject(JSON.parse(saved));restored=true;}}catch{}
  let selected=0,pixel=0,tab="play",tool="move",custom=null,scene,sceneDirty=true;
  let simNow=0,prevReal=performance.now(),paused=false,demo=false,all=false,lastDemoBeat=-1,demoStart=0;
  let labIndex=-1,lastPaint=0,frameResult=null,saveTimer=0,noticeTimer=0,dragUndo=false;
  let pairFirst=null; // null: normal input; -1: waiting for the first of two picks
  const contacts=new Map(),history=[];
  function notice(msg){$("message").textContent=msg;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$("message").textContent="",6000);}
  function remember(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(key,JSON.stringify(project));}catch{notice("Use Save project to keep this session.");}},250);}
  function flushSave(){clearTimeout(saveTimer);try{localStorage.setItem(key,JSON.stringify(project));}catch{}}
  window.addEventListener("pagehide",flushSave);
  function select(index){selected=Math.max(0,Math.min(project.rings.length-1,index));board.setSelected(selected);updateSelection();}
  const board=new SpringBoard($("board"),{
    onPress(i){if(tab==="layout")return;if(demo)stopDemo(true);setContact(i,"pointer",true);},
    onRelease(i){setContact(i,"pointer",false);},
    onSelect(i){if(i>=0)select(i);},
    onPick(i){pickSpring(i);},
    onMove(i,x,y){if(!dragUndo){snapshot();dragUndo=true;}moveRing(i,x,y,false);},
    onAdd(x,y){addRing(x,y);}
  });
  $("board").addEventListener("pointerdown",()=>dragUndo=false,true);
  function applySceneColors(){
    const colors=project.interferenceColors??palettePresets[0];
    const channels=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
    scene.setInterferenceColors(channels(colors.crest),channels(colors.trough));
    scene.setInterferenceRandom(project.interferencePaletteMode==="random");
  }
  function syncPaletteControls(){
    const colors=project.interferenceColors??palettePresets[0];
    const preset=palettePresets.find(p=>p.crest===colors.crest && p.trough===colors.trough);
    const random=project.interferencePaletteMode==="random";
    $("wave-palette").value=random?"random":(preset?.id??"custom");
    $("random-palette-hint").hidden=!random;
    $("keep-colors").hidden=!random;
    for(const phase of ["crest","trough"]){
      const hex=colors[phase];
      if($(phase+"-color").value!==hex)$(phase+"-color").value=hex;
      $(phase+"-hex").textContent=hex.toUpperCase();
    }
    $("teensy-palette").textContent=random?"palette random":
      "palette "+colors.crest.slice(1).toUpperCase()+" "+colors.trough.slice(1).toUpperCase();
  }
  function changeColors(colors){
    setProjectColors(project,colors);
    delete project.interferencePaletteMode;
    if(scene)applySceneColors();
    syncPaletteControls();remember();
  }
  function captureRandomColors(){
    if(project.interferencePaletteMode!=="random" || !usesPairedWaves(project.mode))return;
    const live=scene.getInterferenceColors();
    const hex=channels=>"#"+channels.map(code=>code.toString(16).padStart(2,"0")).join("");
    const crest=hex(live.crest),trough=hex(live.trough);
    const displayed=project.interferenceColors??palettePresets[0];
    if(crest===displayed.crest && trough===displayed.trough)return;
    setProjectColors(project,{crest,trough});syncPaletteControls();remember();
  }
  function ensureScene(){
    if(sceneDirty){scene=new SpringEngine.Scene(project.rings);applySceneColors();sceneDirty=false;contacts.clear();}
    scene.setMode(project.mode[0]==="u"?0:Number(project.mode));
  }
  function setContact(i,source,on){
    if(i<0||i>=project.rings.length)return;
    ensureScene();let sources=contacts.get(i);
    if(on){
      if(!sources){
        sources=new Set();contacts.set(i,sources);scene.press(i,Math.floor(simNow));
        captureRandomColors();
      }
      sources.add(source);
    }
    else if(sources){sources.delete(source);if(!sources.size){contacts.delete(i);scene.release(i);}}
  }
  function releaseSource(source){for(const i of [...contacts.keys()])setContact(i,source,false);}
  function cancelPair(){
    if(pairFirst===null)return;
    pairFirst=null;board.setTool(tab==="layout"?tool:"play");updateActions();
  }
  function pickSpring(i){
    if(pairFirst===null)return;
    if(pairFirst===-1){pairFirst=i;updateActions();notice("First spring selected. Choose a different spring.");return;}
    if(i===pairFirst){notice("Choose a different spring for the second ripple.");return;}
    const first=pairFirst;
    cancelPair();
    // Both edges use the same simulation timestamp, including while paused.
    ensureScene();scene.beginInterferenceGroup();
    for(const index of [first,i])setContact(index,"pair",true);
    for(const index of [first,i])setContact(index,"pair",false);
    notice("Simultaneous plucks on rings "+(first+1)+" and "+(i+1)+".");
  }
  function resetScene(){contacts.clear();sceneDirty=true;all=false;updateActions();}
  function setActive(id){
    cancelPair();
    if(demo && id!==project.mode){releaseSource("demo");lastDemoBeat=-1;demoStart=simNow;}
    project.mode=id;custom=id[0]==="u"?runtimePattern(project.patterns[Number(id.slice(1))]):null;
    if(scene)scene.setMode(id[0]==="u"?0:Number(id));
    $("pattern").value=id;
    $("effect-count").hidden=!["7","8","9"].includes(id) && !usesPairedWaves(id);
    $("pick-pair").hidden=!usesPairedWaves(id);
    $("pick-pair").disabled=project.rings.length<2;
    $("interference-colors").hidden=!usesPairedWaves(id);
    if(usesPairedWaves(id))syncPaletteControls();
    $("pattern-info").textContent=id[0]==="u"?(custom.kind==="wave"?"A custom touch wave from the pattern lab.":"A custom pattern evaluated separately for every LED."):descriptions[Number(id)];
  }
  function option(value,label){const opt=document.createElement("option");opt.value=value;opt.textContent=label;return opt;}
  function patternMenus(){
    const select=$("pattern"),drafts=$("drafts");select.replaceChildren();drafts.replaceChildren(option("-1","Create a pattern"));
    modes.forEach((name,i)=>select.append(option(String(i),name)));
    project.patterns.forEach((p,i)=>{select.append(option("u"+i,p.name));drafts.append(option(String(i),p.name));});
    drafts.value=String(labIndex);setActive(project.mode);
  }
  function updateSelection(){
    const r=project.rings[selected];if(!r)return;
    const name="Ring "+String(selected+1).padStart(2,"0");
    $("inspect-ring").textContent=name;$("layout-ring").textContent=name;
    $("coord-x").value=+r.x.toFixed(2);$("coord-y").value=+r.y.toFixed(2);
    $("remove").disabled=project.rings.length===1;
  }
  function syncLayout(){
    $("arrangement").value=project.shape;$("rows").value=project.rows;$("cols").value=project.cols;
    $("count").value=project.rings.length;$("spacing").value=project.spacing;$("spacing-range").value=project.spacing;
    $("spacing-label").textContent=["custom","spiral"].includes(project.shape)?"Layout spacing scale":"Center spacing";
    $("grid-inputs").hidden=!["grid","hex"].includes(project.shape);
    $("count-field").hidden=!["circle","spiral"].includes(project.shape);
    $("geometry-caption").textContent=shapeNames[project.shape]+" / "+project.rings.length+" rings / "+(project.rings.length*16).toLocaleString()+" LEDs";
    $("project-label").value=project.name;
    $("budget").min=$("budget-range").min=minimumBudget(project.rings.length);$("budget").value=project.budget;$("budget-range").value=project.budget;
    $("pick-pair").disabled=project.rings.length<2;
    $("undo").disabled=!history.length;updateSelection();
  }
  function snapshot(){
    const {shape,rows,cols,count,spacing,rings}=project;
    history.push({shape,rows,cols,count,spacing,rings:rings.map(r=>({...r})),selected});
    if(history.length>32)history.shift();$("undo").disabled=false;
  }
  function changedLayout(refit=true){
    const floor=minimumBudget(project.rings.length);
    if(project.budget<floor){project.budget=floor;notice("Budget raised to "+floor+" A to cover the installed pixels at idle.");}
    resetScene();frameResult=null;
    selected=Math.min(selected,project.rings.length-1);
    board.setLayout(project.rings,refit);board.setSelected(selected);syncLayout();remember();
  }
  function regenerate(shape,rows,cols,count,spacing){
    if(!bounded(rows,1,32,true)||!bounded(cols,1,32,true)||!bounded(count,1,400,true)||(["grid","hex"].includes(shape)&&rows*cols>MAX_RINGS)){notice("Choose a layout with 1–400 rings, up to 32 rows or columns.");syncLayout();return;}
    snapshot();Object.assign(project,{shape,rows,cols,spacing});
    project.rings=geometry(shape,rows,cols,count,spacing);project.count=project.rings.length;
    changedLayout();
  }
  function spacingChange(value,record=true){
    if(!bounded(value,20,300)){notice("Spacing must be 20–300 mm.");syncLayout();return;}
    if(value===project.spacing)return;
    if(record)snapshot();
    // Scale custom arrangements around their center so a previously translated board stays put.
    const ratio=value/project.spacing,rings=project.rings;
    const cx=rings.reduce((sum,r)=>sum+r.x,0)/rings.length,cy=rings.reduce((sum,r)=>sum+r.y,0)/rings.length;
    const positions=rings.map(r=>({...r,x:cx+(r.x-cx)*ratio,y:cy+(r.y-cy)*ratio}));
    if(positions.some(r=>Math.abs(r.x)>100000||Math.abs(r.y)>100000)){notice("Spacing would exceed the coordinate range.");syncLayout();return;}
    project.rings=positions;project.spacing=value;changedLayout();
  }
  function moveRing(i,x,y,refit){
    if(!project.rings[i]||!bounded(x,-100000,100000)||!bounded(y,-100000,100000)){notice("Coordinates must be within ±100,000 mm.");syncLayout();return;}
    project.rings[i]={...project.rings[i],x,y};project.shape="custom";
    sceneDirty=true;board.setLayout(project.rings,refit);syncLayout();remember();
  }
  function addRing(x,y){
    if(project.rings.length>=MAX_RINGS){notice("The simulator supports up to 400 rings.");return;}
    if(!bounded(x,-100000,100000)||!bounded(y,-100000,100000)){notice("Choose a position closer to the table.");return;}
    snapshot();const row=Math.max(...project.rings.map(r=>r.row))+1;
    project.rings=[...project.rings,{x,y,row,col:0}];project.shape="custom";project.count=project.rings.length;selected=project.count-1;
    changedLayout(false);
  }
  function updateActions(){
    $("demo").classList.toggle("active",demo);$("demo").setAttribute("aria-pressed",demo);$("demo").querySelector("span").textContent=demo?"Stop demo":"Run demo";
    $("all").classList.toggle("active",all);$("all").setAttribute("aria-pressed",all);$("all").querySelector("span").textContent=all?"Release all":"Touch all";
    $("pause").querySelector("span").textContent=paused?"Resume":"Pause";$("pause").querySelector("i").innerHTML=drawIcon(paused?"play":"pause");$("step").hidden=!paused;
    $("move").classList.toggle("active",tool==="move");$("add").classList.toggle("active",tool==="add");
    $("pick-pair").setAttribute("aria-pressed",pairFirst!==null);
    const hint=pairFirst!==null?(pairFirst<0?"Pick the first spring · Esc to cancel":"Ring "+(pairFirst+1)+" selected · pick the second spring"):
      tab==="layout"?(tool==="add"?"Click the board to add a ring":"Drag a ring to move it · Space + drag to pan"):demo?"Demo playing · brush a spring to take over":"Brush a spring to pluck it · click to inspect";
    $("stage-hint").lastChild.textContent=hint;
  }
  function switchTab(next){
    cancelPair();
    if(next==="layout"){stopDemo(false);resetScene();}
    if(tab==="layout"&&next!=="layout")sceneDirty=true;
    tab=next;board.setTool(next==="layout"?tool:"play");
    document.querySelectorAll("[data-tab]").forEach(b=>{const yes=b.dataset.tab===next;b.classList.toggle("selected",yes);b.setAttribute("aria-pressed",yes);});
    ["play","layout","lab"].forEach(k=>$("pane-"+k).hidden=k!==next);updateActions();
  }
  function stopDemo(clear){if(!demo)return;demo=false;releaseSource("demo");if(clear)resetScene();updateActions();}
  function startDemo(){cancelPair();resetScene();demo=true;demoStart=simNow;lastDemoBeat=-1;paused=false;updateActions();}
  function tickDemo(){
    const pairDemo=usesPairedWaves(project.mode);
    const beatMs=pairDemo?3400:230;
    const elapsed=simNow-demoStart,beat=Math.floor(elapsed/beatMs);
    if(beat!==lastDemoBeat){
      releaseSource("demo");lastDemoBeat=beat;
      // Aim the sweep across the middle of any layout, with a two-touch ending.
      const rings=project.rings, xs=rings.map(r=>r.x),ys=rings.map(r=>r.y);
      const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
      const cycle=beat%12;
      const hit=(fx,fy,except=-1)=>{const x=minX+fx*(maxX-minX),y=minY+fy*(maxY-minY);let id=-1,best=Infinity;
        rings.forEach((r,i)=>{const d=(r.x-x)**2+(r.y-y)**2;if(i!==except&&d<best){best=d;id=i;}});if(id>=0)setContact(id,"demo",true);return id;};
      if(pairDemo){
        scene.beginInterferenceGroup();
        const horizontal=maxX-minX>=maxY-minY;
        const first=hit(horizontal ? 0.28 : 0.5, horizontal ? 0.5 : 0.28);
        hit(horizontal ? 0.72 : 0.5, horizontal ? 0.5 : 0.72, first);
      }else{
        if(cycle<8)hit(.23+cycle*.075,.48+.13*Math.sin(cycle*.9));
        if(cycle===9){hit(.35,.28);hit(.68,.72);}
      }
    }
    if(elapsed%beatMs>=115)releaseSource("demo");
  }
  function showPixels(out){
    const off=selected*48;const cells=$("pixel-strip").children;
    for(let p=0;p<16;p++){const k=off+p*3,c=out.pixels;cells[p].style.backgroundColor="rgb("+[c[k],c[k+1],c[k+2]].join(",")+")";cells[p].classList.toggle("sel",p===pixel);}
    const k=off+pixel*3;$("led-number").textContent="LED "+String(pixel+1).padStart(2,"0");
    $("pixel-value").textContent="RGB "+[...out.pixels.slice(k,k+3)].join(" / ");
  }
  function reading(id,v,unit){const el=$(id);if(el.firstChild.nodeType===3)el.firstChild.nodeValue=v+" ";else el.textContent=v;if(el.querySelector("small"))el.querySelector("small").textContent=unit;}
  function render(){
    if(tab==="layout"&&sceneDirty){
      const count=project.rings.length*16;
      frameResult={pixels:new Uint8Array(count*3),requestedMa:count,sentMa:count,gain:1};
    }else{ensureScene();if(demo)tickDemo();frameResult=scene.frame(Math.floor(simNow),project.budget*1000,custom);}
    const f=frameResult;board.draw(f.pixels,new Set(contacts.keys()));
    if(!$("effect-count").hidden){
      const n=f.activeWaves??f.activeOrbits??f.activeBalls??0;
      const noun=project.mode==="7"?"ball":project.mode==="8"?"orbit":"wave";
      const label=n+" active "+noun+(n===1?"":"s");
      if($("effect-count").textContent!==label)$("effect-count").textContent=label;
    }
    reading("requested",(f.requestedMa/1000).toFixed(2),"A");reading("sent",(f.sentMa/1000).toFixed(2),"A");
    reading("scale",(f.gain*100).toFixed(0),"%");$("touches").textContent=String(contacts.size);
    $("powerbar").style.width=Math.min(100,100*f.sentMa/(1000*project.budget))+"%";$("powerbar").parentElement.classList.toggle("limited",f.gain<1);
    showPixels(f);
  }
  function clock(real){
    if(!paused)simNow+=Math.min(100,Math.max(0,real-prevReal));prevReal=real;
    if(real-lastPaint>=15){render();lastPaint=real;}
    requestAnimationFrame(clock);
  }
  document.querySelectorAll("[data-tab]").forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  $("pattern").onchange=()=>{setActive($("pattern").value);remember();};
  const palettes=$("wave-palette");
  for(const p of palettePresets)palettes.append(option(p.id,p.name));
  palettes.append(option("random","Random per pluck pair"));
  const customColors=option("custom","Custom colors");customColors.disabled=true;palettes.append(customColors);
  palettes.onchange=()=>{
    if(palettes.value==="random"){
      project.interferencePaletteMode="random";
      if(scene)scene.setInterferenceRandom(true);
      syncPaletteControls();remember();return;
    }
    const preset=palettePresets.find(p=>p.id===palettes.value);
    if(preset)changeColors(preset);
  };
  $("keep-colors").onclick=()=>changeColors(project.interferenceColors??palettePresets[0]);
  for(const phase of ["crest","trough"]){
    const picker=$(phase+"-color");
    picker.oninput=picker.onchange=()=>{
      const colors=project.interferenceColors??palettePresets[0];
      if(colors[phase]!==picker.value)changeColors({...colors,[phase]:picker.value});
    };
  }
  $("demo").onclick=()=>demo?stopDemo(false):startDemo();
  $("all").onclick=()=>{
    cancelPair();stopDemo(true);all=!all;
    if(all){
      ensureScene();if(usesPairedWaves(project.mode))scene.beginInterferenceGroup();
      project.rings.forEach((_,i)=>setContact(i,"all",true));
    }else releaseSource("all");
    updateActions();
  };
  $("pick-pair").onclick=()=>{
    if(pairFirst!==null){cancelPair();return;}
    stopDemo(true);if(all){releaseSource("all");all=false;}
    pairFirst=-1;board.setTool("pair");updateActions();$("board").focus({preventScroll:true});
    notice("Choose two springs. Click each, or use the arrow keys and Enter.");
  };
  window.addEventListener("keydown",e=>{if(e.key==="Escape"&&pairFirst!==null){cancelPair();notice("Pair selection canceled.");}});
  $("pause").onclick=()=>{paused=!paused;updateActions();};
  $("step").onclick=()=>{simNow+=16;render();};
  $("smaller").onclick=()=>board.zoom(1/1.25);$("bigger").onclick=()=>board.zoom(1.25);$("fit").onclick=()=>board.fit();
  function budgetChange(value){const minimum=minimumBudget(project.rings.length);if(!bounded(value,minimum,60)){notice("Enter "+minimum+"–60 A. The minimum covers idle pixel current.");syncLayout();return;}project.budget=value;$("budget").value=value;$("budget-range").value=value;remember();}
  $("budget-range").oninput=e=>budgetChange(+e.target.value);$("budget").onchange=e=>budgetChange(+e.target.value);
  $("arrangement").onchange=e=>regenerate(e.target.value,project.rows,project.cols,project.rings.length,project.spacing);
  for(const id of ["rows","cols","count"])$(id).onchange=()=>regenerate(project.shape,+$("rows").value,+$("cols").value,+$("count").value,project.spacing);
  $("spacing").onchange=e=>spacingChange(+e.target.value);
  let sliding=false;$("spacing-range").onpointerdown=()=>sliding=false;
  $("spacing-range").oninput=e=>{spacingChange(+e.target.value,!sliding);sliding=true;};$("spacing-range").onchange=()=>sliding=false;
  for(const id of ["move","add"])$(id).onclick=()=>{tool=id;board.setTool(tool);updateActions();};
  for(const id of ["coord-x","coord-y"])$(id).onchange=()=>{snapshot();moveRing(selected,+$("coord-x").value,+$("coord-y").value,true);};
  $("remove").onclick=()=>{if(project.rings.length<=1)return;snapshot();project.rings=project.rings.filter((_,i)=>i!==selected);project.count=project.rings.length;project.shape="custom";changedLayout();};
  $("undo").onclick=()=>{const prev=history.pop();if(prev){selected=prev.selected;delete prev.selected;Object.assign(project,prev);changedLayout();}};
  for(let p=0;p<16;p++){const b=document.createElement("button");b.setAttribute("aria-label","Inspect LED "+(p+1));b.onclick=()=>{pixel=p;if(frameResult)showPixels(frameResult);};$("pixel-strip").append(b);}
  function loadDraft(index){
    labIndex=index;$("drafts").value=String(index);const def=index<0?newWave():project.patterns[index];
    $("lab-name").value=def.name;$("lab-kind").value=def.kind;$("lab-error").textContent="";
    const wave=def.kind==="wave"?def:newWave();
    for(const prop of ["shape","color","speed","width","reach","hold"])$("wave-"+prop).value=wave[prop];
    (def.expr||EXAMPLE_EXPR).forEach((s,i)=>$("expr-"+"rgb"[i]).value=s);labFields();
  }
  function labFields(){const formula=$("lab-kind").value==="formula";$("wave-fields").hidden=formula;$("formula-fields").hidden=!formula;}
  $("drafts").onchange=e=>loadDraft(+e.target.value);$("lab-kind").onchange=labFields;
  $("apply").onclick=()=>{
    try{
      let def={name:$("lab-name").value,kind:$("lab-kind").value};
      if(def.kind==="wave"){for(const p of ["shape","color"])def[p]=$("wave-"+p).value;for(const p of ["speed","width","reach","hold"])def[p]=+$("wave-"+p).value;}
      else def.expr=[..."rgb"].map(ch=>$("expr-"+ch).value);
      def=validatePattern(def);
      if(labIndex<0){if(project.patterns.length>=100)throw Error("The project already has 100 patterns.");labIndex=project.patterns.length;project.patterns.push(def);}else project.patterns[labIndex]=def;
      project.mode="u"+labIndex;patternMenus();resetScene();startDemo();$("lab-error").textContent="";remember();notice("Testing "+def.name+". Brush a spring to take over.");
    }catch(e){$("lab-error").textContent=e.message;}
  };
  $("open").onclick=()=>$("file").click();
  $("project-label").onchange=e=>{project.name=e.target.value.trim()||"Studio table";e.target.value=project.name;remember();};
  $("file").onchange=async e=>{
    const f=e.target.files[0];e.target.value="";if(!f)return;
    try{
      if(f.size>1024*1024)throw Error("Choose a project smaller than 1 MB.");
      const next=validateProject(JSON.parse(await f.text()));
      stopDemo(false);all=false;contacts.clear();history.length=0;project=next;selected=0;labIndex=-1;paused=false;
      changedLayout();patternMenus();loadDraft(-1);switchTab("play");remember();notice("Opened "+f.name);
    }catch(error){notice("Open failed. "+error.message);}
  };
  $("save").onclick=()=>{
    const blob=new Blob([JSON.stringify(project,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob);
    const stem=project.name.replace(/[^\w .-]/g,"").trim().slice(0,70)||"project";
    const a=document.createElement("a");a.href=url;a.download="SpringTable-"+stem+".json";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000);flushSave();notice("Project exported.");
  };
  board.setLayout(project.rings);board.setSelected(selected);syncLayout();patternMenus();loadDraft(-1);switchTab("play");
  if(!restored&&!matchMedia("(prefers-reduced-motion: reduce)").matches)startDemo();
  render();requestAnimationFrame(clock);
})();
