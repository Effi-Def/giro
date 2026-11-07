const fs=require('fs');eval(fs.readFileSync(require('path').join(__dirname,'..','src','core.js'),'utf8')+';global.LoopCore=LoopCore');
const sr=8000,c=new LoopCore(sr);const N=128;let F=0;
const ok=(x,m)=>console.log((x?'OK  ':'FAIL')+' '+m);
const events={0:{},1:{},2:{}};// bus -> frame -> value
let outLog=new Map();
function run(to){while(F<to){const ins=[0,1,2].map(b=>{const a=new Float32Array(N);for(let k=0;k<N;k++){const v=events[b][F+k];if(v)a[k]=v}return a});
 const out=new Float32Array(N);c.process(ins,out,F,N);for(let k=0;k<N;k++)if(Math.abs(out[k])>.05)outLog.set(F+k,+out[k].toFixed(3));F+=N}}
const msgs=()=>{const m=c.msgs;c.msgs=[];return m};
// ripartenze per Orecchio: al frame esatto in cui l'indice torna a 0, anche a loop fermo; il resto del file non le guarda
{const d=new LoopCore(sr);d.exec({type:'load',i:2,data:new Float32Array(1000),len:1000,t0:250,vol:.8,pan:0,fx:0},0);d.msgs=[];
 const o=new Float32Array(N),none=[null,null,null];for(let f=0;f<3200;f+=N)d.process(none,o,f,N);
 const w=d.msgs.filter(m=>m.type==='wrap');
 ok(w.length===3&&w.every((m,k)=>m.loop===2&&m.ctx===(250+k*1000)/sr),'ripartenze: frame esatti, anche a loop fermo ('+w.map(m=>m.ctx*sr).join(' ')+')')}
