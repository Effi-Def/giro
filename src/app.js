// ---------- Audio ----------
let ctx,sr,node,core=null,ready=false,masterIn,masterOut,cutF,dry,wet,noiseBuf,liveBus=[],usingWorklet=false;
const SET={sound:0,cut:1,rev:.25,master:.9,latMs:null,oct:0,quant:4};
function loadSet(){try{Object.assign(SET,JSON.parse(localStorage.getItem("giro5.set")||"{}"))}catch(_){}SET.sound=Math.min(SET.sound|0,SOUNDS.length-1)}
function saveSet(){try{localStorage.setItem("giro5.set",JSON.stringify(SET))}catch(_){}}

async function initAudio(){
 if(ctx)return;
 ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});sr=ctx.sampleRate;
 masterIn=ctx.createGain();cutF=ctx.createBiquadFilter();cutF.type="lowpass";cutF.Q.value=.7;
 const comp=ctx.createDynamicsCompressor();comp.threshold.value=-12;comp.ratio.value=4;comp.attack.value=.004;comp.release.value=.2;
 dry=ctx.createGain();wet=ctx.createGain();const conv=ctx.createConvolver();conv.buffer=impulse(2.4);
 masterOut=ctx.createGain();
 masterIn.connect(cutF);cutF.connect(dry);cutF.connect(conv);conv.connect(wet);dry.connect(comp);wet.connect(comp);comp.connect(masterOut);masterOut.connect(ctx.destination);
 // tre bus per il suono dal vivo: sentito subito e registrabile dal looper
 for(let b=0;b<3;b++){const g=ctx.createGain();g.channelCount=1;g.channelCountMode="explicit";g.connect(masterIn);liveBus.push(g)}
 try{
  const src=LoopCore.toString()+`
class GiroLooper extends AudioWorkletProcessor{constructor(){super();this.c=new LoopCore(sampleRate);this.port.onmessage=e=>this.c.cmd(e.data)}
 process(inputs,outputs){const ins=[0,1,2].map(b=>inputs[b]&&inputs[b][0]);const o=outputs[0][0];this.c.process(ins,o,currentFrame,o.length);
  if(this.c.msgs.length){this.port.postMessage(this.c.msgs);this.c.msgs=[]}return true}}
registerProcessor("giro-looper",GiroLooper);`;
  // da file locale Chrome rifiuta i moduli blob:, quindi prima data:, poi blob:
  try{await ctx.audioWorklet.addModule("data:application/javascript;charset=utf-8,"+encodeURIComponent(src))}
  catch(_){await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src],{type:"application/javascript"})))}
  node=new AudioWorkletNode(ctx,"giro-looper",{numberOfInputs:3,numberOfOutputs:1,outputChannelCount:[1],channelCount:1,channelCountMode:"explicit"});
  node.port.onmessage=e=>e.data.forEach(onCoreMsg);
  liveBus.forEach((g,b)=>g.connect(node,0,b));usingWorklet=true;
 }catch(err){
  // riserva: stesso motore su ScriptProcessor
  core=new LoopCore(sr);const merger=ctx.createChannelMerger(3);liveBus.forEach((g,b)=>g.connect(merger,0,b));
  node=ctx.createScriptProcessor(1024,3,1);merger.connect(node);
  node.onaudioprocess=e=>{const ins=[0,1,2].map(c=>e.inputBuffer.getChannelData(c)),o=e.outputBuffer.getChannelData(0);
   core.process(ins,o,Math.round(e.playbackTime*sr),o.length);if(core.msgs.length){const m=core.msgs;core.msgs=[];m.forEach(onCoreMsg)}};
 }
 node.connect(masterIn);
 applyMix();ready=true;
 loadSound(SET.sound).then(preloadAll,preloadAll);
 setInterval(tick,20);
}
function send(c){if(!ready)return;if(usingWorklet)node.port.postMessage(c);else core.cmd(c)}
function applyMix(){if(!ctx)return;const t=ctx.currentTime;
 cutF.frequency.setTargetAtTime(200*Math.pow(100,SET.cut),t,.02);wet.gain.setTargetAtTime(SET.rev*.5,t,.02);masterOut.gain.setTargetAtTime(SET.master,t,.02)}
const nowF=()=>Math.round(ctx.currentTime*sr);
function latencyFrames(){const auto=((ctx.outputLatency||0)+(ctx.baseLatency||0))*1000+(usingWorklet?0:1024/sr*1000);
 return Math.round(((SET.latMs??auto))/1000*sr)}

