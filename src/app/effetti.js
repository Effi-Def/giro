// ---------- Effetti DJ: su tutto il mix o sul singolo loop ----------
// 1 filtro · 2 eco · 3 riverbero · 4 velocità · 5 crusher · 6 wobble · 7 roll · 8 volume (tastiera sul mix, del loop sul loop).
// Tutti nodi nativi del browser (leggeri). A manopole spente (filtro al centro) il suono passa com'era.
// Ambito "mix": la catena DJ fra masterIn e il filtro generale. Ambito "loop": ogni loop esce dal worklet su
// un'uscita sua, che passa per una catena tutta sua, creata al primo effetto. Cambiando loop selezionato,
// quello di prima tiene i suoi effetti e le manopole passano al nuovo.
const DJ_NAMES=["FILTRO","ECO","RIVERBERO","VELOCITÀ","CRUSHER","WOBBLE","ROLL","TASTIERA"];
const DJV=[0,0,0,0,0,0,0,1]; // valori del mix: filtro e velocità -1…1 (0 = spento), gli altri 0…1; la tastiera parte al massimo
let DJ=null,fxScope="mix",revL=null;
const LDJ=Array(8).fill(null),loopOut=[]; // catene dei singoli loop (null = nessun effetto) e uscite dei loop
const ROLL_NAMES={1:"1/4",2:"1/8",4:"1/16",8:"1/32"},WB_NAMES={1:"1/4",2:"1/8",3:"1/8T",4:"1/16"};
function makeDJ(v){const c=ctx,g=v=>{const n=c.createGain();n.gain.value=v;return n};
 const D={v,rollK:0,in:g(1),out:g(1),rev:g(0),crush:c.createWaveShaper(),lp:c.createBiquadFilter(),hp:c.createBiquadFilter()};
 D.lp.type="lowpass";D.lp.frequency.value=22000;D.lp.Q.value=.7;D.hp.type="highpass";D.hp.frequency.value=10;D.hp.Q.value=.7;
 // wobble: passa-basso risonante che si apre e chiude a tempo (dubstep); l'oscillatore muove il detune (in cent)
 D.wb=c.createBiquadFilter();D.wb.type="lowpass";D.wb.frequency.value=22000;D.wb.Q.value=.7;D.wbDepth=g(0);D.wbDepth.connect(D.wb.detune);D.wbOsc=null;D.wbK=0;
 // roll: una linea di ritardo lunga quanto il pezzo, che a un certo punto si richiude su sé stessa
 D.rDry=g(1);D.rIn=g(1);D.rFb=g(0);D.rWet=g(0);D.r=g(1);D.rDel=c.createDelay(2.5);
 // eco: delay di un quarto a tempo. La manopola apre la mandata: abbassandola le ripetizioni già partite si spengono da
 // sole. Passa-alto e passa-basso anche sul ritorno: ogni ripetizione è più scura e la cassa non rimbomba
 D.eSend=g(0);D.eHP=c.createBiquadFilter();D.eHP.type="highpass";D.eHP.frequency.value=250;D.eLP=c.createBiquadFilter();D.eLP.type="lowpass";D.eLP.frequency.value=4000;
 D.eDel=c.createDelay(3);D.eDel.delayTime.value=echoTime();D.eFb=g(.4);D.eWet=g(.55);
 D.in.connect(D.crush);D.crush.connect(D.lp);D.lp.connect(D.hp);D.hp.connect(D.wb);
 D.wb.connect(D.rDry);D.wb.connect(D.rIn);D.rIn.connect(D.rDel);D.rDel.connect(D.rFb);D.rFb.connect(D.rDel);D.rDel.connect(D.rWet);
 D.rDry.connect(D.r);D.rWet.connect(D.r);
 D.r.connect(D.out);D.r.connect(D.eSend);D.eSend.connect(D.eHP);D.eHP.connect(D.eLP);D.eLP.connect(D.eDel);D.eDel.connect(D.eFb);D.eFb.connect(D.eHP);D.eDel.connect(D.eWet);D.eWet.connect(D.out);
 D.out.connect(D.rev); // mandata al riverbero: la usano solo i loop (il mix ha il suo in applyMix)
 return D}
