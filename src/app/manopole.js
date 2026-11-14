// ---------- Manopole: volume, pan o filtro del loop ----------
// Il pulsante dei modi dell'Axiom (LED Volume / Pan / Inst-FX, tutti spenti = MIDI) manda in HyperControl
// CC 58 entrando in Volume o in Pan, CC 59 in Inst/FX, CC 60 in MIDI (canale 16, come lo script di Ableton).
// In MIDI le manopole tornano volume. Dallo schermo (o col tasto M) si cambia modo anche senza Axiom.
const KNOB_MODES=["vol","pan","dj"],KNOB_NAMES={vol:"VOLUME",pan:"PAN",fx:"FILTRO LOOP",dj:"EFFETTI DJ"};
let knobMode="vol",hcMode="midi";
function setKnobMode(m){knobMode=m;render();
 flashHint({vol:"Manopole: <b>VOLUME</b> dei loop.",pan:"Manopole: <b>PAN</b> — gira per spostare il loop a sinistra o a destra.",
  fx:"Manopole: <b>FILTRO</b> — a sinistra il loop si scurisce, a destra si alleggerisce, al centro niente.",
  dj:"Manopole: <b>EFFETTI DJ</b> sul mix — 1 filtro · 2 eco · 3 riverbero · 4 rallenta · 5 crusher · 6 wobble · 7 roll · 8 tastiera."}[m])}
function cycleKnobMode(){setKnobMode(KNOB_MODES[(KNOB_MODES.indexOf(knobMode)+1)%KNOB_MODES.length])}
function hcModeButton(cc){
 if(cc===58){hcMode=hcMode==="vol"?"pan":"vol";setKnobMode(hcMode)}
 else if(cc===59){hcMode="fx";setKnobMode("fx")}
 else{hcMode="midi";setKnobMode("dj")}} // modo MIDI (LED spenti): effetti DJ
function knob(i,v){const L=G.loops[i];if(knobMode==="dj")return djKnob(i,v);
 if(L.has)saveSoon();
 if(knobMode==="vol"){L.vol=v/127;send({type:"vol",i,v:L.vol});render();return}
 let x=Math.max(-1,Math.min(1,(v-64)/63));if(Math.abs(x)<.03)x=0;
 if(knobMode==="pan"){L.pan=x;L.pm=true;send({type:"pan",i,v:x});
  flashHint(`Loop ${i+1}: ${x===0?"al centro":Math.round(Math.abs(x)*100)+"% a "+(x<0?"sinistra":"destra")}`)}
 else{L.fx=x;send({type:"fx",i,v:x});
  flashHint(`Loop ${i+1}: ${x===0?"filtro spento":x<0?"più scuro (passa-basso) "+Math.round(-x*100)+"%":"più leggero (passa-alto) "+Math.round(x*100)+"%"}`)}
 render()}
// Aggancio: una manopola agisce solo quando passa dal valore attuale di quello che comanda. Così cambiando modo
// (o loop, o ambito degli effetti) una manopola lasciata alta non accende di colpo crusher o roll e non fa saltare un volume.
// knobSet ricorda dove e a che valore la manopola ha agito l'ultima volta; knobLast l'ultima posizione fisica.
const knobSet=Array(8).fill(null),knobLast=Array(8).fill(null);
const knobKey=()=>knobMode==="dj"?"dj"+fxScope+(fxScope==="loop"?G.sel:""):knobMode;
function knobTarget(i){const L=G.loops[i];
 if(knobMode==="vol")return L.vol*127;if(knobMode==="pan")return L.pan*63+64;if(knobMode==="fx")return L.fx*63+64;
 if(fxScope==="loop"&&i===7)return G.loops[G.sel].vol*127;
 const a=djView().v[i];return i===0||i===3?a*63+64:a*127}
function knobIn(i,v){if(!ready)return;const key=knobKey(),t=knobTarget(i),S=knobSet[i],p=knobLast[i];knobLast[i]=v;
 const caught=S&&S.key===key&&Math.abs(S.v-t)<=3;
 if(!caught&&Math.abs(v-t)>3&&!(p!=null&&(p-t)*(v-t)<=0)){
  const pct=knobMode==="vol"||knobMode==="dj"&&i>0&&i!==3,where=pct?Math.round(t/127*100)+"%":Math.abs(t-64)<3?"metà":Math.round(Math.abs(t-64)/63*100)+"% a "+(t<64?"sinistra":"destra");
  flashHint(`Manopola ${i+1}${knobMode==="dj"?" "+DJ_NAMES[i]:""}: girala ${v<t?"a destra":"a sinistra"} fino a <b>${where}</b> per agganciarla.`);return}
 knobSet[i]={key,v};knob(i,v)}