// 1. primo loop: impulso a 1000, rec 1000..5000
events[0][1000]=1;
run(1024);c.cmd({type:'rec',i:0,bus:0,start:1000,comp:0});run(3000);
c.cmd({type:'recEnd',i:0,end:5000,len:4000,t0:1000});c.cmd({type:'gate',i:0,on:1,frame:5000});
events[0][5100]=.5; // coda: suona dopo la chiusura sullo stesso bus
run(14000);
const L0=c.loops[0];
ok(L0.len===4000&&Math.abs(L0.buf[0]-1)<1e-6,'impulso registrato a indice 0');
ok(Math.abs(L0.buf[100]-.5*Math.pow(1-100/c.TAIL,2))<1e-3,'coda catturata e piegata a indice 100: '+L0.buf[100].toFixed(3));
const hits=[...outLog.keys()].filter(f=>outLog.get(f)>.5);
ok(hits.slice(0,3).join()==='5000,9000,13000','il loop riparte ogni 4000 frame: '+hits.slice(0,3).join());
// 2. secondo loop con compensazione 100, impulso a 14100, 2 giri
outLog.clear();events[1][14100]=1;
c.cmd({type:'rec',i:1,bus:1,start:14000,comp:100});run(17000);
// chiusura anticipata: main calcola len=8000 (k=2) end = 22000
c.cmd({type:'recEnd',i:1,end:22000,len:8000,t0:14000});c.cmd({type:'gate',i:1,on:1,frame:22000});
run(21000);ok(c.loops[1].rec&&!c.loops[1].buf,'registrazione continua fino al confine');
run(40000);
const L1=c.loops[1];ok(L1.len===8000&&Math.abs(L1.buf[0]-1)<1e-6,'secondo loop: impulso a indice 0 (compensato di 100)');
const h1=[...outLog.keys()].filter(f=>Math.abs(outLog.get(f)-.8)<.05&&f%4000!==1000&&f>22000);
ok(h1.includes(30000)&&h1.includes(38000),'secondo loop suona 100 frame prima, ogni 8000: '+h1.slice(0,3).join());
// 3. sovraincisione sul loop 0 e annulla
events[2][41500]=1; // indice (41500-0-1000)%4000=1500
c.cmd({type:'dub',i:0,bus:2,comp:0});run(43000);c.cmd({type:'undub',i:0});run(45000);
ok(Math.abs(c.loops[0].buf[500]-1)<1e-6,'sovraincisione scritta a indice 500');
c.cmd({type:'undo',i:0});run(45200);
ok(Math.abs(c.loops[0].buf[500])<1e-6&&Math.abs(c.loops[0].buf[0]-1)<1e-6,'annulla toglie solo la sovraincisione');
c.cmd({type:'redo',i:0});run(45400);ok(Math.abs(c.loops[0].buf[500]-1)<1e-6,'ripeti la rimette');
// 4. gate e volume
outLog.clear();c.cmd({type:'gate',i:1,on:0,frame:45400});c.cmd({type:'gate',i:0,on:0,frame:45400});run(50000);
ok([...outLog.keys()].filter(f=>f>46000).length===0,'stop: silenzio dopo il gate');
// 5. clear + undo ripristina
c.cmd({type:'clear',i:1});run(50200);ok(!c.loops[1].buf,'cancella');c.cmd({type:'undo',i:1});run(50400);ok(c.loops[1].buf&&c.loops[1].len===8000,'annulla dopo cancella ripristina');
// 6. shift
const t0=c.loops[0].t0;c.cmd({type:'shift',delta:500});run(50600);ok(c.loops[0].t0===t0+500,'shift');
// 7. registrazione con più materiale del necessario (chiusura arrotondata per difetto): ripiega
events[0][60000]=1;events[0][60000+4000+300]=.25;
c.cmd({type:'rec',i:2,bus:0,start:60000,comp:0});run(64600);
c.cmd({type:'recEnd',i:2,end:64600,len:4000,t0:60000});run(70000);
const L2=c.loops[2];ok(Math.abs(L2.buf[0]-1)<1e-6&&Math.abs(L2.buf[300]-.25)<1e-6,'eccedenza ripiegata sull\'inizio');
console.log('messaggi',msgs().map(m=>m.type).join(','));
// pan e filtro: uscita stereo con un loop di sinusoide a 2 kHz
{const c2=new LoopCore(8000),len=800,buf=new Float32Array(len);for(let j=0;j<len;j++)buf[j]=Math.sin(2*Math.PI*j/4);
 const L=c2.loops[0];Object.assign(L,{buf,len,t0:0,gt:1,g:L.vol});let F2=0;
 const run2=(frames)=>{let el=0,er=0;const ins=[null,null,null];
  for(let f=0;f<frames;f+=N){const l=new Float32Array(N),r=new Float32Array(N);c2.process(ins,l,F2,N,r);F2+=N;
   if(f>=frames-1024)for(let k=0;k<N;k++){el+=l[k]*l[k];er+=r[k]*r[k]}}return[el,er]};
 const [l0,r0]=run2(4096);ok(Math.abs(l0-r0)<1e-6*l0&&l0>1,'stereo al centro: sinistra e destra uguali');
 c2.cmd({type:'pan',i:0,v:-1});const [l1,r1]=run2(4096);ok(r1<1e-6*l1&&Math.abs(l1-l0)<.01*l0,'pan tutto a sinistra: destra muta, sinistra intatta');
 c2.cmd({type:'pan',i:0,v:0});c2.cmd({type:'fx',i:0,v:-1});const [l2]=run2(8192);ok(l2<.01*l0,'filtro passa-basso: 2 kHz quasi spenti ('+(l2/l0).toExponential(1)+')');
 c2.cmd({type:'fx',i:0,v:0});const [l3]=run2(8192);ok(Math.abs(l3-l0)<.01*l0,'filtro al centro: suono intatto');
 c2.cmd({type:'fx',i:0,v:.5});c2.cmd({type:'reset'});run2(N);ok(c2.loops[0].fx===.5&&c2.loops[0].vol===.8,'reset conserva volume, pan e filtro')}
