// ---------- Tempo: tutta la canzone più veloce o più lenta, senza cambiare l'intonazione ----------
// Richiesta dell'utente (la manopola 4 cambia velocità e intonazione insieme, come un disco). Scelte sue: a scatto sull'1, fino a
// ±15% dal tempo del primo giro (G.base0), da schermo (− e + accanto ai bpm) e tastiera del PC (− e +), niente sull'Axiom.
// Non in tempo reale: stirare 8 loop mentre suonano è troppo per questo PC. Dopo l'ultimo − o + Giro si fa copiare i loop (dump con
// tag "tempo"), li stira qui (stretch, a pezzi: fra un pezzo e l'altro passano note e comandi) e il core passa alla versione nuova
// sul prossimo 1 (comando tempo), ogni loop dallo stesso punto del suo giro. Si stira sempre dalla versione suonata (TSRC, finché
// il loop non cambia): cambi ripetuti non sommano difetti e tornando al tempo del primo giro i loop sono di nuovo identici.
// Le note suonate non passano di qui. Gli strati di annulla si perdono (erano al tempo di prima).
const TEMPO={want:0,busy:false,gen:0,tries:0,timer:0,sent:null},TSRC=[];
const bpm0=()=>G.base0?60*G.beats/(G.base0/sr):bpm(),tempoLim=()=>[Math.ceil(bpm0()*.85),Math.floor(bpm0()*1.15)];
const tempoBusy=()=>G.loops.some(L=>L.state==="rec"||L.state==="closing"||L.state==="dub");
function tempoStep(d){if(!ready)return;
 if(!G.base){flashHint("Il tempo lo decide il primo giro: registralo, poi <b>−</b> e <b>+</b> lo cambiano.");return}
 if(tempoBusy()){flashHint("Finisci la registrazione, poi cambia il tempo con <b>−</b> e <b>+</b>.");return}
 const [lo,hi]=tempoLim(),cur=Math.round(bpm()),w=Math.max(lo,Math.min(hi,(TEMPO.want||cur)+d));
 if(w===(TEMPO.want||cur)){flashHint(`Più ${d>0?"veloce":"lento"} di così no: il tempo va da ${lo} a ${hi} bpm (±15% dal primo giro).`);return}
 TEMPO.gen++;TEMPO.busy=false;TEMPO.tries=0;TEMPO.want=w===cur&&!TEMPO.sent?0:w;clearTimeout(TEMPO.timer);
 if(TEMPO.want)TEMPO.timer=setTimeout(tempoRun,700);render()}
function tempoCancel(msg){TEMPO.want=0;TEMPO.busy=false;TEMPO.gen++;clearTimeout(TEMPO.timer);if(msg)flashHint(msg);render()}
function tempoRun(){if(!TEMPO.want||!ready)return;
 if(!G.base)return tempoCancel();
 if(tempoBusy())return tempoCancel("Tempo non cambiato: stai registrando. Riprova con <b>−</b> o <b>+</b> quando hai finito.");
 // pezzo ripetuto in corso, o un cambio già mandato al core: aspetto che finiscano
 if(CUT||TEMPO.sent){TEMPO.timer=setTimeout(tempoRun,400);return}
 TEMPO.busy=true;TEMPO.dg=TEMPO.gen;send({type:"dump",all:true,exp:true,tag:"tempo"});render()}
async function onTempoDump(items){const g=TEMPO.gen,want=TEMPO.want;if(g!==TEMPO.dg||!want||!G.base)return;
 const base1=want===Math.round(bpm0())&&G.base0?G.base0:Math.round(60*G.beats*sr/want),out=[];
 for(const it of items){let S=TSRC[it.i];if(!S||S.ver!==it.ver)S=TSRC[it.i]={data:it.data,len:it.len,base:G.base,ver:it.ver};
  const len=S.len%S.base===0?S.len/S.base*base1:Math.round(S.len*base1/S.base);
  const data=len===S.len?S.data.slice():await stretch(S.data,len,()=>g!==TEMPO.gen);if(!data)return;out.push({i:it.i,data,ver:it.ver})}
 if(g!==TEMPO.gen||!G.base)return;
 if(tempoBusy())return tempoCancel("Tempo non cambiato: stai registrando. Riprova con <b>−</b> o <b>+</b> quando hai finito.");
 const X=G.running?nextBar(nowF()+Math.round(sr*.05)):nowF()+Math.round(sr*.05),r=base1/G.base;
 TEMPO.sent={id:g,X,r,base1,want,ids:out.map(o=>o.i)};
 send({type:"tempo",id:g,frame:X,r,items:out},out.map(o=>o.data.buffer))}
