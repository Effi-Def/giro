// ---------- Note ----------
const held=new Map();
function noteOn(note,vel){if(!ready)return;
 if(held.has(note))noteOff(note,true);
 const a=G.loops.findIndex(L=>L.state==="armed");if(a>=0)beginRec(a);
 const ti=G.loops.findIndex(L=>L.state==="rec"||L.state==="closing"),di=G.loops.findIndex(L=>L.state==="dub"),i=ti>=0?ti:di;
 if(ti>=0&&G.loops[ti].first)G.firstOn.push(nowF()); // attacchi del primo giro: servono a checkDouble anche senza quantizzazione
 // il modo (suddivisione, 0 = spenta) lo decide L.q, fissato quando parte la registrazione o la sovraincisione
 let ev=null;
 if(i>=0&&G.loops[i].q&&BUF[SOUNDS[SET.sound].id]){const L=G.loops[i];
  ev={i,kind:ti>=0?"rec":"dub",note,vel,sound:SET.sound,q:L.q,on:nowF(),off:null,comp:L.first&&ti>=0?0:latencyFrames()};G.ev.push(ev);
  if(ev.kind==="dub")markNote(ev)}
 // nota annotata: il suono dal vivo non va al looper, nel loop entra la versione a tempo; altrimenti va sul bus registrato
 if(ev)ev.lv=DJV[7]; // il volume della tastiera vale anche per la nota rimessa a tempo nel loop
 if(i>=0)dbgNote(i,note,ev,ti>=0&&G.loops[ti].first);
 if(i>=0)mxNote(G.loops[i],SOUNDS[SET.sound],note);
 held.set(note,{v:voice(SET.sound,note,vel,nowT(),ev?masterIn:liveBus[G.cur],DJV[7]),sus:false,ev});uiNote(note,true)}
let sustain=false;
function noteOff(note,force){const h=held.get(note);if(!h)return;if(sustain&&!force){h.sus=true;return}
 h.v.release(nowT());held.delete(note);uiNote(note,false);
 if(h.ev&&!h.ev.done){h.ev.off=nowF();if(h.ev.kind==="dub")commitDubNote(h.ev)}}
function setSustain(on){sustain=on;if(!on)[...held.entries()].filter(([,h])=>h.sus).forEach(([n])=>noteOff(n,true))}
// spegne tutte le note dal vivo, anche quelle tenute dal pedale: per le note rimaste bloccate (cavo staccato,
// rilascio perso). La chiamano ■ da fermo, Esc, i messaggi «all notes off» e lo stacco di una tastiera. Dice quante erano.
function allNotesOff(){const n=held.size;sustain=false;[...held.keys()].forEach(k=>noteOff(k,true));pcHeld.clear();return n}
function setSound(i){lastInCat[SOUNDS[i].cat]=i;if(i===SET.sound)return;SET.sound=i;saveSet();if(ready)loadSound(i);render()}
// ▲▼ saltano di famiglia (riprendendo l'ultimo suono usato lì), il tasto centrale scorre i suoni della famiglia
const lastInCat={};
let CATS=[...new Set(SOUNDS.map(s=>s.cat))];
function soundHint(){const s=SOUNDS[SET.sound],n=SOUNDS.filter(x=>x.cat===s.cat).length;
 flashHint(`${s.cat}: <b>${s.name}</b>`+(n>1?" · tasto centrale per gli altri suoni della famiglia":""))}
function stepFamily(d){const c=CATS[(CATS.indexOf(SOUNDS[SET.sound].cat)+d+CATS.length)%CATS.length];
 setSound(lastInCat[c]??SOUNDS.findIndex(s=>s.cat===c));soundHint()}
function stepInFamily(d){const c=SOUNDS[SET.sound].cat,ids=SOUNDS.map((s,i)=>s.cat===c?i:-1).filter(i=>i>=0);
 setSound(ids[(ids.indexOf(SET.sound)+d+ids.length)%ids.length]);soundHint()}
