// ---------- Stato del looper ----------
const NL=8;
const G={base:null,base0:null,beats:4,origin:0,running:false,stopAt:0,drop:false,dubTake:[],firstOn:[],cur:0,sel:0,ev:[],
 loops:Array.from({length:NL},()=>({sound:null,state:"empty",has:false,muted:false,pend:null,len:0,t0:0,start:0,end:0,first:false,peaks:null,vol:.8,pan:0,fx:0,undo:0,redo:0,mx:null,ar:null,pm:false}))};
const anyHas=()=>G.loops.some(l=>l.has||l.state==="rec"||l.state==="closing");
function Q(){let q=G.base,k=0;while(q/2>=sr*.9&&k<3){q/=2;k++}return Math.round(q)}
function nextQ(f){const q=Q();return G.origin+Math.ceil((f-G.origin+sr*.03)/q)*q}
function rotateBus(){G.cur=(G.cur+1)%3}

function tap(i){
 if(!ready)return;const L=G.loops[i];G.sel=i;
 switch(L.state){
  case "empty":
   G.loops.forEach(o=>{if(o.state==="armed")o.state="empty"});
   if(!anyHas()){send({type:"reset"});G.base=null;G.running=false;G.loops.forEach(o=>{o.undo=0;o.redo=0});L.first=true}else L.first=false;
   L.state="armed";break;
  case "armed":L.state="empty";break;
  case "rec":close(i);break;
  case "closing":break;
  case "play":
   L.dropped=false; // toccato a mano durante un break: da qui in poi lo decidi tu
   if(!G.running){L.muted=!L.muted;break}
   if(L.pend){L.pend=null;send({type:"gate",i,on:L.muted?0:1,frame:nowF()});break}
   // si ferma alla suddivisione successiva, rientra sull'1 della battuta
   {const at=L.muted?nextBar(nowF()):nextQ(nowF());L.pend={muted:!L.muted,at};send({type:"gate",i,on:L.muted?1:0,frame:at})}break;
  case "dub":endDub(i);break}
 render()}

function beginRec(i){const L=G.loops[i],f=nowF();dbgForget(i);
 if(L.first){G.running=false;G.firstOn=[];send({type:"rec",i,bus:G.cur,start:f,comp:0})}
 else{if(!G.running)playAll(f);send({type:"rec",i,bus:G.cur,start:f,comp:latencyFrames()})}
 L.start=f;L.state="rec";L.sound=SET.sound;L.sid=null;L.q=SET.quant;
 // loop nuovo: il pan automatico del loop di prima non vale più (quello girato a mano resta finché il mix automatico non ne dà uno)
 if(L.ar&&!L.pm&&L.pan){L.pan=0;send({type:"pan",i,v:0})}L.mx=freshMx();L.ar=null;L.pm=false;render()}

function close(i){const L=G.loops[i],f=nowF();
 if(L.first){
  if(f-L.start<sr*.25){send({type:"cancelRec",i});L.state="empty";flashHint("Troppo corto: tieni il primo giro almeno un quarto di secondo.");return}
  const len=f-L.start;
  G.base=G.base0=len;G.beats=beatsFor(len);G.origin=L.start;L.len=len;L.t0=L.start;
  const nb=freshBuf(len);send({type:"recEnd",i,end:f,len,t0:L.start,buf:nb},[nb.buffer]);
  // anche registrato senza quantizzazione, il primo giro decide se il tempo vero è il doppio (sopra i 140)
  if(L.q)renderRec(i);else checkDouble(G.firstOn.map(on=>({on,comp:0})));
  DBG.gridClose=dbgGrid(L.q||4,L.q);
  send({type:"gate",i,on:1,frame:f});
  L.state="play";L.has=true;L.muted=false;G.running=true;rotateBus();djRetime();return}
 const k=Math.max(1,Math.round((f-L.start)/G.base)),len=k*G.base,end=Math.max(L.start+len,f);
 L.len=len;L.t0=L.start;L.end=end;L.has=true;L.muted=false;
 const nb=freshBuf(len);send({type:"recEnd",i,end,len,t0:L.start,buf:nb},[nb.buffer]);send({type:"gate",i,on:G.running?1:0,frame:end});
 if(end>f+sr*.02)L.state="closing";else{if(L.q)renderRec(i);L.state="play";rotateBus()}}

function startDub(i){const L=G.loops[i];if(!G.running)playAll();
 G.loops.forEach((o,j)=>{if(j!==i&&o.state==="dub")endDub(j)}); // una sovraincisione alla volta
 if(L.muted){L.muted=false;L.pend=null;send({type:"gate",i,on:1,frame:nowF()})}
 const nb=freshBuf(L.len);send({type:"dub",i,bus:G.cur,comp:latencyFrames(),buf:nb},[nb.buffer]);L.state="dub";L.q=SET.quant;G.dubTake=[];render()}
function endDub(i){send({type:"undub",i});G.loops[i].state="play";rotateBus();render()}

function clearLoop(i){const L=G.loops[i];
 if(L.state==="armed"){L.state="empty";render();return}
 send({type:"clear",i});dbgForget(i);Object.assign(L,{state:"empty",has:false,muted:false,pend:null,dropped:false,peaks:null});
 flashHint(`Loop ${i+1} cancellato. ◀ (annulla) lo riporta indietro.`)}