// il core ha cambiato (o no) il tempo al frame X: la griglia si stira da lì, l'1 del giro resta l'1
function onTempo(m){const S=TEMPO.sent;if(!S||m.id!==S.id)return;TEMPO.sent=null;
 if(!m.ok){if(m.busy||tempoBusy())return tempoCancel("Tempo non cambiato: stai registrando. Riprova con <b>−</b> o <b>+</b> quando hai finito.");
  // un loop è cambiato mentre lo stiravo (code, note in arrivo): riprovo
  if(++TEMPO.tries>12)return tempoCancel("Tempo non cambiato: i loop continuavano a cambiare. Riprova.");
  if(TEMPO.want){TEMPO.busy=false;TEMPO.timer=setTimeout(tempoRun,300)}return}
 const X=m.frame,r=S.r,sc=f=>f>X?X+Math.round((f-X)*r):f,ph=dmod(X-G.origin,G.base);
 G.origin=X-Math.round(ph*r);G.base=S.base1;
 if(G.stopAt)G.stopAt=sc(G.stopAt);
 G.loops.forEach((L,i)=>{if(L.pend)L.pend.at=sc(L.pend.at);if(L.rb)L.rb=sc(L.rb);dbgForget(i)});
 for(const i of S.ids)if(TSRC[i])TSRC[i].ver=m.vers[i];
 TEMPO.tries=0;TEMPO.busy=false;if(TEMPO.want===S.want||TEMPO.want===Math.round(bpm()))TEMPO.want=0;else{clearTimeout(TEMPO.timer);TEMPO.timer=setTimeout(tempoRun,300)}
 djRetime();saveSoon();flashHint(`Tempo: <b>${Math.round(bpm())} bpm</b>. Stessa intonazione; ${Math.round(bpm0())} bpm è il tempo del primo giro.`)}
// stira il loop x (circolare) a m campioni senza cambiare l'intonazione: pezzi da ~50 ms copiati così come sono, uniti da
// dissolvenze di 10 ms (SOLA a sovrapposizione corta: gli attacchi della batteria restano interi, con le finestre lunghe sovrapposte
// a metà si indebolivano e arrivavano 10 ms tardi). Ogni pezzo parte vicino al suo punto ideale (il centro del pezzo va a c·n/m: niente scivola, e dentro il pezzo,
// che non è stirato, lo scarto si divide fra le due metà),
// dove continua meglio il pezzo di prima, entro ±S: prima sul segnale ridotto di D, poi campione per campione; allontanarsi dal punto
// ideale costa (P), altrimenti la ricerca resta sempre in fondo alla finestra e tutto arriva in ritardo. A pezzi di ~6 ms di lavoro,
// fra uno e l'altro passano note e comandi; stale() vero: richiesta superata, si smette (null)
const YQ=[],YC=new MessageChannel();YC.port1.onmessage=()=>YQ.shift()?.();
const yieldNow=()=>new Promise(r=>{YQ.push(r);YC.port2.postMessage(0)});
async function stretch(x,m,stale){const n=x.length,H=Math.round(sr*.05),V=Math.round(sr*.01),S=Math.round(sr*.012),D=4,P=.15,a=n/m,M=Math.max(2,Math.round(m/H)),hs=m/M;
 const y=new Float32Array(m),ws=new Float32Array(m),fade=new Float32Array(V);for(let k=0;k<V;k++)fade[k]=.5-.5*Math.cos(Math.PI*(k+.5)/V);
 // copie che continuano oltre la fine col principio del loop: letture contigue da qualsiasi punto
 const xp=new Float32Array(n+Math.ceil(hs)+2*V+2*S+16);for(let k=0;k<xp.length;k++)xp[k]=x[k%n];
 const nd=Math.floor(n/D),Vd=V>>2,Sd=Math.round(S/D),dp=new Float32Array(nd+Vd+2*Sd+16);for(let k=0;k<dp.length;k++){const j=(k%nd)*D;dp[k]=(x[j]+x[j+1]+x[j+2]+x[j+3])/4}
 const score=(A,b,c,L,dev)=>{let dot=0,ea=0,ec=0;for(let k=0;k<L;k++){const u=A[b+k],v=A[c+k];dot+=u*v;ea+=u*u;ec+=v*v}return dot/Math.sqrt(ea*ec+1e-20)-P*dev*dev};
 let prev=0,po=0,t=performance.now();
 for(let j=0;j<M;j++){const o=Math.round(j*hs),o1=Math.round((j+1)*hs),len=o1-o+V,ideal=Math.round((o+(o1-o)/2)*a-(o1-o)/2);let pos=ideal;
  if(j>0){const nat=prev+o-po,c0=dmod(Math.round(nat/D),nd),f0=dmod(nat,n),i0=Math.round(ideal/D);let best=i0,bs=-Infinity;
   for(let s=-Sd;s<=Sd;s++){const sc=score(dp,dmod(i0+s,nd),c0,Vd,s/Sd);if(sc>bs){bs=sc;best=i0+s}}
   bs=-Infinity;for(let s=best*D-D;s<=best*D+D;s++){const sc=score(xp,dmod(s,n),f0,V,(s-ideal)/S);if(sc>bs){bs=sc;pos=s}}}
  // dissolvenza in entrata sui primi V campioni (l'uscita del pezzo di prima è il complemento), poi il pezzo intero, poi la sua uscita
  const b=dmod(pos,n);let q=o;
  for(let k=0;k<len;k++){const w=k<V?fade[k]:k>=len-V?1-fade[k-(len-V)]:1;y[q]+=xp[b+k]*w;ws[q]+=w;if(++q===m)q=0}
  prev=pos;po=o;
  if(performance.now()-t>6){await yieldNow();if(stale())return null;t=performance.now()}}
 for(let k=0;k<m;k++)if(ws[k]>1e-3)y[k]/=ws[k];
 return y}
