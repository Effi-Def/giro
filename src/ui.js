// ---------- Interfaccia ----------
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
const RC=2*Math.PI*54;
const ORDER=[4,5,6,7,0,1,2,3]; // come i pad dell'Axiom: 5–8 sopra, 1–4 sotto
const START_HINT="Premi un pad e suona: il primo loop parte dalla prima nota. Ripremi lo stesso pad nel punto in cui deve ricominciare.";

function loopLabel(i){const L=G.loops[i];
 if(L.pend)return L.pend.muted?"SI FERMA…":"RIPARTE…";
 if(L.dropped&&G.running)return"DROP";
 switch(L.state){case "empty":return"";case "armed":return"SUONA";case "rec":return"REC";case "closing":return"CHIUDE…";
  case "dub":return"SOVRAINCIDI";case "play":return !G.running?"PRONTO":(L.muted?"FERMO":"")}}
function loopColor(i){const L=G.loops[i];
 if(L.state==="armed")return"arm";if(L.state==="rec"||L.state==="closing")return"rec";if(L.state==="dub")return"dub";
 if(L.state==="play")return(L.muted||!G.running)?"off":"play";return"empty"}

function buildSounds(){
 const cats=[...new Set(SOUNDS.map(s=>s.cat))];
 $("#sounds").innerHTML=cats.map(c=>`<div class="cat"><span class="catn">${c}</span><div class="tiles">${
  SOUNDS.map((s,i)=>s.cat===c?`<button class="snd" data-s="${i}">${s.name}</button>`:"").join("")}</div></div>`).join("");
 $$("#sounds .snd").forEach(b=>b.onclick=()=>setSound(+b.dataset.s))}
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
 buildSounds();initAddUI();
 $("#drumKeys").innerHTML=DRUM_KEYS.map((n,k)=>`<span class="dk ${[1,3,6,8,10].includes(k)?"bk":""}"><b>${["Do","Do#","Re","Re#","Mi","Fa","Fa#","Sol","Sol#","La","La#","Si"][k]}</b>${n}</span>`).join("");
 const pb=$("#playBtn"),pbAct=()=>{(G.running?stopButton:playButton)();stopPress()};
 pb.addEventListener("pointerdown",e=>{e.preventDefault();pbAct()});
 ["pointerup","pointerleave","pointercancel"].forEach(ev=>pb.addEventListener(ev,stopRelease));
 pb.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();e.stopPropagation();(G.running?stopButton:playButton)()}});
 const db=$("#dropBtn");db.addEventListener("pointerdown",e=>{e.preventDefault();playDown(true)});
 ["pointerup","pointerleave","pointercancel"].forEach(ev=>db.addEventListener(ev,playUp));
 $("#knobBtn").onclick=cycleKnobMode;
 $("#djBar").innerHTML=DJ_NAMES.map((n,i)=>`<div class="dj${i===0?" c":""}"><span><b>${i+1}</b> ${n}</span><i><u></u></i><small></small></div>`).join("");
 $("#fxScopeBtn").onclick=toggleFxScope;$("#fxStopBtn").onclick=stopAllFx;
 $("#tel").onclick=telQR;$("#telQR").onclick=()=>$("#telQR").hidden=true;
 $("#dubBtn").onclick=dubButton;$("#qBtn").onclick=cycleQuant;$("#perfBtn").onclick=perfToggle;$("#undoBtn").onclick=()=>undoSel(false);$("#redoBtn").onclick=()=>undoSel(true);
 $("#openSettings").onclick=()=>{$("#settings").hidden=false;showDelay()};$("#closeSettings").onclick=closeSettings;
 $("#settings").addEventListener("pointerdown",e=>{if(e.target.id==="settings")closeSettings()});
 [["#cut","cut"],["#rev","rev"],["#master","master"]].forEach(([s,k])=>{$(s).value=SET[k];$(s).oninput=e=>{SET[k]=+e.target.value;applyMix();saveSet()}});
 $("#exportBtn").onclick=()=>{closeSettings();exportWav()};
 $("#diagStart").onclick=()=>{diagOn=true;diagLines.clear();$("#diag").textContent="In ascolto: tocca i controlli dell'Axiom…"};
 $("#startBtn").onclick=start;
}
function closeSettings(){$("#settings").hidden=true}
function showDelay(){$("#delayVal").textContent=ctx?`${Math.round(audioDelayMs())} ms`:"—"}
async function start(){if($("#gate").hidden)return;$("#gate").hidden=true;
 try{await initAudio();await ctx.resume()}catch(err){flashHint("L'audio non è partito: "+err.message)}
 render()}

