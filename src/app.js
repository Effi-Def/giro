// ---------- Audio ----------
let ctx,sr,node,core=null,ready=false,masterIn,masterOut,cutF,dry,wet,noiseBuf,liveBus=[],usingWorklet=false,bHP,dropG,fxBus,lim,safeClip,PG;
const SET={sound:0,cut:1,rev:.12,master:.9,oct:0,quant:4,mix:2,amix:1};
// mix: 2 = mix più grosso; chi aveva le impostazioni di prima riparte col riverbero più basso
function loadSet(){try{Object.assign(SET,JSON.parse(localStorage.getItem("giro5.set")||"{}"))}catch(_){}SET.sound=Math.min(SET.sound|0,SOUNDS.length-1);delete SET.latMs;
 if(SET.mix!==2){SET.rev=Math.min(SET.rev,.12);SET.mix=2}}
function saveSet(){SET.sid=SOUNDS[SET.sound]?.id;try{localStorage.setItem("giro5.set",JSON.stringify(SET))}catch(_){}}

async function initAudio(){
 if(ctx)return;
 ctx=new (window.AudioContext||window.webkitAudioContext)({latencyHint:"interactive"});sr=ctx.sampleRate;
 masterIn=ctx.createGain();cutF=ctx.createBiquadFilter();cutF.type="lowpass";cutF.Q.value=.7;
 const comp=ctx.createDynamicsCompressor();comp.threshold.value=-12;comp.ratio.value=4;comp.attack.value=.004;comp.release.value=.2;
 dry=ctx.createGain();wet=ctx.createGain();const conv=ctx.createConvolver();conv.buffer=impulse(2.4);
 masterOut=ctx.createGain();
 // salita del drop: passa-alto che si apre (bHP) e silenzio prima dell'1 (dropG); riser e impatto entrano dopo (fxBus)
 bHP=ctx.createBiquadFilter();bHP.type="highpass";bHP.frequency.value=10;bHP.Q.value=.7;dropG=ctx.createGain();fxBus=ctx.createGain();
 // mix più grosso: saturazione morbida prima del compressore e limitatore in fondo (con tanti strati non distorce)
 const satIn=ctx.createGain(),sat=ctx.createWaveShaper();satIn.gain.value=.5;sat.curve=satCurve(.8);sat.oversample="2x";
 lim=ctx.createDynamicsCompressor();lim.threshold.value=-1.5;lim.knee.value=0;lim.ratio.value=20;lim.attack.value=.001;lim.release.value=.08;
 DJ=makeDJ(DJV);masterIn.connect(DJ.in);DJ.out.connect(cutF);cutF.connect(bHP);bHP.connect(dry);bHP.connect(conv);conv.connect(wet);
 dry.connect(satIn);wet.connect(satIn);satIn.connect(sat);sat.connect(comp);comp.connect(masterOut);
 // protezione finale: lineare fino a 0,9, poi si piega dolcemente; non supera mai il fondo scala
 safeClip=ctx.createWaveShaper();safeClip.curve=clipCurve();
 masterOut.connect(dropG);dropG.connect(lim);fxBus.connect(lim);lim.connect(safeClip);safeClip.connect(ctx.destination);tapMaster();
 // pompa sul mix: ci passano i loop che non sono di batteria (routeLoops), così la cassa resta piena e il resto «respira»
 PG={pump:ctx.createGain(),pumpAmt:ctx.createGain(),pumpOsc:null};PG.pumpAmt.gain.value=0;PG.pumpAmt.connect(PG.pump.gain);
 PG.pump.connect(masterIn);
 // tre bus per il suono dal vivo: sentito subito e registrabile dal looper
 for(let b=0;b<3;b++){const g=ctx.createGain();g.channelCount=1;g.channelCountMode="explicit";g.connect(masterIn);liveBus.push(g)}
 try{
  const src=LoopCore.toString()+`
class GiroLooper extends AudioWorkletProcessor{constructor(){super();this.c=new LoopCore(sampleRate);this.port.onmessage=e=>this.c.cmd(e.data)}
 process(inputs,outputs){const ins=[0,1,2].map(b=>inputs[b]&&inputs[b][0]),n=outputs[0][0].length;if(!this.z||this.z.length!==n)this.z=new Float32Array(n);
  this.c.process(ins,this.z,currentFrame,n,null,outputs.map(o=>[o[0],o[1]]));
  if(this.c.msgs.length){const m=this.c.msgs,tr=[];for(const x of m)if(x.type==="dump")for(const it of x.items)for(const ch of it.chunks)tr.push(ch.buffer);
   this.port.postMessage(m,tr);this.c.msgs=[]}return true}}
registerProcessor("giro-looper",GiroLooper);`;
  // da file locale Chrome rifiuta i moduli blob:, quindi prima data:, poi blob:
  try{await ctx.audioWorklet.addModule("data:application/javascript;charset=utf-8,"+encodeURIComponent(src))}
  catch(_){await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([src],{type:"application/javascript"})))}
  // un'uscita stereo per loop: ognuna può passare per i suoi effetti DJ
  node=new AudioWorkletNode(ctx,"giro-looper",{numberOfInputs:3,numberOfOutputs:NL,outputChannelCount:Array(NL).fill(2),channelCount:1,channelCountMode:"explicit"});
  node.port.onmessage=e=>e.data.forEach(onCoreMsg);
  liveBus.forEach((g,b)=>g.connect(node,0,b));usingWorklet=true;
 }catch(err){
  // riserva: stesso motore su ScriptProcessor
  core=new LoopCore(sr);const merger=ctx.createChannelMerger(3);liveBus.forEach((g,b)=>g.connect(merger,0,b));
  node=ctx.createScriptProcessor(1024,3,2);merger.connect(node);
  node.onaudioprocess=e=>{const ins=[0,1,2].map(c=>e.inputBuffer.getChannelData(c)),o=e.outputBuffer.getChannelData(0);
   core.process(ins,o,Math.round(e.playbackTime*sr),o.length,e.outputBuffer.getChannelData(1));if(core.msgs.length){const m=core.msgs;core.msgs=[];m.forEach(onCoreMsg)}};
 }
 if(usingWorklet)for(let i=0;i<NL;i++){const g=ctx.createGain();node.connect(g,i);g.connect(masterIn);loopOut.push(g);loopTo.push(masterIn)}
 else node.connect(PG.pump); // un'uscita sola: col ripiego la pompa prende tutti i loop
 applyMix();ready=true;loadFx();
 loadSound(SET.sound).then(preloadAll,preloadAll);restoreSession();
 setInterval(tick,20);setInterval(clockSample,7);
}
// tr: buffer da passare al worklet senza copiarli (il mittente non li usa più)
function send(c,tr){if(!ready)return;if(usingWorklet)node.port.postMessage(c,tr||[]);else core.cmd(c)}
// buffer azzerato per il core (loop appena chiuso, copia per l'annulla della sovraincisione): preparato qui perché
// nel thread audio la memoria nuova di un loop lungo costava fino a 8 ms. fill scrive ogni pagina, così è già assegnata.
function freshBuf(n){const b=new Float32Array(n);b.fill(0);return b}
function applyMix(){if(!ctx)return;const t=ctx.currentTime;
 cutF.frequency.setTargetAtTime(200*Math.pow(100,SET.cut),t,.02);wet.gain.setTargetAtTime(SET.rev*.5+DJV[2]*.8,t,.02);masterOut.gain.setTargetAtTime(SET.master*1.4,t,.02)} // +3 dB: i picchi li tiene il limitatore
// saturazione: y = tanh(k·u)/k con u = 2x (l'ingresso arriva dimezzato): lineare a basso volume, morbida sui picchi
function clipCurve(){const n=4096,c=new Float32Array(n);for(let j=0;j<n;j++){const x=j/(n-1)*2-1,a=Math.abs(x);c[j]=Math.sign(x)*(a<.9?a:.9+.1*Math.tanh((a-.9)/.1))}return c}
function satCurve(k){const n=2048,c=new Float32Array(n);for(let j=0;j<n;j++){const u=(j/(n-1)*2-1)*2;c[j]=Math.tanh(k*u)/k}return c}

// ---------- Effetti DJ: su tutto il mix o sul singolo loop ----------
// 1 filtro · 2 eco · 3 riverbero · 4 velocità · 5 crusher · 6 wobble · 7 roll · 8 volume (tastiera sul mix, del loop sul loop).
// Tutti nodi nativi del browser (leggeri). A manopole spente (filtro al centro) il suono passa com'era.
// Ambito "mix": la catena DJ fra masterIn e il filtro generale. Ambito "loop": ogni loop esce dal worklet su
// un'uscita sua, che passa per una catena tutta sua, creata al primo effetto. Cambiando loop selezionato,
// quello di prima tiene i suoi effetti e le manopole passano al nuovo.
const DJ_NAMES=["FILTRO","ECO","RIVERBERO","VELOCITÀ","CRUSHER","WOBBLE","ROLL","TASTIERA"];
const DJV=[0,0,0,0,0,0,0,1]; // valori del mix: filtro e velocità -1…1 (0 = spento), gli altri 0…1; la tastiera parte al massimo
let DJ=null,fxScope="mix",revL=null;
const LDJ=Array(8).fill(null),loopOut=[],loopTo=[]; // catene dei singoli loop (null = nessun effetto), uscite dei loop e dove vanno
const ROLL_NAMES={1:"1/4",2:"1/8",4:"1/16",8:"1/32"},WB_NAMES={1:"1/4",2:"1/8",3:"1/8T",4:"1/16"};
function makeDJ(v){const c=ctx,g=v=>{const n=c.createGain();n.gain.value=v;return n};
 const D={v,rollK:0,in:g(1),out:g(1),rev:g(0),crush:c.createWaveShaper(),lp:c.createBiquadFilter(),hp:c.createBiquadFilter()};
 D.lp.type="lowpass";D.lp.frequency.value=22000;D.lp.Q.value=.7;D.hp.type="highpass";D.hp.frequency.value=10;D.hp.Q.value=.7;
 // wobble: passa-basso risonante che si apre e chiude a tempo (dubstep); l'oscillatore muove il detune (in cent)
 D.wb=c.createBiquadFilter();D.wb.type="lowpass";D.wb.frequency.value=22000;D.wb.Q.value=.7;D.wbDepth=g(0);D.wbDepth.connect(D.wb.detune);D.wbOsc=null;D.wbK=0;
 // pompa: il volume si abbassa a ogni battito e risale, come un sidechain sulla cassa (pumpOsc dà la forma).
 // Non ha più una manopola: parte da sola al drop sul mix (pv = profondità)
 D.pv=0;D.pump=g(1);D.pumpAmt=g(0);D.pumpAmt.connect(D.pump.gain);D.pumpOsc=null;
 // roll: una linea di ritardo lunga quanto il pezzo, che a un certo punto si richiude su sé stessa
 D.rDry=g(1);D.rIn=g(1);D.rFb=g(0);D.rWet=g(0);D.r=g(1);D.rDel=c.createDelay(2.5);
 // eco: delay di un quarto a tempo. La manopola apre la mandata: abbassandola le ripetizioni già partite si spengono da
 // sole. Passa-alto e passa-basso anche sul ritorno: ogni ripetizione è più scura e la cassa non rimbomba
 D.eSend=g(0);D.eHP=c.createBiquadFilter();D.eHP.type="highpass";D.eHP.frequency.value=250;D.eLP=c.createBiquadFilter();D.eLP.type="lowpass";D.eLP.frequency.value=4000;
 D.eDel=c.createDelay(3);D.eDel.delayTime.value=echoTime();D.eFb=g(.4);D.eWet=g(.55);
 D.in.connect(D.crush);D.crush.connect(D.lp);D.lp.connect(D.hp);D.hp.connect(D.wb);D.wb.connect(D.pump);
 D.pump.connect(D.rDry);D.pump.connect(D.rIn);D.rIn.connect(D.rDel);D.rDel.connect(D.rFb);D.rFb.connect(D.rDel);D.rDel.connect(D.rWet);
 D.rDry.connect(D.r);D.rWet.connect(D.r);
 D.r.connect(D.out);D.r.connect(D.eSend);D.eSend.connect(D.eHP);D.eHP.connect(D.eLP);D.eLP.connect(D.eDel);D.eDel.connect(D.eFb);D.eFb.connect(D.eHP);D.eDel.connect(D.eWet);D.eWet.connect(D.out);
 D.out.connect(D.rev); // mandata al riverbero: la usano solo i loop (il mix ha il suo in applyMix)
 return D}
// Velocità (manopola 4): al centro normale, a sinistra i loop rallentano fino a fermarsi, a destra accelerano fino al doppio;
// l'intonazione segue, come un disco. La fa il core, che i loop li ha già tutti in memoria e può leggerli anche più avanti della
// griglia. La griglia non si ferma: tornando al centro la velocità risale e sul prossimo 1 la lettura torna a tempo.
// Vale per ogni loop: velocità del mix × velocità del loop. Le note suonate non ci passano.
const speedOf=a=>1+a;
function speedTick(f){let ch=false;const run=G.base&&G.running;
 G.loops.forEach((L,i)=>{const r=run?speedOf(DJV[3])*(LDJ[i]?speedOf(LDJ[i].v[3]):1):1;
  if(L.rb&&f>=L.rb){L.rb=0;ch=true}
  if(r===(L.rt??1))return;
  // al doppio e a metà i battiti cadono ancora sulla griglia, ma girando la manopola la lettura è scivolata: sul prossimo 1 riparte dal punto giusto
  ch=true;if(r!==1){L.rb=0;send({type:"rate",i,v:r,home:run&&(r===2||r===.5)?nextBar(f):0})}
  else{L.rb=run?nextBar(f):0;send({type:"rate",i,v:1,home:run?L.rb:1})}
  L.rt=r});
 return ch}
// catena del loop i: la crea e ci fa passare l'uscita del loop (solo con l'AudioWorklet, che ha un'uscita per loop)
function loopDJ(i){if(LDJ[i])return LDJ[i];if(!usingWorklet||!loopOut[i])return null;
 if(!revL){revL=ctx.createGain();const cv=ctx.createConvolver();cv.buffer=impulse(2.4);revL.connect(cv);cv.connect(masterOut)}
 const D=makeDJ([0,0,0,0,0,0,0,1]);D.rev.connect(revL);D.out.connect(loopTo[i]);
 loopOut[i].disconnect();loopOut[i].connect(D.in);return LDJ[i]=D}
function dropLoopDJ(i){const D=LDJ[i];if(!D)return;LDJ[i]=null;
 loopOut[i].disconnect();loopOut[i].connect(loopTo[i]);D.out.disconnect();D.rev.disconnect();
 for(const o of[D.pumpOsc,D.wbOsc])if(o)try{o.stop()}catch(_){}}
