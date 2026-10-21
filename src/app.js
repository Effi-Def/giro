// ---------- Audio ----------
let ctx,sr,node,core=null,ready=false,masterIn,masterOut,cutF,dry,wet,noiseBuf,liveBus=[],usingWorklet=false;
const SET={sound:0,cut:1,rev:.25,master:.9,oct:0,quant:4};
function loadSet(){try{Object.assign(SET,JSON.parse(localStorage.getItem("giro5.set")||"{}"))}catch(_){}SET.sound=Math.min(SET.sound|0,SOUNDS.length-1);delete SET.latMs}
function saveSet(){SET.sid=SOUNDS[SET.sound]?.id;try{localStorage.setItem("giro5.set",JSON.stringify(SET))}catch(_){}}

async function initAudio(){
 if(ctx)return;
 ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});sr=ctx.sampleRate;
 masterIn=ctx.createGain();cutF=ctx.createBiquadFilter();cutF.type="lowpass";cutF.Q.value=.7;
 const comp=ctx.createDynamicsCompressor();comp.threshold.value=-12;comp.ratio.value=4;comp.attack.value=.004;comp.release.value=.2;
 dry=ctx.createGain();wet=ctx.createGain();const conv=ctx.createConvolver();conv.buffer=impulse(2.4);
 masterOut=ctx.createGain();
 buildDJ();masterIn.connect(DJ.in);DJ.out.connect(cutF);cutF.connect(dry);cutF.connect(conv);conv.connect(wet);dry.connect(comp);wet.connect(comp);comp.connect(masterOut);masterOut.connect(ctx.destination);
 // tre bus per il suono dal vivo: sentito subito e registrabile dal looper
 for(let b=0;b<3;b++){const g=ctx.createGain();g.channelCount=1;g.channelCountMode="explicit";g.connect(masterIn);liveBus.push(g)}
 try{
  const src=LoopCore.toString()+`
class GiroLooper extends AudioWorkletProcessor{constructor(){super();this.c=new LoopCore(sampleRate);this.port.onmessage=e=>this.c.cmd(e.data)}
 process(inputs,outputs){const ins=[0,1,2].map(b=>inputs[b]&&inputs[b][0]);const o=outputs[0][0];this.c.process(ins,o,currentFrame,o.length,outputs[0][1]);
  if(this.c.msgs.length){this.port.postMessage(this.c.msgs);this.c.msgs=[]}return true}}
registerProcessor("giro-looper",GiroLooper);`;
  // da file locale Chrome rifiuta i moduli blob:, quindi prima data:, poi blob:
  try{await ctx.audioWorklet.addModule("data:application/javascript;charset=utf-8,"+encodeURIComponent(src))}
  catch(_){await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src],{type:"application/javascript"})))}
  node=new AudioWorkletNode(ctx,"giro-looper",{numberOfInputs:3,numberOfOutputs:1,outputChannelCount:[2],channelCount:1,channelCountMode:"explicit"});
  node.port.onmessage=e=>e.data.forEach(onCoreMsg);
  liveBus.forEach((g,b)=>g.connect(node,0,b));usingWorklet=true;
 }catch(err){
  // riserva: stesso motore su ScriptProcessor
  core=new LoopCore(sr);const merger=ctx.createChannelMerger(3);liveBus.forEach((g,b)=>g.connect(merger,0,b));
  node=ctx.createScriptProcessor(1024,3,2);merger.connect(node);
  node.onaudioprocess=e=>{const ins=[0,1,2].map(c=>e.inputBuffer.getChannelData(c)),o=e.outputBuffer.getChannelData(0);
   core.process(ins,o,Math.round(e.playbackTime*sr),o.length,e.outputBuffer.getChannelData(1));if(core.msgs.length){const m=core.msgs;core.msgs=[];m.forEach(onCoreMsg)}};
 }
 node.connect(masterIn);
 applyMix();ready=true;
 loadSound(SET.sound).then(preloadAll,preloadAll);restoreSession();
 setInterval(tick,20);
}
function send(c){if(!ready)return;if(usingWorklet)node.port.postMessage(c);else core.cmd(c)}
function applyMix(){if(!ctx)return;const t=ctx.currentTime;
 cutF.frequency.setTargetAtTime(200*Math.pow(100,SET.cut),t,.02);wet.gain.setTargetAtTime(SET.rev*.5+DJV[2]*.8,t,.02);masterOut.gain.setTargetAtTime(SET.master,t,.02)}

