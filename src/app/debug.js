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