// Velocità (manopola 4): al centro normale, a sinistra i loop rallentano fino a fermarsi, a destra accelerano fino al doppio;
// l'intonazione segue, come un disco. La fa il core, che i loop li ha già tutti in memoria e può leggerli anche più avanti della
// griglia. La griglia non si ferma: tornando al centro la velocità risale e sul prossimo 1 la lettura torna a tempo.
// Vale per ogni loop: velocità del mix × velocità del loop. Le note suonate non ci passano.
const speedOf=a=>1+a;
function speedTick(f){let ch=false;const run=G.base&&G.running;
 G.loops.forEach((L,i)=>{const r=run?speedOf(DJV[3])*(LDJ[i]?speedOf(LDJ[i].v[3]):1):1;
  if(L.rb&&f>=L.rb){L.rb=0;ch=true}
  if(r===(L.rt??1))return;
  // al doppio e a metà i battiti cadono ancora sulla griglia, ma girando la manopola la lettura è scivolata: sul prossimo 1 riparte dal punto giusto
  ch=true;if(r!==1){L.rb=0;send({type:"rate",i,v:r,home:run&&(r===2||r===.5)?nextBar(f):0})}
  else{L.rb=run?nextBar(f):0;send({type:"rate",i,v:1,home:run?L.rb:1})}
  L.rt=r});
 return ch}
// catena del loop i: la crea e ci fa passare l'uscita del loop (solo con l'AudioWorklet, che ha un'uscita per loop)
function loopDJ(i){if(LDJ[i])return LDJ[i];if(!usingWorklet||!loopOut[i])return null;
 if(!revL){revL=ctx.createGain();const cv=ctx.createConvolver();cv.buffer=impulse(2.4);revL.connect(cv);cv.connect(masterOut)}
 const D=makeDJ([0,0,0,0,0,0,0,1]);D.rev.connect(revL);D.out.connect(masterIn);
 loopOut[i].disconnect();loopOut[i].connect(D.in);return LDJ[i]=D}
function dropLoopDJ(i){const D=LDJ[i];if(!D)return;LDJ[i]=null;
 loopOut[i].disconnect();loopOut[i].connect(masterIn);D.out.disconnect();D.rev.disconnect();
 if(D.wbOsc)try{D.wbOsc.stop()}catch(_){}}
const djAll=()=>[DJ,...LDJ].filter(Boolean);
const fxActive=D=>!!D&&(D.rollK>0||D.wbK>0||D.v.some((x,i)=>i===0||i===3?x!==0:i<5&&x>.02));
const beatS=()=>G.base?G.base/G.beats/sr:.5,echoTime=()=>Math.min(2.9,beatS())-128/sr; // il giro di ritorno aggiunge un blocco audio: senza togliere le ripetizioni scivolano di 2,7 ms l'una
let cosWave=null;
// eco, wobble e roll seguono il tempo: da richiamare quando il tempo o l'1 cambiano. Il wobble riparte dal prossimo battito
function djRetime(){if(!DJ)return;djAll().forEach(D=>djRetimeOne(D))}
function djRetimeOne(D){const t=ctx.currentTime,b=G.base?G.base/G.beats:0;
 D.eDel.delayTime.setTargetAtTime(echoTime(),t,.05);
 const T=b?(G.origin+Math.ceil((nowF()+sr*.02-G.origin)/b)*b)/sr:0;
 if(D.wbOsc){try{D.wbOsc.stop()}catch(_){}D.wbOsc.disconnect();D.wbOsc=null}
 // wobble: coseno (all'1 il filtro è aperto), da 450 Hz su e giù di 2600 cent, wbK oscillazioni per battito
 const wb=D.wbK&&G.base;D.wb.frequency.setTargetAtTime(wb?450:22000,t,.01);D.wb.Q.setTargetAtTime(wb?6:.7,t,.01);D.wbDepth.gain.setTargetAtTime(wb?2600:0,t,.01);
 if(wb){if(!cosWave)cosWave=ctx.createPeriodicWave(new Float32Array([0,1]),new Float32Array(2));
  const o=ctx.createOscillator();o.setPeriodicWave(cosWave);o.frequency.value=D.wbK/beatS();o.connect(D.wbDepth);o.start(T);D.wbOsc=o}
 if(D.rollK){const k=D.rollK;D.rollK=0;djRoll(D,k)}}