// ---------- Effetti DJ sul mix: manopole in modo MIDI (LED spenti) ----------
// 1 filtro · 2 eco · 3 riverbero · 4 flanger · 5 crusher · 6 trance gate · 7 roll · 8 volume della tastiera.
// Tutti nodi nativi del browser (leggeri). A manopole spente (filtro al centro) il suono passa com'era.
const DJ_NAMES=["FILTRO","ECO","RIVERBERO","FLANGER","CRUSHER","GATE","ROLL","TASTIERA"];
const DJV=[0,0,0,0,0,0,0,1]; // filtro -1…1 (0 = spento), gli altri 0…1; la tastiera parte al massimo
let DJ=null,rollK=0;
const ROLL_NAMES={1:"1/4",2:"1/8",4:"1/16",8:"1/32"};
function buildDJ(){const c=ctx,g=v=>{const n=c.createGain();n.gain.value=v;return n};
 const D={in:g(1),out:g(1),crush:c.createWaveShaper(),lp:c.createBiquadFilter(),hp:c.createBiquadFilter()};
 D.lp.type="lowpass";D.lp.frequency.value=22000;D.lp.Q.value=.7;D.hp.type="highpass";D.hp.frequency.value=10;D.hp.Q.value=.7;
 // flanger: ritardo corto modulato da un LFO, sommato al segnale diretto
 D.flDry=g(1);D.flWet=g(0);D.flFb=g(0);D.fl=g(1);D.flDel=c.createDelay(.05);D.flDel.delayTime.value=.004;
 D.flLfo=c.createOscillator();D.flLfo.frequency.value=.18;D.flDepth=g(.0025);D.flLfo.connect(D.flDepth);D.flDepth.connect(D.flDel.delayTime);D.flLfo.start();
 // trance gate: un'onda quadra a tempo (ammorbidita) che apre e chiude il volume
 D.gate=g(1);D.gateAmt=g(0);D.gateLP=c.createBiquadFilter();D.gateLP.type="lowpass";D.gateLP.frequency.value=60;
 D.gateLP.connect(D.gateAmt);D.gateAmt.connect(D.gate.gain);D.gateOsc=null;
 // roll: una linea di ritardo lunga quanto il pezzo, che a un certo punto si richiude su sé stessa
 D.rDry=g(1);D.rIn=g(1);D.rFb=g(0);D.rWet=g(0);D.r=g(1);D.rDel=c.createDelay(2.5);
 // eco: mandata con ritardo a tempo e ritorno
 D.eDel=c.createDelay(3);D.eDel.delayTime.value=.375;D.eFb=g(0);D.eWet=g(0);
 D.in.connect(D.crush);D.crush.connect(D.lp);D.lp.connect(D.hp);
 D.hp.connect(D.flDry);D.hp.connect(D.flDel);D.flDel.connect(D.flWet);D.flDel.connect(D.flFb);D.flFb.connect(D.flDel);
 D.flDry.connect(D.fl);D.flWet.connect(D.fl);D.fl.connect(D.gate);
 D.gate.connect(D.rDry);D.gate.connect(D.rIn);D.rIn.connect(D.rDel);D.rDel.connect(D.rFb);D.rFb.connect(D.rDel);D.rDel.connect(D.rWet);
 D.rDry.connect(D.r);D.rWet.connect(D.r);
 D.r.connect(D.out);D.r.connect(D.eDel);D.eDel.connect(D.eFb);D.eFb.connect(D.eDel);D.eDel.connect(D.eWet);D.eWet.connect(D.out);
 DJ=D}
const beatS=()=>G.base?G.base/G.beats/sr:.5;
// eco e gate seguono il tempo: da richiamare quando il tempo o l'1 cambiano
function djRetime(){if(!DJ)return;const t=ctx.currentTime;
 DJ.eDel.delayTime.setTargetAtTime(Math.min(2.9,.75*beatS()),t,.05);
 if(DJ.gateOsc){try{DJ.gateOsc.stop()}catch(_){}DJ.gateOsc.disconnect();DJ.gateOsc=null}
 if(DJV[5]>0&&G.base){const o=ctx.createOscillator();o.type="square";o.frequency.value=2/beatS(); // aperto un sedicesimo, chiuso un sedicesimo
  const b=G.base/G.beats,T=(G.origin+Math.ceil((nowF()+sr*.02-G.origin)/b)*b)/sr;o.connect(DJ.gateLP);o.start(T);DJ.gateOsc=o}
 if(rollK){const k=rollK;rollK=0;djRoll(k)}}
function djRoll(k){if(!DJ)return;if(!G.base||!G.running)k=0;if(k===rollK)return;rollK=k;
 const D=DJ,t=ctx.currentTime;[D.rDry,D.rIn,D.rWet,D.rFb].forEach(n=>n.gain.cancelScheduledValues(t));D.rDel.delayTime.cancelScheduledValues(t);
 if(!k){const T=t+.005;D.rDry.gain.setValueAtTime(1,T);D.rIn.gain.setValueAtTime(1,T);D.rWet.gain.setValueAtTime(0,T);D.rFb.gain.setValueAtTime(0,T);return}
 // dal prossimo pezzo a tempo: lo lascio passare registrandolo, poi lo ripeto finché la manopola resta girata
 const s=G.base/(G.beats*k),f=nowF(),Tg=G.origin+Math.ceil((f+sr*.01-G.origin)/s)*s,T1=Tg/sr,T2=(Tg+s)/sr;
 D.rDel.delayTime.setValueAtTime(s/sr,T1);D.rIn.gain.setValueAtTime(1,T1);D.rDry.gain.setValueAtTime(1,T1);D.rWet.gain.setValueAtTime(0,T1);D.rFb.gain.setValueAtTime(0,T1);
 D.rIn.gain.setValueAtTime(0,T2);D.rDry.gain.setValueAtTime(0,T2);D.rWet.gain.setValueAtTime(1,T2);D.rFb.gain.setValueAtTime(1,T2)}
function crushCurve(a){if(a<.02)return null;const n=4096,c=new Float32Array(n),steps=Math.pow(2,12-a*9)/2;
 for(let k=0;k<n;k++){const x=k/(n-1)*2-1;c[k]=Math.round(x*steps)/steps}return c}
