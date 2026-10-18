// ---------- Interfaccia ----------
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
const RC=2*Math.PI*54;
const ORDER=[4,5,6,7,0,1,2,3]; // come i pad dell'Axiom: 5–8 sopra, 1–4 sotto
const START_HINT="Premi un pad e suona: il primo loop parte dalla prima nota. Ripremi lo stesso pad nel punto in cui deve ricominciare.";

function loopLabel(i){const L=G.loops[i];
 if(L.pend)return L.pend.muted?"SI FERMA…":"RIPARTE…";
 switch(L.state){case "empty":return"";case "armed":return"SUONA";case "rec":return"REC";case "closing":return"CHIUDE…";
  case "dub":return"SOVRAINCIDI";case "play":return !G.running?"PRONTO":(L.muted?"FERMO":"")}}
function loopColor(i){const L=G.loops[i];
 if(L.state==="armed")return"arm";if(L.state==="rec"||L.state==="closing")return"rec";if(L.state==="dub")return"dub";
 if(L.state==="play")return(L.muted||!G.running)?"off":"play";return"empty"}

function build(){
 $("#grid").innerHTML=ORDER.map(i=>`
  <button class="loop" data-loop="${i}" aria-label="Loop ${i+1}">
   <svg viewBox="0 0 120 120" aria-hidden="true">
    <circle class="rbg" cx="60" cy="60" r="54"/>
    <path class="wave" d=""/>
    <circle class="rprog" cx="60" cy="60" r="54" stroke-dasharray="${RC}" stroke-dashoffset="${RC}"/>
    <text class="num" x="60" y="57">${i+1}</text>
    <text class="st" x="60" y="77"></text>
    <text class="snm" x="60" y="40"></text>
   </svg>
   <span class="vol"><i></i></span>
  </button>`).join("");
 $$(".loop").forEach(b=>{const i=+b.dataset.loop;
  b.addEventListener("pointerdown",e=>{e.preventDefault();padDown(i)});
  ["pointerup","pointerleave","pointercancel"].forEach(ev=>b.addEventListener(ev,()=>padUp(i)));
  b.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();e.stopPropagation();tap(i)}})});
 $("#keys").innerHTML=Array.from({length:61},(_,k)=>`<i data-k="${36+k}" class="${[1,3,6,8,10].includes(k%12)?"b":""}"></i>`).join("");
 const cats=[...new Set(SOUNDS.map(s=>s.cat))];
 $("#sounds").innerHTML=cats.map(c=>`<div class="cat"><span class="catn">${c}</span><div class="tiles">${
  SOUNDS.map((s,i)=>s.cat===c?`<button class="snd" data-s="${i}">${s.name}</button>`:"").join("")}</div></div>`).join("");
 $$(".snd").forEach(b=>b.onclick=()=>{const i=+b.dataset.s;if(i===SET.sound)preview(i);else setSound(i)});
 $("#drumKeys").innerHTML=DRUM_KEYS.map((n,k)=>`<span class="dk ${[1,3,6,8,10].includes(k)?"bk":""}"><b>${["Do","Do#","Re","Re#","Mi","Fa","Fa#","Sol","Sol#","La","La#","Si"][k]}</b>${n}</span>`).join("");
 $("#playBtn").onclick=()=>G.running?stopButton():playButton();
 $("#dubBtn").onclick=dubButton;$("#qBtn").onclick=cycleQuant;$("#undoBtn").onclick=()=>undoSel(false);$("#redoBtn").onclick=()=>undoSel(true);
 $("#openSettings").onclick=()=>{$("#settings").hidden=false};$("#closeSettings").onclick=closeSettings;
 $("#settings").addEventListener("pointerdown",e=>{if(e.target.id==="settings")closeSettings()});
 [["#cut","cut"],["#rev","rev"],["#master","master"]].forEach(([s,k])=>{$(s).value=SET[k];$(s).oninput=e=>{SET[k]=+e.target.value;applyMix();saveSet()}});
 $("#lat").oninput=e=>{SET.latMs=+e.target.value;saveSet();showLat()};
 $("#latAuto").onclick=()=>{SET.latMs=null;saveSet();showLat()};
 $("#diagStart").onclick=()=>{diagOn=true;diagLines.clear();$("#diag").textContent="In ascolto: tocca i controlli dell'Axiom…"};
 $("#startBtn").onclick=start;
}
function closeSettings(){$("#settings").hidden=true}
function showLat(){if(!ctx){$("#latVal").textContent="—";return}const ms=latencyFrames()/sr*1000;
 $("#lat").value=Math.round(ms);$("#latVal").textContent=`${Math.round(ms)} ms${SET.latMs==null?" (automatica)":""}`}
async function start(){if($("#gate").hidden)return;$("#gate").hidden=true;
 try{await initAudio();await ctx.resume()}catch(err){flashHint("L'audio non è partito: "+err.message)}
 showLat();render()}

