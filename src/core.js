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
  this.WD=Math.round(sr*.012);this.WM=1;while(this.WM<=this.WD)this.WM*=2;this.WM--; // apertura stereo: ritardo di 12 ms, maschera dell'anello
  this.XF=Math.round(sr*.006); // dissolvenza quando un loop cambia contenuto (swap)
  this.vs=new Float32Array(4096);this.RC=1/(.12*sr); // lettura a velocità variabile; inerzia della velocità: 0,12 s, come un piatto
  this.vq=new Float64Array(4096);this.gn=new Float32Array(4096); // posizioni lette in vsRead (la sovraincisione scrive lì), guadagni delle code
  // dove leggeva ogni loop negli ultimi 1024 blocchi (inizio, posizione, velocità): mark lo chiede per una nota già suonata
  this.HM=1023;this.hF=new Float64Array(this.NL*1024);this.hq=new Float64Array(this.NL*1024);this.hr=new Float32Array(this.NL*1024);this.hp=new Int32Array(this.NL);
  this.loops=[];for(let i=0;i<this.NL;i++)this.loops.push(this.fresh());
 }
 // pan: -1 sinistra … 1 destra; fx: filtro sull'uscita del loop, -1 passa-basso … 0 niente … 1 passa-alto.
 // ps/fs sono i valori smussati, z1/z2 gli stati del filtro. ver cresce a ogni modifica del buffer, sv è la versione già salvata.
 // cp: copia per l'annulla della sovraincisione in corso, fatta a pezzi (vedi cpStep)
 // hp: passa-alto del mix automatico in Hz (0 = spento), wid: apertura stereo 0…1; hs/ws smussati, h1/h2 stati, wd anello del ritardo
 // orig: il loop com'era prima di uno swap che lo tiene da parte; xb/xn: buffer di prima e dissolvenza in corso
 // rate: velocità di lettura (1 = normale, manopola 4), rs smussata, ph quanto la lettura è avanti (+) o indietro (−) rispetto alla griglia;
 // home: frame in cui torna sulla griglia, ho e hn: posizione di prima e dissolvenza in corso
 // ct: pezzo ripetuto (comando cut), vedi vsRead
 fresh(){return{ct:null,rate:1,rs:1,ph:0,home:0,ho:0,hn:0,orig:null,xb:null,xn:0,buf:null,len:0,t0:0,g:0,gt:0,vol:.8,pan:0,fx:0,ps:0,fs:0,z1:0,z2:0,hp:0,hs:0,h1:0,h2:0,wid:0,ws:0,wd:null,wp:0,pg:null,ver:0,sv:0,rec:null,dub:null,cp:null,tails:[],pq:[],undo:[],redo:[]}}
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
  this.msgs.push({type:"peaks",i,peaks:p,ver:L.ver})} // ver: la batteria rilegge i loop cambiati
 state(i){const L=this.loops[i];this.msgs.push({type:"state",i,has:!!L.buf,len:L.len,t0:L.t0,undo:L.undo.length,redo:L.redo.length});this.peaks(i)}
 exec(c,F0){const L=c.i!=null?this.loops[c.i]:null;
  switch(c.type){
   case "reset":this.loops=this.loops.map(o=>{const n=this.fresh();n.vol=o.vol;n.pan=n.ps=o.pan;n.fx=n.fs=o.fx;n.hp=n.hs=o.hp;n.wid=n.ws=o.wid;n.wd=o.wd;return n});break;
   // salvataggio sessione: "dump" manda copie dei loop cambiati dall'ultimo salvataggio (all: tutti; exp: per l'export,
   // non conta come salvato), copiate a pezzi da dumpStep; "load" rimette un loop salvato
   // only: solo quel loop; tag torna nel messaggio (la batteria lo usa per farsi dare la parte suonata)
   case "dump":this.dumps.push({exp:!!c.exp,tag:c.tag||null,q:this.loops.map((o,j)=>o.buf&&(c.all||o.ver!==o.sv)&&(c.only==null||c.only===j)?j:-1).filter(j=>j>=0),items:[],cur:null});break;
   case "load":L.buf=new Float32Array(c.data);L.len=c.len;L.t0=c.t0;L.vol=c.vol;L.pan=L.ps=c.pan;L.fx=L.fs=c.fx;L.hp=L.hs=c.hp||0;this.setWid(L,c.wid||0);L.ws=L.wid;L.undo=[];L.redo=[];L.cp=null;L.g=0;L.gt=0;L.ver++;L.sv=L.ver;this.state(c.i);break;
   // ch: pezzi da CH campioni, creati man mano (niente copie quando la registrazione si allunga)
   case "rec":L.rec={bus:c.bus,start:c.start,comp:c.comp||0,have:Math.max(c.start,F0-this.RL+1),ch:[],end:null,len:0,t0:0};break;
   // buf (facoltativo): buffer azzerato per il loop finito, preparato dal thread principale (vedi freshBuf in app.js)
   case "recEnd":if(L.rec){L.rec.end=c.end;L.rec.len=c.len;L.rec.t0=c.t0;L.rec.buf=c.buf}break;
   case "cancelRec":L.rec=null;break;
   case "dub":if(L.buf){this.cpDone(L);const s={buf:c.buf&&c.buf.length===L.len?c.buf:new Float32Array(L.len),len:L.len,t0:L.t0};this.push(L,s);
    // la copia parte poco prima di dove il loop legge, che a velocità diversa da 1 non è la griglia: lì scrive la sovraincisione
    L.cp={dst:s.buf,p:Math.floor(this.mod(F0-(c.comp||0)-L.t0+L.ph-4096,L.len)),left:L.len};L.dub={bus:c.bus,comp:c.comp||0,wq:null,wx:0}}break;
   case "undub":if(L.dub){L.tails.push(this.tail(L.dub,F0));L.dub=null;this.state(c.i)}break;
   // note quantizzate: "fill" riempie un loop appena registrato, "pend" aggiunge una nota
   // di sovraincisione che diventa udibile solo quando la testina la raggiunge nel giro dopo
   case "fill":if(L.rec)L.rec.fill=c.data;else if(L.buf&&c.data.length===L.len){this.cpDone(L);const b=L.buf;for(let j=0;j<b.length;j++)b[j]+=c.data[j];L.ver++;this.peaks(c.i)}break;
   case "pend":if(L.buf)L.pq.push(c);break;
   case "gate":L.pg={on:c.on,frame:c.frame};break;
   case "vol":L.vol=c.v;break;
   case "pan":L.pan=Math.max(-1,Math.min(1,c.v));break;
   case "fx":L.fx=Math.max(-1,Math.min(1,c.v));break;
   case "hp":L.hp=Math.max(0,Math.min(2000,c.v));break;
   case "wid":this.setWid(L,c.v);break;
   case "rate":L.rate=c.v;L.home=c.home||0;break;
   // dove leggeva il loop al frame di una nota (già suonata, o in questo blocco) e a che velocità: la nota quantizzata della
   // sovraincisione va in quel punto del buffer (app.js, commitDubNote). q null: troppo vecchia, vale la griglia
   case "mark":{let q=null,r=1;
    if(L.buf){if(c.frame>=F0){q=this.mod(F0-L.t0+L.ph+(c.frame-F0)*L.rs,L.len);r=L.rs}
     else{const o=c.i*(this.HM+1);let h=this.hp[c.i];
      for(let k=0;k<=this.HM;k++,h=(h-1)&this.HM){const F=this.hF[o+h];if(F<=c.frame-4096)break;
       if(F<=c.frame){q=this.mod(this.hq[o+h]+(c.frame-F)*this.hr[o+h],L.len);r=this.hr[o+h];break}}}}
    this.msgs.push({type:"mark",i:c.i,id:c.id,q,r});break}
   // pezzo ripetuto: s e p in frame della griglia (IN e lunghezza); da s+p il loop ripete [s, s+p). end: frame in cui
   // torna a leggere normalmente (la griglia ha continuato a contare, quindi è subito a tempo)
   case "cut":if(c.p>0)L.ct={s:c.s,p:c.p,end:Infinity,on:false};else if(L.ct)L.ct.end=c.end??F0;break;
   case "shift":for(const o of this.loops){o.t0+=c.delta;if(o.ct){o.ct.s+=c.delta;o.ct.end+=c.delta}for(const s of o.undo)s.t0+=c.delta;for(const s of o.redo)s.t0+=c.delta}break;
   // batteria (app.js): il loop suona un altro contenuto da frame, con una dissolvenza di XF. keep tiene da parte quello
   // di prima (orig) la prima volta; data null rimette orig. La lunghezza può cambiare (una batteria di 4 battute su un giro di 1)
   case "swap":{if(!L.buf)break;this.cpDone(L);let nb=c.data,len=nb?nb.length:0;
    if(nb){if(c.keep&&!L.orig)L.orig={buf:L.buf,len:L.len}}else if(L.orig){nb=L.orig.buf;len=L.orig.len;L.orig=null}else break;
    L.xb=L.buf;L.xn=this.XF;L.buf=nb;L.len=len;L.ver++;this.state(c.i);break}
   case "clear":L.ct=null;L.ph=0;L.rs=L.rate;L.orig=null;this.cpDone(L);if(L.buf)this.push(L,this.snap(L));L.redo=[];L.pq=[];L.buf=null;L.dub=null;L.rec=null;L.tails=[];L.g=0;L.gt=0;L.pg=null;L.ver++;this.state(c.i);break;
   case "undo":case "redo":{
    this.cpDone(L);L.orig=null;L.dub=null;L.tails=[];L.pq=[];const from=c.type==="undo"?L.undo:L.redo,to=c.type==="undo"?L.redo:L.undo;
    if(from.length){to.push(this.snap(L));const s=from.pop();L.buf=s.buf;L.len=s.len;L.t0=s.t0;L.ver++}
    this.state(c.i);break}
  }}
 // grid: coda di una registrazione, scritta sulla griglia come la registrazione; quella di una sovraincisione continua dove scriveva
 tail(src,F,grid){return{bus:src.bus,comp:src.comp,from:F,until:F+this.TAIL,grid:!!grid,wq:src.wq??null,wx:src.wx||0}}
 // sovraincisione a nastro: col loop a velocità diversa da 1 (o fuori griglia, prima di tornarci) il campione k va dove il loop sta
 // leggendo (vq), e l'ingresso si ricampiona (interpolazione lineare fra un campione e l'altro). Tornando a 1 la parte suonata resta
 // a tempo col loop, più acuta e veloce se suonata sul loop rallentato. A nastro fermo non si scrive niente. W (la sovraincisione o
 // la coda) tiene l'ultimo punto scritto, wq e wx, fra un blocco e l'altro; gn: guadagni per campione (code), cr: compensazione in campioni del buffer
 tapeW(W,b,len,x,n,gn,cr){const vq=this.vq;let pq=W.wq,px=W.wx;
  for(let k=0;k<n;k++){let q=vq[k]-cr;if(q<0)q+=len;const v=gn?x[k]*gn[k]:x[k];
   if(pq!=null){let d=q-pq;if(d<-len/2)d+=len;
    if(d>0&&d<64){let t=Math.floor(pq)+1-pq,j=Math.floor(pq)+1;if(j>=len)j-=len;
     for(;t<=d;t+=1){b[j]+=px+(v-px)*t/d;if(++j===len)j=0}}
    else if(d!==0){let j=Math.round(q);if(j>=len)j=0;b[j]+=v}} // salto (la lettura torna sulla griglia): niente interpolazione
   pq=q;px=v}
  W.wq=pq;W.wx=px}
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
  L.buf=b;L.len=len;L.t0=R.t0;L.rec=null;L.orig=null;L.ver++;L.pq=[];L.tails=R.fill?[]:[this.tail(R,R.end,true)];
  // il loop appena chiuso parte senza dissolvenza, in continuità con quello che hai appena suonato
  if(L.pg&&L.pg.on&&L.pg.frame<=R.end+256){L.gt=1;L.g=L.vol;L.pg=null}
  this.msgs.push({type:"done",i});this.state(i)}
 // coefficienti del filtro SVF (Zavalishin, TPT) per il valore fx smussato; null = nessun filtro
 filt(fx){const a=Math.abs(fx);if(a<.02)return null;const t=(a-.02)/.98,hp=fx>0;
  const fc=Math.min(hp?20*Math.pow(300,t):20000*Math.pow(150/20000,t),this.sr*.45);
  const g=Math.tan(Math.PI*fc/this.sr),k=1/1.2,a1=1/(1+g*(g+k));return{hp,k,a1,a2:g*a1,a3:g*g*a1}}
 // passa-alto del mix automatico (12 dB/ottava, Butterworth) sul valore smussato; sotto i 20 Hz non serve
 hpf(fc){if(fc<20)return null;const g=Math.tan(Math.PI*Math.min(fc,this.sr*.45)/this.sr),k=Math.SQRT2,a1=1/(1+g*(g+k));return{k,a1,a2:g*a1,a3:g*g*a1}}
 // l'anello del ritardo si crea una volta sola, la prima volta che il loop si apre
 setWid(L,v){L.wid=Math.max(0,Math.min(1,v));if(L.wid>0&&!L.wd)L.wd=new Float32Array(this.WM+1)}
 // legge n campioni a velocità variabile in vs (interpolazione lineare). La griglia non si ferma: ph conta di quanto la lettura
 // se ne è allontanata, e gira anche a loop muto, così tutti i loop restano allineati fra loro. Quasi fermo il suono diventa
 // un valore costante: si abbassa prima. A home si torna sulla griglia con una dissolvenza dalla posizione di prima
 lerp(b,q,len){const i=Math.floor(q),f=q-i,j=i+1===len?0:i+1;return b[i]+(b[j]-b[i])*f}
 vsRead(L,F0,n){if(this.vs.length<n){this.vs=new Float32Array(n);this.vq=new Float64Array(n);this.gn=new Float32Array(n)}
  if(L.home&&L.home<F0+n){L.ho=L.ph;L.hn=this.XF;L.ph=(F0-L.home)*(L.rate-1);L.rs=L.rate;L.home=0} // home sta dentro il blocco: a velocità ≠ 1 la lettura passa da lì
  const o=this.vs,b=L.buf,len=L.len,rt=L.rate,RC=this.RC,base=F0-L.t0,X=this.XF;let r=L.rs,ph=L.ph,q=this.mod(base+ph,len),C=L.ct;
  for(let k=0;k<n;k++){let x;
   // pezzo ripetuto: uscendo si torna alla lettura normale con una dissolvenza dal punto del pezzo in cui si era
   if(C&&F0+k>=C.end){if(C.on){L.ho=C.m+1-base-k;L.hn=X}L.ct=C=null}
   // dalla fine del pezzo (s+p) si legge s + (posizione − (s+p)) mod p. A ogni ripresa dissolvenza dalla continuazione
   // (quello che c'era dopo il pezzo), all'entrata dalla lettura normale: niente clic
   if(C&&F0+k>=C.s+C.p){const d=this.mod(base+k+ph-(C.s+C.p-L.t0),C.p),m=C.s-L.t0+d;
    if(!C.on){C.on=true;if(d>=X){L.ho=ph;L.hn=X}} // entrando proprio a s+p la dissolvenza della ripresa basta
    x=this.lerp(b,this.mod(m,len),len);
    if(d<X){const y=this.lerp(b,this.mod(m+C.p,len),len);x=y+(x-y)*d/X}C.m=m}
   else x=this.lerp(b,q,len);
   if(r<.12)x*=r/.12;
   if(L.hn>0){const w=L.hn--/this.XF;x+=(this.lerp(b,this.mod(base+k+L.ho,len),len)-x)*w}
   o[k]=x;this.vq[k]=q;q+=r;if(q>=len)q-=len;ph+=r-1;r+=(rt-r)*RC}
  L.rs=r;L.ph=ph}
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
   // misura per Orecchio: l'indice (F − t0) mod len torna a 0 in questo blocco. Anche a loop fermo: l'indice è una formula, non si ferma
   {const w=this.mod(L.t0-F0,len);if(w<n)this.msgs.push({type:"wrap",loop:i,ctx:(F0+w)/this.sr,len,t0:L.t0})}
   if(L.cp)this.cpStep(L,Math.max(this.DB,4096+2*n)); // parte 4096 campioni prima della testina: il primo pezzo la supera sempre
   if(L.pq.length){L.pq=L.pq.filter(P=>{if(P.at>=F1)return true;this.cpDone(L);const d=P.data;let p=this.mod(P.start,len);
     for(let k=0;k<d.length;k++){b[p]+=d[k];if(++p===len)p=0}L.ver++;this.peaks(i);return false})}
   L.ps+=(L.pan-L.ps)*sm;L.fs+=(L.fx-L.fs)*sm;L.hs+=(L.hp-L.hs)*sm;L.ws+=(L.wid-L.ws)*sm;
   const VS=L.ct||L.rate!==1||L.rs!==1||L.ph!==0||L.home||L.hn>0;if(VS){this.vsRead(L,F0,n);L.xn=0;L.xb=null}
   {const h=this.hp[i]=(this.hp[i]+1)&this.HM,o=i*(this.HM+1)+h,vq=this.vq;this.hF[o]=F0; // per mark
    if(VS){this.hq[o]=vq[0];this.hr[o]=n>1?this.mod(vq[n-1]-vq[0],len)/(n-1):L.rs}else{this.hq[o]=this.mod(F0-L.t0,len);this.hr[o]=1}}
   const rb=VS?this.vs:b,rl=VS?n:len; // da dove legge: a velocità variabile il blocco è già pronto
   if(g>1e-5||target>0){let p=VS?0:this.mod(F0-L.t0,len);
    const oL=outs?outs[i][0]:out,oR=outs?outs[i][1]:outR;
    const F=this.filt(L.fs),H=this.hpf(L.hs),W=oR&&L.wd&&L.ws>.005?L.ws:0,gl=oR?Math.min(1,1-L.ps):1,gr=Math.min(1,1+L.ps);
    const XB=L.xn>0?L.xb:null,xl=XB?XB.length:0; // swap appena fatto: dissolvenza dal contenuto di prima
    if(!F){L.z1=0;L.z2=0}if(!H){L.h1=0;L.h2=0}
    if(!F&&!H&&!W&&!XB){
     for(let k=0;k<n;k++){g+=(target-g)*this.ramp;const s=rb[p]*g;oL[k]+=s*gl;if(oR)oR[k]+=s*gr;if(++p===rl)p=0}}
    else{let z1=L.z1,z2=L.z2,h1=L.h1,h2=L.h2,wp=L.wp;const kq=F&&F.k,wd=L.wd,M=this.WM,D=this.WD;
     // apertura stereo: a sinistra il suono più la sua copia ritardata, a destra meno la copia. Sommati tornano
     // il suono di partenza (in mono non cambia niente), nw tiene uguale il livello
     const nw=1/Math.sqrt(1+W*W),wl=gl*nw,wr=gr*nw;
     for(let k=0;k<n;k++){g+=(target-g)*this.ramp;let x=rb[p];if(XB&&L.xn>0){const w=L.xn--/this.XF;x+=(XB[p%xl]-x)*w}x*=g;
      if(F){const v3=x-z2,v1=F.a1*z1+F.a2*v3,v2=z2+F.a2*z1+F.a3*v3;z1=2*v1-z1;z2=2*v2-z2;x=F.hp?x-kq*v1-v2:v2}
      if(H){const v3=x-h2,v1=H.a1*h1+H.a2*v3,v2=h2+H.a2*h1+H.a3*v3;h1=2*v1-h1;h2=2*v2-h2;x=x-H.k*v1-v2}
      if(W){const d=wd[(wp-D)&M]*W;wd[wp]=x;wp=(wp+1)&M;oL[k]+=(x+d)*wl;oR[k]+=(x-d)*wr}
      else{oL[k]+=x*gl;if(oR)oR[k]+=x*gr}
      if(++p===rl)p=0}
     L.z1=z1;L.z2=z2;L.h1=h1;L.h2=h2;L.wp=wp;if(L.xn<=0)L.xb=null}}
   L.g=g;
   if(L.dub){const D=L.dub,x=ins[D.bus];
    if(x){if(VS)this.tapeW(D,b,len,x,n,null,D.comp*L.rs);else{D.wq=null;let p=this.mod(F0-D.comp-L.t0,len);for(let k=0;k<n;k++){b[p]+=x[k];if(++p===len)p=0}}L.ver++}
    if(peakNow)this.peaks(i)}
   if(L.tails.length){L.tails=L.tails.filter(T=>{const x=ins[T.bus];
     if(x){const span=T.until-T.from;
      if(VS&&!T.grid){const gn=this.gn;for(let k=0;k<n;k++){const f=F0+k,w=f>=T.from&&f<T.until?1-(f-T.from)/span:0;gn[k]=w*w}this.tapeW(T,b,len,x,n,gn,T.comp*L.rs)}
      else{T.wq=null;let p=this.mod(F0-T.comp-L.t0,len);
       for(let k=0;k<n;k++){const f=F0+k;if(f>=T.from&&f<T.until){const w=1-(f-T.from)/span;b[p]+=x[k]*w*w}if(++p===len)p=0}}L.ver++}
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
  if(!J.cur&&!J.q.length){this.dumps.shift();this.msgs.push({type:"dump",exp:J.exp,tag:J.tag,items:J.items,has:this.loops.map(o=>!!o.buf)})}}
}