function djKnob(i,v){
 if(i===0){let x=Math.max(-1,Math.min(1,(v-64)/63));if(Math.abs(x)<.04)x=0;DJV[0]=x}else DJV[i]=v/127;
 if(DJ){const D=DJ,t=ctx.currentTime,a=DJV[i];
  switch(i){
   case 0:{const x=DJV[0],u=Math.max(0,(Math.abs(x)-.04)/.96);
    D.lp.frequency.setTargetAtTime(x<0?22000*Math.pow(180/22000,u):22000,t,.02);D.hp.frequency.setTargetAtTime(x>0?10*Math.pow(600,u):10,t,.02);
    D.lp.Q.setTargetAtTime(x<0?.7+u*1.3:.7,t,.05);D.hp.Q.setTargetAtTime(x>0?.7+u*1.3:.7,t,.05);break}
   case 1:D.eWet.gain.setTargetAtTime(a*.55,t,.03);D.eFb.gain.setTargetAtTime(a>0?.15+a*.55:0,t,.03);D.eDel.delayTime.setTargetAtTime(Math.min(2.9,.75*beatS()),t,.05);break;
   case 2:applyMix();break;
   case 3:D.flWet.gain.setTargetAtTime(a*.7,t,.03);D.flFb.gain.setTargetAtTime(a*.55,t,.03);break;
   case 4:D.crush.curve=crushCurve(a);break;
   case 5:{const was=!!D.gateOsc;D.gate.gain.setTargetAtTime(1-a/2,t,.02);D.gateAmt.gain.setTargetAtTime(a/2,t,.02);if((a>0)!==was)djRetime();break}
   case 6:djRoll(a<.1?0:[1,2,4,8][Math.min(3,Math.floor((a-.1)/.9*4))]);break}}
 if(knobMode!=="dj")setKnobMode("dj");
 flashHint(`Effetto <b>${i+1} ${DJ_NAMES[i]}</b>: `+djText(i));render()}
function djText(i){const a=DJV[i];
 if(i===0)return a===0?"spento":a<0?"più scuro "+Math.round(-a*100)+"%":"più leggero "+Math.round(a*100)+"%";
 if(i===6)return rollK?"ripete "+ROLL_NAMES[rollK]:(G.base&&G.running?"spento":"serve un loop che suona");
 if(i===5&&a>0&&!G.base)return "serve un loop che suona";
 return a<.02&&i!==7?"spento":Math.round(a*100)+"%"}
const nowF=()=>Math.round(ctx.currentTime*sr);
// i suoni sono tutti interni: le note e i loop escono con lo stesso ritardo e chi suona si allinea a orecchio,
// quindi la latenza d'uscita non va compensata (spostava le note in anticipo). Resta solo il buffer dello ScriptProcessor.
function latencyFrames(){return usingWorklet?0:1024}
// ritardo tra il tasto e il suono: solo da mostrare nelle impostazioni
function audioDelayMs(){return((ctx.outputLatency||0)+(ctx.baseLatency||0))*1000}

// ---------- Stato del looper ----------
const NL=8;
const G={base:null,beats:4,origin:0,running:false,stopAt:0,drop:false,dubTake:[],firstOn:[],cur:0,sel:0,ev:[],
 loops:Array.from({length:NL},()=>({sound:null,state:"empty",has:false,muted:false,pend:null,len:0,t0:0,start:0,end:0,first:false,peaks:null,vol:.8,pan:0,fx:0,undo:0,redo:0}))};
const anyHas=()=>G.loops.some(l=>l.has||l.state==="rec"||l.state==="closing");
function Q(){let q=G.base,k=0;while(q/2>=sr*.9&&k<3){q/=2;k++}return Math.round(q)}
function nextQ(f){const q=Q();return G.origin+Math.ceil((f-G.origin+sr*.03)/q)*q}
function rotateBus(){G.cur=(G.cur+1)%3}

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
 send({type:"fill",i,data})}
function commitDubNote(e){e.done=true;G.ev=G.ev.filter(x=>x!==e);const L=G.loops[e.i];if(!L.has||!L.len)return;
 const seg=renderNote(e.sound,e.note,e.vel,Math.max(e.off-e.on,sr*.03),e.lv);if(!seg)return;
 G.dubTake.push(e);checkDouble(G.dubTake);
 const idx=qIndex(e,L);let at=L.t0+idx;const min=e.on+L.len*.5;
 if(at<min)at+=Math.ceil((min-at)/L.len)*L.len;
 send({type:"pend",i:e.i,start:idx,data:seg,at})}
function cycleQuant(){SET.quant=SET.quant===4?2:SET.quant===2?0:4;saveSet();
 const busy=G.loops.some(L=>L.state==="rec"||L.state==="closing"||L.state==="dub")?" Vale dalla prossima registrazione.":"";
 flashHint((SET.quant?`Quantizzazione: ${QNAMES[SET.quant]}. Le note registrate vengono rimesse a tempo.`:"Quantizzazione spenta: registro esattamente come suoni.")+busy)}

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
   L.dropped=false; // toccato a mano durante un drop: da qui in poi lo decidi tu
   if(!G.running){L.muted=!L.muted;break}
   if(L.pend){L.pend=null;send({type:"gate",i,on:L.muted?0:1,frame:nowF()});break}
   // si ferma alla suddivisione successiva, rientra sull'1 della battuta
   {const at=L.muted?nextBar(nowF()):nextQ(nowF());L.pend={muted:!L.muted,at};send({type:"gate",i,on:L.muted?1:0,frame:at})}break;
  case "dub":endDub(i);break}
 render()}