// sessione: dump copia i buffer pieni a pezzi, load li rimette (anche in un core nuovo)
const join=it=>{const d=new Float32Array(it.len);let o=0;for(const ch of it.chunks){d.set(ch,o);o+=ch.length}it.data=d;return it};
{const d=new LoopCore(sr);c.msgs=[];c.DB=1000;c.cmd({type:'dump',all:true,exp:true});run(F+N);
 ok(!msgs().some(m=>m.type==='dump'),'dump: un loop lungo non si copia in un blocco solo');
 run(F+N*80);const dm=msgs().find(m=>m.type==='dump');dm.items.forEach(join);
 ok(dm&&dm.items.length>=1&&dm.items[0].data.length===dm.items[0].len&&dm.items[0].chunks.every(ch=>ch.length<=1000)&&dm.has[dm.items[0].i],'dump: copia dei loop pieni, a pezzi');
 const full=dm.items.length;c.cmd({type:'dump'});run(F+N*80);const d1=msgs().find(m=>m.type==='dump');
 c.cmd({type:'dump'});run(F+N*80);const d2=msgs().find(m=>m.type==='dump');
 c.loops[dm.items[0].i].ver++;c.cmd({type:'dump'});run(F+N*80);const d3=msgs().find(m=>m.type==='dump');c.DB=65536;
 ok(full>=2&&d1.items.length===full&&d2.items.length===0&&d3.items.length===1&&d3.items[0].i===dm.items[0].i,"dump: solo i loop cambiati dall'ultimo salvataggio");
 const it=dm.items[0];d.cmd({type:'load',i:it.i,data:it.data,len:it.len,t0:it.t0,vol:.5,pan:-.3,fx:.2});d.process([null,null,null],new Float32Array(N),0,N);
 const L=d.loops[it.i];ok(L.buf&&L.len===it.len&&L.t0===it.t0&&L.vol===.5&&L.pan===-.3&&L.buf[0]===it.data[0],'load: loop ripristinato con volume, pan e filtro');
 it.data[0]=99;ok(c.loops[it.i].buf[0]!==99,'dump: è una copia, non il buffer vivo')}
// registrazione a pezzi piccoli (CH=700): impulsi a cavallo dei pezzi e eccedenza ripiegata
{const r=new LoopCore(sr);r.CH=700;const ev={};let Fr=0;
 const go=to=>{while(Fr<to){const a=new Float32Array(N);for(let k=0;k<N;k++)a[k]=ev[Fr+k]||0;r.process([a,null,null],new Float32Array(N),Fr,N);Fr+=N}};
 const at={1000:1,1699:.3,1700:.6,2400:.2,3999:.7,4250:.4};for(const f in at)ev[f]=at[f];
 go(1024);r.cmd({type:'rec',i:0,bus:0,start:1000,comp:0});go(3000);r.cmd({type:'recEnd',i:0,end:4400,len:3000,t0:1000});go(5000);
 const b=r.loops[0].buf,want={0:1,699:.3,700:.6,1400:.2,2999:.7,250:.4};
 ok(b&&b.length===3000&&Object.entries(want).every(([j,v])=>Math.abs(b[j]-v)<1e-6)&&b.reduce((s,x)=>s+Math.abs(x),0)-3.2<1e-5,'registrazione a pezzi: campioni al posto giusto, eccedenza ripiegata')}
// copia per l'annulla fatta a pezzi (DB piccolo): mentre si sovraincide, annulla torna esattamente al loop di prima
{const r=new LoopCore(sr),len=5000,d=new Float32Array(len);for(let j=0;j<len;j++)d[j]=Math.sin(j*.37);
 r.cmd({type:'load',i:0,data:d.slice(),len,t0:0,vol:1,pan:0,fx:0});r.cmd({type:'gate',i:0,on:1,frame:0});r.DB=300;let Fr=0;
 const go=(to,x)=>{while(Fr<to){const a=new Float32Array(N).fill(x||0);r.process([a,null,null],new Float32Array(N),Fr,N);Fr+=N}};
 go(1280);r.cmd({type:'dub',i:0,bus:0,comp:0});go(1280+N,.5);
 ok(r.loops[0].cp&&r.loops[0].cp.left>0,'sovraincisione: la copia per l\'annulla non si fa in un blocco solo');
 go(4000,.5);r.cmd({type:'pend',i:0,start:3000,data:new Float32Array(400).fill(.25),at:Fr});go(4400,.5);
 r.cmd({type:'undub',i:0});go(9000);ok(!r.loops[0].cp,'copia finita');
 const changed=r.loops[0].buf.some((x,j)=>Math.abs(x-d[j])>1e-3);r.cmd({type:'undo',i:0});go(9000+N);
 ok(changed&&r.loops[0].buf.every((x,j)=>x===d[j]),'annulla dopo una sovraincisione copiata a pezzi: loop identico a prima');
 r.cmd({type:'dub',i:0,bus:0,comp:0});go(9000+2*N,.5);r.cmd({type:'undo',i:0});go(9000+3*N);
 ok(r.loops[0].buf.every((x,j)=>x===d[j]),'annulla subito dopo l\'inizio (copia non finita): loop identico a prima')}
