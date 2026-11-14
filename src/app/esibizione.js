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