function beginRec(i){const L=G.loops[i],f=nowF();
 if(L.first){G.running=false;G.firstOn=[];send({type:"rec",i,bus:G.cur,start:f,comp:0})}
 else{if(!G.running)playAll(f);send({type:"rec",i,bus:G.cur,start:f,comp:latencyFrames()})}
 L.start=f;L.state="rec";L.sound=SET.sound;L.q=SET.quant;render()}

function close(i){const L=G.loops[i],f=nowF();
 if(L.first){
  if(f-L.start<sr*.25){send({type:"cancelRec",i});L.state="empty";flashHint("Troppo corto: tieni il primo giro almeno un quarto di secondo.");return}
  const len=f-L.start;
  G.base=len;G.beats=beatsFor(len);G.origin=L.start;L.len=len;L.t0=L.start;
  send({type:"recEnd",i,end:f,len,t0:L.start});
  // anche registrato senza quantizzazione, il primo giro decide se il tempo vero è il doppio (sopra i 140)
  if(L.q)renderRec(i);else checkDouble(G.firstOn.map(on=>({on,comp:0})));
  send({type:"gate",i,on:1,frame:f});
  L.state="play";L.has=true;L.muted=false;G.running=true;rotateBus();djRetime();return}
 const k=Math.max(1,Math.round((f-L.start)/G.base)),len=k*G.base,end=Math.max(L.start+len,f);
 L.len=len;L.t0=L.start;L.end=end;L.has=true;L.muted=false;
 send({type:"recEnd",i,end,len,t0:L.start});send({type:"gate",i,on:G.running?1:0,frame:end});
 if(end>f+sr*.02)L.state="closing";else{if(L.q)renderRec(i);L.state="play";rotateBus()}}

function startDub(i){const L=G.loops[i];if(!G.running)playAll();
 G.loops.forEach((o,j)=>{if(j!==i&&o.state==="dub")endDub(j)}); // una sovraincisione alla volta
 if(L.muted){L.muted=false;L.pend=null;send({type:"gate",i,on:1,frame:nowF()})}
 send({type:"dub",i,bus:G.cur,comp:latencyFrames()});L.state="dub";L.q=SET.quant;G.dubTake=[];render()}
function endDub(i){send({type:"undub",i});G.loops[i].state="play";rotateBus();render()}

function clearLoop(i){const L=G.loops[i];
 if(L.state==="armed"){L.state="empty";render();return}
 send({type:"clear",i});Object.assign(L,{state:"empty",has:false,muted:false,pend:null,dropped:false,peaks:null});
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
  if(L.dropped){L.dropped=false;L.muted=false} // tolto dal drop: alla ripartenza suona di nuovo
  // un loop che sta chiudendo partirebbe al suo confine: lo spengo lì
  send({type:"gate",i,on:0,frame:L.state==="closing"?Math.max(f,L.end):f})});
 G.drop=false;buildCancel();G.running=false;djRoll(0);render()}