// ---------- Stato del looper ----------
const NL=8;
const G={base:null,beats:4,origin:0,running:false,cur:0,sel:0,ev:[],
 loops:Array.from({length:NL},()=>({sound:null,state:"empty",has:false,muted:false,pend:null,len:0,t0:0,start:0,end:0,first:false,peaks:null,vol:.8,undo:0,redo:0}))};
const anyHas=()=>G.loops.some(l=>l.has||l.state==="rec"||l.state==="closing");
function Q(){let q=G.base,k=0;while(q/2>=sr*.9&&k<3){q/=2;k++}return Math.round(q)}
function nextQ(f){const q=Q();return G.origin+Math.ceil((f-G.origin+sr*.03)/q)*q}
function rotateBus(){G.cur=(G.cur+1)%3}

// ---------- Quantizzazione ----------
// Mentre suoni senti le note subito; nel loop viene scritta la versione rimessa a tempo sulla griglia.
const QNAMES={0:"NO",2:"1/8",4:"1/16"};
function beatsFor(len){const secs=len/sr;let n=1;while(60*n/secs<70)n*=2;return n}
const bpm=()=>G.base?60*G.beats/(G.base/sr):0;
function gridF(q){return G.base/(G.beats*q)}
function qIndex(ev,L){const g=gridF(ev.q),rel=ev.on-ev.comp-G.origin,q=Math.round(rel/g)*g;
 return((Math.round(q+G.origin-L.t0)%L.len)+L.len)%L.len}
function renderRec(i){const L=G.loops[i],evs=G.ev.filter(e=>e.i===i&&e.kind==="rec");G.ev=G.ev.filter(e=>!evs.includes(e));
 const data=new Float32Array(L.len),now=nowF();
 for(const e of evs){e.done=true;const seg=renderNote(e.sound,e.note,e.vel,Math.max((e.off??now)-e.on,sr*.03));if(!seg)continue;
  let p=qIndex(e,L);for(let k=0;k<seg.length;k++){data[p]+=seg[k];if(++p===L.len)p=0}}
 send({type:"fill",i,data})}
function commitDubNote(e){e.done=true;G.ev=G.ev.filter(x=>x!==e);const L=G.loops[e.i];if(!L.has||!L.len)return;
 const seg=renderNote(e.sound,e.note,e.vel,Math.max(e.off-e.on,sr*.03));if(!seg)return;
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
   if(!G.running){L.muted=!L.muted;break}
   if(L.pend){L.pend=null;send({type:"gate",i,on:L.muted?0:1,frame:nowF()});break}
   {const at=nextQ(nowF());L.pend={muted:!L.muted,at};send({type:"gate",i,on:L.muted?1:0,frame:at})}break;
  case "dub":endDub(i);break}
 render()}

function beginRec(i){const L=G.loops[i],f=nowF();
 if(L.first){G.running=false;send({type:"rec",i,bus:G.cur,start:f,comp:0})}
 else{if(!G.running)playAll(f);send({type:"rec",i,bus:G.cur,start:f,comp:latencyFrames()})}
 L.start=f;L.state="rec";L.sound=SET.sound;L.q=SET.quant;render()}

function close(i){const L=G.loops[i],f=nowF();
 if(L.first){const len=f-L.start;
  if(len<sr*.25){send({type:"cancelRec",i});L.state="empty";flashHint("Troppo corto: tieni il primo giro almeno un quarto di secondo.");return}
  G.base=len;G.beats=beatsFor(len);G.origin=L.start;L.len=len;L.t0=L.start;
  send({type:"recEnd",i,end:f,len,t0:L.start});if(L.q)renderRec(i);send({type:"gate",i,on:1,frame:f});
  L.state="play";L.has=true;L.muted=false;G.running=true;rotateBus();return}
 const k=Math.max(1,Math.round((f-L.start)/G.base)),len=k*G.base,end=Math.max(L.start+len,f);
 L.len=len;L.t0=L.start;L.end=end;L.has=true;L.muted=false;
 send({type:"recEnd",i,end,len,t0:L.start});send({type:"gate",i,on:G.running?1:0,frame:end});
 if(end>f+sr*.02)L.state="closing";else{if(L.q)renderRec(i);L.state="play";rotateBus()}}

function startDub(i){const L=G.loops[i];if(!G.running)playAll();
 if(L.muted){L.muted=false;L.pend=null;send({type:"gate",i,on:1,frame:nowF()})}
 send({type:"dub",i,bus:G.cur,comp:latencyFrames()});L.state="dub";L.q=SET.quant;render()}
function endDub(i){send({type:"undub",i});G.loops[i].state="play";rotateBus();render()}

function clearLoop(i){const L=G.loops[i];
 if(L.state==="armed"){L.state="empty";render();return}
 send({type:"clear",i});Object.assign(L,{state:"empty",has:false,muted:false,pend:null,peaks:null});
 flashHint(`Loop ${i+1} cancellato. ◀ (annulla) lo riporta indietro.`)}

