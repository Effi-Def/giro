const fs=require('fs');eval(fs.readFileSync(require('path').join(__dirname,'..','src','core.js'),'utf8')+';global.LoopCore=LoopCore');
const sr=8000,c=new LoopCore(sr);const N=128;let F=0;
const ok=(x,m)=>console.log((x?'OK  ':'FAIL')+' '+m);
const events={0:{},1:{},2:{}};// bus -> frame -> value
let outLog=new Map();
function run(to){while(F<to){const ins=[0,1,2].map(b=>{const a=new Float32Array(N);for(let k=0;k<N;k++){const v=events[b][F+k];if(v)a[k]=v}return a});
 const out=new Float32Array(N);c.process(ins,out,F,N);for(let k=0;k<N;k++)if(Math.abs(out[k])>.05)outLog.set(F+k,+out[k].toFixed(3));F+=N}}
const msgs=()=>{const m=c.msgs;c.msgs=[];return m};
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
