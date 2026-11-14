// ---------- Messaggi dal core e controllo periodico (tick) ----------
function onCoreMsg(m){
 if(m.type==="wrap")return dbgWrap(m);
 if(m.type==="mark")return onMark(m);
 if(m.type==="dump")return onDump(m);
 if(m.type==="tempo")return onTempo(m);
 const L=G.loops[m.i];if(!L)return;
 if(m.type==="peaks"){L.peaks=m.peaks;L.ver=m.ver;drawWave(m.i);saveSoon();return}
 if(m.type==="state"){saveSoon();L.undo=m.undo;L.redo=m.redo;
  if(m.has){L.len=m.len;L.t0=m.t0;
   if(!L.has||L.state==="empty"){L.has=true;L.state="play";L.muted=false;if(!G.base){G.base=G.base0=m.len;G.origin=m.t0}
    send({type:"gate",i:m.i,on:G.running?1:0,frame:nowF()})}}
  else if(L.state!=="armed"&&L.state!=="rec"){L.has=false;L.state="empty";L.peaks=null;drawWave(m.i)}
  render()}}

let perfLast=-1;
function tick(){if(!ready)return;const f=nowF();let ch=false;
 autoMix();if(speedTick(f))ch=true;
 if(perf&&Math.floor(perfSecs())!==perfLast){perfLast=Math.floor(perfSecs());render()}
 if(G.stopAt&&f>=G.stopAt){stopAll();ch=true}
 // un loop cancellato perde anche i suoi effetti
 LDJ.forEach((D,i)=>{if(D&&!G.loops[i].has){dropLoopDJ(i);ch=true}});
 if(CUT&&!G.loops[CUT.i].has){CUT=null;ch=true} // e il pezzo ripetuto (il core l'ha già tolto)
 G.loops.forEach(L=>{
  if(L.state==="closing"&&f>=L.end){if(L.q)renderRec(G.loops.indexOf(L));L.state="play";rotateBus();ch=true}
  if(L.pend&&f>=L.pend.at){L.muted=L.pend.muted;L.pend=null;ch=true}});
 if(ch)render()}