// strati di annulla: ne restano al massimo UNDO
{const r=new LoopCore(sr);r.cmd({type:'load',i:0,data:new Float32Array(1000),len:1000,t0:0,vol:1,pan:0,fx:0});
 for(let k=0;k<14;k++){r.cmd({type:'dub',i:0,bus:0,comp:0});r.cmd({type:'undub',i:0})}r.process([null,null,null],new Float32Array(N),0,N);
 ok(r.loops[0].undo.length===r.UNDO,'annulla: tenuti gli ultimi '+r.UNDO+' strati ('+r.loops[0].undo.length+')')}
// uscite separate: ogni loop esce sulla sua coppia di canali, l'uscita principale resta muta
{const r=new LoopCore(sr),len=1000,d=new Float32Array(len).fill(.5);
 for(const i of [0,1])r.cmd({type:'load',i,data:d.slice(),len,t0:0,vol:i?1:.5,pan:0,fx:0});
 r.cmd({type:'gate',i:0,on:1,frame:0});r.cmd({type:'gate',i:1,on:1,frame:0});
 const outs=Array.from({length:8},()=>[new Float32Array(N),new Float32Array(N)]),o=new Float32Array(N),oR=new Float32Array(N);
 for(let b=0;b<40;b++)r.process([null,null,null],o,b*N,N,oR,outs);
 ok(Math.abs(outs[0][0][5]-.25)<1e-3&&Math.abs(outs[1][1][5]-.5)<1e-3&&outs[2][0].every(x=>x===0)&&o.every(x=>x===0),'uscite separate per loop')}
// mix automatico: passa-alto per loop (toglie i bassi, lascia passare gli acuti) e apertura stereo (in mono non cambia niente)
{const r=new LoopCore(sr),len=4000,lo=new Float32Array(len),hi=new Float32Array(len);
 for(let j=0;j<len;j++){lo[j]=.5*Math.sin(2*Math.PI*40*j/sr);hi[j]=.5*Math.sin(2*Math.PI*2000*j/sr)}
 r.cmd({type:'load',i:0,data:lo,len,t0:0,vol:1,pan:0,fx:0,hp:300});r.cmd({type:'load',i:1,data:hi,len,t0:0,vol:1,pan:0,fx:0,hp:300});
 r.cmd({type:'gate',i:0,on:1,frame:0});r.cmd({type:'gate',i:1,on:1,frame:0});
 const outs=Array.from({length:8},()=>[new Float32Array(N),new Float32Array(N)]),o=new Float32Array(N),oR=new Float32Array(N);let e0=0,e1=0;
 for(let b=0;b<60;b++){r.process([null,null,null],o,b*N,N,oR,outs);if(b>=30)for(let k=0;k<N;k++){e0+=outs[0][0][k]**2;e1+=outs[1][0][k]**2}}
 const ref=.125*30*N; // energia di un seno da 0,5 non filtrato
 ok(e0/ref<.05&&e1/ref>.9,'passa-alto a 300 Hz: 40 Hz quasi spento ('+(e0/ref).toFixed(3)+'), 2 kHz intatto ('+(e1/ref).toFixed(3)+')')}
{const r=new LoopCore(sr),len=4000,d=new Float32Array(len);for(let j=0;j<len;j++)d[j]=Math.sin(j*.37)*Math.sin(j*.011);
 r.cmd({type:'load',i:0,data:d,len,t0:0,vol:1,pan:0,fx:0,wid:.6});r.cmd({type:'gate',i:0,on:1,frame:0});
 const o=new Float32Array(N),oR=new Float32Array(N);let side=0,mid=0,err=0;const w=1/Math.sqrt(1+.36);
 for(let b=0;b<60;b++){r.process([null,null,null],o,b*N,N,oR);if(b>=30)for(let k=0;k<N;k++){const x=d[(b*N+k)%len];side+=(o[k]-oR[k])**2;mid+=(o[k]+oR[k])**2;err=Math.max(err,Math.abs((o[k]+oR[k])/2-x*w))}}
 ok(side/mid>.1&&err<1e-4,'apertura stereo: sinistra e destra diverse (laterale/centro '+(side/mid).toFixed(2)+'), sommate tornano il loop ('+err.toExponential(1)+')');
 r.cmd({type:'reset'});r.process([null,null,null],o,0,N,oR);ok(r.loops[0].wid===.6,'reset conserva l\'apertura stereo')}