const djAll=()=>[DJ,...LDJ].filter(Boolean);
// i loop melodici vanno nella pompa del mix (PG), quelli di batteria direttamente a masterIn
function routeLoops(){G.loops.forEach((L,i)=>{if(!loopOut[i])return;const want=L.has&&!SOUNDS[L.sound]?.drum?PG.pump:masterIn;if(loopTo[i]===want)return;
 const src=LDJ[i]?LDJ[i].out:loopOut[i];src.disconnect(loopTo[i]);src.connect(want);loopTo[i]=want})}
const fxActive=D=>!!D&&(D.rollK>0||D.wbK>0||D.v.some((x,i)=>i===0||i===3?x!==0:i<5&&x>.02));
const beatS=()=>G.base?G.base/G.beats/sr:.5,echoTime=()=>Math.min(2.9,beatS())-128/sr; // il giro di ritorno aggiunge un blocco audio: senza togliere le ripetizioni scivolano di 2,7 ms l'una
// forma della pompa su un battito: niente all'attacco (la cassa passa), giù del tutto al 3%, risale entro il 60%.
// L'oscillatore dà e(t) − media; il guadagno è 1 − d·e(t) = (1 − d·media) − d·(e − media).
let pumpWave=null,PUMP_MEAN=0,cosWave=null;
function pumpShape(){if(pumpWave)return pumpWave;const N=512,K=48,e=new Float32Array(N);let m=0;
 for(let j=0;j<N;j++){const p=j/N;e[j]=p<.03?p/.03:Math.pow(1-Math.min(1,(p-.03)/.57),2);m+=e[j]/N}
 const re=new Float32Array(K+1),im=new Float32Array(K+1);
 for(let k=1;k<=K;k++){let a=0,b=0;for(let j=0;j<N;j++){const w=2*Math.PI*k*j/N;a+=(e[j]-m)*Math.cos(w);b+=(e[j]-m)*Math.sin(w)}re[k]=2*a/N;im[k]=2*b/N}
 PUMP_MEAN=m;return pumpWave=ctx.createPeriodicWave(re,im,{disableNormalization:true})}
// profondità della pompa (fino all'85% di abbassamento) da pv, dal tempo t.
// Sul mix la pompa è PG (solo i loop melodici), sul singolo loop quella della sua catena.
const pumpOf=D=>D===DJ?PG:D;
function pumpSet(D,t,tau=.02){pumpShape();const P=pumpOf(D),d=G.base&&D.pv>.02?.85*D.pv:0;P.pump.gain.setTargetAtTime(1-d*PUMP_MEAN,t,tau);P.pumpAmt.gain.setTargetAtTime(-d,t,tau)}
// eco, pompa, wobble e roll seguono il tempo: da richiamare quando il tempo o l'1 cambiano.
// at: frame da cui far partire pompa e wobble (deve stare su un battito), altrimenti il prossimo battito
function djRetime(){if(!DJ)return;djAll().forEach(D=>djRetimeOne(D))}
function djRetimeOne(D,at){const t=ctx.currentTime,b=G.base?G.base/G.beats:0;
 D.eDel.delayTime.setTargetAtTime(echoTime(),t,.05);
 const T=b?(at??G.origin+Math.ceil((nowF()+sr*.02-G.origin)/b)*b)/sr:0;
 const P=pumpOf(D);for(const [O,k] of[[P,"pumpOsc"],[D,"wbOsc"]])if(O[k]){try{O[k].stop()}catch(_){}O[k].disconnect();O[k]=null}
 if(D.pv>.02&&G.base){const o=ctx.createOscillator();o.setPeriodicWave(pumpShape());o.frequency.value=1/beatS();o.connect(P.pumpAmt);o.start(T);P.pumpOsc=o}
 pumpSet(D,t);
 // wobble: coseno (all'1 il filtro è aperto), da 450 Hz su e giù di 2600 cent, wbK oscillazioni per battito
 const wb=D.wbK&&G.base;D.wb.frequency.setTargetAtTime(wb?450:22000,t,.01);D.wb.Q.setTargetAtTime(wb?6:.7,t,.01);D.wbDepth.gain.setTargetAtTime(wb?2600:0,t,.01);
 if(wb){if(!cosWave)cosWave=ctx.createPeriodicWave(new Float32Array([0,1]),new Float32Array(2));
  const o=ctx.createOscillator();o.setPeriodicWave(cosWave);o.frequency.value=D.wbK/beatS();o.connect(D.wbDepth);o.start(T);D.wbOsc=o}
 if(D.rollK){const k=D.rollK;D.rollK=0;djRoll(D,k)}}
function djRoll(D,k){if(!G.base||!G.running)k=0;if(k===D.rollK)return;D.rollK=k;
 const t=ctx.currentTime;[D.rDry,D.rIn,D.rWet,D.rFb].forEach(n=>n.gain.cancelScheduledValues(t));D.rDel.delayTime.cancelScheduledValues(t);
 if(!k){const T=t+.005;D.rDry.gain.setValueAtTime(1,T);D.rIn.gain.setValueAtTime(1,T);D.rWet.gain.setValueAtTime(0,T);D.rFb.gain.setValueAtTime(0,T);return}
 // dal prossimo pezzo a tempo: lo lascio passare registrandolo, poi lo ripeto finché la manopola resta girata
 const s=G.base/(G.beats*k),f=nowF(),Tg=G.origin+Math.ceil((f+sr*.01-G.origin)/s)*s,T1=Tg/sr,T2=(Tg+s)/sr;
 D.rDel.delayTime.setValueAtTime(s/sr,T1);D.rIn.gain.setValueAtTime(1,T1);D.rDry.gain.setValueAtTime(1,T1);D.rWet.gain.setValueAtTime(0,T1);D.rFb.gain.setValueAtTime(0,T1);
 D.rIn.gain.setValueAtTime(0,T2);D.rDry.gain.setValueAtTime(0,T2);D.rWet.gain.setValueAtTime(1,T2);D.rFb.gain.setValueAtTime(1,T2)}
const rollAllOff=()=>{if(DJ)djAll().forEach(D=>djRoll(D,0))};
function crushCurve(a){if(a<.02)return null;const n=4096,c=new Float32Array(n),steps=Math.pow(2,12-a*9)/2;
 for(let k=0;k<n;k++){const x=k/(n-1)*2-1;c[k]=Math.round(x*steps)/steps}return c}
function djApply(D,i){const t=ctx.currentTime,a=D.v[i];
 switch(i){
  case 0:{const u=Math.max(0,(Math.abs(a)-.04)/.96);
   D.lp.frequency.setTargetAtTime(a<0?22000*Math.pow(180/22000,u):22000,t,.02);D.hp.frequency.setTargetAtTime(a>0?10*Math.pow(600,u):10,t,.02);
   D.lp.Q.setTargetAtTime(a<0?.7+u*1.3:.7,t,.05);D.hp.Q.setTargetAtTime(a>0?.7+u*1.3:.7,t,.05);break}
  case 1:D.eSend.gain.setTargetAtTime(a,t,.03);D.eFb.gain.setTargetAtTime(a>.02?.35+a*.45:.4,t,.03);break;
  case 2:if(D===DJ)applyMix();else D.rev.gain.setTargetAtTime(a*.8,t,.03);break;
  case 4:D.crush.curve=crushCurve(a);break;
  case 5:{const k=a<.1?0:[1,2,3,4][Math.min(3,Math.floor((a-.1)/.9*4))];if(k!==D.wbK){D.wbK=k;djRetimeOne(D)}break}
  case 6:djRoll(D,a<.1?0:[1,2,4,8][Math.min(3,Math.floor((a-.1)/.9*4))]);break}}
function djKnob(i,v){let x=v/127;
 if(i===0||i===3){x=Math.max(-1,Math.min(1,(v-64)/63));if(Math.abs(x)<.04)x=0}
 if(i===3&&Math.abs(x+.5)<.03)x=-.5; // metà velocità esatta, come il doppio tutta a destra: resta a tempo
 if(fxScope==="loop"){const n=G.sel,L=G.loops[n];
  if(!L.has){flashHint("Effetti sul loop: prima registra un loop e selezionalo.");return}
  if(i===7){L.vol=x;send({type:"vol",i:n,v:x});saveSoon();flashHint(`Loop ${n+1}: volume ${Math.round(x*100)}%`);render();return}
  if(!ready)return;const D=loopDJ(n);
  if(!D){fxScope="mix";flashHint("Effetti sul singolo loop non disponibili su questo PC: torno a tutto il mix.");render();return}
  D.v[i]=x;djApply(D,i);flashHint(`Loop ${n+1} · effetto <b>${i+1} ${DJ_NAMES[i]}</b>: `+djText(i));render();return}
 DJV[i]=x;if(DJ)djApply(DJ,i);
 flashHint(`Effetto <b>${i+1} ${DJ_NAMES[i]}</b>: `+djText(i));render()}
// valori mostrati sulla striscia: quelli del mix o del loop selezionato
function djView(){if(fxScope==="mix")return{v:DJV,rollK:DJ?DJ.rollK:0,wbK:DJ?DJ.wbK:0};
 const D=LDJ[G.sel];return{v:D?D.v:[0,0,0,0,0,0,0,0],rollK:D?D.rollK:0,wbK:D?D.wbK:0}}
function djText(i){const V=djView(),a=V.v[i];
 if(i===7&&fxScope==="loop")return Math.round(G.loops[G.sel].vol*100)+"%";
 if(i===0)return a===0?"spento":a<0?"scuro "+Math.round(-a*100)+"%":"leggero "+Math.round(a*100)+"%";
 if(i===6)return V.rollK?ROLL_NAMES[V.rollK]:(G.base&&G.running?"spento":"serve un loop");
 if(i===5)return !V.wbK?"spento":G.base?WB_NAMES[V.wbK]:"serve un loop";
 if(i===3){if(a===0)return (fxScope==="mix"?G.loops.some(L=>L.rb):G.loops[G.sel].rb)?"a tempo sull'1":"normale";
  if(!G.base||!G.running)return "serve un loop";return a<-.97?"fermo":Math.round((1+a)*100)+"%"}
 return a<.02&&i!==7?"spento":Math.round(a*100)+"%"}
function setFxScope(m){fxScope=m;
 flashHint(m==="loop"?`Effetti DJ sul <b>loop selezionato</b> (ora il ${G.sel+1}). Cambiando loop, quello di prima tiene i suoi effetti.`:"Effetti DJ su <b>tutto il mix</b>.");render()}
const toggleFxScope=()=>setFxScope(fxScope==="mix"?"loop":"mix");
// spegne tutti gli effetti, sul mix e su ogni loop (i volumi restano com'erano)
// anche il filtro di ogni loop (modo FILTRO LOOP), che prima restava girato
function stopAllFx(){for(let i=0;i<7;i++)DJV[i]=0;
 if(DJ){for(let i=0;i<7;i++)djApply(DJ,i);for(let i=0;i<LDJ.length;i++)dropLoopDJ(i);pumpAutoOff()}cutOff();
 G.loops.forEach((L,i)=>{if(!L.fx)return;L.fx=0;send({type:"fx",i,v:0});saveSoon()});
 flashHint("<b>Effetti spenti</b> su tutto il mix e su tutti i loop.");render()}
// velocità normale per il loop selezionato (tasto centrale tenuto, tasto 9): la sua e quella del mix, che vale anche per lui.
// Filtro ed effetti restano come sono; tornando a 1 il loop rientra a tempo sull'1 (speedTick)
function speedReset(){if(!ready)return;const n=G.sel,D=LDJ[n],mix=DJV[3]!==0,own=!!D&&D.v[3]!==0;
 if(!mix&&!own){flashHint(`Loop ${n+1}: la velocità è già normale.`);return}
 DJV[3]=0;if(own)D.v[3]=0;
 const altri=G.loops.map((_,i)=>i).filter(i=>i!==n&&LDJ[i]&&LDJ[i].v[3]!==0);
 flashHint(`<b>Velocità normale</b> ${mix?"su tutto il mix":"sul loop "+(n+1)}`+(G.running?", a tempo dall'1":"")+(altri.length?` · il loop ${altri.map(i=>i+1).join(", ")} ha ancora la sua`:"")+".");render()}
// Tempo degli eventi. ctx.currentTime avanza a scatti: un blocco da 128 campioni alla volta, a raffiche lunghe quanto
// il buffer della scheda (su questo PC 10 ms, scarto misurato 13,8 ms). Leggerlo quando arriva una nota dava fino a
// ~14 ms di jitter fra il tasto e il suono (e nel loop, senza quantizzazione). Si usa invece l'istante dell'evento
// (timeStamp di MIDI, tastiera e puntatore, sullo stesso orologio di performance.now) portato sull'orologio audio
// con ckMax(): il massimo recente di currentTime − performance.now(), cioè dove arriva currentTime subito dopo una
// raffica. Così una nota parte sempre allo stesso ritardo dal tasto (in media mezzo buffer in più, niente jitter).
const CK=[]; // massimi di currentTime − performance.now() a finestre di 0,5 s (le ultime 4: l'orologio audio deriva)
function clockSample(){if(!ctx||ctx.state!=="running")return;const p=performance.now()/1000,o=ctx.currentTime-p,k=Math.floor(p*2);
 if(CK.length&&o<ckMax()-.06)CK.length=0; // audio rimasto indietro (buco, scheda cambiata): i massimi vecchi non valgono più
 const top=CK[CK.length-1];if(top&&top.k===k){if(o>top.o)top.o=o}else{CK.push({k,o});while(CK[0].k<k-3)CK.shift()}}
function ckMax(){let m=-Infinity;for(const x of CK)if(x.o>m)m=x.o;return m}
// istante (sull'orologio audio) dell'evento con questo timeStamp; null se non si può dire
function eventTime(ts){clockSample();if(!(ts>0)||CK.length<2)return null;
 const t=ts/1000+ckMax(),now=ctx.currentTime;return t>now+.05||t<now-.25?null:t}
let evT=null; // istante dell'evento che si sta gestendo (null = adesso)
let evIn=null; // solo per il log di debug: [timeStamp, performance.now(), currentTime] letti appena arriva l'evento
// gestisce un evento al suo istante: dentro fn, nowT() e nowF() valgono quell'istante
function atEvent(e,fn){const p=performance.now();evIn=ctx?[e&&e.timeStamp||p,p,ctx.currentTime]:null;
 evT=ctx?eventTime(e&&e.timeStamp):null;try{return fn()}finally{evT=null;evIn=null}}