let hintOverride="",hintTimer=0;
function flashHint(t){hintOverride=t;clearTimeout(hintTimer);hintTimer=setTimeout(()=>{hintOverride="";render()},2600);render()}
function hint(){
 if(hintOverride)return[hintOverride,"sel"];
 const n=s=>G.loops.findIndex(L=>L.state===s);
 let i;
 if((i=n("armed"))>=0)return[`<b>Loop ${i+1} pronto.</b> Suona: registra dalla prima nota.`,"arm"];
 if((i=n("rec"))>=0)return G.loops[i].first?[`<b>Registro il primo loop.</b> Ripremi il pad ${i+1} nel punto esatto in cui deve ricominciare.`,"rec"]:[`<b>Registro il loop ${i+1}.</b> Ripremi il pad ${i+1} quando hai finito: la lunghezza si aggancia da sola.`,"rec"];
 if((i=n("closing"))>=0)return[`<b>Loop ${i+1}:</b> chiudo alla fine del giro, continua a suonare.`,"rec"];
 if((i=n("dub"))>=0)return[`<b>Sovraincisione sul loop ${i+1}.</b> Suona sopra, premi ● per smettere.`,"dub"];
 if(!anyHas())return[START_HINT,"off"];
 if(!G.running)return["Fermo. <b>▶</b> per ripartire · <b>■</b> due volte per cancellare tutto.","off"];
 return["Pad vuoto: nuovo loop · pad pieno: ferma / riparti · <b>●</b> sovraincidi sull'ultimo toccato · tieni premuto un pad: cancella.","play"]}

function render(){
 $$(".loop").forEach(b=>{const i=+b.dataset.loop,L=G.loops[i];
  b.dataset.c=loopColor(i);b.classList.toggle("sel",i===G.sel);
  b.classList.toggle("blink",L.state==="armed"||L.state==="closing"||!!L.pend);
  b.querySelector(".st").textContent=loopLabel(i);
  b.querySelector(".vol i").style.width=Math.round(L.vol*100)+"%"});
 $$(".snd").forEach(b=>{const i=+b.dataset.s;b.classList.toggle("on",i===SET.sound);b.classList.toggle("wait",ready&&!BUF[SOUNDS[i].id])});
 $("#drumKeys").hidden=!SOUNDS[SET.sound].drum;
 $$(".loop").forEach(b=>{const L=G.loops[+b.dataset.loop];b.querySelector(".snm").textContent=L.has||L.state==="rec"?(SOUNDS[L.sound]?.name||""):""});
 $("#playBtn").textContent=G.running?"■ STOP":"▶ PLAY";$("#playBtn").classList.toggle("on",G.running);
 $("#dubBtn").textContent=G.loops[G.sel].state==="dub"?`● FINE (loop ${G.sel+1})`:`● SOVRAINCIDI ${G.sel+1}`;
 $("#dubBtn").classList.toggle("on",G.loops[G.sel].state==="dub");
 $("#info").textContent=G.base?`${Math.round(bpm())} bpm · ${G.beats/4>=1?G.beats/4+" batt.":G.beats+" mov."}`:"giro libero";
 $("#qBtn").textContent=`QUANTIZZA ${QNAMES[SET.quant]}`;$("#qBtn").classList.toggle("on",SET.quant>0);
 const [h,c]=hint();$("#hint").innerHTML=h;$("#hintBox").dataset.c=c}

function drawWave(i){const b=$(`.loop[data-loop="${i}"] .wave`);if(!b)return;const p=G.loops[i].peaks;
 if(!p){b.setAttribute("d","");return}
 const mx=Math.max(.05,...p);let d="";
 for(let k=0;k<p.length;k++){const a=k/p.length*2*Math.PI-Math.PI/2,r0=35,r1=r0+Math.max(.6,p[k]/mx*14);
  d+=`M${(60+r0*Math.cos(a)).toFixed(1)} ${(60+r0*Math.sin(a)).toFixed(1)}L${(60+r1*Math.cos(a)).toFixed(1)} ${(60+r1*Math.sin(a)).toFixed(1)}`}
 b.setAttribute("d",d)}

function frame(){
 if(ready){const f=nowF();
  $$(".loop").forEach(b=>{const i=+b.dataset.loop,L=G.loops[i],r=b.querySelector(".rprog");let fr=0;
   if(L.state==="rec"){fr=L.first?((f-L.start)/sr%4)/4:((f-L.start)/G.base)%1}
   else if(L.state==="closing")fr=(f-L.start)/L.len;
   else if(L.has&&G.running&&!L.muted&&L.len)fr=(((f-L.t0)%L.len)+L.len)%L.len/L.len;
   r.style.strokeDashoffset=RC*(1-Math.max(0,Math.min(1,fr)))});
  const rec=G.loops.find(L=>L.state==="rec"&&L.first);
  $("#clock").textContent=rec?((f-rec.start)/sr).toFixed(1)+" s":""}
 requestAnimationFrame(frame)}
function flash(sel){$$(sel).forEach(el=>{el.classList.add("hit");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("hit"),140)})}
function uiNote(n,on){const k=$(`#keys i[data-k="${n}"]`);if(k)k.classList.toggle("on",on)}
function setMidi(ok,txt){const m=$("#midi");m.textContent=txt;m.classList.toggle("ok",ok);$("#gateMidi").textContent=ok?`Tastiera collegata: ${txt}`:txt}

loadSet();build();render();initMIDI();requestAnimationFrame(frame);
