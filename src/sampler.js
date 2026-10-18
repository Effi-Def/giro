// ---------- Campionatore ----------
// Strumenti veri (soundfont MusyngKite, batterie LinnDrum LM-2 e TR-808), incorporati nel file.
const DRUM_KEYS=["cassa","rim","rullante","clap","rullante 2","tom basso","charleston","tom medio","charleston corto","tom alto","charleston aperto","piatto"];
const BUF={};const loading={};
function impulse(sec){const len=ctx.sampleRate*sec,b=ctx.createBuffer(2,len,ctx.sampleRate);
 for(let c=0;c<2;c++){const d=b.getChannelData(c);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,3)}return b}
function b64buf(s){const bin=atob(s),u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);return u.buffer}
// per gli strumenti tenuti (organo, archi, pad, coro) prepara un tratto che si ripete senza scatti
function makeLoop(b){const a=Math.round(1.2*b.sampleRate),e=Math.min(b.length-64,Math.round(2.9*b.sampleRate)),X=Math.round(.35*b.sampleRate);
 if(e-a<X*2)return null;
 for(let c=0;c<b.numberOfChannels;c++){const d=b.getChannelData(c);
  for(let i=0;i<X;i++){const w=i/X;d[e-X+i]=d[e-X+i]*(1-w)+d[a-X+i]*w}}
 return{start:a/b.sampleRate,end:e/b.sampleRate}}
function loadSound(i){const s=SOUNDS[i];if(BUF[s.id])return Promise.resolve();if(loading[s.id])return loading[s.id];
 const src=SAMPLE_DATA[s.id];
 loading[s.id]=Promise.all(Object.entries(src).map(([k,v])=>ctx.decodeAudioData(b64buf(v)).then(b=>[+k,b,s.loop?makeLoop(b):null])))
  .then(list=>{list.sort((x,y)=>x[0]-y[0]);BUF[s.id]=list;render()});
 return loading[s.id]}
function preloadAll(){let p=Promise.resolve();SOUNDS.forEach((_,i)=>{p=p.then(()=>loadSound(i)).catch(()=>{})})}

let openHat=null;
function voice(i,note,vel,when,bus){
 const s=SOUNDS[i],list=BUF[s.id];
 if(!list){loadSound(i);return{release(){}}}
 const amp=ctx.createGain(),src=ctx.createBufferSource();
 const level=s.gain*Math.pow(.2+.8*vel,1.4);
 if(s.drum){const k=((note%12)+12)%12,e=list.find(x=>x[0]===k);if(!e)return{release(){}};
  src.buffer=e[1];amp.gain.value=level;src.connect(amp);amp.connect(bus);src.start(when);
  if(k===6||k===8){if(openHat){try{openHat.gain.setTargetAtTime(0,when,.01)}catch(_){}openHat=null}}
  if(k===10)openHat=amp;
  src.onended=()=>amp.disconnect();return{release(){}}}
 const n=note+(s.tr||0);let best=list[0];for(const e of list)if(Math.abs(e[0]-n)<Math.abs(best[0]-n))best=e;
 src.buffer=best[1];src.playbackRate.value=Math.pow(2,(n-best[0])/12);
 if(best[2]){src.loop=true;src.loopStart=best[2].start;src.loopEnd=best[2].end}
 const att=s.att||.002;
 amp.gain.setValueAtTime(0,when);amp.gain.linearRampToValueAtTime(level,when+att);
 src.connect(amp);amp.connect(bus);src.start(when,s.off||0);
 src.onended=()=>amp.disconnect();
 let done=false;
 return{release(t){if(done)return;done=true;t=Math.max(t,ctx.currentTime);
  try{amp.gain.cancelAndHoldAtTime(t)}catch(_){amp.gain.cancelScheduledValues(t)}
  amp.gain.setTargetAtTime(0,t,(s.rel||.2)/3);src.stop(t+(s.rel||.2)*2.5+.05)}}}

// Ricostruisce una nota come la suonerebbe voice(): serve per scrivere nel loop la versione quantizzata
function renderNote(si,note,vel,dur){const s=SOUNDS[si],list=BUF[s.id];if(!list)return null;
 const level=s.gain*Math.pow(.2+.8*vel,1.4);
 const mono=b=>{if(b._mono)return b._mono;const n=b.numberOfChannels,m=new Float32Array(b.length);
  for(let c=0;c<n;c++){const d=b.getChannelData(c);for(let k=0;k<m.length;k++)m[k]+=d[k]/n}return b._mono=m};
 if(s.drum){const k=((note%12)+12)%12,e=list.find(x=>x[0]===k);if(!e)return null;
  const m=mono(e[1]),o=new Float32Array(m.length);for(let j=0;j<m.length;j++)o[j]=m[j]*level;return o}
 const n=note+(s.tr||0);let best=list[0];for(const e of list)if(Math.abs(e[0]-n)<Math.abs(best[0]-n))best=e;
 const m=mono(best[1]),R=best[1].sampleRate,rate=Math.pow(2,(n-best[0])/12)*R/sr,lp=best[2];
 const off=(s.off||0)*R,att=Math.max(1,(s.att||.002)*sr),rel=(s.rel||.2),tau=rel/3*sr;
 let total=Math.round(dur+rel*2.5*sr);if(!lp)total=Math.min(total,Math.floor((m.length-1-off)/rate));
 if(total<=0)return null;
 const o=new Float32Array(total),ls=lp?lp.start*R:0,le=lp?lp.end*R:0,span=le-ls;
 const envAt=k=>k<att?level*k/att:level,eDur=envAt(dur);
 for(let k=0;k<total;k++){let p=off+k*rate;if(lp&&p>=le)p=ls+((p-ls)%span);
  const i=p|0,f=p-i,x=m[i]+(m[i+1]-m[i])*f;
  o[k]=x*(k<dur?envAt(k):eDur*Math.exp(-(k-dur)/tau))}
 return o}