// ■ a loop avviati: si ferma tutto alla fine del giro, sul battere; ■ di nuovo: subito
function stopButton(){if(!ready)return;
 if(G.stopAt||!G.running){if(G.stopAt||G.loops.some(l=>l.state==="rec"||l.state==="armed"))stopAll();return}
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
function clearAll(){send({type:"reset"});saveSoon();G.base=null;G.running=false;G.stopAt=0;G.drop=false;buildCancel();djRoll(0);djRetime();G.ev=[];
 G.loops.forEach(L=>Object.assign(L,{state:"empty",has:false,muted:false,pend:null,dropped:false,peaks:null,undo:0,redo:0}));flashHint("Tutto cancellato. Il prossimo giro lo decidi tu.")}
function playButton(){if(!ready)return;if(!G.base){flashHint(START_HINT);return}
 if(G.running){flashHint("Sta già suonando. <b>■</b> per fermare a fine giro.");return}playAll()}

// ---------- Drop e build-up: ▶ mentre i loop suonano ----------
// tocco = drop: al prossimo 1 resta solo il loop selezionato; ritocco = tutto rientra sul prossimo 1.
// tenuto = build-up: il filtro si chiude piano; quando lasci si riapre di colpo sul prossimo 1 (e finisce il drop).
const barF=()=>G.base*Math.min(1,4/G.beats);
function nextBar(f){const b=barF();return G.origin+Math.ceil((f-G.origin+sr*.03)/b)*b}
function dropToggle(){if(!G.running||G.stopAt)return;const at=nextBar(nowF());
 if(G.drop){G.drop=false;
  G.loops.forEach((L,i)=>{if(!L.dropped)return;L.dropped=false;L.pend={muted:false,at};send({type:"gate",i,on:1,frame:at})})}
 else{const ids=[];G.loops.forEach((L,i)=>{if(i!==G.sel&&L.has&&L.state==="play"&&!L.muted&&!L.pend)ids.push(i)});
  if(!ids.length){flashHint("Niente da togliere: suona solo il loop selezionato.");return}
  G.drop=true;ids.forEach(i=>{const L=G.loops[i];L.dropped=true;L.pend={muted:true,at};send({type:"gate",i,on:0,frame:at})})}
 render()}
let building=false;const FILTER_Q=1;
const cutHz=()=>200*Math.pow(100,SET.cut);
function holdParam(p,t){try{p.cancelAndHoldAtTime(t)}catch(_){p.cancelScheduledValues(t);p.setValueAtTime(p.value,t)}}
function buildStart(){if(!G.running||G.stopAt)return;building=true;
 const t=ctx.currentTime,dur=Math.max(2,Math.min(8,2*barF()/sr)),f=cutF.frequency,q=cutF.Q;
 holdParam(f,t);f.exponentialRampToValueAtTime(Math.min(f.value,300),t+dur);
 holdParam(q,t);q.linearRampToValueAtTime(8,t+dur);render()}
function buildEnd(){if(!building)return;building=false;
 const T=nextBar(nowF())/sr,t=ctx.currentTime;
 holdParam(cutF.frequency,t);holdParam(cutF.Q,t);cutF.frequency.setValueAtTime(cutHz(),T);cutF.Q.setValueAtTime(FILTER_Q,T);
 if(G.drop)dropToggle();render()}
function buildCancel(){if(!building||!ctx)return;building=false;const t=ctx.currentTime;
 holdParam(cutF.frequency,t);holdParam(cutF.Q,t);cutF.frequency.setTargetAtTime(cutHz(),t,.05);cutF.Q.setTargetAtTime(FILTER_Q,t,.05)}
// ▶ dall'Axiom distingue tocco e tenuto solo se il tasto manda anche il rilascio; altrimenti ogni pressione è un tocco
let playHoldT=0,playHeld=false,playRel=false;
function playDown(canHold){if(!ready)return;
 if(!G.running){playButton();return}
 if(!canHold){dropToggle();return}
 playHeld=true;clearTimeout(playHoldT);playHoldT=setTimeout(()=>{playHoldT=0;buildStart()},400)}
function playUp(){if(!playHeld)return;playHeld=false;
 if(playHoldT){clearTimeout(playHoldT);playHoldT=0;dropToggle()}else buildEnd()}
function dubButton(){if(!ready)return;const i=G.sel,L=G.loops[i];
 if(L.state==="play")startDub(i);else if(L.state==="dub")endDub(i);else tap(i)}
function undoSel(redo){if(!ready)return;const i=G.sel,L=G.loops[i];
 if(L.state==="armed"){L.state="empty";render();return}
 if(L.state==="rec"){send({type:"cancelRec",i});G.ev=G.ev.filter(e=>e.i!==i);L.state="empty";if(L.first){G.base=null}flashHint(`Registrazione del loop ${i+1} annullata.`);return}
 if(L.state==="closing")return;
 if(L.state==="dub")L.state="play";
 if(redo?!L.redo:!L.undo){flashHint(redo?"Niente da ripetere.":"Niente da annullare sul loop "+(i+1)+".");return}
 send({type:redo?"redo":"undo",i});flashHint((redo?"Ripristinato":"Annullato")+` l'ultimo strato del loop ${i+1}.`)}

// ---------- Sessione: salvataggio automatico dei loop in IndexedDB, ripresa all'apertura ----------
// Si salva un attimo dopo l'ultima modifica (loop chiuso, sovraincisione, annulla, cancella, volume/pan/filtro).
// Il core manda copie dei buffer (dump); alla ripresa i loop tornano fermi, ▶ li fa partire. Tutto in try/catch:
// se IndexedDB non c'è, Giro funziona come prima senza salvare.
let saveT=0,restoring=false;
function saveSoon(){if(restoring)return;clearTimeout(saveT);saveT=setTimeout(()=>send({type:"dump"}),2500)}
function idb(mode,fn){return new Promise((ok,ko)=>{const r=indexedDB.open("giro",1);r.onupgradeneeded=()=>r.result.createObjectStore("session");
 r.onerror=()=>ko(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction("session",mode),q=fn(t.objectStore("session"));
  t.oncomplete=()=>{d.close();ok(q&&q.result)};t.onerror=()=>ko(t.error)}})}
// ---------- Esporta WAV: un giro dei loop che suonano, reso offline con lo stesso LoopCore ----------
let exportWant=false;
function exportWav(){
 if(!ready||!G.base||!G.loops.some(L=>L.has&&!L.muted)){flashHint("Niente da esportare: registra almeno un loop.");return}
 exportWant=true;send({type:"dump"});flashHint("Preparo il file WAV…")}
function wavBlob(L,R,rate){const n=L.length,d=new DataView(new ArrayBuffer(44+n*4)),w=(o,s)=>{for(let k=0;k<s.length;k++)d.setUint8(o+k,s.charCodeAt(k))};
 let pk=0;for(let k=0;k<n;k++)pk=Math.max(pk,Math.abs(L[k]),Math.abs(R[k]));const sc=pk>.98?.98/pk:1;
 w(0,"RIFF");d.setUint32(4,36+n*4,true);w(8,"WAVEfmt ");d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,2,true);
 d.setUint32(24,rate,true);d.setUint32(28,rate*4,true);d.setUint16(32,4,true);d.setUint16(34,16,true);w(36,"data");d.setUint32(40,n*4,true);
 for(let k=0;k<n;k++){d.setInt16(44+k*4,Math.round(L[k]*sc*32767),true);d.setInt16(46+k*4,Math.round(R[k]*sc*32767),true)}
 return new Blob([d],{type:"audio/wav"})}
