const fs=require("node:fs"),path=require("node:path");
const read=name=>fs.readFileSync(path.join(__dirname,name),"utf8");
const scripts=["ricochet.js","drain.js","reflection.js","interference.js","engine.js","board.js","project.js","ui.js"].map(read).join("\n");
const doc=read("page.html").replace("/*STYLE*/",()=>read("style.css")).replace("/*SCRIPTS*/",()=>scripts);
const dest=path.join(__dirname,"..","SpringTable Studio.html");
fs.writeFileSync(dest,doc);
console.log(dest,fs.statSync(dest).size+" bytes");