function playAll(f){if(!G.base)return;f=f??nowF()+Math.round(sr*.02);
 const delta=f-G.origin;G.origin=f;G.loops.forEach(L=>{L.t0+=delta;L.pend=null});send({type:"shift",delta});
 G.running=true;G.loops.forEach((L,i)=>{if(L.has&&(L.state==="play"||L.state==="dub"))send({type:"gate",i,on:L.muted?0:1,frame:f})});render()}
function stopAll(){const f=nowF();
 G.loops.forEach((L,i)=>{
  if(L.state==="rec")close(i);
  if(L.state==="armed")L.state="empty";
  if(L.state==="dub")endDub(i);
  if(L.pend){L.muted=L.pend.muted;L.pend=null}
  send({type:"gate",i,on:0,frame:f})});
 G.running=false;render()}
let stopArm=0;
function stopButton(){if(!ready)return;
 if(G.running||G.loops.some(l=>l.state==="rec"||l.state==="armed")){stopAll();return}
 if(!anyHas())return;
 if(performance.now()-stopArm<2000){stopArm=0;clearAll();return}
 stopArm=performance.now();flashHint("Premi ancora <b>■</b> per cancellare tutti i loop.")}
function clearAll(){send({type:"reset"});G.base=null;G.running=false;G.ev=[];
 G.loops.forEach(L=>Object.assign(L,{state:"empty",has:false,muted:false,pend:null,peaks:null,undo:0,redo:0}));flashHint("Tutto cancellato. Il prossimo giro lo decidi tu.")}
function playButton(){if(!ready)return;if(!G.base){flashHint(START_HINT);return}playAll()}
function dubButton(){if(!ready)return;const i=G.sel,L=G.loops[i];
 if(L.state==="play")startDub(i);else if(L.state==="dub")endDub(i);else tap(i)}
function undoSel(redo){if(!ready)return;const i=G.sel,L=G.loops[i];
 if(L.state==="armed"){L.state="empty";render();return}
 if(L.state==="rec"){send({type:"cancelRec",i});G.ev=G.ev.filter(e=>e.i!==i);L.state="empty";if(L.first){G.base=null}flashHint(`Registrazione del loop ${i+1} annullata.`);return}
 if(L.state==="closing")return;
 if(L.state==="dub")L.state="play";
 if(redo?!L.redo:!L.undo){flashHint(redo?"Niente da ripetere.":"Niente da annullare sul loop "+(i+1)+".");return}
 send({type:redo?"redo":"undo",i});flashHint((redo?"Ripristinato":"Annullato")+` l'ultimo strato del loop ${i+1}.`)}

function onCoreMsg(m){const L=G.loops[m.i];if(!L)return;
 if(m.type==="peaks"){L.peaks=m.peaks;drawWave(m.i);return}
 if(m.type==="state"){L.undo=m.undo;L.redo=m.redo;
  if(m.has){L.len=m.len;L.t0=m.t0;
   if(!L.has||L.state==="empty"){L.has=true;L.state="play";L.muted=false;if(!G.base){G.base=m.len;G.origin=m.t0}
    send({type:"gate",i:m.i,on:G.running?1:0,frame:nowF()})}}
  else if(L.state!=="armed"&&L.state!=="rec"){L.has=false;L.state="empty";L.peaks=null;drawWave(m.i)}
  render()}}

function tick(){if(!ready)return;const f=nowF();let ch=false;
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
 // il modo (suddivisione, 0 = spenta) lo decide L.q, fissato quando parte la registrazione o la sovraincisione
 let ev=null;
 if(i>=0&&G.loops[i].q&&BUF[SOUNDS[SET.sound].id]){const L=G.loops[i];
  ev={i,kind:ti>=0?"rec":"dub",note,vel,sound:SET.sound,q:L.q,on:nowF(),off:null,comp:L.first&&ti>=0?0:latencyFrames()};G.ev.push(ev)}
 // nota annotata: il suono dal vivo non va al looper, nel loop entra la versione a tempo; altrimenti va sul bus registrato
 held.set(note,{v:voice(SET.sound,note,vel,ctx.currentTime,ev?masterIn:liveBus[G.cur]),sus:false,ev});uiNote(note,true)}
let sustain=false;
function noteOff(note,force){const h=held.get(note);if(!h)return;if(sustain&&!force){h.sus=true;return}
 h.v.release(ctx.currentTime);held.delete(note);uiNote(note,false);
 if(h.ev&&!h.ev.done){h.ev.off=nowF();if(h.ev.kind==="dub")commitDubNote(h.ev)}}