function doExport(items){
 const c=new LoopCore(sr);let max=0;
 for(const it of items){const L=G.loops[it.i];if(!L||L.muted)continue;
  c.exec({type:"load",i:it.i,data:it.data,len:it.len,t0:it.t0-G.origin,vol:L.vol,pan:L.pan,fx:L.fx},0);
  const o=c.loops[it.i];o.g=o.vol;o.gt=1;max=Math.max(max,it.len)}
 c.msgs=[];if(!max){flashHint("Niente da esportare: i loop sono fermi.");return}
 const L=new Float32Array(max),R=new Float32Array(max),a=new Float32Array(512),b=new Float32Array(512),none=[null,null,null];
 for(let f=0;f<max;f+=512){const n=Math.min(512,max-f),A=a.subarray(0,n),B=b.subarray(0,n);
  c.process(none,A,f,n,B);L.set(A,f);R.set(B,f);c.msgs=[]}
 const t=new Date(),p=x=>String(x).padStart(2,"0"),name=`giro-${t.getFullYear()}${p(t.getMonth()+1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}.wav`;
 const url=URL.createObjectURL(wavBlob(L,R,sr)),el=document.createElement("a");el.href=url;el.download=name;document.body.appendChild(el);el.click();el.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
 flashHint(`<b>${name}</b> scaricato: ${(max/sr).toFixed(1)} s, un giro dei loop.`)}
function onDump(items){
 if(exportWant){exportWant=false;return doExport(items)}
 if(!items.length){if(!G.loops.some(L=>L.state==="rec"||L.state==="closing")&&!anyHas())idb("readwrite",s=>s.delete("s")).catch(()=>{});return}
 if(!G.base)return;
 const rec={v:1,sr,base:G.base,beats:G.beats,loops:items.map(it=>{const L=G.loops[it.i];
  return{i:it.i,len:it.len,rel:it.t0-G.origin,data:it.data,vol:L.vol,pan:L.pan,fx:L.fx,sound:L.sound}})};
 idb("readwrite",s=>s.put(rec,"s")).catch(()=>{})}
async function restoreSession(){
 let rec=null;try{rec=await idb("readonly",s=>s.get("s"))}catch(_){}
 if(!rec||rec.v!==1||rec.sr!==sr||anyHas()||G.base)return;
 restoring=true;
 G.base=rec.base;G.beats=rec.beats;G.origin=nowF();G.running=false;
 for(const s of rec.loops){const L=G.loops[s.i];if(!L)continue;
  Object.assign(L,{vol:s.vol,pan:s.pan,fx:s.fx,sound:s.sound});
  send({type:"load",i:s.i,data:s.data,len:s.len,t0:G.origin+s.rel,vol:s.vol,pan:s.pan,fx:s.fx})}
 setTimeout(()=>{restoring=false},500);
 flashHint("Ripresa la sessione precedente: <b>▶</b> per riascoltarla. Tieni premuto <b>■</b> per cancellare tutto.");render()}

function onCoreMsg(m){
 if(m.type==="dump")return onDump(m.items);
 const L=G.loops[m.i];if(!L)return;
 if(m.type==="peaks"){L.peaks=m.peaks;drawWave(m.i);saveSoon();return}
 if(m.type==="state"){saveSoon();L.undo=m.undo;L.redo=m.redo;
  if(m.has){L.len=m.len;L.t0=m.t0;
   if(!L.has||L.state==="empty"){L.has=true;L.state="play";L.muted=false;if(!G.base){G.base=m.len;G.origin=m.t0}
    send({type:"gate",i:m.i,on:G.running?1:0,frame:nowF()})}}
  else if(L.state!=="armed"&&L.state!=="rec"){L.has=false;L.state="empty";L.peaks=null;drawWave(m.i)}
  render()}}

function tick(){if(!ready)return;const f=nowF();let ch=false;
 if(G.stopAt&&f>=G.stopAt){stopAll();ch=true}
 G.loops.forEach(L=>{
  if(L.state==="closing"&&f>=L.end){if(L.q)renderRec(G.loops.indexOf(L));L.state="play";rotateBus();ch=true}
  if(L.pend&&f>=L.pend.at){L.muted=L.pend.muted;L.pend=null;ch=true}});
 if(ch)render()}

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
  ev={i,kind:ti>=0?"rec":"dub",note,vel,sound:SET.sound,q:L.q,on:nowF(),off:null,comp:L.first&&ti>=0?0:latencyFrames()};G.ev.push(ev)}
 // nota annotata: il suono dal vivo non va al looper, nel loop entra la versione a tempo; altrimenti va sul bus registrato
 if(ev)ev.lv=DJV[7]; // il volume della tastiera vale anche per la nota rimessa a tempo nel loop
 held.set(note,{v:voice(SET.sound,note,vel,ctx.currentTime,ev?masterIn:liveBus[G.cur],DJV[7]),sus:false,ev});uiNote(note,true)}
