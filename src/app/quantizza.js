// ---------- Quantizzazione ----------
// Mentre suoni senti le note subito; nel loop viene scritta la versione rimessa a tempo sulla griglia.
const QNAMES={0:"NO",2:"1/8",4:"1/16"};
function beatsFor(len){const secs=len/sr;let n=1;while(60*n/secs<70)n*=2;return n}
// Il primo giro va dalla prima nota alla ripressione del pad: la prima nota è l'1. Indovinare dalle note se
// invece si è partiti in levare non è affidabile (con le imprecisioni di chi suona sbagliava 1 volta su 3 e
// spostava tutto in levare), quindi un giro che deve cominciare in levare si costruisce dal secondo loop.
const bpm=()=>G.base?60*G.beats/(G.base/sr):0;
function gridF(q){return G.base/(G.beats*q)}
function qIndex(ev,L){const g=gridF(ev.q),rel=ev.on-ev.comp-G.origin,q=Math.round(rel/g)*g;
 if(ev.dbg){ev.dbg.rel=rel;ev.dbg.qf=q;ev.dbg.g=g}
 return((Math.round(q+G.origin-L.t0)%L.len)+L.len)%L.len}
// Il tempo del primo giro è ambiguo: 2 battiti a 75 bpm o 4 a 150? beatsFor sceglie 70–140 bpm, e sopra i 140
// la griglia diventerebbe larga il doppio: con 1/8 i levare finirebbero sul battere precedente. Se nelle note di
// una ripresa almeno 3 su 10 cadono a 1/4 o 3/4 del battito stimato, sono ottavi in levare di un tempo doppio:
// raddoppio i battiti (finché il tempo resta entro i 180 bpm: oltre, sedicesimi funk a 100 sembrerebbero ottavi a 200). Male che vada la griglia diventa più fine, mai più larga.
function checkDouble(evs){if(!G.base||!evs.length||60*G.beats*2/(G.base/sr)>180)return;
 const b=G.base/G.beats;let c=0;
 for(const e of evs){const f=((((e.on-e.comp-G.origin)/b)%1)+1)%1;if(Math.abs(f-.25)<.09||Math.abs(f-.75)<.09)c++}
 if(c>=1&&c/evs.length>=.3){G.beats*=2;djRetime();render()}}
function renderRec(i){const L=G.loops[i],evs=G.ev.filter(e=>e.i===i&&e.kind==="rec");G.ev=G.ev.filter(e=>!evs.includes(e));
 checkDouble(evs);
 const data=new Float32Array(L.len),now=nowF();
 for(const e of evs){e.done=true;const seg=renderNote(e.sound,e.note,e.vel,Math.max((e.off??now)-e.on,sr*.03),e.lv);if(!seg)continue;
  let p=qIndex(e,L);for(let k=0;k<seg.length;k++){data[p]+=seg[k];if(++p===L.len)p=0}}
 send({type:"fill",i,data},[data.buffer])}
// dove leggeva il loop quando è partita una nota della sovraincisione: lo dice il core (mark), di solito prima del rilascio
let markId=0;const MARKS=new Map();
function markNote(e){e.mid=++markId;MARKS.set(e.mid,e);send({type:"mark",i:e.i,frame:e.on-e.comp,id:e.mid})}
function onMark(m){const e=MARKS.get(m.id);if(!e)return;MARKS.delete(m.id);e.mk={q:m.q,r:m.r};if(e.wait){e.wait=false;commitDubNote(e)}}
// nota ricampionata come l'ingresso del core a velocità r (tapeW): dura r volte tanto nel buffer
function tapeSeg(s,r){const n=Math.max(1,Math.round(s.length*r)),o=new Float32Array(n),m=s.length-1;
 for(let j=0;j<n;j++){const x=j/r,i=Math.floor(x);o[j]=i>=m?s[m]:s[i]+(s[i+1]-s[i])*(x-i)}return o}
function commitDubNote(e){if(e.mid&&!e.mk&&MARKS.has(e.mid)){e.wait=true;return}
 e.done=true;G.ev=G.ev.filter(x=>x!==e);const L=G.loops[e.i];if(!L.has||!L.len)return;
 const seg=renderNote(e.sound,e.note,e.vel,Math.max(e.off-e.on,sr*.03),e.lv);if(!seg)return;
 // loop a velocità diversa da 1 (o non ancora tornato sulla griglia): la nota va a tempo con quello che sentivi, cioè sulla griglia
 // del buffer vicina a dove il loop leggeva, ricampionata come la sovraincisione dal vivo (core.js, tapeW)
 const mk=e.mk,off=mk&&mk.q!=null?dmod(mk.q-(e.on-e.comp-L.t0)+L.len/2,L.len)-L.len/2:0;
 if(mk&&mk.q!=null&&(Math.abs(mk.r-1)>1e-4||Math.abs(off)>1)){const r=mk.r;if(r<.05)return; // nastro fermo: non si scrive niente
  const g=gridF(e.q),o=dmod(G.origin-L.t0,L.len),idx=dmod(Math.round(Math.round((mk.q-o)/g)*g+o),L.len);
  // nel buffer quando la testina è a mezzo giro dalla nota: non si sente doppia e non è ancora il suo turno
  let at=e.on+Math.round(L.len*.5/r);const now=nowF();while(at<now+sr*.02)at+=Math.round(L.len/r);
  if(e.dbg)e.dbg.at=at;send({type:"pend",i:e.i,start:idx,data:tapeSeg(seg,r),at});return}
 G.dubTake.push(e);checkDouble(G.dubTake);
 const idx=qIndex(e,L);let at=L.t0+idx;const min=e.on+L.len*.5;
 if(at<min)at+=Math.ceil((min-at)/L.len)*L.len;
 if(e.dbg)e.dbg.at=at;
 send({type:"pend",i:e.i,start:idx,data:seg,at})}
function cycleQuant(){setQuant(SET.quant===4?2:SET.quant===2?0:4)}
function setQuant(v){SET.quant=v;saveSet();
 const busy=G.loops.some(L=>L.state==="rec"||L.state==="closing"||L.state==="dub")?" Vale dalla prossima registrazione.":"";
 flashHint((SET.quant?`Quantizzazione: ${QNAMES[SET.quant]}. Le note registrate vengono rimesse a tempo.`:"Quantizzazione spenta: registro esattamente come suoni.")+busy)}
