// Motore del looper: gira dentro un AudioWorklet (o ScriptProcessor di riserva).
// Tutte le posizioni sono in frame audio assoluti. Ogni loop è un buffer mono che gira con
// indice (F - t0) mod len. Tre bus d'ingresso a rotazione: le code (tail) di una registrazione
// continuano a essere catturate dal suo bus mentre le note nuove vanno sul bus successivo.
class LoopCore{
 constructor(sr){
  this.sr=sr;this.NL=8;this.TAIL=Math.round(sr*1.6);
  this.RL=Math.ceil(sr*3);this.ring=[0,1,2].map(()=>new Float32Array(this.RL));
  this.q=[];this.msgs=[];this.peakClock=0;this.ramp=1/(.004*sr);
  this.dumps=[];this.DB=65536; // salvataggi in corso; campioni copiati al massimo per blocco audio
  this.CH=sr*2;this.UNDO=10; // la registrazione si accumula a pezzi da 2 s; strati di annulla tenuti per loop
  this.loops=[];for(let i=0;i<this.NL;i++)this.loops.push(this.fresh());
 }
 // pan: -1 sinistra … 1 destra; fx: filtro sull'uscita del loop, -1 passa-basso … 0 niente … 1 passa-alto.
 // ps/fs sono i valori smussati, z1/z2 gli stati del filtro. ver cresce a ogni modifica del buffer, sv è la versione già salvata.
 // cp: copia per l'annulla della sovraincisione in corso, fatta a pezzi (vedi cpStep)
 fresh(){return{buf:null,len:0,t0:0,g:0,gt:0,vol:.8,pan:0,fx:0,ps:0,fs:0,z1:0,z2:0,pg:null,ver:0,sv:0,rec:null,dub:null,cp:null,tails:[],pq:[],undo:[],redo:[]}}
 cmd(c){this.q.push(c)}
 mod(a,n){return((a%n)+n)%n}
 snap(L){return{buf:L.buf,len:L.len,t0:L.t0}}
 // nuovo strato di annulla: oltre UNDO strati si perde il più vecchio (ognuno può tenere una copia intera del loop)
 push(L,s){L.undo.push(s);if(L.undo.length>this.UNDO)L.undo.shift();L.redo=[]}
 // la sovraincisione scrive nel buffer che suona, quindi l'annulla ne vuole una copia. Copiare un loop lungo in un
 // blocco solo prendeva fino a 6 ms nel thread audio: la copia parte poco prima della testina e va avanti a pezzi
 // (DB campioni per blocco), sempre prima delle scritture del blocco, così arriva dove si scrive prima che ci si scriva.
 cpStep(L,budget){const C=L.cp,src=L.buf,dst=C.dst,len=src.length;
  while(budget>0&&C.left>0){const m=Math.min(budget,C.left,len-C.p);dst.set(src.subarray(C.p,C.p+m),C.p);
   C.p+=m;if(C.p===len)C.p=0;C.left-=m;budget-=m}
  if(C.left<=0)L.cp=null}
 // finisce subito la copia (prima di cambiare il buffer, di annullare o di scrivere lontano dalla testina)
 cpDone(L){if(L.cp)this.cpStep(L,Infinity)}
 // forma d'onda in 96 colonne: al massimo ~128 letture per colonna, anche sui loop lunghi (leggere un campione su 4
 // prendeva fino a 10 ms nel thread audio con un loop da 80 s, ogni 0,3 s durante la sovraincisione)
 peaks(i){const L=this.loops[i];if(!L.buf){this.msgs.push({type:"peaks",i,peaks:null});return}
  const B=96,b=L.buf,step=L.len/B,p=new Array(B),st=Math.max(4,Math.floor(step/128));
  for(let k=0;k<B;k++){let m=0;const a=Math.floor(k*step),z=Math.floor((k+1)*step);
   for(let j=a;j<z;j+=st){const v=b[j]<0?-b[j]:b[j];if(v>m)m=v}p[k]=+m.toFixed(3)}
  this.msgs.push({type:"peaks",i,peaks:p})}
 state(i){const L=this.loops[i];this.msgs.push({type:"state",i,has:!!L.buf,len:L.len,t0:L.t0,undo:L.undo.length,redo:L.redo.length});this.peaks(i)}
 exec(c,F0){const L=c.i!=null?this.loops[c.i]:null;
  switch(c.type){
   case "reset":this.loops=this.loops.map(o=>{const n=this.fresh();n.vol=o.vol;n.pan=n.ps=o.pan;n.fx=n.fs=o.fx;return n});break;
   // salvataggio sessione: "dump" manda copie dei loop cambiati dall'ultimo salvataggio (all: tutti; exp: per l'export,
   // non conta come salvato), copiate a pezzi da dumpStep; "load" rimette un loop salvato
   case "dump":this.dumps.push({exp:!!c.exp,q:this.loops.map((o,j)=>o.buf&&(c.all||o.ver!==o.sv)?j:-1).filter(j=>j>=0),items:[],cur:null});break;
   case "load":L.buf=new Float32Array(c.data);L.len=c.len;L.t0=c.t0;L.vol=c.vol;L.pan=L.ps=c.pan;L.fx=L.fs=c.fx;L.undo=[];L.redo=[];L.cp=null;L.g=0;L.gt=0;L.ver++;L.sv=L.ver;this.state(c.i);break;
   // ch: pezzi da CH campioni, creati man mano (niente copie quando la registrazione si allunga)
   case "rec":L.rec={bus:c.bus,start:c.start,comp:c.comp||0,have:Math.max(c.start,F0-this.RL+1),ch:[],end:null,len:0,t0:0};break;
   // buf (facoltativo): buffer azzerato per il loop finito, preparato dal thread principale (vedi freshBuf in app.js)
   case "recEnd":if(L.rec){L.rec.end=c.end;L.rec.len=c.len;L.rec.t0=c.t0;L.rec.buf=c.buf}break;
   case "cancelRec":L.rec=null;break;
   case "dub":if(L.buf){this.cpDone(L);const s={buf:c.buf&&c.buf.length===L.len?c.buf:new Float32Array(L.len),len:L.len,t0:L.t0};this.push(L,s);
    L.cp={dst:s.buf,p:this.mod(F0-(c.comp||0)-L.t0-4096,L.len),left:L.len};L.dub={bus:c.bus,comp:c.comp||0}}break;
   case "undub":if(L.dub){L.tails.push(this.tail(L.dub,F0));L.dub=null;this.state(c.i)}break;
   // note quantizzate: "fill" riempie un loop appena registrato, "pend" aggiunge una nota
   // di sovraincisione che diventa udibile solo quando la testina la raggiunge nel giro dopo
   case "fill":if(L.rec)L.rec.fill=c.data;else if(L.buf&&c.data.length===L.len){this.cpDone(L);const b=L.buf;for(let j=0;j<b.length;j++)b[j]+=c.data[j];L.ver++;this.peaks(c.i)}break;
   case "pend":if(L.buf)L.pq.push(c);break;
   case "gate":L.pg={on:c.on,frame:c.frame};break;
   case "vol":L.vol=c.v;break;
   case "pan":L.pan=Math.max(-1,Math.min(1,c.v));break;
   case "fx":L.fx=Math.max(-1,Math.min(1,c.v));break;
   case "shift":for(const o of this.loops){o.t0+=c.delta;for(const s of o.undo)s.t0+=c.delta;for(const s of o.redo)s.t0+=c.delta}break;
   case "clear":this.cpDone(L);if(L.buf)this.push(L,this.snap(L));L.redo=[];L.pq=[];L.buf=null;L.dub=null;L.rec=null;L.tails=[];L.g=0;L.gt=0;L.pg=null;L.ver++;this.state(c.i);break;
   case "undo":case "redo":{
    this.cpDone(L);L.dub=null;L.tails=[];L.pq=[];const from=c.type==="undo"?L.undo:L.redo,to=c.type==="undo"?L.redo:L.undo;
    if(from.length){to.push(this.snap(L));const s=from.pop();L.buf=s.buf;L.len=s.len;L.t0=s.t0;L.ver++}
    this.state(c.i);break}
  }}
 tail(src,F){return{bus:src.bus,comp:src.comp,from:F,until:F+this.TAIL}}
 // il campione j della registrazione va all'indice (start + j − comp − t0) mod len; quello che avanza oltre
 // un giro si ripiega sull'inizio. Il primo giro si copia con set (copia nativa), solo l'eccedenza si somma a mano:
 // un ciclo su ogni campione, che qui gira una volta sola e quindi non viene mai ottimizzato, prendeva 12–25 ms
 // nel thread audio per un loop da 20–80 s (70 ms col mod su ogni campione), abbastanza per un buco
 finish(i){const L=this.loops[i],R=L.rec,len=R.len,b=R.buf&&R.buf.length===len?R.buf:new Float32Array(len),n=R.end-R.start,CH=this.CH;
  if(R.fill&&R.fill.length===len)b.set(R.fill);
  else{const p0=this.mod(R.start-R.comp-R.t0,len);
   for(let ci=0;ci*CH<n;ci++){const c=R.ch[ci];if(!c)continue;const j0=ci*CH,m=Math.min(CH,n-j0),m1=Math.max(0,Math.min(m,len-j0));let k=0;
    while(k<m1){const p=(p0+j0+k)%len,s=Math.min(m1-k,len-p);b.set(c.subarray(k,k+s),p);k+=s}
    for(let p=(p0+j0+k)%len;k<m;k++){b[p]+=c[k];if(++p===len)p=0}}}
  this.push(L,this.snap(L));
  L.buf=b;L.len=len;L.t0=R.t0;L.rec=null;L.ver++;L.pq=[];L.tails=R.fill?[]:[this.tail(R,R.end)];
  // il loop appena chiuso parte senza dissolvenza, in continuità con quello che hai appena suonato
  if(L.pg&&L.pg.on&&L.pg.frame<=R.end+256){L.gt=1;L.g=L.vol;L.pg=null}
  this.msgs.push({type:"done",i});this.state(i)}
 // coefficienti del filtro SVF (Zavalishin, TPT) per il valore fx smussato; null = nessun filtro
 filt(fx){const a=Math.abs(fx);if(a<.02)return null;const t=(a-.02)/.98,hp=fx>0;
  const fc=Math.min(hp?20*Math.pow(300,t):20000*Math.pow(150/20000,t),this.sr*.45);
  const g=Math.tan(Math.PI*fc/this.sr),k=1/1.2,a1=1/(1+g*(g+k));return{hp,k,a1,a2:g*a1,a3:g*g*a1}}
 // out: uscita mono (o canale sinistro); outR facoltativo: se c'è l'uscita è stereo e vale il pan.
 // outs facoltativo: [[sinistra,destra],…] uno per loop; se c'è, ogni loop esce sul suo (per gli effetti del singolo loop)
 process(ins,out,F0,n,outR,outs){
  const RL=this.RL,F1=F0+n;
  for(let b=0;b<3;b++){const r=this.ring[b],x=ins[b];let p=F0%RL;for(let k=0;k<n;k++){r[p]=x?x[k]:0;if(++p===RL)p=0}}
  if(this.q.length){const keep=[];for(const c of this.q){if(c.frame==null||c.frame<F1)this.exec(c,F0);else keep.push(c)}this.q=keep}
  for(let i=0;i<this.NL;i++){const R=this.loops[i].rec;if(!R)continue;
   const upto=R.end!=null?Math.min(F1,R.end):F1;
   if(upto>R.have){const r=this.ring[R.bus],CH=this.CH;let f=R.have;
    while(f<upto){const j=f-R.start,ci=Math.floor(j/CH),o=j-ci*CH,m=Math.min(upto-f,CH-o),c=R.ch[ci]||(R.ch[ci]=new Float32Array(CH));
     let rp=f%RL;for(let k=0;k<m;k++){c[o+k]=r[rp];if(++rp===RL)rp=0}f+=m}
    R.have=upto}
   if(R.end!=null&&R.have>=R.end)this.finish(i)}
  out.fill(0);if(outR)outR.fill(0);if(outs)for(const o of outs){o[0].fill(0);if(o[1])o[1].fill(0)}
  const sm=Math.min(1,n/(.03*this.sr)); // smussatura di pan e filtro: ~30 ms
  this.peakClock+=n;const peakNow=this.peakClock>=this.sr*.3;if(peakNow)this.peakClock=0;
  for(let i=0;i<this.NL;i++){const L=this.loops[i];
   if(L.pg&&L.pg.frame<F1){L.gt=L.pg.on?1:0;L.pg=null}
   if(!L.buf)continue;const b=L.buf,len=L.len,target=L.gt*L.vol;let g=L.g;
   if(L.cp)this.cpStep(L,Math.max(this.DB,4096+2*n)); // parte 4096 campioni prima della testina: il primo pezzo la supera sempre
   if(L.pq.length){L.pq=L.pq.filter(P=>{if(P.at>=F1)return true;this.cpDone(L);const d=P.data;let p=this.mod(P.start,len);
     for(let k=0;k<d.length;k++){b[p]+=d[k];if(++p===len)p=0}L.ver++;this.peaks(i);return false})}
   L.ps+=(L.pan-L.ps)*sm;L.fs+=(L.fx-L.fs)*sm;
   if(g>1e-5||target>0){let p=this.mod(F0-L.t0,len);
    const oL=outs?outs[i][0]:out,oR=outs?outs[i][1]:outR;
    const F=this.filt(L.fs),gl=oR?Math.min(1,1-L.ps):1,gr=Math.min(1,1+L.ps);
    if(!F){L.z1=0;L.z2=0;
     for(let k=0;k<n;k++){g+=(target-g)*this.ramp;const s=b[p]*g;oL[k]+=s*gl;if(oR)oR[k]+=s*gr;if(++p===len)p=0}}
    else{let z1=L.z1,z2=L.z2;const{hp,k:kq,a1,a2,a3}=F;
     for(let k=0;k<n;k++){g+=(target-g)*this.ramp;const x=b[p]*g;
      const v3=x-z2,v1=a1*z1+a2*v3,v2=z2+a2*z1+a3*v3;z1=2*v1-z1;z2=2*v2-z2;
      const s=hp?x-kq*v1-v2:v2;oL[k]+=s*gl;if(oR)oR[k]+=s*gr;if(++p===len)p=0}
     L.z1=z1;L.z2=z2}}
   L.g=g;
   if(L.dub){const x=ins[L.dub.bus];if(x){let p=this.mod(F0-L.dub.comp-L.t0,len);for(let k=0;k<n;k++){b[p]+=x[k];if(++p===len)p=0}L.ver++}
    if(peakNow)this.peaks(i)}
   if(L.tails.length){L.tails=L.tails.filter(T=>{const x=ins[T.bus];
     if(x){let p=this.mod(F0-T.comp-L.t0,len);const span=T.until-T.from;
      for(let k=0;k<n;k++){const f=F0+k;if(f>=T.from&&f<T.until){const w=1-(f-T.from)/span;b[p]+=x[k]*w*w}if(++p===len)p=0}L.ver++}
     if(F1>=T.until){this.peaks(i);return false}return true})}
  }
  this.dumpStep();
 }
 // salvataggio a pezzi: al massimo DB campioni copiati per blocco audio, così il thread audio non si ferma
 // (copiare 8 loop lunghi in un colpo solo prendeva ~56 ms e faceva buchi nell'audio)
 dumpStep(){const J=this.dumps[0];if(!J)return;let budget=this.DB;
  while(budget>0){
   if(!J.cur){const i=J.q.shift();if(i==null)break;const L=this.loops[i];if(!L.buf)continue;J.cur={i,src:L.buf,ver:L.ver,off:0,chunks:[]}}
   const C=J.cur,L=this.loops[C.i];
   // buffer sostituito a metà copia (annulla, nuova registrazione): ricomincio quel loop
   if(L.buf!==C.src){J.cur=null;if(L.buf)J.q.unshift(C.i);continue}
   const n=Math.min(budget,C.src.length-C.off);C.chunks.push(C.src.slice(C.off,C.off+n));C.off+=n;budget-=n;
   // se il loop cambia durante la copia, ver resta diverso da sv e il prossimo salvataggio lo ricopia
   if(C.off>=C.src.length){J.items.push({i:C.i,len:L.len,t0:L.t0,chunks:C.chunks});if(!J.exp)L.sv=C.ver;J.cur=null}}
  if(!J.cur&&!J.q.length){this.dumps.shift();this.msgs.push({type:"dump",exp:J.exp,items:J.items,has:this.loops.map(o=>!!o.buf)})}}
}