function djRoll(D,k){if(!G.base||!G.running)k=0;if(k===D.rollK)return;D.rollK=k;
 const t=ctx.currentTime;[D.rDry,D.rIn,D.rWet,D.rFb].forEach(n=>n.gain.cancelScheduledValues(t));D.rDel.delayTime.cancelScheduledValues(t);
 if(!k){const T=t+.005;D.rDry.gain.setValueAtTime(1,T);D.rIn.gain.setValueAtTime(1,T);D.rWet.gain.setValueAtTime(0,T);D.rFb.gain.setValueAtTime(0,T);return}
 // dal prossimo pezzo a tempo: lo lascio passare registrandolo, poi lo ripeto finché la manopola resta girata
 const s=G.base/(G.beats*k),f=nowF(),Tg=G.origin+Math.ceil((f+sr*.01-G.origin)/s)*s,T1=Tg/sr,T2=(Tg+s)/sr;
 D.rDel.delayTime.setValueAtTime(s/sr,T1);D.rIn.gain.setValueAtTime(1,T1);D.rDry.gain.setValueAtTime(1,T1);D.rWet.gain.setValueAtTime(0,T1);D.rFb.gain.setValueAtTime(0,T1);
 D.rIn.gain.setValueAtTime(0,T2);D.rDry.gain.setValueAtTime(0,T2);D.rWet.gain.setValueAtTime(1,T2);D.rFb.gain.setValueAtTime(1,T2)}
const rollAllOff=()=>{if(DJ)djAll().forEach(D=>djRoll(D,0))};
function crushCurve(a){if(a<.02)return null;const n=4096,c=new Float32Array(n),steps=Math.pow(2,12-a*9)/2;
 for(let k=0;k<n;k++){const x=k/(n-1)*2-1;c[k]=Math.round(x*steps)/steps}return c}
function djApply(D,i){const t=ctx.currentTime,a=D.v[i];
 switch(i){
  case 0:{const u=Math.max(0,(Math.abs(a)-.04)/.96);
   D.lp.frequency.setTargetAtTime(a<0?22000*Math.pow(180/22000,u):22000,t,.02);D.hp.frequency.setTargetAtTime(a>0?10*Math.pow(600,u):10,t,.02);
   D.lp.Q.setTargetAtTime(a<0?.7+u*1.3:.7,t,.05);D.hp.Q.setTargetAtTime(a>0?.7+u*1.3:.7,t,.05);break}
  case 1:D.eSend.gain.setTargetAtTime(a,t,.03);D.eFb.gain.setTargetAtTime(a>.02?.35+a*.45:.4,t,.03);break;
  case 2:if(D===DJ)applyMix();else D.rev.gain.setTargetAtTime(a*.8,t,.03);break;
  case 4:D.crush.curve=crushCurve(a);break;
  case 5:{const k=a<.1?0:[1,2,3,4][Math.min(3,Math.floor((a-.1)/.9*4))];if(k!==D.wbK){D.wbK=k;djRetimeOne(D)}break}
  case 6:djRoll(D,a<.1?0:[1,2,4,8][Math.min(3,Math.floor((a-.1)/.9*4))]);break}}
