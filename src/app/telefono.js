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
 else if(c.c==="play"){if(G.running&&c.v!=="up")playPress()} // break / rientro (il telefono di prima manda anche "up": niente)
 else if(c.c==="knob"&&KNOB_MODES.includes(c.v))setKnobMode(c.v);
 else if(c.c==="quant"&&QNAMES[+c.v])setQuant(+c.v);
 else if(c.c==="sel"){const i=+c.v;if(G.loops[i]?.has)selectLoop(i)}
 render()}
function telPush(){if(!tel.on)return;
 const s=JSON.stringify({perf:!!perf,secs:Math.floor(perfSecs()),fx:fxScope,fxOn:djAll().some(fxActive),knob:knobMode,quant:SET.quant,sel:G.sel,running:G.running,
  drop:G.drop,loops:G.loops.map((L,i)=>({st:L.state,muted:!!L.muted,fx:fxActive(LDJ[i])}))});
 if(s===tel.last)return;if(tel.busy){tel.again=true;return}tel.last=s;tel.busy=true;
 fetch(TEL+"/state",{method:"POST",body:s}).catch(()=>{}).finally(()=>{tel.busy=false;if(tel.again){tel.again=false;telPush()}})}