// swap (batteria): il loop suona un altro contenuto da un frame preciso, con dissolvenza; keep tiene l'originale per rimetterlo
{const r=new LoopCore(sr),len=4000,d=new Float32Array(len).fill(.2),e=new Float32Array(2*len).fill(.6);
 r.cmd({type:'load',i:0,data:d,len,t0:0,vol:1,pan:0,fx:0});r.cmd({type:'gate',i:0,on:1,frame:0});
 const o=new Float32Array(N),out=[];const go=c=>{const end=out.length+c;while(out.length<end){r.process([null,null,null],o,out.length,N);out.push(...o)}};
 go(2048);r.cmd({type:'swap',i:0,data:e,keep:true,frame:4096});go(2048*3);
 const xf=r.XF;let mono=true;for(let j=4096;j<4096+xf+N;j++)if(out[j+1]<out[j]-1e-6)mono=false;
 ok(Math.abs(out[4000]-.2)<1e-6&&Math.abs(out[4096+xf+200]-.6)<1e-6&&mono&&r.loops[0].len===8000,'swap: dal frame giusto, dissolvenza senza salti, lunghezza nuova ('+r.loops[0].len+')');
 r.cmd({type:'swap',i:0,data:null,frame:out.length});go(2048);
 ok(r.loops[0].buf[5]===d[5]&&r.loops[0].len===4000&&!r.loops[0].orig&&Math.abs(out[out.length-1]-.2)<1e-6,'swap con data null: torna il loop di prima');
 r.cmd({type:'swap',i:0,data:e});go(N);r.cmd({type:'undo',i:0});go(N);ok(!r.loops[0].orig,'swap senza keep e annulla: niente originale tenuto')}