let sustain=false;
function noteOff(note,force){const h=held.get(note);if(!h)return;if(sustain&&!force){h.sus=true;return}
 h.v.release(ctx.currentTime);held.delete(note);uiNote(note,false);
 if(h.ev&&!h.ev.done){h.ev.off=nowF();if(h.ev.kind==="dub")commitDubNote(h.ev)}}
function setSustain(on){sustain=on;if(!on)[...held.entries()].filter(([,h])=>h.sus).forEach(([n])=>noteOff(n,true))}
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

// ---------- Pad: tocco = azione, tenuto premuto = cancella ----------
const holdT={};
function padDown(i){tap(i);clearTimeout(holdT[i]);holdT[i]=setTimeout(()=>{holdT[i]=null;clearLoop(i)},800)}
function padUp(i){clearTimeout(holdT[i]);holdT[i]=null}

// ---------- MIDI (Axiom AIR Mini 32: modo MIDI canale 1, oppure HyperControl canale 16) ----------
// pad 1–8 = note 36–43 · manopole 1–8 = CC 1–8 · ■ ▶ ● = CC 16 17 18
// ◀ ▶ ▲ ▼ = CC 19 20 21 22 · tasto centrale = CC 23 · sustain = CC 64
const BTN={18:dubButton,19:()=>undoSel(false),20:()=>undoSel(true),21:()=>stepFamily(1),22:()=>stepFamily(-1),23:()=>stepInFamily(1)};
function initMIDI(){
 if(!navigator.requestMIDIAccess){setMidi(false,"MIDI non supportato: usa Chrome");return}
 navigator.requestMIDIAccess().then(acc=>{
  const bind=()=>{const names=[];acc.inputs.forEach(inp=>{inp.onmidimessage=onMIDI;names.push(inp.name.replace(/ MIDI In$/,""))});
   setMidi(names.length>0,names.length?names.join(", "):"Nessuna tastiera")};
  bind();acc.onstatechange=bind},()=>setMidi(false,"MIDI non consentito"))}
let diagOn=false;const diagLines=new Map();
// sceglie il loop su cui sovraincidere senza toccarne il pad (che lo fermerebbe): solo tra i loop pieni
function selStep(d){const ids=G.loops.map((L,i)=>L.has?i:-1).filter(i=>i>=0);if(!ids.length)return;
 const k=ids.indexOf(G.sel),i=k<0?ids[d>0?0:ids.length-1]:ids[(k+d+ids.length)%ids.length];
 G.sel=i;flash(`[data-loop="${i}"]`);flashHint(`Loop ${i+1} selezionato: <b>●</b> per sovraincidere.`)}
// pitch bend: su = loop successivo, giù = precedente. Scatta una volta per spinta e si riarma al centro,
// così funziona sia con una rampa di valori sia con un salto secco.
let pbArmed=true;
function pitchBend(v){if(Math.abs(v-8192)<1500){pbArmed=true;return}
 if(!pbArmed||!ready)return;if(v>12288){pbArmed=false;selStep(1)}else if(v<4096){pbArmed=false;selStep(-1)}}
// ---------- Manopole: volume, pan o filtro del loop ----------
// Il pulsante dei modi dell'Axiom (LED Volume / Pan / Inst-FX, tutti spenti = MIDI) manda in HyperControl
// CC 58 entrando in Volume o in Pan, CC 59 in Inst/FX, CC 60 in MIDI (canale 16, come lo script di Ableton).
// In MIDI le manopole tornano volume. Dallo schermo (o col tasto M) si cambia modo anche senza Axiom.
const KNOB_MODES=["vol","pan","dj"],KNOB_NAMES={vol:"VOLUME",pan:"PAN",fx:"FILTRO LOOP",dj:"EFFETTI DJ"};
let knobMode="vol",hcMode="midi";
function setKnobMode(m){knobMode=m;render();
 flashHint({vol:"Manopole: <b>VOLUME</b> dei loop.",pan:"Manopole: <b>PAN</b> — gira per spostare il loop a sinistra o a destra.",
  fx:"Manopole: <b>FILTRO</b> — a sinistra il loop si scurisce, a destra si alleggerisce, al centro niente.",
  dj:"Manopole: <b>EFFETTI DJ</b> sul mix — 1 filtro · 2 eco · 3 riverbero · 4 flanger · 5 crusher · 6 gate · 7 roll · 8 tastiera."}[m])}
function cycleKnobMode(){setKnobMode(KNOB_MODES[(KNOB_MODES.indexOf(knobMode)+1)%KNOB_MODES.length])}
function hcModeButton(cc){
 if(cc===58){hcMode=hcMode==="vol"?"pan":"vol";setKnobMode(hcMode)}
 else if(cc===59){hcMode="fx";setKnobMode("fx")}
 else{hcMode="midi";setKnobMode("dj")}} // modo MIDI (LED spenti): effetti DJ
function knob(i,v){const L=G.loops[i];if(knobMode==="dj")return djKnob(i,v);
 if(L.has)saveSoon();
 if(knobMode==="vol"){L.vol=v/127;send({type:"vol",i,v:L.vol});render();return}
 let x=Math.max(-1,Math.min(1,(v-64)/63));if(Math.abs(x)<.03)x=0;
 if(knobMode==="pan"){L.pan=x;send({type:"pan",i,v:x});
  flashHint(`Loop ${i+1}: ${x===0?"al centro":Math.round(Math.abs(x)*100)+"% a "+(x<0?"sinistra":"destra")}`)}
 else{L.fx=x;send({type:"fx",i,v:x});
  flashHint(`Loop ${i+1}: ${x===0?"filtro spento":x<0?"più scuro (passa-basso) "+Math.round(-x*100)+"%":"più leggero (passa-alto) "+Math.round(x*100)+"%"}`)}
 render()}