const nowT=()=>evT??ctx.currentTime;
const nowF=()=>Math.round(nowT()*sr);
// i suoni sono tutti interni: le note e i loop escono con lo stesso ritardo e chi suona si allinea a orecchio,
// quindi la latenza d'uscita non va compensata (spostava le note in anticipo). Resta solo il buffer dello ScriptProcessor.
function latencyFrames(){return usingWorklet?0:1024}
// ritardo tra il tasto e il suono: solo da mostrare nelle impostazioni
function audioDelayMs(){return((ctx.outputLatency||0)+(ctx.baseLatency||0))*1000}

// ---------- Stato del looper ----------
const NL=8;
const G={base:null,base0:null,beats:4,origin:0,running:false,stopAt:0,drop:false,dropAt:0,dubTake:[],firstOn:[],cur:0,sel:0,ev:[],
 loops:Array.from({length:NL},()=>({sound:null,state:"empty",has:false,muted:false,pend:null,len:0,t0:0,start:0,end:0,first:false,peaks:null,vol:.8,pan:0,fx:0,undo:0,redo:0,mx:null,ar:null,pm:false}))};
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
 if(L.fixed){send({type:"swap",i,data:null});L.fixed=false;L.dk="";L.org=null} // si sovraincide sulla batteria suonata, poi si corregge di nuovo
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
 G.drop=false;buildCancel();pumpAutoOff();G.running=false;rollAllOff();cutOff();render()}
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
function clearAll(){send({type:"reset"});saveSoon();for(let i=0;i<NL;i++)dbgForget(i);DBG.gridClose=null;G.base=null;G.running=false;G.stopAt=0;G.drop=false;buildCancel();pumpAutoOff();rollAllOff();CUT=null;djRetime();G.ev=[];TSRC.length=0;if(TEMPO.want)tempoCancel();
 G.loops.forEach(L=>Object.assign(L,{state:"empty",has:false,muted:false,pend:null,dropped:false,peaks:null,undo:0,redo:0}));flashHint("Tutto cancellato. Il prossimo giro lo decidi tu.")}
function playButton(){if(!ready)return;if(!G.base){flashHint(START_HINT);return}
 if(G.running){flashHint("Sta già suonando. <b>■</b> per fermare a fine giro.");return}playAll()}

// ---------- Break, salita e drop: ▶ mentre i loop suonano ----------
// tocco = break: al prossimo 1 resta solo il loop selezionato (G.drop); ritocco = tutto rientra sul prossimo 1.
// tenuto = salita: passa-alto che si apre, rumore che sale, rullata che accelera (2 battute);
// lasci = DROP: mezzo battito di silenzio, poi sull'1 impatto (boom + piatto), rientra tutto e parte la pompa.
const barF=()=>G.base*Math.min(1,4/G.beats);
function nextBar(f){const b=barF();return G.origin+Math.ceil((f-G.origin+sr*.03)/b)*b}
function dropToggle(){if(!G.running||G.stopAt)return;const at=nextBar(nowF());
 if(G.drop){G.drop=false;
  G.loops.forEach((L,i)=>{if(!L.dropped)return;L.dropped=false;L.pend={muted:false,at};send({type:"gate",i,on:1,frame:at})})}
 else{const ids=[];G.loops.forEach((L,i)=>{if(i!==G.sel&&L.has&&L.state==="play"&&!L.muted&&!L.pend)ids.push(i)});
  if(!ids.length){flashHint("Niente da togliere: suona solo il loop selezionato.");return}
  G.drop=true;ids.forEach(i=>{const L=G.loops[i];L.dropped=true;L.pend={muted:true,at};send({type:"gate",i,on:0,frame:at})})}
 render()}
// bld: la salita in corso (riser, rullata da start, prossimo colpo next, ultimo colpo prima di end); G.dropAt: frame del drop
let building=false,bld=null,pumpAuto=false;
function holdParam(p,t){try{p.cancelAndHoldAtTime(t)}catch(_){p.cancelScheduledValues(t);p.setValueAtTime(p.value,t)}}
function noise(){if(noiseBuf)return noiseBuf;const n=sr*2,b=ctx.createBuffer(1,n,sr),d=b.getChannelData(0);for(let k=0;k<n;k++)d[k]=Math.random()*2-1;return noiseBuf=b}
// campioni del drop (boom e piatto, CC0 da Sonic Pi), incorporati in SAMPLE_DATA.drop_fx
const FX={};
function loadFx(){const d=SAMPLE_DATA.drop_fx;if(d)for(const k in d)ctx.decodeAudioData(b64buf(d[k])).then(b=>{FX[k]=b}).catch(()=>{})}
function playBuf(b,ts,v,out){const s=ctx.createBufferSource(),g=ctx.createGain();s.buffer=b;g.gain.value=v;s.connect(g);g.connect(out);s.start(ts);s.onended=()=>g.disconnect()}
// rullante della rullata: quello del kit house, se no della batteria
function snare(){for(const id of["house909","batteria"]){const s=SOUNDS.find(x=>x.id===id),e=BUF[id]&&BUF[id].find(x=>x[0]===2);if(e)return[e[1],s.gain]}return null}
function buildStart(){if(!G.running||G.stopAt||G.dropAt)return;building=true;
 const t=ctx.currentTime,b=G.base/G.beats,dur=Math.max(2,Math.min(8,8*b/sr));
 holdParam(bHP.frequency,t);bHP.frequency.exponentialRampToValueAtTime(1500,t+dur);holdParam(bHP.Q,t);bHP.Q.linearRampToValueAtTime(4,t+dur);
 // riser: rumore in un passa-banda che sale da 400 Hz a 9 kHz, sempre più forte
 const src=ctx.createBufferSource(),bp=ctx.createBiquadFilter(),g=ctx.createGain();src.buffer=noise();src.loop=true;bp.type="bandpass";bp.Q.value=1.2;
 bp.frequency.setValueAtTime(400,t);bp.frequency.exponentialRampToValueAtTime(9000,t+dur);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.3,t+dur);
 src.connect(bp);bp.connect(g);g.connect(fxBus);src.start(t);
 const start=G.origin+Math.ceil((nowF()+sr*.02-G.origin)/b)*b;bld={src,g,start,next:start,end:Infinity};rollTick();render()}
// rullata a tempo: 4 battiti a quarti, 2 a ottavi, 1 a sedicesimi, 1 a trentaduesimi, poi sedicesimi finché tieni; sempre più forte
function rollTick(){if(!bld)return;const b=G.base/G.beats,until=nowF()+sr*.12,sn=snare();
 while(bld.next<until&&bld.next<bld.end){const e=(bld.next-bld.start)/b,step=e<4?1:e<6?.5:e<7?.25:e<8?.125:.25;
  if(sn&&bld.next>=nowF())playBuf(sn[0],bld.next/sr,sn[1]*(.35+.65*Math.min(1,e/8)),masterIn);
  bld.next+=Math.round(step*b)}}
function buildEnd(){if(!building)return;building=false;
 const b=G.base/G.beats,T=nextBar(nowF()+b/2),gs=(T-b/2)/sr,Ts=T/sr;
 // la salita continua fino al silenzio, mezzo battito prima dell'1
 if(bld){bld.end=T-b/2;holdParam(bld.g.gain,gs);bld.g.gain.linearRampToValueAtTime(.0001,gs+.01);bld.src.stop(gs+.05)}
 dropG.gain.cancelScheduledValues(ctx.currentTime);dropG.gain.setValueAtTime(1,gs);dropG.gain.linearRampToValueAtTime(0,gs+.006);dropG.gain.setValueAtTime(0,Ts-.002);dropG.gain.linearRampToValueAtTime(1,Ts+.001);
 holdParam(bHP.frequency,Ts);holdParam(bHP.Q,Ts);bHP.frequency.setValueAtTime(10,Ts);bHP.Q.setValueAtTime(.7,Ts);
 if(FX.boom)playBuf(FX.boom,Ts,1,fxBus);if(FX.crash)playBuf(FX.crash,Ts,.5,fxBus);
 // i loop tolti col break rientrano proprio sul drop
 if(G.drop){G.drop=false;G.loops.forEach((L,i)=>{if(!L.dropped)return;L.dropped=false;L.pend={muted:false,at:T};send({type:"gate",i,on:1,frame:T})})}
 // pompa sul mix dal drop (si spegne con ■, cancella tutto o STOP EFFETTI)
 if(!pumpAuto){DJ.pv=.6;pumpAuto=true;pumpSet(DJ,Ts,.005);djRetimeOne(DJ,T)}
 G.dropAt=T;render()}
function pumpAutoOff(){if(!pumpAuto||!DJ)return;pumpAuto=false;DJ.pv=0;djRetimeOne(DJ)}
function buildCancel(){if(!ctx)return;const t=ctx.currentTime;building=false;G.dropAt=0;
 if(bld){bld.g.gain.cancelScheduledValues(t);bld.g.gain.setTargetAtTime(0,t,.02);try{bld.src.stop(t+.1)}catch(_){}bld=null}
 holdParam(bHP.frequency,t);holdParam(bHP.Q,t);bHP.frequency.setTargetAtTime(10,t,.03);bHP.Q.setTargetAtTime(.7,t,.03);
 dropG.gain.cancelScheduledValues(t);dropG.gain.setTargetAtTime(1,t,.005)}
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
 send({type:redo?"redo":"undo",i});dbgForget(i);if(L.fixed){L.fixed=false;L.dk="";L.org=null} // il core ha lasciato la versione corretta: si rifà
 flashHint((redo?"Ripristinato":"Annullato")+` l'ultimo strato del loop ${i+1}.`)}

// ---------- Pezzo ripetuto (tasto V): IN e OUT a tempo sul loop selezionato ----------
// Come il roll, ma il pezzo lo scegli tu: primo tocco IN, secondo OUT (tutti e due sul sedicesimo più vicino), e da OUT
// il loop ripete il pezzo (lo fa il core, comando cut: il pezzo può essere già passato). Terzo tocco: esce subito, ed è
// già a tempo perché la griglia ha continuato a contare. Gli altri loop vanno avanti.
let CUT=null; // {i, s: IN in frame, p: lunghezza in frame (0 finché manca OUT)}
const cutStep=()=>G.base/(G.beats*4),cutSnap=f=>Math.round(G.origin+Math.round((f-G.origin)/cutStep())*cutStep());
function cutLen(p){const n=Math.round(p/cutStep());return n<4?["","1/16","1/8","3/16"][n]+" di battito":n===4?"1 battito":String(n/4).replace(".",",")+" battiti"}
function cutButton(){if(!ready)return;
 if(CUT&&CUT.p){const i=CUT.i;cutOff();flashHint(`Loop ${i+1}: <b>fine del pezzo</b>, torna normale a tempo.`);return}
 const i=CUT?CUT.i:G.sel,L=G.loops[i];
 if(!G.base||!G.running||!L.has){CUT=null;flashHint("Il pezzo si sceglie su un loop che suona: selezionalo (<b>Maiusc</b>+numero) mentre gira, poi <b>V</b>.");return}
 const f=cutSnap(nowF());
 if(!CUT){CUT={i,s:f,p:0};render();return}
 const p=Math.max(f-CUT.s,Math.round(cutStep()));
 if(p>=L.len){CUT=null;flashHint("Pezzo lungo quanto tutto il loop: niente da ripetere. Riprova con <b>V</b>, più corto.");return}
 CUT.p=p;send({type:"cut",i,s:CUT.s,p});render()}
function cutOff(){if(!CUT)return;if(CUT.p)send({type:"cut",i:CUT.i,end:nowF()});CUT=null;render()}

// ---------- Tempo: tutta la canzone più veloce o più lenta, senza cambiare l'intonazione ----------
// Richiesta dell'utente (la manopola 4 cambia velocità e intonazione insieme, come un disco). Scelte sue: a scatto sull'1, fino a
// ±15% dal tempo del primo giro (G.base0), da schermo (− e + accanto ai bpm) e tastiera del PC (− e +), niente sull'Axiom.
// Non in tempo reale: stirare 8 loop mentre suonano è troppo per questo PC. Dopo l'ultimo − o + Giro si fa copiare i loop (dump con
// tag "tempo"), li stira qui (stretch, a pezzi: fra un pezzo e l'altro passano note e comandi) e il core passa alla versione nuova
// sul prossimo 1 (comando tempo), ogni loop dallo stesso punto del suo giro. Si stira sempre dalla versione suonata (TSRC, finché
// il loop non cambia): cambi ripetuti non sommano difetti e tornando al tempo del primo giro i loop sono di nuovo identici.
// Le note suonate non passano di qui. Gli strati di annulla si perdono (erano al tempo di prima).
const TEMPO={want:0,busy:false,gen:0,tries:0,timer:0,sent:null},TSRC=[];
const bpm0=()=>G.base0?60*G.beats/(G.base0/sr):bpm(),tempoLim=()=>[Math.ceil(bpm0()*.85),Math.floor(bpm0()*1.15)];
const tempoBusy=()=>G.loops.some(L=>L.state==="rec"||L.state==="closing"||L.state==="dub");
function tempoStep(d){if(!ready)return;
 if(!G.base){flashHint("Il tempo lo decide il primo giro: registralo, poi <b>−</b> e <b>+</b> lo cambiano.");return}
 if(tempoBusy()){flashHint("Finisci la registrazione, poi cambia il tempo con <b>−</b> e <b>+</b>.");return}
 const [lo,hi]=tempoLim(),cur=Math.round(bpm()),w=Math.max(lo,Math.min(hi,(TEMPO.want||cur)+d));
 if(w===(TEMPO.want||cur)){flashHint(`Più ${d>0?"veloce":"lento"} di così no: il tempo va da ${lo} a ${hi} bpm (±15% dal primo giro).`);return}
 TEMPO.gen++;TEMPO.busy=false;TEMPO.tries=0;TEMPO.want=w===cur&&!TEMPO.sent?0:w;clearTimeout(TEMPO.timer);
 if(TEMPO.want)TEMPO.timer=setTimeout(tempoRun,700);render()}
function tempoCancel(msg){TEMPO.want=0;TEMPO.busy=false;TEMPO.gen++;clearTimeout(TEMPO.timer);if(msg)flashHint(msg);render()}
function tempoRun(){if(!TEMPO.want||!ready)return;
 if(!G.base)return tempoCancel();
 if(tempoBusy())return tempoCancel("Tempo non cambiato: stai registrando. Riprova con <b>−</b> o <b>+</b> quando hai finito.");
 // salita, drop o pezzo ripetuto in corso, o un cambio già mandato al core: aspetto che finiscano
 if(building||G.dropAt||CUT||TEMPO.sent){TEMPO.timer=setTimeout(tempoRun,400);return}
 TEMPO.busy=true;TEMPO.dg=TEMPO.gen;send({type:"dump",all:true,exp:true,tag:"tempo"});render()}
