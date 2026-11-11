"use strict";
// Bounded arithmetic expressions for the lab. Project files contain data only.
const variables = new Set(["i","p","x","y","t","age","held","dt","d"]);
const functions = {
  sin:[1,Math.sin], cos:[1,Math.cos], abs:[1,Math.abs], floor:[1,Math.floor],
  min:[2,Math.min], max:[2,Math.max], clamp:[3,(v,lo,hi)=>Math.max(lo,Math.min(hi,v))],
  if:[3,(test,yes,no)=>test ? yes : no]
};
const operators = {
  "<":[1,(a,b)=>+(a<b)], ">":[1,(a,b)=>+(a>b)], "<=":[1,(a,b)=>+(a<=b)], ">=":[1,(a,b)=>+(a>=b)],
  "==":[1,(a,b)=>+(a===b)], "!=":[1,(a,b)=>+(a!==b)], "+":[2,(a,b)=>a+b], "-":[2,(a,b)=>a-b],
  "*":[3,(a,b)=>a*b], "/":[3,(a,b)=>b===0?0:a/b], "%":[3,(a,b)=>b===0?0:a%b]
};
function compileExpression(source) {
  if(typeof source!=="string" || source.length>384) throw Error("Use at most 384 characters per channel.");
  const tokens=source.match(/\d+\.?\d*|\.\d+|[A-Za-z_][A-Za-z_0-9]*|<=|>=|==|!=|[^\s]/g)||[];
  if(tokens.length>100) throw Error("Use at most 100 tokens per channel.");
  let at=0;
  function take(token) { if(tokens[at]===token){at++;return true;} return false; }
  function required(token){if(!take(token))throw Error("Expected '"+token+"'.");}
  function atom(){
    if(take("-")){const v=atom();return c=>-v(c);}
    if(take("+"))return atom();
    if(take("(")){const v=expression(0);required(")");return v;}
    const word=tokens[at++];
    if(!word)throw Error("Expected a number or variable.");
    if(/^(?:\d+\.?\d*|\.\d+)$/.test(word)){const v=Number(word);return ()=>v;}
    if(word==="pi")return ()=>Math.PI;
    if(variables.has(word))return c=>Number(c[word]);
    if(Object.hasOwn(functions,word)){
      const [n,fn]=functions[word];required("(");const args=[expression(0)];
      while(take(","))args.push(expression(0));
      required(")");if(args.length!==n)throw Error(word+" needs "+n+" arguments.");
      if(n===1)return c=>fn(args[0](c));
      if(n===2)return c=>fn(args[0](c),args[1](c));
      return c=>fn(args[0](c),args[1](c),args[2](c));
    }
    throw Error("Unknown term '"+word+"'.");
  }
  function expression(minimum){
    let left=atom();
    while(Object.hasOwn(operators,tokens[at])){
      const [precedence,fn]=operators[tokens[at]];if(precedence<minimum)break;
      at++;const rhs=expression(precedence+1),lhs=left;left=c=>fn(lhs(c),rhs(c));
    }
    return left;
  }
  const evaluate=expression(0);
  if(at!==tokens.length)throw Error("Unexpected '"+tokens[at]+"'.");
  return evaluate;
}
const EXAMPLE_EXPR=["if(age >= 0, max(0, 1-age) * (125+125*cos(p*pi/8-age*9)), 0)","if(held, 40, 0)","if(age >= 0, max(0, 1-age) * (125-125*cos(p*pi/8-age*9)), 0)"];
const newWave=()=>({name:"Echo bloom",kind:"wave",shape:"radial",color:"#fd925a",speed:450,reach:225,width:320,hold:10});
function runtimePattern(def) {
  if(def.kind!=="formula")return def;
  const compiled=def.expr.map((s,i)=>{try{return compileExpression(s);}catch(e){throw Error(["Red","Green","Blue"][i]+": "+e.message);}});
  return {...def,paint:c=>[compiled[0](c),compiled[1](c),compiled[2](c)]};
}
const MAX_RINGS=400, SHAPES=["grid","hex","circle","spiral","custom"];
function geometry(shape,rows,cols,count,pitch){
  const rings=[];
  if(shape==="grid"||shape==="hex"){
    for(let r=0;r<rows;r++)for(let c=0;c<cols;c++)
      rings.push({x:(c + (shape==="hex" && r%2 ? 0.5 : 0))*pitch,y:r*pitch*(shape==="hex"?Math.sqrt(3)/2:1),row:r,col:c});
  }else if(shape==="circle"){
    const radius=count===1?0:pitch/(2*Math.sin(Math.PI/count));
    for(let i=0;i<count;i++){const a=2*Math.PI*i/count-Math.PI/2;rings.push({x:radius*Math.cos(a),y:radius*Math.sin(a),row:0,col:i});}
  }else if(shape==="spiral"){
    const angle=Math.PI*(3-Math.sqrt(5));
    for(let i=0;i<count;i++){const r=pitch*.6*Math.sqrt(i);rings.push({x:r*Math.cos(i*angle),y:r*Math.sin(i*angle),row:0,col:i});}
  }
  if(rings.length){
    const left=Math.min(...rings.map(r=>r.x)),right=Math.max(...rings.map(r=>r.x));
    const top=Math.min(...rings.map(r=>r.y)),bottom=Math.max(...rings.map(r=>r.y));
    for(const r of rings){r.x-=(left+right)/2;r.y-=(top+bottom)/2;}
  }
  return rings;
}
function defaultProject(){return {format:"springtable-studio",version:1,name:"Studio table",shape:"grid",rows:10,cols:10,count:100,spacing:60,budget:40,mode:"0",rings:geometry("grid",10,10,100,60),patterns:[]};}
const palettePresets = [
  {id:"original", name:"Aqua & violet", crest:"#28d2ff", trough:"#5f41be"},
  {id:"amber-blue", name:"Amber & blue", crest:"#ffac32", trough:"#287aff"},
  {id:"rose-lime", name:"Rose & lime", crest:"#ff4d83", trough:"#a8ed40"},
  {id:"ice-ember", name:"Ice & ember", crest:"#bcf4ff", trough:"#ff5935"}
];
function setProjectColors(project, colors){
  if(!colors || ![colors.crest,colors.trough].every(s=>typeof s==="string" && /^#[0-9a-f]{6}$/i.test(s))){
    throw Error("Interference colors need a six-digit hex value for both crest and trough.");
  }
  const crest=colors.crest.toLowerCase(),trough=colors.trough.toLowerCase();
  const original=palettePresets[0];
  if(crest===original.crest && trough===original.trough) delete project.interferenceColors;
  else project.interferenceColors={crest,trough};
}
function bounded(n,lo,hi,whole=false){return Number.isFinite(n)&&n>=lo&&n<=hi&&(!whole||Number.isInteger(n));}
function minimumBudget(ringCount){return Math.max(.1,Math.ceil(ringCount*16/100)/10);}
function validatePattern(p){
  if(!p||typeof p.name!=="string"||!p.name.trim()||p.name.length>45)throw Error("Give the pattern a name of 1–45 characters.");
  if(p.kind==="formula"){
    if(!Array.isArray(p.expr)||p.expr.length!==3)throw Error("A formula needs three channels.");
    runtimePattern(p);return {kind:"formula",name:p.name.trim(),expr:p.expr.slice()};
  }
  if(p.kind!=="wave"||!["radial","square"].includes(p.shape)||!/^#[0-9a-f]{6}$/i.test(p.color)||!bounded(p.speed,10,5000)||!bounded(p.reach,1,5000)||!bounded(p.width,10,5000)||!bounded(p.hold,0,100))throw Error("Check the wave shape, color and field ranges.");
  return {kind:"wave",name:p.name.trim(),shape:p.shape,color:p.color,speed:p.speed,reach:p.reach,width:p.width,hold:p.hold};
}
function validateProject(p){
  if(!p||p.format!=="springtable-studio"||p.version!==1)throw Error("Choose a SpringTable Studio version 1 project.");
  if(!SHAPES.includes(p.shape)||!bounded(p.rows,1,32,true)||!bounded(p.cols,1,32,true)||!bounded(p.count,1,MAX_RINGS,true)||!bounded(p.spacing,20,300)||!bounded(p.budget,.1,60)||!Array.isArray(p.rings)||p.rings.length<1||p.rings.length>MAX_RINGS)throw Error("The saved layout settings are outside the supported range.");
  const rings=p.rings.map(r=>{if(!r||!bounded(r.x,-100000,100000)||!bounded(r.y,-100000,100000)||!bounded(r.row,0,100000,true)||!bounded(r.col,0,100000,true))throw Error("Invalid ring position.");return {x:r.x,y:r.y,row:r.row,col:r.col};});
  if(p.budget<minimumBudget(rings.length))throw Error("The budget must cover the idle current for all installed pixels.");
  if((p.shape==="grid"||p.shape==="hex")&&p.rows*p.cols!==rings.length)throw Error("Ring count does not match grid dimensions.");
  if(!Array.isArray(p.patterns)||p.patterns.length>100)throw Error("Invalid pattern collection.");
  const patterns=p.patterns.map(validatePattern);
  if(typeof p.mode!=="string"||!(/^(?:[0-9]|1[01])$/.test(p.mode)||(/^u\d+$/.test(p.mode)&&Number(p.mode.slice(1))<patterns.length)))throw Error("Unknown active pattern.");
  if(typeof p.name!=="string"||p.name.length>80)throw Error("Invalid project name.");
  const project={format:p.format,version:1,name:p.name,shape:p.shape,rows:p.rows,cols:p.cols,count:p.count,spacing:p.spacing,budget:p.budget,mode:p.mode,rings,patterns};
  if(Object.hasOwn(p,"interferenceColors"))setProjectColors(project,p.interferenceColors);
  if(Object.hasOwn(p,"interferencePaletteMode")){
    if(p.interferencePaletteMode==="random")project.interferencePaletteMode="random";
    else if(p.interferencePaletteMode!=="fixed")throw Error("Unknown interference palette mode.");
  }
  return project;
}
