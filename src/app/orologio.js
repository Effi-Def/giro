// ---------- Orologio degli eventi ----------
// Tempo degli eventi. ctx.currentTime avanza a scatti: un blocco da 128 campioni alla volta, a raffiche lunghe quanto
// il buffer della scheda (su questo PC 10 ms, scarto misurato 13,8 ms). Leggerlo quando arriva una nota dava fino a
// ~14 ms di jitter fra il tasto e il suono (e nel loop, senza quantizzazione). Si usa invece l'istante dell'evento
// (timeStamp di MIDI, tastiera e puntatore, sullo stesso orologio di performance.now) portato sull'orologio audio
// con ckMax(): il massimo recente di currentTime − performance.now(), cioè dove arriva currentTime subito dopo una
// raffica. Così una nota parte sempre allo stesso ritardo dal tasto (in media mezzo buffer in più, niente jitter).
const CK=[]; // massimi di currentTime − performance.now() a finestre di 0,5 s (le ultime 4: l'orologio audio deriva)
function clockSample(){if(!ctx||ctx.state!=="running")return;const p=performance.now()/1000,o=ctx.currentTime-p,k=Math.floor(p*2);
 if(CK.length&&o<ckMax()-.06)CK.length=0; // audio rimasto indietro (buco, scheda cambiata): i massimi vecchi non valgono più
 const top=CK[CK.length-1];if(top&&top.k===k){if(o>top.o)top.o=o}else{CK.push({k,o});while(CK[0].k<k-3)CK.shift()}}
function ckMax(){let m=-Infinity;for(const x of CK)if(x.o>m)m=x.o;return m}
// istante (sull'orologio audio) dell'evento con questo timeStamp; null se non si può dire
function eventTime(ts){clockSample();if(!(ts>0)||CK.length<2)return null;
 const t=ts/1000+ckMax(),now=ctx.currentTime;return t>now+.05||t<now-.25?null:t}
let evT=null; // istante dell'evento che si sta gestendo (null = adesso)
let evIn=null; // solo per il log di debug: [timeStamp, performance.now(), currentTime] letti appena arriva l'evento
// gestisce un evento al suo istante: dentro fn, nowT() e nowF() valgono quell'istante
function atEvent(e,fn){const p=performance.now();evIn=ctx?[e&&e.timeStamp||p,p,ctx.currentTime]:null;
 evT=ctx?eventTime(e&&e.timeStamp):null;try{return fn()}finally{evT=null;evIn=null}}
const nowT=()=>evT??ctx.currentTime;
const nowF=()=>Math.round(nowT()*sr);
// i suoni sono tutti interni: le note e i loop escono con lo stesso ritardo e chi suona si allinea a orecchio,
// quindi la latenza d'uscita non va compensata (spostava le note in anticipo). Resta solo il buffer dello ScriptProcessor.
function latencyFrames(){return usingWorklet?0:1024}
// ritardo tra il tasto e il suono: solo da mostrare nelle impostazioni
function audioDelayMs(){return((ctx.outputLatency||0)+(ctx.baseLatency||0))*1000}