async function onTempoDump(items){const g=TEMPO.gen,want=TEMPO.want;if(g!==TEMPO.dg||!want||!G.base)return;
 const base1=want===Math.round(bpm0())&&G.base0?G.base0:Math.round(60*G.beats*sr/want),out=[];
 for(const it of items){let S=TSRC[it.i];if(!S||S.ver!==it.ver)S=TSRC[it.i]={data:it.data,len:it.len,base:G.base,ver:it.ver};
  const len=S.len%S.base===0?S.len/S.base*base1:Math.round(S.len*base1/S.base);
  const data=len===S.len?S.data.slice():await stretch(S.data,len,()=>g!==TEMPO.gen);if(!data)return;out.push({i:it.i,data,ver:it.ver})}
 if(g!==TEMPO.gen||!G.base)return;
 if(tempoBusy())return tempoCancel("Tempo non cambiato: stai registrando. Riprova con <b>−</b> o <b>+</b> quando hai finito.");
 const X=G.running?nextBar(nowF()+Math.round(sr*.05)):nowF()+Math.round(sr*.05),r=base1/G.base;
 TEMPO.sent={id:g,X,r,base1,want,ids:out.map(o=>o.i)};
 send({type:"tempo",id:g,frame:X,r,items:out},out.map(o=>o.data.buffer))}
// il core ha cambiato (o no) il tempo al frame X: la griglia si stira da lì, l'1 del giro resta l'1
function onTempo(m){const S=TEMPO.sent;if(!S||m.id!==S.id)return;TEMPO.sent=null;
 if(!m.ok){if(m.busy||tempoBusy())return tempoCancel("Tempo non cambiato: stai registrando. Riprova con <b>−</b> o <b>+</b> quando hai finito.");
  // un loop è cambiato mentre lo stiravo (code, note in arrivo): riprovo
  if(++TEMPO.tries>12)return tempoCancel("Tempo non cambiato: i loop continuavano a cambiare. Riprova.");
  if(TEMPO.want){TEMPO.busy=false;TEMPO.timer=setTimeout(tempoRun,300)}return}
 const X=m.frame,r=S.r,sc=f=>f>X?X+Math.round((f-X)*r):f,ph=dmod(X-G.origin,G.base);
 G.origin=X-Math.round(ph*r);G.base=S.base1;
 if(G.stopAt)G.stopAt=sc(G.stopAt);if(G.dropAt)G.dropAt=sc(G.dropAt);
 G.loops.forEach((L,i)=>{if(L.pend)L.pend.at=sc(L.pend.at);if(L.rb)L.rb=sc(L.rb);L.fixed=false;L.dk="";L.org=null;dbgForget(i)});
 for(const i of S.ids)if(TSRC[i])TSRC[i].ver=m.vers[i];
 TEMPO.tries=0;TEMPO.busy=false;if(TEMPO.want===S.want||TEMPO.want===Math.round(bpm()))TEMPO.want=0;else{clearTimeout(TEMPO.timer);TEMPO.timer=setTimeout(tempoRun,300)}
 djRetime();saveSoon();flashHint(`Tempo: <b>${Math.round(bpm())} bpm</b>. Stessa intonazione; ${Math.round(bpm0())} bpm è il tempo del primo giro.`)}
// stira il loop x (circolare) a m campioni senza cambiare l'intonazione: pezzi da ~50 ms copiati così come sono, uniti da
// dissolvenze di 10 ms (SOLA a sovrapposizione corta: gli attacchi della batteria restano interi, con le finestre lunghe sovrapposte
// a metà si indebolivano e arrivavano 10 ms tardi). Ogni pezzo parte vicino al suo punto ideale (il centro del pezzo va a c·n/m: niente scivola, e dentro il pezzo,
// che non è stirato, lo scarto si divide fra le due metà),
// dove continua meglio il pezzo di prima, entro ±S: prima sul segnale ridotto di D, poi campione per campione; allontanarsi dal punto
// ideale costa (P), altrimenti la ricerca resta sempre in fondo alla finestra e tutto arriva in ritardo. A pezzi di ~6 ms di lavoro,
// fra uno e l'altro passano note e comandi; stale() vero: richiesta superata, si smette (null)
const YQ=[],YC=new MessageChannel();YC.port1.onmessage=()=>YQ.shift()?.();
const yieldNow=()=>new Promise(r=>{YQ.push(r);YC.port2.postMessage(0)});
async function stretch(x,m,stale){const n=x.length,H=Math.round(sr*.05),V=Math.round(sr*.01),S=Math.round(sr*.012),D=4,P=.15,a=n/m,M=Math.max(2,Math.round(m/H)),hs=m/M;
 const y=new Float32Array(m),ws=new Float32Array(m),fade=new Float32Array(V);for(let k=0;k<V;k++)fade[k]=.5-.5*Math.cos(Math.PI*(k+.5)/V);
 // copie che continuano oltre la fine col principio del loop: letture contigue da qualsiasi punto
 const xp=new Float32Array(n+Math.ceil(hs)+2*V+2*S+16);for(let k=0;k<xp.length;k++)xp[k]=x[k%n];
 const nd=Math.floor(n/D),Vd=V>>2,Sd=Math.round(S/D),dp=new Float32Array(nd+Vd+2*Sd+16);for(let k=0;k<dp.length;k++){const j=(k%nd)*D;dp[k]=(x[j]+x[j+1]+x[j+2]+x[j+3])/4}
 const score=(A,b,c,L,dev)=>{let dot=0,ea=0,ec=0;for(let k=0;k<L;k++){const u=A[b+k],v=A[c+k];dot+=u*v;ea+=u*u;ec+=v*v}return dot/Math.sqrt(ea*ec+1e-20)-P*dev*dev};
 let prev=0,po=0,t=performance.now();
 for(let j=0;j<M;j++){const o=Math.round(j*hs),o1=Math.round((j+1)*hs),len=o1-o+V,ideal=Math.round((o+(o1-o)/2)*a-(o1-o)/2);let pos=ideal;
  if(j>0){const nat=prev+o-po,c0=dmod(Math.round(nat/D),nd),f0=dmod(nat,n),i0=Math.round(ideal/D);let best=i0,bs=-Infinity;
   for(let s=-Sd;s<=Sd;s++){const sc=score(dp,dmod(i0+s,nd),c0,Vd,s/Sd);if(sc>bs){bs=sc;best=i0+s}}
   bs=-Infinity;for(let s=best*D-D;s<=best*D+D;s++){const sc=score(xp,dmod(s,n),f0,V,(s-ideal)/S);if(sc>bs){bs=sc;pos=s}}}
  // dissolvenza in entrata sui primi V campioni (l'uscita del pezzo di prima è il complemento), poi il pezzo intero, poi la sua uscita
  const b=dmod(pos,n);let q=o;
  for(let k=0;k<len;k++){const w=k<V?fade[k]:k>=len-V?1-fade[k-(len-V)]:1;y[q]+=xp[b+k]*w;ws[q]+=w;if(++q===m)q=0}
  prev=pos;po=o;
  if(performance.now()-t>6){await yieldNow();if(stale())return null;t=performance.now()}}
 for(let k=0;k<m;k++)if(ws[k]>1e-3)y[k]/=ws[k];
 return y}

// ---------- Sessione: salvataggio automatico dei loop in IndexedDB, ripresa all'apertura ----------
// Si salva un attimo dopo l'ultima modifica (loop chiuso, sovraincisione, annulla, cancella, volume/pan/filtro).
// Il core manda a pezzi le copie dei soli loop cambiati (dump); in IndexedDB "s" tiene tempo, volumi e posizioni,
// "L0"…"L7" i campioni di ogni loop. Alla ripresa i loop tornano fermi, ▶ li fa partire. Tutto in try/catch:
// se IndexedDB non c'è, Giro funziona come prima senza salvare.
let saveT=0,restoring=false;
function saveSoon(){if(restoring)return;clearTimeout(saveT);saveT=setTimeout(()=>send({type:"dump"}),2500)}
function idb(mode,fn){return new Promise((ok,ko)=>{const r=indexedDB.open("giro",1);r.onupgradeneeded=()=>r.result.createObjectStore("session");
 r.onerror=()=>ko(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction("session",mode),q=fn(t.objectStore("session"));
  t.oncomplete=()=>{d.close();ok(Array.isArray(q)?q.map(x=>x.result):q&&q.result)};t.onerror=()=>ko(t.error)}})}
// ---------- Registra l'esibizione: tutto quello che esce (note, loop, effetti) in un WAV ----------
let perf=null,perfTap=null;
function tapMaster(){perfTap=ctx.createScriptProcessor(4096,2,2);const mute=ctx.createGain();mute.gain.value=0;
 perfTap.onaudioprocess=e=>{if(!perf)return;const a=e.inputBuffer.getChannelData(0),b=e.inputBuffer.getChannelData(1),n=a.length,d=new Int16Array(n*2);
  for(let k=0;k<n;k++){d[2*k]=Math.max(-1,Math.min(1,a[k]))*32767;d[2*k+1]=Math.max(-1,Math.min(1,b[k]))*32767}perf.chunks.push(d);perf.n+=n};
 safeClip.connect(perfTap);perfTap.connect(mute);mute.connect(ctx.destination)}
const perfSecs=()=>perf?perf.n/sr:0;
function perfToggle(){if(!ready)return;
 if(!perf){perf={chunks:[],n:0};flashHint("<b>Registro l'esibizione</b>: tutto quello che suoni finisce nel file. Ripremi per fermare e salvare.");render();return}
 const P=perf;perf=null;render();if(P.n<sr*.5){flashHint("Registrazione troppo corta: scartata.");return}
 const n=P.n,d=new DataView(new ArrayBuffer(44+n*4)),w=(o,t)=>{for(let k=0;k<t.length;k++)d.setUint8(o+k,t.charCodeAt(k))};
 w(0,"RIFF");d.setUint32(4,36+n*4,true);w(8,"WAVEfmt ");d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,2,true);
 d.setUint32(24,sr,true);d.setUint32(28,sr*4,true);d.setUint16(32,4,true);d.setUint16(34,16,true);w(36,"data");d.setUint32(40,n*4,true);
 let o=44;for(const c of P.chunks){for(let k=0;k<c.length;k++,o+=2)d.setInt16(o,c[k],true)}
 const t=new Date(),p=x=>String(x).padStart(2,"0"),name=`esibizione-${t.getFullYear()}${p(t.getMonth()+1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}.wav`;
 const url=URL.createObjectURL(new Blob([d],{type:"audio/wav"})),el=document.createElement("a");el.href=url;el.download=name;document.body.appendChild(el);el.click();el.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);flashHint(`<b>${name}</b> scaricato: ${Math.floor(n/sr/60)}:${p(Math.floor(n/sr%60))}.`)}
// ---------- Telecomando dal telefono: ponte telecomando.py su localhost (vedi src/telecomando.py) ----------
// Giro riceve i comandi con Server-Sent Events e manda il suo stato quando cambia. Se il ponte non c'è, riprova ogni 5 s.
const TEL="http://localhost:8765";let tel={on:false,addr:"",last:"",busy:false,again:false};
function telConnect(){let es;try{es=new EventSource(TEL+"/events?who=giro")}catch(_){return}
 es.onopen=()=>{tel.on=true;tel.last="";fetch(TEL+"/info").then(r=>r.json()).then(j=>{tel.addr=j.ip+":"+j.port;render()}).catch(()=>{});render()};
 es.onmessage=e=>{try{telCmd(JSON.parse(e.data))}catch(_){}};
 es.onerror=()=>{if(tel.on){tel.on=false;render()}if(es.readyState===2){es.close();setTimeout(telConnect,5000)}}}
// QR per aprire il telecomando sul telefono: l'immagine la fa il ponte
function telQR(){if(!tel.on)return;$("#telQRimg").src=TEL+"/qr.svg?"+Date.now();$("#telAddr").textContent="http://"+tel.addr;$("#telQR").hidden=false}
addEventListener("pagehide",()=>{if(tel.on)navigator.sendBeacon(TEL+"/bye","{}")});
function telCmd(c){if(away)return;
 if(c.c==="perf")perfToggle();
 else if(c.c==="fx"&&(c.v==="mix"||c.v==="loop")){if(fxScope!==c.v)setFxScope(c.v)}
 else if(c.c==="fxstop")stopAllFx();
 else if(c.c==="play"){if(!G.running)return;if(c.v==="down")playDown(true);else playUp()} // tocco = drop, tenuto = build-up
 else if(c.c==="knob"&&KNOB_MODES.includes(c.v))setKnobMode(c.v);
 else if(c.c==="quant"&&QNAMES[+c.v])setQuant(+c.v);
 else if(c.c==="sel"){const i=+c.v;if(G.loops[i]?.has)selectLoop(i)}
 render()}
function telPush(){if(!tel.on)return;
 const s=JSON.stringify({perf:!!perf,secs:Math.floor(perfSecs()),fx:fxScope,fxOn:djAll().some(fxActive),knob:knobMode,quant:SET.quant,sel:G.sel,running:G.running,
  drop:G.drop,building,loops:G.loops.map((L,i)=>({st:L.state,muted:!!L.muted,fx:fxActive(LDJ[i])}))});
 if(s===tel.last)return;if(tel.busy){tel.again=true;return}tel.last=s;tel.busy=true;
 fetch(TEL+"/state",{method:"POST",body:s}).catch(()=>{}).finally(()=>{tel.busy=false;if(tel.again){tel.again=false;telPush()}})}
// ---------- Esporta WAV: un giro dei loop che suonano, reso offline con lo stesso LoopCore ----------
function exportWav(){
 if(!ready||!G.base||!G.loops.some(L=>L.has&&!L.muted)){flashHint("Niente da esportare: registra almeno un loop.");return}
 send({type:"dump",all:true,exp:true});flashHint("Preparo il file WAV…")}
function wavBlob(L,R,rate){const n=L.length,d=new DataView(new ArrayBuffer(44+n*4)),w=(o,s)=>{for(let k=0;k<s.length;k++)d.setUint8(o+k,s.charCodeAt(k))};
 let pk=0;for(let k=0;k<n;k++)pk=Math.max(pk,Math.abs(L[k]),Math.abs(R[k]));const sc=pk>.98?.98/pk:1;
 w(0,"RIFF");d.setUint32(4,36+n*4,true);w(8,"WAVEfmt ");d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,2,true);
 d.setUint32(24,rate,true);d.setUint32(28,rate*4,true);d.setUint16(32,4,true);d.setUint16(34,16,true);w(36,"data");d.setUint32(40,n*4,true);
 for(let k=0;k<n;k++){d.setInt16(44+k*4,Math.round(L[k]*sc*32767),true);d.setInt16(46+k*4,Math.round(R[k]*sc*32767),true)}
 return new Blob([d],{type:"audio/wav"})}