// HyperControl (canale 16): stessi comandi del modo MIDI con altri numeri
const HC_CC={116:16,117:17,118:18,99:19,100:20,101:21,102:22,98:23};
function onMIDI(e){let [st,d1,d2=0]=e.data,type=st&0xf0;if(st>=0xF0)return;
 const ch=st&15;
 // la diagnostica mostra i messaggi come arrivano, prima di tradurre quelli HyperControl
 if(diagOn&&(type===0x90&&d2>0||type===0xB0)){const k=(type===0xB0?"CC ":"nota ")+d1+" · canale "+(ch+1);if(!diagLines.has(k)){diagLines.set(k,1);$("#diag").textContent=[...diagLines.keys()].join("\n")}}
 if(ch===15&&type===0xB0){
  if(d1>=58&&d1<=60){if(d2>63)hcModeButton(d1);return}
  if(d1>=33&&d1<=40){if(ready)knob(d1-33,d2);return}
  if(HC_CC[d1])d1=HC_CC[d1]}
 // pad in HyperControl: note 81–84 = pad 1–4, 85–88 = pad 5–8 (canale 15, banco B sul 16)
 if(ch>=14&&(type===0x90||type===0x80)&&d1>=81&&d1<=88)d1=d1-81+36;
 const on=type===0x90&&d2>0,off=type===0x80||(type===0x90&&d2===0),cc=type===0xB0;
 if(type===0xE0){if(diagOn&&!diagLines.has("pitch bend")){diagLines.set("pitch bend",1);$("#diag").textContent=[...diagLines.keys()].join("\n")}return pitchBend(d1|(d2<<7))}
 if((on||off)&&d1>=36&&d1<=43){const i=d1-36;if(on){flash(`[data-loop="${i}"]`);padDown(i)}else padUp(i);return}
 if(cc){if(d1===64)return setSustain(d2>=64);
  if(d1===16){if(d2>63){flash(`[data-key="16"]`);stopButton();if(stopRel)stopPress()}else{stopRel=true;stopRelease()}return}
  if(d1===17){if(d2>63){flash(`[data-key="17"]`);playDown(playRel)}else{playRel=true;playUp()}return}
  if(BTN[d1]){if(d2>63){flash(`[data-key="${d1}"]`);BTN[d1]()}return}
  if(d1>=1&&d1<=8){if(ready)djKnob(d1-1,d2);return} // modo MIDI, LED spenti: le manopole sono gli effetti DJ
  return}
 if(on)noteOn(d1,d2/127);else if(off)noteOff(d1)}

// ---------- Tastiera del PC ----------
const KEYMAP="awsedftgyhujkolp;'";const pcHeld=new Map();
addEventListener("keydown",e=>{
 if(!$("#gate").hidden){e.preventDefault();start();return}
 if(!$("#settings").hidden){if(e.key==="Escape")closeSettings();return}
 if(e.target.matches("input,select")||e.ctrlKey||e.metaKey||e.altKey)return;
 const k=e.key.toLowerCase();
 if(e.code==="Space"){e.preventDefault();if(!e.repeat){(G.running?stopButton:playButton)();stopPress()}return}
 if(e.repeat)return;
 if(e.shiftKey&&/^Digit[1-8]$/.test(e.code)){const i=+e.code[5]-1;if(G.loops[i].has){G.sel=i;flashHint(`Loop ${i+1} selezionato: <b>●</b> per sovraincidere.`)}return}
 if(/^[1-8]$/.test(k))return padDown(+k-1);
 if(k==="r")return dubButton();
 if(k==="b")return playDown(true); // come ▶: tocco = drop, tenuto = build-up
 if(k==="q")return cycleQuant();
 if(k==="m")return cycleKnobMode();
 if(e.key==="Backspace"){e.preventDefault();return undoSel(false)}
 if(e.key==="ArrowUp"){e.preventDefault();return stepFamily(1)}
 if(e.key==="ArrowDown"){e.preventDefault();return stepFamily(-1)}
 if(e.key==="ArrowRight"){e.preventDefault();return stepInFamily(1)}
 if(e.key==="ArrowLeft"){e.preventDefault();return stepInFamily(-1)}
 if(k==="z"||k==="x"){SET.oct=Math.max(-3,Math.min(3,SET.oct+(k==="z"?-1:1)));flashHint(`Ottava tastiera PC: ${SET.oct>0?"+":""}${SET.oct}`);return}
 const idx=KEYMAP.indexOf(k);if(idx>=0){const n=60+SET.oct*12+idx;pcHeld.set(k,n);noteOn(n,.8)}});
addEventListener("keyup",e=>{const k=e.key.toLowerCase();
 if(e.code==="Space")return stopRelease();
 if(k==="b")return playUp();
 if(/^[1-8]$/.test(k))return padUp(+k-1);
 if(pcHeld.has(k)){noteOff(pcHeld.get(k));pcHeld.delete(k)}});
