// ---------- Una scheda sola ----------
// Web MIDI manda l'Axiom a tutte le schede: con Giro aperto due volte ogni nota suonava anche nell'altra scheda, col suono
// scelto lì (l'utente sentiva «il pianoforte sotto tutti i suoni»). L'ultima scheda accesa vince e lo dice alle altre
// (BroadcastChannel); quelle già accese vanno in pausa: audio sospeso, Axiom, tastiera del PC e telefono ignorati,
// finché non si preme USA QUESTA SCHEDA (che mette in pausa l'altra).
let away=false;const tabId=Math.random().toString(36).slice(2),tabCh=typeof BroadcastChannel==="function"?new BroadcastChannel("giro"):null;
function tabTake(){tabCh?.postMessage({take:tabId});if(!away)return;away=false;$("#away").hidden=true;ctx?.resume();render()}
if(tabCh)tabCh.onmessage=e=>{if(!e.data||e.data.take===tabId||away||!ctx)return;
 away=true;allNotesOff();stopRelease();clearTimeout(ctrHold);ctrHold=0;for(const i in holdT)padUp(+i);$("#away").hidden=false;ctx.suspend()};