function djKnob(i,v){let x=v/127;
 if(i===0||i===3){x=Math.max(-1,Math.min(1,(v-64)/63));if(Math.abs(x)<.04)x=0}
 if(i===3&&Math.abs(x+.5)<.03)x=-.5; // metà velocità esatta, come il doppio tutta a destra: resta a tempo
 if(fxScope==="loop"){const n=G.sel,L=G.loops[n];
  if(!L.has){flashHint("Effetti sul loop: prima registra un loop e selezionalo.");return}
  if(i===7){L.vol=x;send({type:"vol",i:n,v:x});saveSoon();flashHint(`Loop ${n+1}: volume ${Math.round(x*100)}%`);render();return}
  if(!ready)return;const D=loopDJ(n);
  if(!D){fxScope="mix";flashHint("Effetti sul singolo loop non disponibili su questo PC: torno a tutto il mix.");render();return}
  D.v[i]=x;djApply(D,i);flashHint(`Loop ${n+1} · effetto <b>${i+1} ${DJ_NAMES[i]}</b>: `+djText(i));render();return}
 DJV[i]=x;if(DJ)djApply(DJ,i);
 flashHint(`Effetto <b>${i+1} ${DJ_NAMES[i]}</b>: `+djText(i));render()}
// valori mostrati sulla striscia: quelli del mix o del loop selezionato
function djView(){if(fxScope==="mix")return{v:DJV,rollK:DJ?DJ.rollK:0,wbK:DJ?DJ.wbK:0};
 const D=LDJ[G.sel];return{v:D?D.v:[0,0,0,0,0,0,0,0],rollK:D?D.rollK:0,wbK:D?D.wbK:0}}
function djText(i){const V=djView(),a=V.v[i];
 if(i===7&&fxScope==="loop")return Math.round(G.loops[G.sel].vol*100)+"%";
 if(i===0)return a===0?"spento":a<0?"scuro "+Math.round(-a*100)+"%":"leggero "+Math.round(a*100)+"%";
 if(i===6)return V.rollK?ROLL_NAMES[V.rollK]:(G.base&&G.running?"spento":"serve un loop");
 if(i===5)return !V.wbK?"spento":G.base?WB_NAMES[V.wbK]:"serve un loop";
 if(i===3){if(a===0)return (fxScope==="mix"?G.loops.some(L=>L.rb):G.loops[G.sel].rb)?"a tempo sull'1":"normale";
  if(!G.base||!G.running)return "serve un loop";return a<-.97?"fermo":Math.round((1+a)*100)+"%"}
 return a<.02&&i!==7?"spento":Math.round(a*100)+"%"}
function setFxScope(m){fxScope=m;
 flashHint(m==="loop"?`Effetti DJ sul <b>loop selezionato</b> (ora il ${G.sel+1}). Cambiando loop, quello di prima tiene i suoi effetti.`:"Effetti DJ su <b>tutto il mix</b>.");render()}
const toggleFxScope=()=>setFxScope(fxScope==="mix"?"loop":"mix");
// spegne tutti gli effetti, sul mix e su ogni loop (i volumi restano com'erano)
// anche il filtro di ogni loop (modo FILTRO LOOP), che prima restava girato
function stopAllFx(){for(let i=0;i<7;i++)DJV[i]=0;
 if(DJ){for(let i=0;i<7;i++)djApply(DJ,i);for(let i=0;i<LDJ.length;i++)dropLoopDJ(i)}cutOff();
 G.loops.forEach((L,i)=>{if(!L.fx)return;L.fx=0;send({type:"fx",i,v:0});saveSoon()});
 flashHint("<b>Effetti spenti</b> su tutto il mix e su tutti i loop.");render()}
// velocità normale per il loop selezionato (tasto centrale tenuto, tasto 9): la sua e quella del mix, che vale anche per lui.
// Filtro ed effetti restano come sono; tornando a 1 il loop rientra a tempo sull'1 (speedTick)
function speedReset(){if(!ready)return;const n=G.sel,D=LDJ[n],mix=DJV[3]!==0,own=!!D&&D.v[3]!==0;
 if(!mix&&!own){flashHint(`Loop ${n+1}: la velocità è già normale.`);return}
 DJV[3]=0;if(own)D.v[3]=0;
 const altri=G.loops.map((_,i)=>i).filter(i=>i!==n&&LDJ[i]&&LDJ[i].v[3]!==0);
 flashHint(`<b>Velocità normale</b> ${mix?"su tutto il mix":"sul loop "+(n+1)}`+(G.running?", a tempo dall'1":"")+(altri.length?` · il loop ${altri.map(i=>i+1).join(", ")} ha ancora la sua`:"")+".");render()}