function doExport(items){
 const c=new LoopCore(sr);let max=0;
 for(const it of items){const L=G.loops[it.i];if(!L||L.muted)continue;
  c.exec({type:"load",i:it.i,data:it.data,len:it.len,t0:it.t0-G.origin,vol:L.vol,pan:L.pan,fx:L.fx,hp:L.shp||0,wid:L.swid||0},0);
  const o=c.loops[it.i];o.g=o.vol;o.gt=1;max=Math.max(max,it.len)}
 c.msgs=[];if(!max){flashHint("Niente da esportare: i loop sono fermi.");return}
 const L=new Float32Array(max),R=new Float32Array(max),a=new Float32Array(512),b=new Float32Array(512),none=[null,null,null];
 for(let f=0;f<max;f+=512){const n=Math.min(512,max-f),A=a.subarray(0,n),B=b.subarray(0,n);
  c.process(none,A,f,n,B);L.set(A,f);R.set(B,f);c.msgs=[]}
 const t=new Date(),p=x=>String(x).padStart(2,"0"),name=`giro-${t.getFullYear()}${p(t.getMonth()+1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}.wav`;
 const url=URL.createObjectURL(wavBlob(L,R,sr)),el=document.createElement("a");el.href=url;el.download=name;document.body.appendChild(el);el.click();el.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
 flashHint(`<b>${name}</b> scaricato: ${(max/sr).toFixed(1)} s, un giro dei loop.`)}
function onDump(m){
 const items=m.items.map(it=>{const data=new Float32Array(it.len);let o=0;for(const ch of it.chunks){data.set(ch,o);o+=ch.length}return{i:it.i,len:it.len,t0:it.t0,ver:it.ver,data}});
 if(m.tag==="fix")return onFixDump(items);
 if(m.tag==="beat")return onBeatDump(items);
 if(m.tag==="debug")return dbgWrite(items);
 if(m.tag==="tempo")return onTempoDump(items);
 if(m.exp)return doExport(items);
 if(!m.has.some(Boolean)){if(!G.loops.some(L=>L.state==="rec"||L.state==="closing")&&!anyHas())idb("readwrite",s=>{s.clear()}).catch(()=>{});return}
 if(!G.base)return;
 // posizione e lunghezza dallo stato di Giro (si spostano insieme a G.origin), i campioni solo dei loop cambiati
 const loops=[];G.loops.forEach((L,i)=>{if(m.has[i]&&L.has)loops.push({i,len:L.len,rel:L.t0-G.origin,vol:L.vol,pan:L.pan,fx:L.fx,sound:L.sound,sid:L.sid??SOUNDS[L.sound]?.id,mx:L.mx,ar:L.ar,pm:L.pm,bat:L.bat||0})});
 const rec={v:2,sr,base:G.base,base0:G.base0,beats:G.beats,loops};
 idb("readwrite",s=>{s.put(rec,"s");for(const it of items)s.put(it.data,"L"+it.i);m.has.forEach((h,i)=>{if(!h)s.delete("L"+i)})}).catch(()=>{})}
async function restoreSession(){
 let rec=null;try{rec=await idb("readonly",s=>s.get("s"))}catch(_){}
 if(!rec||(rec.v!==1&&rec.v!==2)||rec.sr!==sr||anyHas()||G.base)return;
 // v1 (versioni precedenti): i campioni stavano dentro "s"
 let datas=rec.loops.map(l=>l.data);if(rec.v===2){try{datas=await idb("readonly",s=>rec.loops.map(l=>s.get("L"+l.i)))}catch(_){return}}
 if(anyHas()||G.base)return;
 restoring=true;
 G.base=rec.base;G.base0=rec.base0||rec.base;G.beats=rec.beats;G.origin=nowF();G.running=false;
 rec.loops.forEach((s,k)=>{const L=G.loops[s.i],data=datas[k];if(!L||!data||data.length!==s.len)return;
  // mix automatico: le sessioni di prima non hanno le note (mx) e restano come erano; il loro pan conta come girato a mano
  // il suono per id: con i suoni aggiunti (+ SUONI) la posizione nell'elenco può cambiare; se non c'è ancora resta sid (soundOf)
  const si=s.sid!=null?SOUNDS.findIndex(x=>x.id===s.sid):-1;
  Object.assign(L,{vol:s.vol,pan:s.pan,fx:s.fx,sound:si>=0?si:s.sid!=null?null:s.sound,sid:si>=0?null:s.sid??null,mx:s.mx||null,ar:s.ar??null,pm:s.pm??s.pan!==0,bat:s.bat||0,fixed:false,dk:""});
  send({type:"load",i:s.i,data,len:s.len,t0:G.origin+s.rel,vol:s.vol,pan:s.pan,fx:s.fx},[data.buffer])});
 if(rec.v===1)send({type:"dump",all:true}); // riscrive subito nel formato nuovo
 setTimeout(()=>{restoring=false},500);
 flashHint("Ripresa la sessione precedente: <b>▶</b> per riascoltarla. Tieni premuto <b>■</b> per cancellare tutto.");render()}

// ---------- Debug per Orecchio (orecchio/, formato in orecchio/FORMATO.md) ----------
// Solo misure: Ctrl+Shift+D scarica un JSON con note, griglia, ripartenze e audio dei loop, orecchio.py lo analizza.
// Nel buffer l'indice 0 di un loop è la sua prima nota (t0), che dopo il primo loop non cade sulla griglia: i contenuti stanno
// al posto giusto perché tutto si conta in frame assoluti. Orecchio invece misura tutto dall'inizio del giro, quindi posizioni,
// ripartenze e WAV escono contati da G.origin (stesso contenuto, buffer ruotato): altrimenti ogni loop dopo il primo risulterebbe sfasato.
const DBG={notes:[],wraps:[],wk:{},gridClose:null,at:0},DBG_NOTES=2000,DBG_WRAPS=500;
const dmod=(a,n)=>((a%n)+n)%n;
function dbgGrid(q,on){return{loopLength:G.base/sr,bpm:bpm(),beats:G.beats,division:on?QNAMES[q]:null,step:gridF(q)/sr}}
// una nota suonata dentro un loop. rel (frame dall'origine della griglia) e qf (frame quantizzato) li riscrive qIndex coi valori che usa davvero
function dbgNote(i,note,ev,first){const L=G.loops[i],comp=ev?ev.comp:first?0:latencyFrames(),p=performance.now(),[midiTs,perfArrival,ctxArrival]=evIn||[p,p,ctx.currentTime];
 const d={loop:i,overdub:!first,pitch:note,sound:SOUNDS[SET.sound].name,midiTs,perfArrival,ctxArrival,ctxUsed:nowT(),latencyComp:comp/sr,
  rel:nowF()-comp-(first?L.start:G.origin),quant:ev?ev.q:0,qf:null,g:0,at:0};
 DBG.notes.push(d);if(DBG.notes.length>DBG_NOTES)DBG.notes.shift();if(ev)ev.dbg=d}
// il loop è cambiato del tutto (cancellato, annullato, registrato di nuovo): quelle note e quelle ripartenze non descrivono più il suo audio
function dbgForget(i){DBG.notes=DBG.notes.filter(d=>d.loop!==i);DBG.wraps=DBG.wraps.filter(w=>w.loop!==i);delete DBG.wk[i]}
// lunghezza o t0 cambiati (nuova registrazione, ▶ che sposta la griglia): le ripartenze di prima non sono più confrontabili
function dbgWrap(m){const k=m.len+"/"+m.t0;if(DBG.wk[m.loop]!==k){DBG.wk[m.loop]=k;DBG.wraps=DBG.wraps.filter(w=>w.loop!==m.loop)}
 DBG.wraps.push({loop:m.loop,ctx:m.ctx+dmod(G.origin-m.t0,m.len)/sr,ctxBuf:m.ctx});if(DBG.wraps.length>DBG_WRAPS)DBG.wraps.shift()}
function dbgExport(){if(!G.base){flashHint("Debug: niente da esportare, registra almeno un loop.");return}
 DBG.at=nowF();send({type:"dump",all:true,exp:true,tag:"debug"})}
// WAV PCM 16 bit mono
function encodeWav(x,rate){const n=x.length,d=new DataView(new ArrayBuffer(44+n*2)),w=(o,s)=>{for(let k=0;k<s.length;k++)d.setUint8(o+k,s.charCodeAt(k))};
 w(0,"RIFF");d.setUint32(4,36+n*2,true);w(8,"WAVEfmt ");d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,1,true);
 d.setUint32(24,rate,true);d.setUint32(28,rate*2,true);d.setUint16(32,2,true);d.setUint16(34,16,true);w(36,"data");d.setUint32(40,n*2,true);
 for(let k=0;k<n;k++)d.setInt16(44+k*2,Math.round(Math.max(-1,Math.min(1,x[k]))*32767),true);
 return new Uint8Array(d.buffer)}
// a pezzi multipli di 3 byte: i pezzi in base64 si possono attaccare
function b64enc(u){let s="";for(let k=0;k<u.length;k+=0x6000)s+=btoa(String.fromCharCode.apply(null,u.subarray(k,k+0x6000)));return s}
function dbgWrite(items){if(!G.base)return;
 const byId={},loops=items.map(it=>{byId[it.i]=it;const L=G.loops[it.i],rot=dmod(L.t0-G.origin,it.len),w=new Float32Array(it.len);
  w.set(it.data.subarray(it.len-rot),0);w.set(it.data.subarray(0,it.len-rot),rot);
  return{id:it.i,lengthSamples:it.len,wavBase64:b64enc(encodeWav(w,sr))}});
 // la griglia di adesso (i battiti possono essersi raddoppiati dopo il primo giro) nell'ultima suddivisione usata
 const lastQ=[...DBG.notes].reverse().find(d=>d.quant)?.quant,q=lastQ||SET.quant||4,g=gridF(q),notes=[];
 for(const d of DBG.notes){const it=byId[d.loop],st=G.loops[d.loop].state;
  // ancora fuori dal loop: registrazione da chiudere, nota quantizzata non ancora resa o tenuta
  if(!it||st==="rec"||st==="closing"||(d.quant&&d.qf==null))continue;
  const qr=d.qf==null?null:dmod(Math.round(d.qf),it.len)/sr;
  // qpos è null se la nota non è stata quantizzata su questa griglia (Q spenta o cambiata) o non è ancora arrivata nel buffer:
  // Orecchio la confronterebbe con la griglia di step e la darebbe per sbagliata
  notes.push({loop:d.loop,cycle:Math.floor(d.rel/G.base),overdub:d.overdub,pitch:d.pitch,sound:d.sound,midiTs:d.midiTs,perfArrival:d.perfArrival,ctxArrival:d.ctxArrival,
   ctxUsed:d.ctxUsed,latencyComp:d.latencyComp,pos:dmod(d.rel,it.len)/sr,qpos:d.g===g&&d.at<=DBG.at?qr:null,qposUsed:qr,stepUsed:d.g/sr})}
 const log={giro_debug:1,sampleRate:sr,baseLatency:ctx.baseLatency||0,outputLatency:ctx.outputLatency||0,quantize:SET.quant?QNAMES[SET.quant]:null,
  grid:dbgGrid(q,lastQ||SET.quant),gridClose:DBG.gridClose,worklet:usingWorklet,loops,notes,wraps:DBG.wraps.filter(w=>byId[w.loop])};
 const t=new Date(),p=x=>String(x).padStart(2,"0"),name=`giro_debug_${t.getFullYear()}${p(t.getMonth()+1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.json`;
 const url=URL.createObjectURL(new Blob([JSON.stringify(log)],{type:"application/json"})),el=document.createElement("a");el.href=url;el.download=name;document.body.appendChild(el);el.click();el.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);flashHint("Debug esportato",2000)}

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
 rollTick();routeLoops();autoMix();drumSync();if(speedTick(f))ch=true;if(G.dropAt&&f>=G.dropAt){G.dropAt=0;bld=null;flashHint("<b>DROP!</b>")}
 if(perf&&Math.floor(perfSecs())!==perfLast){perfLast=Math.floor(perfSecs());render()}
 if(G.stopAt&&f>=G.stopAt){stopAll();ch=true}
 // un loop cancellato perde anche i suoi effetti
 LDJ.forEach((D,i)=>{if(D&&!G.loops[i].has){dropLoopDJ(i);ch=true}});
 if(CUT&&!G.loops[CUT.i].has){CUT=null;ch=true} // e il pezzo ripetuto (il core l'ha già tolto)
 G.loops.forEach(L=>{
  if(L.state==="closing"&&f>=L.end){if(L.q)renderRec(G.loops.indexOf(L));L.state="play";rotateBus();ch=true}
  if(L.pend&&f>=L.pend.at){L.muted=L.pend.muted;L.pend=null;ch=true}});
 if(ch)render()}

// ---------- Mix automatico ----------
// Come farebbe un fonico: ogni loop prende un ruolo dai suoni suonati dentro e riceve pan, passa-alto e apertura stereo.
// I loop sono mono: senza questo finivano tutti al centro uno sopra l'altro, e accordi e tappeti riempivano i bassi
// insieme al basso (nelle esibizioni registrate dall'utente: quasi mono, −24 dB di laterale, il grosso fra 60 e 400 Hz).
// hp: passa-alto in Hz · pan: quanto va di lato (il lato lo sceglie autoMix) · wid: apertura stereo (core.js)
const ROLES={rit:{hp:0,pan:0,wid:0},per:{hp:150,pan:.3,wid:0},bas:{hp:0,pan:0,wid:0},acc:{hp:150,pan:.35,wid:.2},
 tap:{hp:220,pan:0,wid:.6},mel:{hp:200,pan:.2,wid:.15},col:{hp:350,pan:.5,wid:.3}};
const ROLE_ID={vibra:"acc",cristallo:"col",mtarchi:"tap",mtcoro:"tap",mtflauto:"mel",ondes:"mel",celesta:"col",glock:"col",steeldrum:"col",sitar:"mel",
 lead:"mel",polysynth:"acc",synthbrass:"acc",synthstrings:"tap",sweep:"tap",sub808:"bas",reese:"bas",acid:"bas",supersaw:"tap",stab:"acc"};
