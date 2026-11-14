// Axiom finto per i test: sostituisce Web MIDI (navigator.requestMIDIAccess) con le due porte d'ingresso dell'Axiom AIR Mini 32,
// prima che parta Giro. I messaggi fanno la stessa strada di quelli veri: onmidimessage della porta, atEvent con il timeStamp
// dell'evento, onMIDI. I numeri sono quelli della mappa in CLAUDE.md (modo MIDI: canale 1; HyperControl: porta sua, canale 16,
// pad sul 15). I nomi delle porte sono quelli che di solito dà Windows a una tastiera USB con due porte: non verificati.
(()=>{
 class Porta extends EventTarget{
  constructor(id,name){super();Object.assign(this,{id,name,type:"input",manufacturer:"M-Audio",state:"connected",connection:"open",onmidimessage:null});
   this.addEventListener("midimessage",e=>this.onmidimessage&&this.onmidimessage(e))}}
 const acc=new EventTarget();Object.assign(acc,{inputs:new Map(),outputs:new Map(),sysexEnabled:false,onstatechange:null});
 const midi=new Porta("axiom-1","Axiom AIR Mini 32"),hc=new Porta("axiom-2","MIDIIN2 (Axiom AIR Mini 32)");
 acc.inputs.set(midi.id,midi);acc.inputs.set(hc.id,hc);
 Object.defineProperty(Navigator.prototype,"requestMIDIAccess",{configurable:true,value:()=>Promise.resolve(acc)});
 // il timeStamp è l'istante in cui l'evento nasce; con ritardo (ms) la pagina lo riceve dopo, come quando il thread principale è occupato
 function invia(porta,bytes){if(porta.state!=="connected")return;const e=new Event("midimessage");Object.defineProperty(e,"data",{value:Uint8Array.from(bytes)});
  if(A.ritardo>0)setTimeout(()=>porta.dispatchEvent(e),A.ritardo);else porta.dispatchEvent(e)}
 const A=window.axiom={ritardo:0,acc,
  // modo MIDI (LED delle manopole spenti): tutto sul canale 1
  midi:(...b)=>invia(midi,b),
  nota:(n,vel=100)=>invia(midi,[0x90,n,vel]),rilascia:n=>invia(midi,[0x80,n,0]),
  pad:(i,giu=true)=>invia(midi,giu?[0x90,35+i,100]:[0x80,35+i,0]), // pad 1–8 = note 36–43
  cc:(n,v)=>invia(midi,[0xB0,n,v]),
  premi:n=>{invia(midi,[0xB0,n,127]);invia(midi,[0xB0,n,0])}, // ■ 16, ▶ 17, ● 18, ◀ 19, ▶ 20, ▲ 21, ▼ 22, centrale 23
  bend:v=>invia(midi,[0xE0,v&127,v>>7]),
  // modi HyperControl (LED Volume, Pan, Inst/FX): porta HyperControl, canale 16, pad sul canale 15
  hc:(...b)=>invia(hc,b),
  hcCC:(n,v)=>invia(hc,[0xBF,n,v]),
  hcPad:(i,giu=true)=>invia(hc,giu?[0x9E,80+i,100]:[0x8E,80+i,0]), // pad 1–8 = note 81–88
  // cavo staccato: le porte spariscono e Chrome lo dice con statechange
  stacca(){for(const p of[midi,hc]){p.state="disconnected";acc.inputs.delete(p.id);
   const e=new Event("statechange");e.port=p;acc.onstatechange&&acc.onstatechange(e)}}}
})();
