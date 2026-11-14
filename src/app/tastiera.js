// ---------- Tastiera del PC ----------
// tasti delle note: nessuna di queste lettere può essere un comando (i comandi sono controllati prima)
const KEYMAP="awsedftgyhujkolp;'";const pcHeld=new Map();
addEventListener("keydown",e=>atEvent(e,()=>{
 if(e.ctrlKey&&e.shiftKey&&e.code==="KeyD"){e.preventDefault();if(!away&&ready&&!e.repeat)dbgExport();return}
 if(away)return;
 if(!$("#gate").hidden){e.preventDefault();start();return}
 if(!$("#settings").hidden||!$("#help").hidden){if(e.key==="Escape")closeSettings();return}
 if(e.target.matches("input,select")||e.ctrlKey||e.metaKey||e.altKey)return;
 const k=e.key.toLowerCase();
 if(e.code==="Space"){e.preventDefault();if(!e.repeat){(G.running?stopButton:playButton)();stopPress()}return}
 if(e.repeat)return;
 if(e.shiftKey&&/^Digit[1-8]$/.test(e.code)){selectLoop(+e.code[5]-1);return}
 if(/^[1-8]$/.test(k))return padDown(+k-1);
 if(k==="r")return dubButton();
 if(k==="b")return playPress(); // come ▶: break / rientro
 if(k==="q")return cycleQuant();
 if(k==="m")return cycleKnobMode();
 if(k==="c")return toggleFxScope();
 if(k==="0")return stopAllFx();
 if(k==="9")return speedReset();
 if(k==="n")return perfToggle();
 if(k==="v")return cutButton();
 if(e.key==="+"||e.key==="=")return tempoStep(1);
 if(e.key==="-")return tempoStep(-1);
 if(e.key==="Escape")return allNotesOff();
 if(e.key==="Backspace"){e.preventDefault();return undoSel(false)}
 if(e.key==="ArrowUp"){e.preventDefault();return stepFamily(1)}
 if(e.key==="ArrowDown"){e.preventDefault();return stepFamily(-1)}
 if(e.key==="ArrowRight"){e.preventDefault();return stepInFamily(1)}
 if(e.key==="ArrowLeft"){e.preventDefault();return stepInFamily(-1)}
 if(k==="z"||k==="x"){SET.oct=Math.max(-3,Math.min(3,SET.oct+(k==="z"?-1:1)));flashHint(`Ottava tastiera PC: ${SET.oct>0?"+":""}${SET.oct}`);return}
 const idx=KEYMAP.indexOf(k);if(idx>=0){const n=60+SET.oct*12+idx;pcHeld.set(k,n);noteOn(n,.8)}}));
// finestra che perde il focus: i rilasci dei tasti del PC non arriverebbero più (note bloccate, pad o ■ tenuti che cancellano)
addEventListener("blur",()=>{[...pcHeld.values()].forEach(n=>noteOff(n,true));pcHeld.clear();
 for(const i in holdT)padUp(+i);stopRelease()});
addEventListener("keyup",e=>atEvent(e,()=>{const k=e.key.toLowerCase();
 if(e.code==="Space")return stopRelease();
 if(/^[1-8]$/.test(k))return padUp(+k-1);
 if(pcHeld.has(k)){noteOff(pcHeld.get(k));pcHeld.delete(k)}}));