// velocità (manopola 4): lettura più lenta o più veloce, griglia che non si ferma, ritorno preciso su un frame
{const len=4000,d=new Float32Array(len);for(let j=0;j<len;j++)d[j]=Math.sin(2*Math.PI*20*j/len); // 40 Hz a sr 8000
 const mk=()=>{const r=new LoopCore(sr);r.cmd({type:'load',i:0,data:d,len,t0:0,vol:1,pan:0,fx:0});r.cmd({type:'gate',i:0,on:1,frame:0});return r};
 const go=(r,F0,bl)=>{const o=new Float32Array(N),x=[];for(let b=0;b<bl;b++){r.process([null,null,null],o,F0+b*N,N);x.push(...o)}return x};
 const hz=x=>{let c=0;for(let j=1;j<x.length;j++)if(x[j-1]<0&&x[j]>=0)c++;return c*sr/x.length};
 let r=mk();go(r,0,8);r.cmd({type:'rate',i:0,v:.5});go(r,8*N,60);ok(Math.abs(hz(go(r,68*N,60))-20)<1.5,'velocità 0,5: un\'ottava sotto');
 r=mk();go(r,0,8);r.cmd({type:'rate',i:0,v:2});go(r,8*N,60);ok(Math.abs(hz(go(r,68*N,60))-80)<1.5,'velocità 2: un\'ottava sopra');
 r=mk();go(r,0,8);r.cmd({type:'rate',i:0,v:0});go(r,8*N,80);ok(Math.max(...go(r,88*N,10).map(Math.abs))<.002,'velocità 0: fermo e in silenzio');
 // a home torna identico alla griglia, sia da più lento sia da più veloce
 for(const v of[.5,2]){r=mk();go(r,0,8);r.cmd({type:'rate',i:0,v});go(r,8*N,50);r.cmd({type:'rate',i:0,v:1,home:78*N});go(r,58*N,40);const x=go(r,98*N,10);let e=0;
  for(let k=0;k<x.length;k++)e=Math.max(e,Math.abs(x[k]-d[(98*N+k)%len]));ok(e<1e-4&&r.loops[0].ph===0,'velocità '+v+' e ritorno: di nuovo sulla griglia ('+e.toExponential(1)+')')}
 // al doppio e a metà, con home: dopo la rampa la lettura riparte dal punto della griglia e resta a tempo
 for(const v of[.5,2]){const H=58*N+37;r=mk();go(r,0,8);r.cmd({type:'rate',i:0,v:1.37});go(r,8*N,30);r.cmd({type:'rate',i:0,v,home:H});go(r,38*N,30);const F=68*N,x=go(r,F,20);let e=0;
  for(let k=0;k<x.length;k++){const q=(H+(F+k-H)*v)%len,i=Math.floor(q),j=(i+1)%len;e=Math.max(e,Math.abs(x[k]-(d[i]+(d[j]-d[i])*(q-i))))}
  ok(e<1e-4,'velocità '+v+' con home: dopo la rampa agganciata alla griglia ('+e.toExponential(1)+')')}
 // un loop muto resta allineato a uno che suona; a velocità normale nessuno scarto
 r=mk();r.cmd({type:'load',i:1,data:d,len,t0:0,vol:1,pan:0,fx:0});go(r,0,8);r.cmd({type:'rate',i:0,v:1.5});r.cmd({type:'rate',i:1,v:1.5});go(r,8*N,50);ok(r.loops[0].ph===r.loops[1].ph&&r.loops[0].ph>0,'loop muto e loop che suona restano allineati');
 r=mk();go(r,0,8);ok(!r.loops[0].ph&&r.loops[0].rs===1,'a velocità normale nessuno scarto')}
