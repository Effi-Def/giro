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
  if(d1===17){if(d2>63){flash(`[data-key="17"]`);playPress()}return}
  if(d1===23){if(d2>63){flash(`[data-key="23"]`);centerDown()}else centerUp();return}
  if(BTN[d1]){if(d2>63){flash(`[data-key="${d1}"]`);BTN[d1]()}return}
  if(d1>=1&&d1<=8)return knobIn(d1-1,d2); // CC 1–8: fanno quello che dice il modo scelto nell'app (volume / pan / effetti DJ)
  return}
 if(on)noteOn(d1,d2/127);else if(off)noteOff(d1)}