let hintOverride="",hintTimer=0;
function flashHint(t){hintOverride=t;clearTimeout(hintTimer);hintTimer=setTimeout(()=>{hintOverride="";render()},2600);render()}
function hint(){
 if(hintOverride)return[hintOverride,"sel"];
 const n=s=>G.loops.findIndex(L=>L.state===s);
 let i;
 if(G.stopAt)return["<b>Mi fermo alla fine del giro.</b> ■ di nuovo: subito.","rec"];
 if(building)return["<b>Build-up:</b> il suono si chiude… lascia <b>▶</b> e tutto si riapre sull'1.","dub"];
 if(G.drop)return[`<b>DROP:</b> resta il loop ${G.sel+1}. Tocca <b>▶</b>: tutto rientra sull'1 · tieni premuto <b>▶</b>: build-up.`,"dub"];
 if((i=n("armed"))>=0)return[`<b>Loop ${i+1} pronto.</b> Suona: registra dalla prima nota.`,"arm"];
 if((i=n("rec"))>=0)return G.loops[i].first?[`<b>Registro il primo loop.</b> Ripremi il pad ${i+1} nel punto esatto in cui deve ricominciare.`,"rec"]:[`<b>Registro il loop ${i+1}.</b> Ripremi il pad ${i+1} quando hai finito: la lunghezza si aggancia da sola.`,"rec"];
 if((i=n("closing"))>=0)return[`<b>Loop ${i+1}:</b> chiudo alla fine del giro, continua a suonare.`,"rec"];
 if((i=n("dub"))>=0)return[`<b>Sovraincisione sul loop ${i+1}.</b> Suona sopra, premi ● per smettere.`,"dub"];
 if(!anyHas())return[START_HINT,"off"];
 if(!G.running)return["Fermo. <b>▶</b> per ripartire · tieni premuto <b>■</b> per cancellare tutto.","off"];
 return["Pad: nuovo loop · ferma / riparti sull'1 · <b>●</b> sovraincidi (pitch bend sceglie il loop) · <b>▶</b> drop, tenuto build-up · <b>■</b> fine a tempo.","play"]}