// pezzo ripetuto (IN/OUT): da s+p il loop ripete [s, s+p) sulla griglia, con dissolvenze; all'uscita torna subito a tempo
{const len=4000,d=new Float32Array(len);for(let j=0;j<len;j++)d[j]=.1+.8*j/len; // ogni indice ha il suo valore
 const mk=()=>{const r=new LoopCore(sr);r.cmd({type:'load',i:0,data:d,len,t0:0,vol:1,pan:0,fx:0});r.cmd({type:'gate',i:0,on:1,frame:0});return r};
 const go=(r,F0,to,o=[])=>{const b=new Float32Array(N);for(let F=F0;F<to;F+=N){r.process([null,null,null],b,F,N);o.push(...b)}return o};
 const X=new LoopCore(sr).XF,err=(x,F0,want)=>{let e=0;for(let k=0;k<x.length;k++){const w=want(F0+k);if(w!=null)e=Math.max(e,Math.abs(x[k]-w))}return e};
 const inPiece=(F,s,p)=>{const q=(F-s-p)%p;return q<X+2?null:d[(s+q)%len]};
 let r=mk(),x=go(r,0,1024);r.cmd({type:'cut',i:0,s:1000,p:500});x=go(r,1024,4992,x);
 let e1=err(x.slice(800,1500),800,F=>d[F%len]),e2=err(x.slice(1500),1500,F=>inPiece(F,1000,500)),jump=0;
 for(let k=300;k<x.length;k++)jump=Math.max(jump,Math.abs(x[k]-x[k-1]));
 ok(e1<1e-6&&e2<1e-6,'pezzo: prima di OUT normale, poi ripete [1000, 1500) ('+e2.toExponential(1)+')');
 ok(jump<.8*500/len/X*1.2+.001,'pezzo: niente salti alle riprese (passo massimo '+jump.toFixed(4)+')');
 r.cmd({type:'cut',i:0,end:5100});x=go(r,4992,6016);
 ok(err(x,4992,F=>F<5100?inPiece(F,1000,500):F>=5100+X?d[F%len]:null)<1e-6&&!r.loops[0].ct,'pezzo: all\'uscita di nuovo sulla griglia');
 // OUT arrivato in ritardo (s+p già passato): entra subito, dal punto del pezzo dove sarebbe stato, con dissolvenza
 r=mk();go(r,0,2048);r.cmd({type:'cut',i:0,s:1000,p:500});x=go(r,2048,3072);jump=0;for(let k=1;k<x.length;k++)jump=Math.max(jump,Math.abs(x[k]-x[k-1]));
 ok(err(x,2048,F=>F>=2048+X?inPiece(F,1000,500):null)<1e-6&&jump<.2/X*1.5,'pezzo: OUT in ritardo entra senza salti');
 r.cmd({type:'clear',i:0});go(r,3072,3200);ok(!r.loops[0].ct,'cancella toglie il pezzo')}
// sovraincisione a nastro: a velocità 0,8 e 1,25 l'ingresso va dove il loop sta leggendo, ricampionato; mark dice dove leggeva
{const len=8000,z=new Float32Array(len),sig=F=>Math.sin(2*Math.PI*3*F/sr);
 for(const v of[.8,1.25]){const r=new LoopCore(sr);r.cmd({type:'load',i:0,data:z,len,t0:0,vol:1,pan:0,fx:0});r.cmd({type:'gate',i:0,on:1,frame:0});
  const o=new Float32Array(N),inp=new Float32Array(N),marks=[];let F=0;
  const go=(bl,feed)=>{for(let b=0;b<bl;b++,F+=N){for(let k=0;k<N;k++)inp[k]=feed?sig(F+k):0;r.process([inp,null,null],o,F,N);marks.push(...r.msgs.filter(m=>m.type==='mark'));r.msgs=[]}};
  r.cmd({type:'rate',i:0,v});go(80); // velocità assestata
  const A=F+5;r.cmd({type:'mark',i:0,frame:A,id:1});r.cmd({type:'dub',i:0,bus:0});go(30,true);
  const qa=marks[0].q,b=r.loops[0].buf;let e=0,cnt=0;
  for(let p=Math.ceil(qa)+5;p<qa+29*N*v;p++){const Fp=A+(p-qa)/v;e=Math.max(e,Math.abs(b[p%len]-sig(Fp)));cnt++}
  ok(Math.abs(marks[0].r-v)<1e-3&&cnt>2000&&e<2e-3,'nastro a '+v+': ogni campione dove il loop leggeva quando l\'hai suonato (scarto '+e.toExponential(1)+')');
  const B=F-1000;r.cmd({type:'mark',i:0,frame:B,id:2});go(1);const qb=marks[1].q,want=(qa+(B-A)*v)%len;
  ok(Math.abs(qb-want)<.05,'mark su un frame già passato: dalla storia ('+(qb-want).toFixed(4)+' campioni)');
  r.cmd({type:'undo',i:0});go(1);ok(r.loops[0].buf.every(x=>x===0),'nastro a '+v+': annulla toglie tutta la sovraincisione')}
 // a velocità normale la sovraincisione resta quella di sempre (sulla griglia)
 const r=new LoopCore(sr);r.cmd({type:'load',i:0,data:z,len,t0:0,vol:1,pan:0,fx:0});const o=new Float32Array(N),inp=new Float32Array(N);inp[7]=1;
 r.process([null,null,null],o,0,N);r.cmd({type:'dub',i:0,bus:0});r.process([inp,null,null],o,N,N);ok(r.loops[0].buf[N+7]===1&&r.loops[0].dub.wq===null,'a velocità normale: sulla griglia, campione per campione')}