function setSustain(on){sustain=on;if(!on)[...held.entries()].filter(([,h])=>h.sus).forEach(([n])=>noteOff(n,true))}
function setSound(i){if(i===SET.sound)return;SET.sound=i;saveSet();if(ready){loadSound(i);preview(i)}render()}
function stepSound(d){setSound((SET.sound+d+SOUNDS.length)%SOUNDS.length)}

// ---------- Pad: tocco = azione, tenuto premuto = cancella ----------
const holdT={};
function padDown(i){tap(i);clearTimeout(holdT[i]);holdT[i]=setTimeout(()=>{holdT[i]=null;clearLoop(i)},800)}
function padUp(i){clearTimeout(holdT[i]);holdT[i]=null}

// ---------- MIDI (Axiom AIR Mini 32, modo MIDI, canale 1) ----------
// pad 1–8 = note 36–43 · manopole 1–8 = CC 1–8 · ■ ▶ ● = CC 16 17 18
// ◀ ▶ ▲ ▼ = CC 19 20 21 22 · tasto centrale = CC 23 · sustain = CC 64
const BTN={16:stopButton,17:playButton,18:dubButton,19:()=>undoSel(false),20:()=>undoSel(true),21:()=>stepSound(1),22:()=>stepSound(-1),23:dubButton};
function initMIDI(){
 if(!navigator.requestMIDIAccess){setMidi(false,"MIDI non supportato: usa Chrome");return}
 navigator.requestMIDIAccess().then(acc=>{
  const bind=()=>{const names=[];acc.inputs.forEach(inp=>{inp.onmidimessage=onMIDI;names.push(inp.name.replace(/ MIDI In$/,""))});
   setMidi(names.length>0,names.length?names.join(", "):"Nessuna tastiera")};
  bind();acc.onstatechange=bind},()=>setMidi(false,"MIDI non consentito"))}
let diagOn=false;const diagLines=new Map();
function onMIDI(e){const [st,d1,d2=0]=e.data,type=st&0xf0;if(st>=0xF0)return;
 const on=type===0x90&&d2>0,off=type===0x80||(type===0x90&&d2===0),cc=type===0xB0;
 if(diagOn&&(on||cc)){const k=(cc?"CC ":"nota ")+d1+" · canale "+((st&15)+1);if(!diagLines.has(k)){diagLines.set(k,1);$("#diag").textContent=[...diagLines.keys()].join("\n")}}
 if((on||off)&&d1>=36&&d1<=43){const i=d1-36;if(on){flash(`[data-loop="${i}"]`);padDown(i)}else padUp(i);return}
 if(cc){if(d1===64)return setSustain(d2>=64);
  if(BTN[d1]){if(d2>63){flash(`[data-key="${d1}"]`);BTN[d1]()}return}
  if(d1>=1&&d1<=8){const i=d1-1;G.loops[i].vol=d2/127;send({type:"vol",i,v:d2/127});render();return}
  return}
 if(on)noteOn(d1,d2/127);else if(off)noteOff(d1)}

// ---------- Tastiera del PC ----------
const KEYMAP="awsedftgyhujkolp;'";const pcHeld=new Map();
addEventListener("keydown",e=>{
 if(!$("#gate").hidden){e.preventDefault();start();return}
 if(!$("#settings").hidden){if(e.key==="Escape")closeSettings();return}
 if(e.target.matches("input,select")||e.ctrlKey||e.metaKey||e.altKey)return;
 const k=e.key.toLowerCase();
 if(e.code==="Space"){e.preventDefault();if(!e.repeat)(G.running?stopButton:playButton)();return}
 if(e.repeat)return;
 if(/^[1-8]$/.test(k))return padDown(+k-1);
 if(k==="r")return dubButton();
 if(k==="q")return cycleQuant();
 if(e.key==="Backspace"){e.preventDefault();return undoSel(false)}
 if(e.key==="ArrowUp"){e.preventDefault();return stepSound(1)}
 if(e.key==="ArrowDown"){e.preventDefault();return stepSound(-1)}
 if(k==="z"||k==="x"){SET.oct=Math.max(-3,Math.min(3,SET.oct+(k==="z"?-1:1)));flashHint(`Ottava tastiera PC: ${SET.oct>0?"+":""}${SET.oct}`);return}
 const idx=KEYMAP.indexOf(k);if(idx>=0){const n=60+SET.oct*12+idx;pcHeld.set(k,n);noteOn(n,.8)}});
addEventListener("keyup",e=>{const k=e.key.toLowerCase();
 if(/^[1-8]$/.test(k))return padUp(+k-1);
 if(pcHeld.has(k)){noteOff(pcHeld.get(k));pcHeld.delete(k)}});
