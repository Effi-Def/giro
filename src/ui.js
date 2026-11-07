// ---------- Interfaccia ----------
const $=s=>document.querySelector(s),$$=s=>document.querySelectorAll(s);
const ORDER=[4,5,6,7,0,1,2,3]; // come i pad dell'Axiom: 5–8 sopra, 1–4 sotto
const START_HINT="Premi un pad e suona: il primo loop parte dalla prima nota. Ripremi lo stesso pad nel punto in cui deve ricominciare.";

function loopLabel(i){const L=G.loops[i];
 if(L.pend)return L.pend.muted?"SI FERMA…":"RIPARTE…";
 if(L.dropped&&G.running)return"BREAK";
 if(CUT&&CUT.i===i&&L.state==="play")return CUT.p?"↻ PEZZO":"IN…";
 switch(L.state){case "empty":return"";case "armed":return"SUONA";case "rec":return"REC";case "closing":return"CHIUDE…";
  case "dub":return"SOVRAINCIDI";case "play":return !G.running?"PRONTO":(L.muted?"FERMO":"")}}
function loopColor(i){const L=G.loops[i];
 if(L.state==="armed")return"arm";if(L.state==="rec"||L.state==="closing")return"rec";if(L.state==="dub")return"dub";
 if(L.state==="play")return(L.muted||!G.running)?"off":"play";return"empty"}

let tipsShown=null,soundShown=null; // consigli già disegnati: si ridisegnano solo se cambiano; ultimo suono portato in vista
function buildSounds(){
 const cats=[...new Set(SOUNDS.map(s=>s.cat))];
 $("#sounds").innerHTML=cats.map(c=>`<div class="cat" data-cat="${c}"><span class="catn">${c}</span><div class="tiles">${
  SOUNDS.map((s,i)=>s.cat===c?`<button class="snd" data-s="${i}">${s.name}</button>`:"").join("")}</div></div>`).join("");
 $$("#sounds .snd").forEach(b=>b.onclick=()=>setSound(+b.dataset.s))}