const ROLE_CAT={Tastiere:"acc",Chitarre:"acc",Bassi:"bas",Atmosfere:"tap",Synth:"acc",Etnici:"mel",Fiati:"mel",Orchestra:"mel",Percussioni:"col"};
// i file del PC («Miei») non hanno un ruolo: restano come sono
function soundRole(id,kick){const s=SOUNDS.find(x=>x.id===id);if(!s)return null;if(s.drum)return kick?"rit":"per";
 return ROLE_ID[s.id]||(s.cat==="Orchestra"&&s.loop?"tap":ROLE_CAT[s.cat])||null}
// mx: note suonate nel loop per suono (w), nota più bassa che si sente (lo), se la batteria ha cassa o tom basso (kick)
// h: colpi di batteria suonati, per il correttore (hitNote, fixRender)
const freshMx=()=>({w:{},lo:null,kick:false,h:[]});
function mxNote(L,s,note){const M=L.mx||(L.mx=freshMx());M.w[s.id]=(M.w[s.id]||0)+1;
 if(s.drum){if(note%12===0||note%12===5)M.kick=true}else{const n=note+(s.tr||0);if(M.lo==null||n<M.lo)M.lo=n}}
// il ruolo è quello del suono con più note
function loopRole(L){const M=L.mx;if(!M||!L.has)return null;let r=null,w=0;
 for(const id in M.w){const q=soundRole(id,M.kick);if(q&&M.w[id]>w){r=q;w=M.w[id]}}return r}
function autoTarget(i){const L=G.loops[i],r=SET.amix?loopRole(L):null;if(!r)return{r:null,hp:0,wid:0};
 const M=L.mx,bass=G.loops.some((o,j)=>j!==i&&loopRole(o)==="bas");let hp=Infinity;
 for(const id in M.w){const q=soundRole(id,M.kick);hp=Math.min(hp,q?ROLES[q].hp:0)} // con dentro anche un basso, il passa-alto è quello del basso
 // le note più basse restano: senza un basso nel giro sono loro il basso, con il basso ne perdono solo la fondamentale
 if(hp&&M.lo!=null)hp=Math.min(hp,(bass?1.2:.7)*440*Math.pow(2,(M.lo-69)/12));
 return{r,hp:hp>=40?Math.round(hp):0,wid:ROLES[r].wid}}
// gira in tick: manda al core solo quello che cambia. Il pan si decide una volta, quando il loop prende il suo ruolo,
// dal lato che bilancia gli altri; il primo loop resta al centro. Un pan girato a mano (pm) non si tocca più.
function autoMix(){
 G.loops.forEach((L,i)=>{const t=autoTarget(i);
  if(t.hp!==L.shp){L.shp=t.hp;send({type:"hp",i,v:t.hp})}
  if(t.wid!==L.swid){L.swid=t.wid;send({type:"wid",i,v:t.wid})}
  if(!L.has||L.pm||t.r===L.ar)return;L.ar=t.r;let x=0;
  if(t.r&&ROLES[t.r].pan&&G.loops.some((o,j)=>j!==i&&o.has)){const S=G.loops.reduce((a,o,j)=>a+(j!==i&&o.has?o.pan:0),0);
   x=(S>.01?-1:S<-.01?1:t.r==="mel"?1:-1)*ROLES[t.r].pan}
  if(x!==L.pan){L.pan=x;send({type:"pan",i,v:x});saveSoon()}})}
// ---------- Batteria ----------
// Per ora senza comando: la manopola 4 è passata a Rallenta. Il motore resta qui, con drumLv = 0 non fa niente (drumSet nei test).
// Chi suona non sa fare bene le parti di batteria. Due versioni bocciate: riordinare i colpi suonati per genere, e un
// batterista con 8 generi scritti a mano in 4/4 («non mi piace»: su un giro di lunghezza strana scivolava fuori dal giro,
// e sopra una melodia con accenti sfasati faceva il suo schema dritto). Ora la batteria segue i loop che ci sono:
// - gli attacchi si leggono dall'audio dei loop (beatOnsets), anche di quelli registrati senza quantizzazione e delle
//   sessioni di prima; si rileggono quando un loop cambia (L.ver dal core, cache in BO);
// - la griglia è quella che spiega meglio gli attacchi (beatGrid): dritta o in terzina, con qualsiasi numero di battiti
//   nel giro; la batteria dura quanto il loop più lungo (raddoppiato fino a ~6 s) e parte dall'1 del giro: non scivola;
// - cassa e rullante cadono sugli attacchi più forti, esattamente dove sono (cassa sull'1 e sui più gravi, poi alternati),
//   il charleston va sulla griglia (drumPlan).
// La manopola è la quantità (DRUM_LV): essenziale (cassa e rullante) · charleston sui battiti · charleston fitto · piena
// (rullanti fantasma sugli altri attacchi, aperto alla fine) · piena con rullata e piatto alla fine della frase.
// BATTERISTA: senza batteria nel giro crea un loop di batteria nel primo posto libero col kit scelto nel pannello (l'ultimo
// kit scelto, se adesso è scelto uno strumento) e si rifà quando cambiano i loop, il kit o la quantità.
// CORRETTORE: sopra una batteria suonata (note in mx.h) la stessa batteria aggiunge solo quello che manca (strumenti non
// suonati, fantasmi, rullata, piatto); l'audio suonato resta com'è (L.org, dal core) e tace solo nella rullata; la
// versione suonata resta da parte (swap con keep). Tutta a sinistra: il batterista se ne va, le batterie suonate tornano
// come erano. STOP EFFETTI non la tocca.
const DRUM_LV=["essenziale","charleston","charleston fitto","piena","piena con rullata"];
const lvOf=a=>a<.08?0:1+Math.min(DRUM_LV.length-1,Math.floor((a-.08)/.92*DRUM_LV.length));
const isDrum=i=>{const L=G.loops[i];return L.has&&!!SOUNDS[L.sound]?.drum};
// classe di un colpo dalla nota: k cassa, s rullante, rim o clap, t tom, h charleston, y piatto
const drumCls=n=>{const c=((n%12)+12)%12;return c===0?"k":c<=4?"s":c===11?"y":c===6||c===8||c===10?"h":"t"};
const DK=48,DS=50,DH=54,DO=58,DY=59; // cassa, rullante, charleston chiuso e aperto, piatto (mappa dei kit)
let lastKit=-1;
function drumKit(){if(SOUNDS[SET.sound]?.drum)return SET.sound;if(SOUNDS[lastKit]?.drum)return lastKit;return Math.max(0,SOUNDS.findIndex(s=>s.id==="batteria"))}
// colpi di batteria suonati: [indice nel buffer, classe, quantizzazione, nota, forza]
function hitNote(L,rec,note,vel){const M=L.mx||(L.mx=freshMx()),f=nowF()-(rec&&L.first?0:latencyFrames());if(!M.h)M.h=[];
 if(M.h.length<4000)M.h.push([rec?f-L.start:((f-L.t0)%L.len+L.len)%L.len,drumCls(note)[0],L.q||4,note,vel])}
// attacchi nell'audio di un loop (x; off = indice dove cade l'1): [{t dall'1, s forza 0…1, low quota sotto i ~120 Hz}].
// Energia a blocchi di 256 campioni: un attacco è una salita di almeno 6 dB sui 3 blocchi prima, non più di 30 dB sotto
// il massimo del loop, la più alta nel giro di ±6 blocchi; l'istante è il primo campione oltre metà del picco
function beatOnsets(x,off){const H=256,K=Math.floor(x.length/H),len=x.length;if(K<16)return[];
 const a=1-Math.exp(-2*Math.PI*120/sr),D=new Float32Array(K),Lo=new Float32Array(K);let y1=0,y2=0;
 for(let p=Math.max(0,len-4096);p<len;p++){y1+=a*(x[p]-y1);y2+=a*(y1-y2)} // il loop gira: il filtro parte dalla coda
 for(let k=0;k<K;k++){let f=0,l=0;for(let p=k*H;p<k*H+H;p++){const v=x[p];y1+=a*(v-y1);y2+=a*(y1-y2);f+=v*v;l+=y2*y2}
  D[k]=10*Math.log10(f/H+1e-10);Lo[k]=l/(f+1e-12)}
 let top=-100;for(const d of D)top=Math.max(top,d);
 const at=k=>D[(k+K)%K],o=new Float32Array(K),out=[];
 for(let k=0;k<K;k++)o[k]=Math.max(at(k),at(k+1))-Math.max(at(k-1),at(k-2),at(k-3));
 for(let k=0;k<K;k++){const r=o[k],lvl=Math.max(at(k),at(k+1));if(r<6||lvl<top-30)continue;
  let peak=true;for(let j=1;j<=6&&peak;j++)if(o[(k+j)%K]>r||o[(k-j+K)%K]>=r)peak=false;if(!peak)continue;
  let m=0;for(let p=k*H;p<Math.min(len,k*H+2*H);p++)m=Math.max(m,Math.abs(x[p]));
  let p0=k*H;while(p0<k*H+H-1&&Math.abs(x[p0])<m*.5)p0++;
  out.push({t:((p0-off)%len+len)%len,s:Math.min(1,(r-3)/20)*Math.min(1,(lvl-top+30)/30),low:Math.min(1,Lo[(k+1)%K])})}
 return out}
// la griglia che spiega meglio gli attacchi dentro il giro: k passi per giro, battito = g passi. Fra le griglie che spiegano
// almeno il 90% di quanto la migliore, prima quelle del tempo del giro (ottavi, terzine, sedicesimi, sestine), se no la
// più larga; il battito è quello del giro se ci cadono gli attacchi, se no il più lungo che li raccoglie (es. 3 battiti)
function beatGrid(ons){const P=G.base,sig=sr*.012;let tot=0;for(const o of ons)tot+=o.s;
 const on=(t,st)=>{const d=(t%P)/st;return Math.exp(-.5*(((d-Math.round(d))*st)/sig)**2)};
 const fit=k=>{let f=0;for(const o of ons)f+=o.s*on(o.t,P/k);return tot?f/tot:0};
 const lo=Math.max(1,Math.ceil(P/(sr*.4))),hi=Math.max(lo,Math.floor(P/(sr*.085))),F={};let best=0;
 for(let k=lo;k<=hi;k++){F[k]=fit(k);best=Math.max(best,F[k])}
 const ok=k=>k>=lo&&k<=hi&&F[k]>=.9*best;
 let k=best<.3?null:[2,3,4,6].map(m=>G.beats*m).find(ok);
 if(!k&&best>=.3)for(let j=lo;j<=hi;j++)if(ok(j)){k=j;break}
 if(!k){k=G.beats*4;while(k>hi&&k%2===0)k/=2;while(k<lo)k*=2}
 // frac: quanta forza cade sui battiti · cov: quanti battiti hanno un attacco (le terzine piene hanno cov 1 e frac basso)
 const st=P/k,frac=g=>{let f=0;for(const o of ons)f+=o.s*on(o.t,st*g);return tot?f/tot:1};
 const cov=g=>{const n=Math.round(k/g);let c=0;for(let b=0;b<n;b++)if(ons.some(o=>{const d=((o.t-b*st*g)%P+P)%P;return d<sr*.03||P-d<sr*.03}))c++;return c/n};
 const gs=[1,2,3,4,6,8].filter(g=>k%g===0&&st*g>=sr*.3&&st*g<=sr*1.2),g0=k%G.beats===0?k/G.beats:0;let g=g0;
 if(!gs.includes(g0)||!(cov(g0)>=.75||frac(g0)>=.85*Math.max(...gs.map(frac))))
  g=gs.length?gs.reduce((a,b)=>{const ca=cov(a),cb=cov(b);return cb>ca+1e-9||(Math.abs(cb-ca)<1e-9&&Math.abs(st*b-sr*.5)<Math.abs(st*a-sr*.5))?b:a}):(g0||1);
 return{step:st,g,beat:st*g,beats:Math.round(k/g)}}
// la batteria della quantità lv su T frame, dagli attacchi ons (t da 0 a T): [{t,note,v}] e dove comincia la rullata
function drumPlan(lv,T,ons){const P=G.base,{step,g,beat,beats}=beatGrid(ons),N=[],fill=lv>=5?T-beat:T;
 // gli attacchi letti dall'audio arrivano qualche ms dopo la nota: entro 15 ms dalla griglia ci vanno sopra, gli altri
 // (le tempistiche strane di chi suona) restano dove sono
 ons=ons.map(o=>{const d=Math.round(o.t/step);return Math.abs(o.t-d*step)<sr*.015?{...o,t:d*step}:o});
 const near=(t,arr,d)=>arr.some(u=>Math.abs(u.t-t)<d),onBeat=t=>{const d=t/beat;return Math.abs(d-Math.round(d))*beat<sr*.03};
 const ks=[];
 for(let s0=0;s0<T-1;s0+=P){ // ogni giro: cassa e rullante sugli attacchi più forti
  const seg=ons.filter(o=>o.t>=s0&&o.t<s0+P&&o.t<fill).map(o=>({...o,w:o.s*(1+o.low)*(onBeat(o.t)?1.25:1)})).sort((a,b)=>b.w-a.w);
  const n=Math.max(2,Math.round(beats*[.5,.75,1,1,1][lv-1])),gap=Math.max(1.5*step,sr*.12),pick=[{t:s0,low:1,w:9}];
  for(const o of seg){if(pick.length>=n)break;if(!near(o.t,pick,gap))pick.push(o)}
  // pochi attacchi (un tappeto): i battiti, prima quello a metà giro
  const half=Math.round(beats/2);for(const b of[half,...Array.from({length:beats},(_,j)=>j)]){if(pick.length>=n)break;const t=s0+b*beat;
   if(b>0&&t<fill&&t<s0+P-sr*.05&&!near(t,pick,gap))pick.push({t,low:0,w:0})}
  pick.sort((a,b)=>a.t-b.t);let prev=null;
  for(const o of pick){o.r=!prev?DK:o.low>=.35?DK:prev===DK?DS:DK;prev=o.r}
  if(pick.length>1&&!pick.some(o=>o.r===DS)){const o=pick.slice(1).sort((a,b)=>b.w-a.w)[0];o.r=DS}
  for(const o of pick){if(o.t>=fill)continue;N.push({t:o.t,note:o.r,v:o.r===DS?.95:onBeat(o.t)?1:.85});ks.push(o)}
  if(lv>=4){let c=0;for(const o of seg){if(c>=beats)break;if(!near(o.t,ks,step*.75)){N.push({t:o.t,note:DS,v:.3});ks.push(o);c++}}}}
 if(lv>=2){const hs=lv===2?beat:lv===3?(g%2===0?beat/2:step):(step>=sr*.1?step:2*step),hv=lv>=4?[.6,.4]:[.55,.38];
  const last=Math.floor((Math.min(fill,T)-1)/hs);
  for(let j=0;j<=last;j++){const t=j*hs;N.push({t,note:lv>=4&&j===last&&!onBeat(t)?DO:DH,v:onBeat(t)?hv[0]:hv[1]})}}
 if(lv>=5){const n=Math.max(2,Math.round(beat/step));for(let j=0;j<n;j++)N.push({t:fill+j*step,note:DS,v:.5+.5*j/Math.max(1,n-1)});
  N.push({t:fill,note:DK,v:.9},{t:0,note:DY,v:.75})}
 return{notes:N,fill}}
