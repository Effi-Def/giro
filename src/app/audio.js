// ---------- Audio ----------
let ctx,sr,node,core=null,ready=false,masterIn,masterOut,cutF,dry,wet,liveBus=[],usingWorklet=false,lim,safeClip;
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
 // mix più grosso: saturazione morbida prima del compressore e limitatore in fondo (con tanti strati non distorce)
 const satIn=ctx.createGain(),sat=ctx.createWaveShaper();satIn.gain.value=.5;sat.curve=satCurve(.8);sat.oversample="2x";
 lim=ctx.createDynamicsCompressor();lim.threshold.value=-1.5;lim.knee.value=0;lim.ratio.value=20;lim.attack.value=.001;lim.release.value=.08;
 DJ=makeDJ(DJV);masterIn.connect(DJ.in);DJ.out.connect(cutF);cutF.connect(dry);cutF.connect(conv);conv.connect(wet);
 dry.connect(satIn);wet.connect(satIn);satIn.connect(sat);sat.connect(comp);comp.connect(masterOut);
 // protezione finale: lineare fino a 0,9, poi si piega dolcemente; non supera mai il fondo scala
 safeClip=ctx.createWaveShaper();safeClip.curve=clipCurve();
 masterOut.connect(lim);lim.connect(safeClip);safeClip.connect(ctx.destination);tapMaster();
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
 if(usingWorklet)for(let i=0;i<NL;i++){const g=ctx.createGain();node.connect(g,i);g.connect(masterIn);loopOut.push(g)}
 else node.connect(masterIn);
 applyMix();ready=true;
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