// cambio di tempo: da frame X il loop suona la versione nuova dallo stesso punto del giro (p → p·len'/len), con dissolvenza;
// i frame già fissati dopo X si stirano; se il loop è cambiato dopo la copia (ver) o si registra, non cambia niente
{const len=4000,d=new Float32Array(len);for(let j=0;j<len;j++)d[j]=j/len; // rampa: il valore dice dove legge
 const mk=()=>{const r=new LoopCore(sr);r.exec({type:'load',i:0,data:d,len,t0:500,vol:1,pan:0,fx:0},0);const L=r.loops[0];L.g=1;L.gt=1;r.msgs=[];return r};
 const go=(r,F0,to,o=[])=>{const b=new Float32Array(N);for(let F=F0;F<to;F+=N){r.process([null,null,null],b,F,N);o.push(...b)}return o};
 let r=mk();go(r,0,1024);const len2=3000,d2=new Float32Array(len2);for(let j=0;j<len2;j++)d2[j]=j/len2,X=2600;
 r.cmd({type:'gate',i:0,on:0,frame:5000});r.cmd({type:'vol',i:0,v:1,frame:9000});
 r.cmd({type:'tempo',id:7,frame:X,r:.75,items:[{i:0,data:d2,ver:r.loops[0].ver}]});
 const x=go(r,1024,4096),m=r.msgs.find(q=>q.type==='tempo'),L=r.loops[0];
 ok(m&&m.ok&&m.frame===X&&L.len===len2&&L.buf===d2&&L.undo.length===0,'tempo: il loop passa alla versione nuova ('+L.len+' campioni)');
 const want=F=>F<X-N?((F-500)%len)/len:F>=X+N?((((F-X)+Math.round((X-500)%len*.75))%len2)/len2):null;let e=0;
 for(let k=0;k<x.length;k++){const w=want(1024+k);if(w!=null)e=Math.max(e,Math.abs(x[k]-w))}
 ok(e<1e-6,'tempo: prima legge il giro di prima, dopo lo stesso punto del giro nella versione nuova (scarto '+e.toExponential(1)+')');
 let jump=0;for(let k=1;k<x.length;k++){const F=1024+k;if(F>X-2*N&&F<X+2*N&&Math.abs(x[k]-x[k-1])<.5)jump=Math.max(jump,Math.abs(x[k]-x[k-1]))}
 ok(jump<.01,'tempo: niente salti al cambio (passo massimo '+jump.toFixed(4)+')');
 ok(r.q.some(c=>c.type==='gate'&&c.frame===X+Math.round((5000-X)*.75))&&r.q.some(c=>c.type==='vol'&&c.frame===X+Math.round((9000-X)*.75)),'tempo: stop e comandi già fissati dopo X si stirano con la griglia');
 // ver diversa (una nota è arrivata dopo la copia): non cambia niente
 r=mk();go(r,0,1024);const v0=r.loops[0].ver;r.cmd({type:'fill',i:0,data:new Float32Array(len)});go(r,1024,1152);
 r.cmd({type:'tempo',id:8,frame:1200,r:.75,items:[{i:0,data:d2,ver:v0}]});go(r,1152,1408);
 let q=r.msgs.find(q=>q.type==='tempo');ok(q&&!q.ok&&!q.busy&&r.loops[0].len===len,'tempo: loop cambiato dopo la copia, niente cambio (ok false)');
 r=mk();go(r,0,1024);r.cmd({type:'dub',i:0,bus:0});go(r,1024,1152);r.cmd({type:'tempo',id:9,frame:1200,r:.75,items:[{i:0,data:d2,ver:r.loops[0].ver}]});go(r,1152,1408);
 q=r.msgs.find(q=>q.type==='tempo');ok(q&&!q.ok&&q.busy&&r.loops[0].len===len,'tempo: durante la sovraincisione niente cambio (busy)')}