// mette i colpi nel buffer (posizione t in frame dall'1, off = indice del buffer dove cade l'1); l'aperto si chiude col
// charleston chiuso dopo, come suonando dal vivo (voice in sampler.js)
function drumMix(si,notes,len,off){const data=new Float32Array(len),fd=Math.round(sr*.01);notes.sort((a,b)=>a.t-b.t);
 notes.forEach((n,x)=>{let seg=renderNote(si,n.note,n.v,sr*.1);if(!seg)return;
  if(n.note%12===10){const nx=notes.find((m,y)=>y>x&&m.t>n.t&&(m.note%12===6||m.note%12===8));
   if(nx){const cut=Math.round(nx.t-n.t);if(cut<seg.length){seg=seg.slice(0,Math.min(seg.length,cut+fd));for(let k=0;cut+k<seg.length;k++)seg[cut+k]*=1-k/fd}}}
  let p=((Math.round(n.t+off))%len+len)%len;for(let k=0;k<seg.length;k++){data[p]+=seg[k];if(++p===len)p=0}});
 return data}
// attacchi letti dai loop: si chiede al core l'audio dei loop cambiati (dump con only e tag "beat", onBeatDump).
// Dice se sono tutti aggiornati
const BO=[];
function beatScan(){const now=performance.now();let fresh=true;
 G.loops.forEach((L,i)=>{if(!L.has||isDrum(i)){BO[i]=null;L.bq=null;return}const b=BO[i];
  if(b&&b.ver===L.ver&&b.len===L.len&&b.t0===L.t0&&b.o===G.origin)return;fresh=false;
  if(L.state==="rec"||L.state==="closing"||L.state==="dub"||(L.bq&&now-L.bq.t<3000))return;
  L.bq={ver:L.ver,t:now};send({type:"dump",all:true,exp:true,only:i,tag:"beat"})});
 return fresh}
function onBeatDump(items){for(const it of items){const L=G.loops[it.i],q=L.bq;L.bq=null;if(!L.has||!q||it.len!==L.len)continue;
 const off=((G.origin-L.t0)%it.len+it.len)%it.len;BO[it.i]={ver:q.ver,len:it.len,t0:L.t0,o:G.origin,ons:beatOnsets(it.data,off)}}}
// la batteria si rifà solo se cambiano gli attacchi (non per la coda delle note che finisce di entrare nel loop)
const beatKey=()=>BO.map(b=>b?b.len+":"+b.ons.map(o=>Math.round(o.t/256)).join():"").join("|");
// durata della batteria: il loop più lungo (anche quello suonato, own), raddoppiato finché non dura ~6 s (fino a 4 volte)
function drumSpan(own){let m=Math.max(G.base,own||0);G.loops.forEach((L,i)=>{if(L.has&&!isDrum(i))m=Math.max(m,L.len)});
 let T=m;while(T<6*sr&&T<4*m)T*=2;if(own)T=Math.ceil(T/own)*own;return Math.round(T)}
// gli attacchi dei loop che non sono batterie, ripetuti su T
function drumOns(T){const out=[];G.loops.forEach((L,i)=>{const b=BO[i];if(!L.has||isDrum(i)||!b)return;
 for(let r=0;r<T;r+=b.len)for(const o of b.ons)if(r+o.t<T)out.push({...o,t:r+o.t})});return out}
// batterista: dall'1 della griglia
function batRender(lv,si,T){return drumMix(si,drumPlan(lv,T,drumOns(T)).notes,T,0)}
// correttore: la batteria suonata (org, il suo audio) ripetuta su T, più quello che manca. Nella rullata la parte suonata
// tace (con 5 ms di dissolvenza), come farebbe un batterista
function fixRender(i,lv,org){const L=G.loops[i],L0=org.length,off=((G.origin-L.t0)%L0+L0)%L0,T=drumSpan(L0),offT=((G.origin-L.t0)%T+T)%T;
 const U=L.mx.h.map(h=>{const note=h[3]??(h[1]==="k"?DK:h[1]==="s"?DS:DH);return{t:((h[0]-off)%L0+L0)%L0,note,s:h[4]??.8,low:drumCls(note)==="k"?1:0}});
 const has=new Set(U.map(u=>drumCls(u.note))),own=[];for(let r=0;r<T;r+=L0)for(const u of U)if(r+u.t<T)own.push({...u,t:r+u.t});
 const{notes,fill}=drumPlan(lv,T,drumOns(T).concat(own)),step=sr*.06;
 const data=new Float32Array(T);for(let p=0;p<T;p++)data[p]=org[p%L0];
 const fd=Math.round(sr*.005),at=t=>((Math.round(t+offT)%T)+T)%T,a=Math.round(fill-sr*.02);
 if(fill<T)for(let t=a-fd;t<T;t++)data[at(t)]*=t<a?(a-t)/fd:0;
 const add=notes.filter(n=>{const c=drumCls(n.note);if(n.t>=a||c==="y"||!has.has(c))return true;
  return c==="s"&&n.v<.45&&!own.some(u=>drumCls(u.note)==="s"&&Math.abs(u.t-n.t)<step)});
 const extra=drumMix(L.sound,add,T,offT);for(let p=0;p<T;p++)data[p]+=extra[p];
 return data}
// la batteria nuova entra sull'1 del prossimo giro, con la dissolvenza dello swap finita prima
function drumAt(){const f=nowF();return Math.round(G.origin+Math.ceil((f+sr*.05-G.origin)/G.base)*G.base-sr*.008)}
let batWant=null,drumMsg=0;
function batMake(j,lv){const L=G.loops[j],si=drumKit(),data=batRender(lv,si,drumSpan()),len=data.length;
 Object.assign(L,{state:"play",has:true,muted:false,pend:null,dropped:false,sound:si,sid:null,len,t0:G.origin,first:false,peaks:null,
  mx:{w:{[SOUNDS[si].id]:1},lo:null,kick:true,h:[]},ar:null,pm:false,pan:0,shp:0,swid:0,bat:lv,dk:[lv,si,G.base,len,beatKey()].join(),fixed:false});
 send({type:"load",i:j,data,len,t0:G.origin,vol:L.vol,pan:0,fx:L.fx},[data.buffer]);
 send({type:"gate",i:j,on:G.running?1:0,frame:G.running?drumAt()+Math.round(sr*.008):nowF()});
 flashHint(`Batterista (<b>${DRUM_LV[lv-1]}</b>) nel loop ${j+1}, kit ${SOUNDS[si].name}: segue i tuoi loop.`);render()}
let drumLv=0; // quantità: 0 = spenta
function drumSet(v){drumLv=lvOf(v/127);if(!drumLv)G.loops.forEach((L,j)=>{if(L.bat&&L.has){clearLoop(j);L.bat=0;flashHint(`Batterista tolto dal loop ${j+1}. ◀ lo riporta indietro.`)}});drumSync()}
function drumText(){if(!drumLv)return "spento";const n=DRUM_LV[drumLv-1];if(!G.base)return n+" · prima registra un giro";
 const fix=L=>L.mx?.h?.length?n+" · corregge la tua batteria":n+" · batteria senza note: suonala di nuovo";
 const u=G.loops.find((L,j)=>isDrum(j)&&!L.bat),b=G.loops.findIndex(L=>L.has&&L.bat);
 return u?fix(u):b>=0?n+` · batterista nel loop ${b+1}`:n+" · batterista"}
// gira in tick: legge i loop, crea il batterista, rifà le batterie quando cambiano quantità, kit o loop (aspetta che la
// quantità si fermi)
function drumSync(){if(!ready)return;const lm=G.base?drumLv:0,now=performance.now();
 const want=i=>lm,calm=(o,key)=>{if(!o.dw||o.dw.key!==key){o.dw={key,t:now};return false}return now-o.dw.t>150};
 const fresh=G.base&&G.loops.some((L,i)=>want(i))?beatScan():false;
 if(lm&&!G.loops.some((L,i)=>isDrum(i)||L.state==="rec"||L.state==="closing")){const w=batWant||(batWant={});
  if(calm(w,lm)&&fresh){const j=G.loops.findIndex(L=>L.state==="empty"),si=drumKit();
   if(j<0){if(now-drumMsg>4000){drumMsg=now;flashHint("Batteria: nessun loop libero. Cancella un loop per far entrare il batterista.")}}
   else if(!BUF[SOUNDS[si].id])loadSound(si);else{batWant=null;batMake(j,lm)}}}else batWant=null;
 G.loops.forEach((L,i)=>{
  if(!L.has){L.bat=0;L.fixed=false;L.dk="";L.org=null;L.orgReq=false;return}
  if(!isDrum(i))return;
  const g=want(i);
  if(L.bat){if(!g||!fresh)return;const si=drumKit(),T=drumSpan(),key=[g,si,G.base,T,beatKey()].join();
   if(key===L.dk||!calm(L,key))return;if(!BUF[SOUNDS[si].id]){loadSound(si);return}
   L.dk=key;L.bat=g;L.sound=si;L.sid=null;L.mx.w={[SOUNDS[si].id]:1};send({type:"swap",i,data:batRender(g,si,T),frame:drumAt()});return}
  if(!g){if(L.fixed&&calm(L,"")){L.fixed=false;L.dk="";L.org=null;send({type:"swap",i,data:null,frame:drumAt()})}return}
  if(!L.mx?.h?.length||L.state!=="play"||!fresh)return;
  const key=[g,L.sound,G.base,beatKey(),L.mx.h.length].join();if(key===L.dk||!calm(L,key))return;
  if(!SOUNDS[L.sound])return;if(!BUF[SOUNDS[L.sound].id]){loadSound(L.sound);return}
  // la parte suonata: la prima volta si chiede al core (onDump), poi resta qui per i cambi di quantità
  if(!L.org){if(!L.orgReq){L.orgReq=true;send({type:"dump",all:true,exp:true,only:i,tag:"fix"})}return}
  const data=fixRender(i,g,L.org);L.fixed=true;L.dk=key;send({type:"swap",i,data,keep:true,frame:drumAt()})})}
// la parte suonata di una batteria da correggere (vedi drumSync)
function onFixDump(items){for(const it of items){const L=G.loops[it.i];L.orgReq=false;if(!L.fixed&&L.has)L.org=it.data}}

// ---------- Consigli sugli strumenti ----------
// Tre suoni sempre in vista sopra il pannello: i primi due coprono i ruoli che mancano al giro (nell'ordine di una band:
// ritmo, basso, accordi, tappeto, melodia, colore acuto) restando nel «mondo» dei suoni già usati; il terzo è un
// abbinamento inatteso, lo stesso ruolo da un altro mondo. Cambiano solo quando cambiano i loop (chiusi, sovraincisi, cancellati).
const ROLE_ORDER=["rit","bas","acc","tap","mel","col"];
const ROLE_WHY={rit:"ritmo",bas:"basso",acc:"accordi",tap:"tiene le note",mel:"melodia",col:"aria in alto"};
// mondi: ac acustico, in indie/vintage, el elettronico
const WORLD_ID={rhodes:"in",synthbass:"el",synthbass2:"el",archi:"ac",coro:"ac",cristallo:"el","808":"el",cr8000:"in",house909:"el"};
const WORLD_CAT={Atmosfere:"el",Indie:"in",Synth:"el",Techno:"el"};
const soundWorld=s=>WORLD_ID[s.id]||WORLD_CAT[s.cat]||"ac";
let tipCache={key:null,list:[]};
function tips(){
 const full=G.loops.filter(L=>L.has&&L.mx),roles=new Set(full.map(loopRole));if(roles.has("per"))roles.add("rit");
 const used=new Set(),wn={};
 for(const L of full)for(const id in L.mx.w){used.add(id);const s=SOUNDS.find(x=>x.id===id);if(s)wn[soundWorld(s)]=(wn[soundWorld(s)]||0)+L.mx.w[id]}
 const world=Object.keys(wn).sort((a,b)=>wn[b]-wn[a])[0]||null;
 const key=[...roles].sort()+"|"+[...used].sort()+"|"+world+"|"+SOUNDS.length;
 if(key===tipCache.key)return tipCache.list;
 let need=ROLE_ORDER.filter(r=>!roles.has(r));if(!need.length)need=["col","mel","tap"]; // c'è tutto: un colore o una melodia in più
 const out=[],pick=(r,ok)=>{const c=SOUNDS.map((s,i)=>i).filter(i=>{const s=SOUNDS[i];return soundRole(s.id,true)===r&&!used.has(s.id)&&!out.some(t=>t.i===i)&&ok(soundWorld(s))});
  return c.length?c[Math.floor(Math.random()*c.length)]:-1};
 const same=w=>!world||w===world,add=(r,odd)=>{let i=pick(r,odd?w=>world?w!==world:true:same);if(i<0&&!odd)i=pick(r,()=>true);if(i>=0)out.push({i,why:ROLE_WHY[r],odd})};
 add(need[0]);add(need[1]||need[0]);add(need[0],true);
 tipCache={key,list:out};return out}
function toggleAutoMix(){SET.amix=SET.amix?0:1;saveSet();autoMix();
 flashHint(SET.amix?"Mix automatico acceso: ogni loop prende il suo posto (pan, bassi puliti, apertura).":"Mix automatico spento: i loop restano al centro, senza filtri.");render()}

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
 if(i>=0){mxNote(G.loops[i],SOUNDS[SET.sound],note);if(SOUNDS[SET.sound].drum)hitNote(G.loops[i],ti>=0,note,vel)}
 held.set(note,{v:voice(SET.sound,note,vel,nowT(),ev?masterIn:liveBus[G.cur],DJV[7]),sus:false,ev});uiNote(note,true)}
let sustain=false;
function noteOff(note,force){const h=held.get(note);if(!h)return;if(sustain&&!force){h.sus=true;return}
 h.v.release(nowT());held.delete(note);uiNote(note,false);
 if(h.ev&&!h.ev.done){h.ev.off=nowF();if(h.ev.kind==="dub")commitDubNote(h.ev)}}