function build(){
 $("#grid").innerHTML=ORDER.map(i=>`
  <button class="loop" data-loop="${i}" aria-label="Loop ${i+1}">
   <span class="lh"><span class="num">${i+1}</span><span class="st"></span></span>
   <span class="snm"></span>
   <span class="wv"><svg viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><path class="wave" d=""/></svg><i class="cutr"></i><i class="rprog"></i></span>
  </button>`).join("");
 $$(".loop").forEach(b=>{const i=+b.dataset.loop;
  b.addEventListener("pointerdown",e=>{e.preventDefault();atEvent(e,()=>padDown(i))});
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
 $("#knobBtn").innerHTML=["vol","pan","dj","fx"].map(m=>`<button data-m="${m}">${{dj:"EFFETTI",fx:"FILTRO"}[m]||KNOB_NAMES[m]}</button>`).join("");
 $$("#knobBtn button").forEach(b=>b.onclick=()=>setKnobMode(b.dataset.m));
 $("#djBar").innerHTML=DJ_NAMES.map(()=>`<div class="dj"><span></span><i><u></u></i><small></small></div>`).join("");
 $("#fxScopeBtn").onclick=toggleFxScope;$("#fxStopBtn").onclick=stopAllFx;
 $("#tel").onclick=telQR;$("#telQR").onclick=()=>$("#telQR").hidden=true;
 $("#cutBtn").addEventListener("pointerdown",e=>{e.preventDefault();atEvent(e,cutButton)});
 $("#dubBtn").onclick=dubButton;$("#qBtn").onclick=cycleQuant;$("#perfBtn").onclick=perfToggle;$("#undoBtn").onclick=()=>undoSel(false);$("#redoBtn").onclick=()=>undoSel(true);
 $("#openSettings").onclick=()=>{$("#settings").hidden=false;showDelay()};$("#closeSettings").onclick=closeSettings;
 $("#settings").addEventListener("pointerdown",e=>{if(e.target.id==="settings")closeSettings()});
 $("#openHelp").onclick=()=>{$("#help").hidden=false};$("#closeHelp").onclick=closeSettings;
 $("#help").addEventListener("pointerdown",e=>{if(e.target.id==="help")closeSettings()});
 [["#cut","cut"],["#rev","rev"],["#master","master"]].forEach(([s,k])=>{$(s).value=SET[k];$(s).oninput=e=>{SET[k]=+e.target.value;applyMix();saveSet()}});
 $("#exportBtn").onclick=()=>{closeSettings();exportWav()};$("#amixBtn").onclick=toggleAutoMix;
 $("#diagStart").onclick=()=>{diagOn=true;diagLines.clear();$("#diag").textContent="In ascolto: tocca i controlli dell'Axiom…"};
 $("#startBtn").onclick=start;$("#awayBtn").onclick=tabTake;
}
function closeSettings(){$("#settings").hidden=$("#help").hidden=true}
function showDelay(){$("#delayVal").textContent=ctx?`${Math.round(audioDelayMs())} ms`:"—"}
async function start(){if($("#gate").hidden)return;$("#gate").hidden=true;
 try{await initAudio();await ctx.resume()}catch(err){flashHint("L'audio non è partito: "+err.message)}
 tabTake(); // le altre schede di Giro vanno in pausa
 render()}

let hintOverride="",hintTimer=0;
function flashHint(t,ms){hintOverride=t;clearTimeout(hintTimer);hintTimer=setTimeout(()=>{hintOverride="";render()},ms||2600);render()}
function hint(){
 if(hintOverride)return[hintOverride,"sel"];
 const n=s=>G.loops.findIndex(L=>L.state===s);
 let i;
 if(G.stopAt)return["<b>Mi fermo alla fine del giro.</b> ■ di nuovo: subito.","rec"];
 if(building)return["<b>Salita…</b> lascia <b>▶</b>: mezzo battito di silenzio e <b>DROP</b> sull'1.","dub"];
 if(G.dropAt)return["<b>DROP</b> sul prossimo 1…","dub"];
 if(G.drop)return[`<b>BREAK:</b> resta il loop ${G.sel+1}. Tocca <b>▶</b>: tutto rientra sull'1 · tieni premuto <b>▶</b>: salita, lascia: <b>DROP</b>.`,"dub"];
 if((i=n("armed"))>=0)return[`<b>Loop ${i+1} pronto.</b> Suona: registra dalla prima nota.`,"arm"];
 if((i=n("rec"))>=0)return G.loops[i].first?[`<b>Registro il primo loop.</b> Ripremi il pad ${i+1} nel punto esatto in cui deve ricominciare.`,"rec"]:[`<b>Registro il loop ${i+1}.</b> Ripremi il pad ${i+1} quando hai finito: la lunghezza si aggancia da sola.`,"rec"];
 if((i=n("closing"))>=0)return[`<b>Loop ${i+1}:</b> chiudo alla fine del giro, continua a suonare.`,"rec"];
 if((i=n("dub"))>=0)return[`<b>Sovraincisione sul loop ${i+1}.</b> Suona sopra, premi ● per smettere.`,"dub"];
 if(CUT&&G.running)return CUT.p?[`<b>Loop ${CUT.i+1}: ripete il pezzo</b> (${cutLen(CUT.p)}). <b>V</b> per uscire: torna normale, a tempo.`,"dub"]:
  [`<b>IN</b> sul loop ${CUT.i+1}. Premi <b>V</b> di nuovo dove finisce il pezzo: da lì si ripete.`,"arm"];
 if(!anyHas())return[START_HINT,"off"];
 if(!G.running)return["Fermo. <b>▶</b> per ripartire · tieni premuto <b>■</b> per cancellare tutto.","off"];
 return["Pad: nuovo loop · ferma / riparti sull'1 · <b>●</b> sovraincidi (pitch bend sceglie il loop) · <b>▶</b> break, tenuto salita e DROP · <b>■</b> fine a tempo.","play"]}
// velocità non normale: la manopola resta girata senza accorgersene, e i loop sono fuori tempo e stonati rispetto alle note.
// Sta accanto alla riga dei suggerimenti, così non ne toglie mai uno.
function speedNote(){const m=DJV[3],ls=G.loops.map((_,i)=>i).filter(i=>LDJ[i]&&LDJ[i].v[3]!==0),al=a=>"AL "+Math.round((1+a)*100)+"%";
 if(!m&&!ls.length)return G.running&&G.loops.some(L=>L.rb)?"<b>VELOCITÀ NORMALE</b> · torno a tempo sull'1":"";
 const one=ls.length===1?ls[0]:-1,a=m||LDJ[one]?.v[3]||0,alone=!m||!ls.length;
 const what=m?(a<-.97?"LOOP FERMI":"LOOP "+al(a))+(ls.length?" (LOOP "+ls.map(i=>i+1).join(", ")+" A PARTE)":""):
  one>=0?`LOOP ${one+1} `+(a<-.97?"FERMO":al(a)):"LOOP "+ls.map(i=>i+1).join(", ")+" A VELOCITÀ DIVERSA";
 const how=alone&&a===1?"un'ottava sopra, a tempo dall'1":alone&&a===-.5?"un'ottava sotto, a tempo dall'1":"fuori tempo e stonati";
 // la manopola 4 arriva a quella velocità solo se comanda lei, altrimenti resta STOP EFFETTI
 // tasto centrale tenuto: basta se rimette a 1 tutto quello che è girato (il mix e il loop selezionato, speedReset)
 const dj=knobMode==="dj",other=!m&&one>=0&&G.sel!==one,knob4=dj&&(m?!ls.length&&fxScope==="mix":one>=0&&fxScope==="loop"&&G.sel===one);
 const ctr=!ls.length||ls.length===1&&G.sel===one,C="tasto centrale tenuto (9)";
 return`<b>${what}</b> ${how} · per tornare normale: ${knob4?"manopola 4 al centro":other?`seleziona il loop ${one+1}, poi ${C}`:ctr?C:"tasto 0, STOP EFFETTI"}`}
// sul pad: la velocità di quel loop, che non si vede più nella striscia appena ne selezioni un altro
function padFx(i){const D=LDJ[i],a=D?D.v[3]:0;return a?" · "+(a<-.97?"FERMO":Math.round((1+a)*100)+"%"):fxActive(D)?" · FX":""}
// una manopola sulla striscia: etichetta, valore (da sinistra, o dal centro con c), testo, se è girata, se comanda un loop vuoto
function knobCell(i){const L=G.loops[i],lab=n=>`<b>${i+1}</b> ${n}`,side=x=>x<0?"sin.":"des.";
 if(knobMode!=="dj"){const nm=L.has||L.state==="rec"?SOUNDS[L.sound]?.name||"":"",off=!nm,name=lab(nm||"LOOP "+(i+1));
  if(knobMode==="vol")return{lab:name,a:L.vol,txt:Math.round(L.vol*100)+"%",off};
  if(knobMode==="pan")return{lab:name,a:L.pan,c:1,on:L.pan!==0,txt:L.pan===0?"centro":Math.round(Math.abs(L.pan)*100)+"% "+side(L.pan),off};
  return{lab:name,a:L.fx,c:1,on:L.fx!==0,txt:L.fx===0?"spento":(L.fx<0?"scuro ":"leggero ")+Math.round(Math.abs(L.fx)*100)+"%",off}}
 const V=djView(),a=i===7&&fxScope==="loop"?G.loops[G.sel].vol:V.v[i];
 return{lab:lab(i===7?(fxScope==="loop"?"VOLUME":"TASTIERA"):DJ_NAMES[i]),a,c:i===0||i===3,txt:djText(i),
  on:i===0||i===3?a!==0:i===5?V.wbK>0:i===6?V.rollK>0:i===7?a<.98:a>.02}}

function render(){
 $$(".loop").forEach(b=>{const i=+b.dataset.loop,L=G.loops[i];
  b.dataset.c=loopColor(i);b.classList.toggle("sel",i===G.sel);
  b.classList.toggle("blink",L.state==="armed"||L.state==="closing"||!!L.pend||CUT?.i===i&&!CUT.p);
  b.querySelector(".st").textContent=loopLabel(i);
  // il pezzo sulla forma d'onda: da IN a OUT (solo IN finché manca OUT)
  const cr=b.querySelector(".cutr"),on=CUT?.i===i&&L.len>0;cr.hidden=!on;
  if(on){const a=(((CUT.s-L.t0)%L.len)+L.len)%L.len/L.len;cr.style.left=(a*100).toFixed(2)+"%";cr.style.width=(Math.min(CUT.p/L.len,1-a)*100).toFixed(2)+"%"}});
 $("#cutBtn").textContent=!CUT?"↻ PEZZO: IN":CUT.p?"↻ PEZZO: ESCI":"↻ PEZZO: OUT";$("#cutBtn").classList.toggle("on",!!CUT);
 $$("#knobBtn button").forEach(b=>{b.classList.toggle("on",b.dataset.m===knobMode);if(b.dataset.m==="fx")b.hidden=knobMode!=="fx"});
 $("#fxScopeBtn").innerHTML=fxScope==="loop"?`EFFETTI SU <b>LOOP ${G.sel+1}</b>`:"EFFETTI SU <b>TUTTO</b>";
 $("#fxScopeBtn").disabled=knobMode!=="dj";
 $("#fxScopeBtn").classList.toggle("on",fxScope==="loop");$("#fxStopBtn").classList.toggle("on",djAll().some(fxActive));
 // la striscia c'è sempre: mostra quello che comandano adesso le manopole
 $("#djBar").dataset.m=knobMode;
 [...$("#djBar").children].forEach((el,i)=>{const C=knobCell(i),u=el.querySelector("u"),s=el.querySelector("span");
  if(el._lab!==C.lab){el._lab=C.lab;s.innerHTML=C.lab}
  el.classList.toggle("c",!!C.c);el.classList.toggle("off",!!C.off);
  if(C.c){u.style.left=Math.min(50,50+C.a*50)+"%";u.style.width=Math.abs(C.a)*50+"%"}else{u.style.left="0";u.style.width=C.a*100+"%"}
  el.classList.toggle("on",!!C.on);el.querySelector("small").textContent=C.txt});
 {const T=tips(),k=T.map(t=>t.i+t.why).join();
  if(k!==tipsShown){tipsShown=k;
   $("#tips").innerHTML=`<span class="catn">Consigliati</span>`+T.map(t=>`<button class="snd tip${t.odd?" odd":""}" data-s="${t.i}">${SOUNDS[t.i].name}<small>${t.odd?"inatteso · ":""}${t.why}</small></button>`).join("");
   $$("#tips .snd").forEach(b=>b.onclick=()=>setSound(+b.dataset.s))}
  $$("#tips .snd").forEach(b=>b.classList.toggle("on",+b.dataset.s===SET.sound));
  $$("#sounds .snd").forEach(b=>b.classList.toggle("tipped",T.some(t=>t.i===+b.dataset.s)))}
 $$("#sounds .snd").forEach(b=>{const i=+b.dataset.s;b.classList.toggle("on",i===SET.sound);b.classList.toggle("wait",ready&&!BUF[SOUNDS[i].id])});
 $$("#sounds .cat").forEach(c=>c.classList.toggle("cur",c.dataset.cat===SOUNDS[SET.sound].cat));
 if(SET.sound!==soundShown){soundShown=SET.sound;const box=$("#sounds"),el=box.querySelector(".snd.on");
  // con tanti suoni aggiunti l'elenco scorre: quello scelto dall'Axiom deve restare in vista
  if(el&&box.scrollHeight>box.clientHeight){const r=el.getBoundingClientRect(),q=box.getBoundingClientRect();if(r.top<q.top||r.bottom>q.bottom)box.scrollTop+=r.top-q.top-(q.height-r.height)/2}}
 {const d=!!SOUNDS[SET.sound].drum;$("#drumKeys").hidden=!d;$("#keys").hidden=d}
 $$(".loop").forEach(b=>{const L=G.loops[+b.dataset.loop];b.querySelector(".snm").textContent=L.has||L.state==="rec"?(SOUNDS[L.sound]?.name||"")+padFx(+b.dataset.loop):""});
 $("#amixBtn").textContent=SET.amix?"SÌ":"NO";$("#amixBtn").classList.toggle("on",!!SET.amix);
 $("#playBtn").textContent=G.stopAt?"■ SUBITO":G.running?"■ STOP":"▶ PLAY";$("#playBtn").classList.toggle("on",G.running);
 $("#dropBtn").disabled=!G.running;$("#dropBtn").textContent=building?"▶ LASCIA: DROP":G.drop?"▶ RIENTRA":"▶ BREAK";$("#dropBtn").classList.toggle("on",G.drop||building||!!G.dropAt);
 $("#dubBtn").textContent=G.loops[G.sel].state==="dub"?`● FINE (loop ${G.sel+1})`:`● SOVRAINCIDI ${G.sel+1}`;
 $("#dubBtn").classList.toggle("on",G.loops[G.sel].state==="dub");
 $("#info").textContent=G.base?`${Math.round(bpm())} bpm · ${G.beats/4>=1?G.beats/4+" batt.":G.beats+" mov."}`:"giro libero";
 {const m=Math.floor(perfSecs()/60),sc=Math.floor(perfSecs()%60);$("#perfBtn").textContent=perf?`■ FERMA E SALVA ${m}:${String(sc).padStart(2,"0")}`:"● REGISTRA ESIBIZIONE";$("#perfBtn").classList.toggle("on",!!perf)}
 $("#tel").hidden=!tel.on;
 telPush();
 $("#qBtn").textContent=`QUANTIZZA ${QNAMES[SET.quant]}`;$("#qBtn").classList.toggle("on",SET.quant>0);
 const [h,c]=hint();$("#hint").innerHTML=h;$("#hintBox").dataset.c=c;
 const sn=speedNote();$("#speedNote").innerHTML=sn;$("#speedNote").hidden=!sn}

function drawWave(i){const b=$(`.loop[data-loop="${i}"] .wave`);if(!b)return;const p=G.loops[i].peaks;
 if(!p){b.setAttribute("d","");return}
 const mx=Math.max(.05,...p);let d="";
 for(let k=0;k<p.length;k++){const x=((k+.5)/p.length*200).toFixed(1),h=Math.max(.6,p[k]/mx*19);
  d+=`M${x} ${(20-h).toFixed(1)}L${x} ${(20+h).toFixed(1)}`}
 b.setAttribute("d",d)}

function frame(){
 if(ready){const f=nowF();
  $$(".loop").forEach(b=>{const i=+b.dataset.loop,L=G.loops[i],r=b.querySelector(".rprog");let fr=0;
   if(L.state==="rec"){fr=L.first?((f-L.start)/sr%4)/4:((f-L.start)/G.base)%1}
   else if(L.state==="closing")fr=(f-L.start)/L.len;
   else if(L.has&&G.running&&!L.muted&&L.len){let g=f;
    // pezzo ripetuto: la testina torna indietro con il suono
    if(CUT?.i===i&&CUT.p&&f>=CUT.s+CUT.p)g=CUT.s+(f-CUT.s-CUT.p)%CUT.p;
    fr=(((g-L.t0)%L.len)+L.len)%L.len/L.len}
   // la testina si sposta col compositore: niente ridisegno del pad a ogni fotogramma
   const v=fr>0?((Math.min(1,fr)-1)*100).toFixed(1):"-102";if(r._v!==v){r._v=v;r.style.transform=`translateX(${v}%)`}});
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
function setMidi(ok,txt){const m=$("#midi");m.firstChild.textContent=txt;m.title=txt;m.classList.toggle("ok",ok);$("#gateMidi").textContent=ok?`Tastiera collegata: ${txt}`:txt}

loadSet();build();render();loadCustomSounds();initMIDI();telConnect();requestAnimationFrame(frame);
