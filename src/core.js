// Motore del looper: gira dentro un AudioWorklet (o ScriptProcessor di riserva).
// Tutte le posizioni sono in frame audio assoluti. Ogni loop è un buffer mono che gira con
// indice (F - t0) mod len. Tre bus d'ingresso a rotazione: le code (tail) di una registrazione
// continuano a essere catturate dal suo bus mentre le note nuove vanno sul bus successivo.
class LoopCore{
 constructor(sr){
  this.sr=sr;this.NL=8;this.TAIL=Math.round(sr*1.6);
  this.RL=Math.ceil(sr*3);this.ring=[0,1,2].map(()=>new Float32Array(this.RL));
  this.q=[];this.msgs=[];this.peakClock=0;this.ramp=1/(.004*sr);
  this.loops=[];for(let i=0;i<this.NL;i++)this.loops.push(this.fresh());
 }
 // pan: -1 sinistra … 1 destra; fx: filtro sull'uscita del loop, -1 passa-basso … 0 niente … 1 passa-alto.
 // ps/fs sono i valori smussati, z1/z2 gli stati del filtro.
 fresh(){return{buf:null,len:0,t0:0,g:0,gt:0,vol:.8,pan:0,fx:0,ps:0,fs:0,z1:0,z2:0,pg:null,rec:null,dub:null,tails:[],pq:[],undo:[],redo:[]}}
 cmd(c){this.q.push(c)}
 mod(a,n){return((a%n)+n)%n}
 snap(L){return{buf:L.buf,len:L.len,t0:L.t0}}
 peaks(i){const L=this.loops[i];if(!L.buf){this.msgs.push({type:"peaks",i,peaks:null});return}
  const B=96,b=L.buf,step=L.len/B,p=new Array(B);
  for(let k=0;k<B;k++){let m=0;const a=Math.floor(k*step),z=Math.floor((k+1)*step);
   for(let j=a;j<z;j+=4){const v=b[j]<0?-b[j]:b[j];if(v>m)m=v}p[k]=+m.toFixed(3)}
  this.msgs.push({type:"peaks",i,peaks:p})}
 state(i){const L=this.loops[i];this.msgs.push({type:"state",i,has:!!L.buf,len:L.len,t0:L.t0,undo:L.undo.length,redo:L.redo.length});this.peaks(i)}
 exec(c,F0){const L=c.i!=null?this.loops[c.i]:null;
  switch(c.type){
   case "reset":this.loops=this.loops.map(o=>{const n=this.fresh();n.vol=o.vol;n.pan=n.ps=o.pan;n.fx=n.fs=o.fx;return n});break;
   case "rec":L.rec={bus:c.bus,start:c.start,comp:c.comp||0,have:Math.max(c.start,F0-this.RL+1),data:new Float32Array(this.sr*8),end:null,len:0,t0:0};break;
   case "recEnd":if(L.rec){L.rec.end=c.end;L.rec.len=c.len;L.rec.t0=c.t0}break;
   case "cancelRec":L.rec=null;break;
   case "dub":if(L.buf){L.undo.push({buf:L.buf.slice(),len:L.len,t0:L.t0});L.redo=[];L.dub={bus:c.bus,comp:c.comp||0}}break;
   case "undub":if(L.dub){L.tails.push(this.tail(L.dub,F0));L.dub=null;this.state(c.i)}break;
   // note quantizzate: "fill" riempie un loop appena registrato, "pend" aggiunge una nota
   // di sovraincisione che diventa udibile solo quando la testina la raggiunge nel giro dopo
   case "fill":if(L.rec)L.rec.fill=c.data;else if(L.buf&&c.data.length===L.len){const b=L.buf;for(let j=0;j<b.length;j++)b[j]+=c.data[j];this.peaks(c.i)}break;
   case "pend":if(L.buf)L.pq.push(c);break;
   case "gate":L.pg={on:c.on,frame:c.frame};break;
   case "vol":L.vol=c.v;break;
   case "pan":L.pan=Math.max(-1,Math.min(1,c.v));break;
   case "fx":L.fx=Math.max(-1,Math.min(1,c.v));break;
   case "shift":for(const o of this.loops){o.t0+=c.delta;for(const s of o.undo)s.t0+=c.delta;for(const s of o.redo)s.t0+=c.delta}break;
   case "clear":if(L.buf)L.undo.push(this.snap(L));L.redo=[];L.pq=[];L.buf=null;L.dub=null;L.rec=null;L.tails=[];L.g=0;L.gt=0;L.pg=null;this.state(c.i);break;
   case "undo":case "redo":{
    L.dub=null;L.tails=[];L.pq=[];const from=c.type==="undo"?L.undo:L.redo,to=c.type==="undo"?L.redo:L.undo;
    if(from.length){to.push(this.snap(L));const s=from.pop();L.buf=s.buf;L.len=s.len;L.t0=s.t0}
    this.state(c.i);break}
  }}
 tail(src,F){return{bus:src.bus,comp:src.comp,from:F,until:F+this.TAIL}}
 grow(R,need){if(need<=R.data.length)return;let n=R.data.length;while(n<need)n*=2;const d=new Float32Array(n);d.set(R.data);R.data=d}
 finish(i){const L=this.loops[i],R=L.rec,len=R.len,b=new Float32Array(len),n=R.end-R.start;
  if(R.fill&&R.fill.length===len)b.set(R.fill);
  else for(let j=0;j<n;j++)b[this.mod(R.start+j-R.comp-R.t0,len)]+=R.data[j];
  L.undo.push(this.snap(L));L.redo=[];
  L.buf=b;L.len=len;L.t0=R.t0;L.rec=null;L.pq=[];L.tails=R.fill?[]:[this.tail(R,R.end)];
  // il loop appena chiuso parte senza dissolvenza, in continuità con quello che hai appena suonato
  if(L.pg&&L.pg.on&&L.pg.frame<=R.end+256){L.gt=1;L.g=L.vol;L.pg=null}
  this.msgs.push({type:"done",i});this.state(i)}
 // coefficienti del filtro SVF (Zavalishin, TPT) per il valore fx smussato; null = nessun filtro
 filt(fx){const a=Math.abs(fx);if(a<.02)return null;const t=(a-.02)/.98,hp=fx>0;
  const fc=Math.min(hp?20*Math.pow(300,t):20000*Math.pow(150/20000,t),this.sr*.45);
  const g=Math.tan(Math.PI*fc/this.sr),k=1/1.2,a1=1/(1+g*(g+k));return{hp,k,a1,a2:g*a1,a3:g*g*a1}}
 // out: uscita mono (o canale sinistro); outR facoltativo: se c'è l'uscita è stereo e vale il pan
 process(ins,out,F0,n,outR){
  const RL=this.RL,F1=F0+n;
  for(let b=0;b<3;b++){const r=this.ring[b],x=ins[b];let p=F0%RL;for(let k=0;k<n;k++){r[p]=x?x[k]:0;if(++p===RL)p=0}}
  if(this.q.length){const keep=[];for(const c of this.q){if(c.frame==null||c.frame<F1)this.exec(c,F0);else keep.push(c)}this.q=keep}
  for(let i=0;i<this.NL;i++){const R=this.loops[i].rec;if(!R)continue;
   const upto=R.end!=null?Math.min(F1,R.end):F1;
   if(upto>R.have){this.grow(R,upto-R.start);const r=this.ring[R.bus];
    for(let f=R.have;f<upto;f++)R.data[f-R.start]=r[f%RL];R.have=upto}
   if(R.end!=null&&R.have>=R.end)this.finish(i)}
  out.fill(0);if(outR)outR.fill(0);
  const sm=Math.min(1,n/(.03*this.sr)); // smussatura di pan e filtro: ~30 ms
  this.peakClock+=n;const peakNow=this.peakClock>=this.sr*.3;if(peakNow)this.peakClock=0;
  for(let i=0;i<this.NL;i++){const L=this.loops[i];
   if(L.pg&&L.pg.frame<F1){L.gt=L.pg.on?1:0;L.pg=null}
   if(!L.buf)continue;const b=L.buf,len=L.len,target=L.gt*L.vol;let g=L.g;
   if(L.pq.length){L.pq=L.pq.filter(P=>{if(P.at>=F1)return true;const d=P.data;let p=this.mod(P.start,len);
     for(let k=0;k<d.length;k++){b[p]+=d[k];if(++p===len)p=0}this.peaks(i);return false})}
   L.ps+=(L.pan-L.ps)*sm;L.fs+=(L.fx-L.fs)*sm;
   if(g>1e-5||target>0){let p=this.mod(F0-L.t0,len);
    const F=this.filt(L.fs),gl=outR?Math.min(1,1-L.ps):1,gr=Math.min(1,1+L.ps);
    if(!F){L.z1=0;L.z2=0;
     for(let k=0;k<n;k++){g+=(target-g)*this.ramp;const s=b[p]*g;out[k]+=s*gl;if(outR)outR[k]+=s*gr;if(++p===len)p=0}}
    else{let z1=L.z1,z2=L.z2;const{hp,k:kq,a1,a2,a3}=F;
     for(let k=0;k<n;k++){g+=(target-g)*this.ramp;const x=b[p]*g;
      const v3=x-z2,v1=a1*z1+a2*v3,v2=z2+a2*z1+a3*v3;z1=2*v1-z1;z2=2*v2-z2;
      const s=hp?x-kq*v1-v2:v2;out[k]+=s*gl;if(outR)outR[k]+=s*gr;if(++p===len)p=0}
     L.z1=z1;L.z2=z2}}
   L.g=g;
   if(L.dub){const x=ins[L.dub.bus];if(x){let p=this.mod(F0-L.dub.comp-L.t0,len);for(let k=0;k<n;k++){b[p]+=x[k];if(++p===len)p=0}}
    if(peakNow)this.peaks(i)}
   if(L.tails.length){L.tails=L.tails.filter(T=>{const x=ins[T.bus];
     if(x){let p=this.mod(F0-T.comp-L.t0,len);const span=T.until-T.from;
      for(let k=0;k<n;k++){const f=F0+k;if(f>=T.from&&f<T.until){const w=1-(f-T.from)/span;b[p]+=x[k]*w*w}if(++p===len)p=0}}
     if(F1>=T.until){this.peaks(i);return false}return true})}
  }
 }
}