function setSustain(on){sustain=on;if(!on)[...held.entries()].filter(([,h])=>h.sus).forEach(([n])=>noteOff(n,true))}
// spegne tutte le note dal vivo, anche quelle tenute dal pedale: per le note rimaste bloccate (cavo staccato,
// rilascio perso). La chiamano ■ da fermo, Esc, i messaggi «all notes off» e lo stacco di una tastiera. Dice quante erano.
function allNotesOff(){const n=held.size;sustain=false;[...held.keys()].forEach(k=>noteOff(k,true));pcHeld.clear();return n}
function setSound(i){lastInCat[SOUNDS[i].cat]=i;if(SOUNDS[i].drum)lastKit=i;if(i===SET.sound)return;SET.sound=i;saveSet();if(ready)loadSound(i);render()}
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
const BTN={18:dubButton,19:()=>undoSel(false),20:()=>undoSel(true),21:()=>stepFamily(1),22:()=>stepFamily(-1)};
// tasto centrale (CC 23): tocco = suono successivo nella famiglia, tenuto 0,6 s = velocità normale sul loop selezionato (speedReset).
// Tenuto solo se il tasto manda anche il rilascio, come ■ e ▶: finché non se ne vede uno ogni pressione è un tocco
let ctrHold=0,ctrRel=false;
function centerDown(){clearTimeout(ctrHold);ctrHold=0;if(!ctrRel){stepInFamily(1);return}ctrHold=setTimeout(()=>{ctrHold=0;speedReset()},600)}
function centerUp(){ctrRel=true;if(ctrHold){clearTimeout(ctrHold);ctrHold=0;stepInFamily(1)}}
function initMIDI(){
 if(!navigator.requestMIDIAccess){setMidi(false,"MIDI non supportato: usa Chrome");return}
 navigator.requestMIDIAccess().then(acc=>{
  const bind=()=>{const names=[];acc.inputs.forEach(inp=>{inp.onmidimessage=e=>{if(!away)atEvent(e,()=>onMIDI(e))};names.push(inp.name.replace(/ MIDI In$/,""))});
   setMidi(names.length>0,names.length?names.join(", "):"Nessuna tastiera")};
  // una tastiera che si stacca non manda più i rilasci: spengo le note
  bind();acc.onstatechange=e=>{if(e&&e.port&&e.port.type==="input"&&e.port.state==="disconnected")allNotesOff();bind()}},()=>setMidi(false,"MIDI non consentito"))}
// ---------- Una scheda sola ----------
// Web MIDI manda l'Axiom a tutte le schede: con Giro aperto due volte ogni nota suonava anche nell'altra scheda, col suono
// scelto lì (l'utente sentiva «il pianoforte sotto tutti i suoni»). L'ultima scheda accesa vince e lo dice alle altre
// (BroadcastChannel); quelle già accese vanno in pausa: audio sospeso, Axiom, tastiera del PC e telefono ignorati,
// finché non si preme USA QUESTA SCHEDA (che mette in pausa l'altra).
let away=false;const tabId=Math.random().toString(36).slice(2),tabCh=typeof BroadcastChannel==="function"?new BroadcastChannel("giro"):null;
function tabTake(){tabCh?.postMessage({take:tabId});if(!away)return;away=false;$("#away").hidden=true;ctx?.resume();render()}
if(tabCh)tabCh.onmessage=e=>{if(!e.data||e.data.take===tabId||away||!ctx)return;
 away=true;allNotesOff();stopRelease();playUp();clearTimeout(ctrHold);ctrHold=0;for(const i in holdT)padUp(+i);$("#away").hidden=false;ctx.suspend()};
let diagOn=false;const diagLines=new Map();
// sceglie il loop su cui sovraincidere senza toccarne il pad (che lo fermerebbe): solo tra i loop pieni
function selStep(d){const ids=G.loops.map((L,i)=>L.has?i:-1).filter(i=>i>=0);if(!ids.length)return;
 const k=ids.indexOf(G.sel),i=k<0?ids[d>0?0:ids.length-1]:ids[(k+d+ids.length)%ids.length];
 flash(`[data-loop="${i}"]`);selectLoop(i)}
// suono con cui il loop è stato registrato (sid: salvato per id e non ancora fra i suoni, vedi restoreSession)
function soundOf(L){if(L.sid!=null){const k=SOUNDS.findIndex(x=>x.id===L.sid);if(k>=0){L.sound=k;L.sid=null}}return SOUNDS[L.sound]?L.sound:-1}
// selezione esplicita (pitch bend, Maiusc+numero, telefono): il loop resta com'è e la tastiera passa al suo strumento.
// Il tocco del pad no: ferma e fa rientrare, e cambiare il suono che stai suonando lì sarebbe una sorpresa
function selectLoop(i){const L=G.loops[i];if(!L.has)return;G.sel=i;const si=soundOf(L);
 if(si>=0&&si!==SET.sound)setSound(si);
 flashHint(`Loop ${i+1} selezionato`+(si>=0?` · suono: <b>${SOUNDS[si].name}</b>`:"")+`: <b>●</b> per sovraincidere.`)}
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
  dj:"Manopole: <b>EFFETTI DJ</b> sul mix — 1 filtro · 2 eco · 3 riverbero · 4 rallenta · 5 crusher · 6 wobble · 7 roll · 8 tastiera."}[m])}
function cycleKnobMode(){setKnobMode(KNOB_MODES[(KNOB_MODES.indexOf(knobMode)+1)%KNOB_MODES.length])}
function hcModeButton(cc){
 if(cc===58){hcMode=hcMode==="vol"?"pan":"vol";setKnobMode(hcMode)}
 else if(cc===59){hcMode="fx";setKnobMode("fx")}
 else{hcMode="midi";setKnobMode("dj")}} // modo MIDI (LED spenti): effetti DJ
function knob(i,v){const L=G.loops[i];if(knobMode==="dj")return djKnob(i,v);
 if(L.has)saveSoon();
 if(knobMode==="vol"){L.vol=v/127;send({type:"vol",i,v:L.vol});render();return}
 let x=Math.max(-1,Math.min(1,(v-64)/63));if(Math.abs(x)<.03)x=0;
 if(knobMode==="pan"){L.pan=x;L.pm=true;send({type:"pan",i,v:x});
  flashHint(`Loop ${i+1}: ${x===0?"al centro":Math.round(Math.abs(x)*100)+"% a "+(x<0?"sinistra":"destra")}`)}
 else{L.fx=x;send({type:"fx",i,v:x});
  flashHint(`Loop ${i+1}: ${x===0?"filtro spento":x<0?"più scuro (passa-basso) "+Math.round(-x*100)+"%":"più leggero (passa-alto) "+Math.round(x*100)+"%"}`)}
 render()}
// Aggancio: una manopola agisce solo quando passa dal valore attuale di quello che comanda. Così cambiando modo
// (o loop, o ambito degli effetti) una manopola lasciata alta non accende di colpo crusher o roll e non fa saltare un volume.
// knobSet ricorda dove e a che valore la manopola ha agito l'ultima volta; knobLast l'ultima posizione fisica.
const knobSet=Array(8).fill(null),knobLast=Array(8).fill(null);
const knobKey=()=>knobMode==="dj"?"dj"+fxScope+(fxScope==="loop"?G.sel:""):knobMode;
function knobTarget(i){const L=G.loops[i];
 if(knobMode==="vol")return L.vol*127;if(knobMode==="pan")return L.pan*63+64;if(knobMode==="fx")return L.fx*63+64;
 if(fxScope==="loop"&&i===7)return G.loops[G.sel].vol*127;
 const a=djView().v[i];return i===0||i===3?a*63+64:a*127}
function knobIn(i,v){if(!ready)return;const key=knobKey(),t=knobTarget(i),S=knobSet[i],p=knobLast[i];knobLast[i]=v;
 const caught=S&&S.key===key&&Math.abs(S.v-t)<=3;
 if(!caught&&Math.abs(v-t)>3&&!(p!=null&&(p-t)*(v-t)<=0)){
  const pct=knobMode==="vol"||knobMode==="dj"&&i>0&&i!==3,where=pct?Math.round(t/127*100)+"%":Math.abs(t-64)<3?"metà":Math.round(Math.abs(t-64)/63*100)+"% a "+(t<64?"sinistra":"destra");
  flashHint(`Manopola ${i+1}${knobMode==="dj"?" "+DJ_NAMES[i]:""}: girala ${v<t?"a destra":"a sinistra"} fino a <b>${where}</b> per agganciarla.`);return}
 knobSet[i]={key,v};knob(i,v)}
// HyperControl (canale 16): stessi comandi del modo MIDI con altri numeri
const HC_CC={116:16,117:17,118:18,99:19,100:20,101:21,102:22,98:23};
function onMIDI(e){let [st,d1,d2=0]=e.data,type=st&0xf0;
 // la diagnostica mostra tutti i messaggi come arrivano (tranne clock e active sensing), con la porta, prima di tradurre quelli HyperControl
 if(diagOn&&st!==0xF8&&st!==0xFE&&!(type===0x90&&d2===0)&&type!==0x80){
  const ch1=" · canale "+((st&15)+1),k=(st>=0xF0?"sistema "+[...e.data].map(x=>x.toString(16).padStart(2,"0")).join(" "):
   {0x90:"nota "+d1+ch1,0xB0:"CC "+d1+ch1,0xC0:"program change "+d1+ch1,0xD0:"aftertouch"+ch1,0xA0:"aftertouch nota "+d1+ch1,0xE0:"pitch bend"+ch1}[type])+" · "+(e.target?.name||"?");
  if(!diagLines.has(k)){diagLines.set(k,1);$("#diag").textContent=[...diagLines.keys()].join("\n")}}
 if(st>=0xF0)return;
 const ch=st&15;
 if(ch===15&&type===0xB0){
  if(d1>=58&&d1<=60){if(d2>63)hcModeButton(d1);return}
  if(d1>=33&&d1<=40)return knobIn(d1-33,d2);
  if(HC_CC[d1])d1=HC_CC[d1]}
 // pad in HyperControl: note 81–84 = pad 1–4, 85–88 = pad 5–8 (canale 15, banco B sul 16)
 if(ch>=14&&(type===0x90||type===0x80)&&d1>=81&&d1<=88)d1=d1-81+36;
 const on=type===0x90&&d2>0,off=type===0x80||(type===0x90&&d2===0),cc=type===0xB0;
 if(type===0xE0)return pitchBend(d1|(d2<<7));
 if((on||off)&&d1>=36&&d1<=43){const i=d1-36;if(on){flash(`[data-loop="${i}"]`);padDown(i)}else padUp(i);return}
 if(cc){if(d1===64)return setSustain(d2>=64);
  if(d1===120||d1===123)return allNotesOff(); // all sound off / all notes off
  if(d1===16){if(d2>63){flash(`[data-key="16"]`);stopButton();if(stopRel)stopPress()}else{stopRel=true;stopRelease()}return}
  if(d1===17){if(d2>63){flash(`[data-key="17"]`);playDown(playRel)}else{playRel=true;playUp()}return}
  if(d1===23){if(d2>63){flash(`[data-key="23"]`);centerDown()}else centerUp();return}
  if(BTN[d1]){if(d2>63){flash(`[data-key="${d1}"]`);BTN[d1]()}return}
  if(d1>=1&&d1<=8)return knobIn(d1-1,d2); // CC 1–8: fanno quello che dice il modo scelto nell'app (volume / pan / effetti DJ)
  return}
 if(on)noteOn(d1,d2/127);else if(off)noteOff(d1)}

// ---------- Tastiera del PC ----------
// tasti delle note: nessuna di queste lettere può essere un comando (i comandi sono controllati prima)
const KEYMAP="awsedftgyhujkolp;'";const pcHeld=new Map();
addEventListener("keydown",e=>atEvent(e,()=>{
 if(e.ctrlKey&&e.shiftKey&&e.code==="KeyD"){e.preventDefault();if(!away&&ready&&!e.repeat)dbgExport();return}
 if(away)return;
 if(!$("#gate").hidden){e.preventDefault();start();return}
 if(!$("#settings").hidden||!$("#help").hidden){if(e.key==="Escape")closeSettings();return}
 if(e.target.matches("input,select")||e.ctrlKey||e.metaKey||e.altKey)return;
 const k=e.key.toLowerCase();
 if(e.code==="Space"){e.preventDefault();if(!e.repeat){(G.running?stopButton:playButton)();stopPress()}return}
 if(e.repeat)return;
 if(e.shiftKey&&/^Digit[1-8]$/.test(e.code)){selectLoop(+e.code[5]-1);return}
 if(/^[1-8]$/.test(k))return padDown(+k-1);
 if(k==="r")return dubButton();
 if(k==="b")return playDown(true); // come ▶: tocco = drop, tenuto = build-up
 if(k==="q")return cycleQuant();
 if(k==="m")return cycleKnobMode();
 if(k==="c")return toggleFxScope();
 if(k==="0")return stopAllFx();
 if(k==="9")return speedReset();
 if(k==="n")return perfToggle();
 if(k==="v")return cutButton();
 if(e.key==="+"||e.key==="=")return tempoStep(1);
 if(e.key==="-")return tempoStep(-1);
 if(e.key==="Escape")return allNotesOff();
 if(e.key==="Backspace"){e.preventDefault();return undoSel(false)}
 if(e.key==="ArrowUp"){e.preventDefault();return stepFamily(1)}
 if(e.key==="ArrowDown"){e.preventDefault();return stepFamily(-1)}
 if(e.key==="ArrowRight"){e.preventDefault();return stepInFamily(1)}
 if(e.key==="ArrowLeft"){e.preventDefault();return stepInFamily(-1)}
 if(k==="z"||k==="x"){SET.oct=Math.max(-3,Math.min(3,SET.oct+(k==="z"?-1:1)));flashHint(`Ottava tastiera PC: ${SET.oct>0?"+":""}${SET.oct}`);return}
 const idx=KEYMAP.indexOf(k);if(idx>=0){const n=60+SET.oct*12+idx;pcHeld.set(k,n);noteOn(n,.8)}}));
// finestra che perde il focus: i rilasci dei tasti del PC non arriverebbero più (note bloccate, pad o ■ tenuti che cancellano)
addEventListener("blur",()=>{[...pcHeld.values()].forEach(n=>noteOff(n,true));pcHeld.clear();
 for(const i in holdT)padUp(+i);stopRelease();playUp()});
addEventListener("keyup",e=>atEvent(e,()=>{const k=e.key.toLowerCase();
 if(e.code==="Space")return stopRelease();
 if(k==="b")return playUp();
 if(/^[1-8]$/.test(k))return padUp(+k-1);
 if(pcHeld.has(k)){noteOff(pcHeld.get(k));pcHeld.delete(k)}}));