function render(){
 $$(".loop").forEach(b=>{const i=+b.dataset.loop,L=G.loops[i];
  b.dataset.c=loopColor(i);b.classList.toggle("sel",i===G.sel);
  b.classList.toggle("blink",L.state==="armed"||L.state==="closing"||!!L.pend);
  b.querySelector(".st").textContent=loopLabel(i);
  // la barretta mostra il valore del modo delle manopole: volume da sinistra, pan come segno, filtro dal centro
  const vb=b.querySelector(".vol"),vi=vb.firstChild;vb.className="vol "+knobMode;let l=0,w=L.vol*100;
  if(knobMode==="pan"){l=(L.pan+1)*50-4;w=8}else if(knobMode==="fx"){l=Math.min(50,50+L.fx*50);w=Math.max(1,Math.abs(L.fx)*50)}
  vi.style.left=Math.max(0,l)+"%";vi.style.width=Math.min(w,100-Math.max(0,l))+"%"});
 $("#knobBtn").innerHTML=`MANOPOLE <b>${KNOB_NAMES[knobMode]}</b>`;
 // effetti DJ: la striscia si vede solo in quel modo; il filtro parte dal centro
 $("#djBar").hidden=$("#djCtl").hidden=knobMode!=="dj";
 $("#fxScopeBtn").innerHTML=fxScope==="loop"?`EFFETTI SU <b>LOOP ${G.sel+1}</b>`:"EFFETTI SU <b>TUTTO</b>";
 $("#fxScopeBtn").classList.toggle("on",fxScope==="loop");$("#fxStopBtn").classList.toggle("on",djAll().some(fxActive));
 const V=djView();
 [...$("#djBar").children].forEach((el,i)=>{const a=i===7&&fxScope==="loop"?G.loops[G.sel].vol:V.v[i],u=el.querySelector("u");
  if(i===7)el.querySelector("span").innerHTML=`<b>8</b> ${fxScope==="loop"?"VOLUME":"TASTIERA"}`;
  if(i===0){u.style.left=Math.min(50,50+a*50)+"%";u.style.width=Math.abs(a)*50+"%"}else{u.style.left="0";u.style.width=a*100+"%"}
  el.classList.toggle("on",i===0?a!==0:i===6?V.rollK>0:i===7?a<.98:a>.02);el.querySelector("small").textContent=djText(i)});
 $$("#sounds .snd").forEach(b=>{const i=+b.dataset.s;b.classList.toggle("on",i===SET.sound);b.classList.toggle("wait",ready&&!BUF[SOUNDS[i].id])});
 $("#drumKeys").hidden=!SOUNDS[SET.sound].drum;
 $$(".loop").forEach(b=>{const L=G.loops[+b.dataset.loop];b.querySelector(".snm").textContent=L.has||L.state==="rec"?(SOUNDS[L.sound]?.name||"")+(fxActive(LDJ[+b.dataset.loop])?" · FX":""):""});
 $("#playBtn").textContent=G.stopAt?"■ SUBITO":G.running?"■ STOP":"▶ PLAY";$("#playBtn").classList.toggle("on",G.running);
 $("#dropBtn").hidden=!G.running;$("#dropBtn").textContent=G.drop?"▶ RIENTRA":"▶ DROP";$("#dropBtn").classList.toggle("on",G.drop||building);
 $("#dubBtn").textContent=G.loops[G.sel].state==="dub"?`● FINE (loop ${G.sel+1})`:`● SOVRAINCIDI ${G.sel+1}`;
 $("#dubBtn").classList.toggle("on",G.loops[G.sel].state==="dub");
 $("#info").textContent=G.base?`${Math.round(bpm())} bpm · ${G.beats/4>=1?G.beats/4+" batt.":G.beats+" mov."}`:"giro libero";
 {const m=Math.floor(perfSecs()/60),sc=Math.floor(perfSecs()%60);$("#perfBtn").textContent=perf?`■ FERMA E SALVA ${m}:${String(sc).padStart(2,"0")}`:"● REGISTRA ESIBIZIONE";$("#perfBtn").classList.toggle("on",!!perf)}
 $("#tel").hidden=!tel.on;$("#tel").textContent="📱 TELEFONO";
 telPush();
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
  $("#clock").textContent=rec?((f-rec.start)/sr).toFixed(1)+" s":"";
  beat(f)}
 requestAnimationFrame(frame)}
// battito grande: quale movimento della battuta si sta sentendo (tolto il ritardo d'uscita), l'1 è evidenziato
let beatShown="";
function beat(f){const el=$("#beat");const n=G.base?Math.min(4,G.beats):0;let k=-1;
 if(n&&G.running){const len=G.base/G.beats,rel=f-audioDelayMs()/1000*sr-G.origin;k=((Math.floor(rel/len)%n)+n)%n}
 const key=n+":"+k;if(key===beatShown)return;beatShown=key;
 el.hidden=!n;if(!n)return;
 if(el.children.length!==n)el.innerHTML=Array.from({length:n},(_,j)=>`<i>${j+1}</i>`).join("");
 [...el.children].forEach((x,j)=>x.classList.toggle("on",j===k))}
function flash(sel){$$(sel).forEach(el=>{el.classList.add("hit");clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("hit"),140)})}
function uiNote(n,on){const k=$(`#keys i[data-k="${n}"]`);if(k)k.classList.toggle("on",on)}
function setMidi(ok,txt){const m=$("#midi");m.textContent=txt;m.classList.toggle("ok",ok);$("#gateMidi").textContent=ok?`Tastiera collegata: ${txt}`:txt}

loadSet();build();render();loadCustomSounds();initMIDI();telConnect();requestAnimationFrame(frame);
