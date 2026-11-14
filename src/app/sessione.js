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

function onDump(m){
 const items=m.items.map(it=>{const data=new Float32Array(it.len);let o=0;for(const ch of it.chunks){data.set(ch,o);o+=ch.length}return{i:it.i,len:it.len,t0:it.t0,ver:it.ver,data}});
 if(m.tag==="debug")return dbgWrite(items);
 if(m.tag==="tempo")return onTempoDump(items);
 if(m.exp)return doExport(items);
 if(!m.has.some(Boolean)){if(!G.loops.some(L=>L.state==="rec"||L.state==="closing")&&!anyHas())idb("readwrite",s=>{s.clear()}).catch(()=>{});return}
 if(!G.base)return;
 // posizione e lunghezza dallo stato di Giro (si spostano insieme a G.origin), i campioni solo dei loop cambiati
 const loops=[];G.loops.forEach((L,i)=>{if(m.has[i]&&L.has)loops.push({i,len:L.len,rel:L.t0-G.origin,vol:L.vol,pan:L.pan,fx:L.fx,sound:L.sound,sid:L.sid??SOUNDS[L.sound]?.id,mx:L.mx,ar:L.ar,pm:L.pm})});
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
  Object.assign(L,{vol:s.vol,pan:s.pan,fx:s.fx,sound:si>=0?si:s.sid!=null?null:s.sound,sid:si>=0?null:s.sid??null,mx:s.mx||null,ar:s.ar??null,pm:s.pm??s.pan!==0});
  send({type:"load",i:s.i,data,len:s.len,t0:G.origin+s.rel,vol:s.vol,pan:s.pan,fx:s.fx},[data.buffer])});
 if(rec.v===1)send({type:"dump",all:true}); // riscrive subito nel formato nuovo
 setTimeout(()=>{restoring=false},500);
 flashHint("Ripresa la sessione precedente: <b>▶</b> per riascoltarla. Tieni premuto <b>■</b> per cancellare tutto.");render()}