function playAll(f){if(!G.base)return;f=f??nowF()+Math.round(sr*.02);
 G.stopAt=0;const delta=f-G.origin;G.origin=f;G.loops.forEach(L=>{L.t0+=delta;L.pend=null});send({type:"shift",delta});
 G.running=true;G.loops.forEach((L,i)=>{if(L.has&&(L.state==="play"||L.state==="dub"))send({type:"gate",i,on:L.muted?0:1,frame:f})});djRetime();render()}
function stopAll(){const f=nowF();G.stopAt=0;
 G.loops.forEach((L,i)=>{
  if(L.state==="rec")close(i);
  if(L.state==="armed")L.state="empty";
  if(L.state==="dub")endDub(i);
  if(L.pend){L.muted=L.pend.muted;L.pend=null}
  if(L.dropped){L.dropped=false;L.muted=false} // tolto dal break: alla ripartenza suona di nuovo
  // un loop che sta chiudendo partirebbe al suo confine: lo spengo lì
  send({type:"gate",i,on:0,frame:L.state==="closing"?Math.max(f,L.end):f})});
 G.drop=false;G.running=false;rollAllOff();cutOff();render()}
// ■ a loop avviati: si ferma tutto alla fine del giro, sul battere; ■ di nuovo: subito
function stopButton(){if(!ready)return;
 if(G.stopAt||!G.running){const n=allNotesOff();if(G.stopAt||G.loops.some(l=>l.state==="rec"||l.state==="armed"))stopAll();else if(n)flashHint("Spente le note rimaste accese.");return}
 const f=nowF();let at=G.origin+Math.ceil((f-G.origin)/G.base)*G.base;if(at-f<sr*.03)at+=G.base;
 G.stopAt=at;
 G.loops.forEach((L,i)=>{
  if(L.state==="rec")close(i);
  if(L.state==="armed")L.state="empty";
  if(L.state==="dub")send({type:"undub",i,frame:at});
  send({type:"gate",i,on:0,frame:at})});
 render()}
// ■ (o spazio) tenuto premuto 2 s: cancella tutto. Dall'Axiom solo se il tasto manda anche il rilascio,
// altrimenti ogni pressione cancellerebbe tutto.
let stopHold=0,stopRel=false;
function stopPress(){clearTimeout(stopHold);
 stopHold=setTimeout(()=>{if(!anyHas())return;flashHint("Continua a tenere premuto per <b>cancellare tutto</b>…");
  stopHold=setTimeout(()=>{stopHold=0;if(anyHas())clearAll()},1500)},500)}
function stopRelease(){clearTimeout(stopHold);stopHold=0}
function clearAll(){send({type:"reset"});saveSoon();for(let i=0;i<NL;i++)dbgForget(i);DBG.gridClose=null;G.base=null;G.running=false;G.stopAt=0;G.drop=false;rollAllOff();CUT=null;djRetime();G.ev=[];TSRC.length=0;if(TEMPO.want)tempoCancel();
 G.loops.forEach(L=>Object.assign(L,{state:"empty",has:false,muted:false,pend:null,dropped:false,peaks:null,undo:0,redo:0}));flashHint("Tutto cancellato. Il prossimo giro lo decidi tu.")}
function playButton(){if(!ready)return;if(!G.base){flashHint(START_HINT);return}
 if(G.running){flashHint("Sta già suonando. <b>■</b> per fermare a fine giro.");return}playAll()}

// ---------- Break: ▶ mentre i loop suonano ----------
// al prossimo 1 resta solo il loop selezionato (G.drop); ▶ di nuovo = tutto rientra sul prossimo 1.
const barF=()=>G.base*Math.min(1,4/G.beats);
function nextBar(f){const b=barF();return G.origin+Math.ceil((f-G.origin+sr*.03)/b)*b}
function dropToggle(){if(!G.running||G.stopAt)return;const at=nextBar(nowF());
 if(G.drop){G.drop=false;
  G.loops.forEach((L,i)=>{if(!L.dropped)return;L.dropped=false;L.pend={muted:false,at};send({type:"gate",i,on:1,frame:at})})}
 else{const ids=[];G.loops.forEach((L,i)=>{if(i!==G.sel&&L.has&&L.state==="play"&&!L.muted&&!L.pend)ids.push(i)});
  if(!ids.length){flashHint("Niente da togliere: suona solo il loop selezionato.");return}
  G.drop=true;ids.forEach(i=>{const L=G.loops[i];L.dropped=true;L.pend={muted:true,at};send({type:"gate",i,on:0,frame:at})})}
 render()}
// ▶ (Axiom, B, pulsante BREAK, telefono): da fermo fa partire tutto, mentre suona break / rientro
function playPress(){if(!ready)return;if(!G.running){playButton();return}dropToggle()}
function dubButton(){if(!ready)return;const i=G.sel,L=G.loops[i];
 if(L.state==="play")startDub(i);else if(L.state==="dub")endDub(i);else tap(i)}
function undoSel(redo){if(!ready)return;const i=G.sel,L=G.loops[i];
 if(L.state==="armed"){L.state="empty";render();return}
 if(L.state==="rec"){send({type:"cancelRec",i});G.ev=G.ev.filter(e=>e.i!==i);L.state="empty";if(L.first){G.base=null}flashHint(`Registrazione del loop ${i+1} annullata.`);return}
 if(L.state==="closing")return;
 if(L.state==="dub")L.state="play";
 if(redo?!L.redo:!L.undo){flashHint(redo?"Niente da ripetere.":"Niente da annullare sul loop "+(i+1)+".");return}
 send({type:redo?"redo":"undo",i});dbgForget(i);
 flashHint((redo?"Ripristinato":"Annullato")+` l'ultimo strato del loop ${i+1}.`)}
