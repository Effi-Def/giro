// ---------- Esporta WAV: un giro dei loop che suonano, reso offline con lo stesso LoopCore ----------
function exportWav(){
 if(!ready||!G.base||!G.loops.some(L=>L.has&&!L.muted)){flashHint("Niente da esportare: registra almeno un loop.");return}
 send({type:"dump",all:true,exp:true});flashHint("Preparo il file WAV…")}
function wavBlob(L,R,rate){const n=L.length,d=new DataView(new ArrayBuffer(44+n*4)),w=(o,s)=>{for(let k=0;k<s.length;k++)d.setUint8(o+k,s.charCodeAt(k))};
 let pk=0;for(let k=0;k<n;k++)pk=Math.max(pk,Math.abs(L[k]),Math.abs(R[k]));const sc=pk>.98?.98/pk:1;
 w(0,"RIFF");d.setUint32(4,36+n*4,true);w(8,"WAVEfmt ");d.setUint32(16,16,true);d.setUint16(20,1,true);d.setUint16(22,2,true);
 d.setUint32(24,rate,true);d.setUint32(28,rate*4,true);d.setUint16(32,4,true);d.setUint16(34,16,true);w(36,"data");d.setUint32(40,n*4,true);
 for(let k=0;k<n;k++){d.setInt16(44+k*4,Math.round(L[k]*sc*32767),true);d.setInt16(46+k*4,Math.round(R[k]*sc*32767),true)}
 return new Blob([d],{type:"audio/wav"})}
function doExport(items){
 const c=new LoopCore(sr);let max=0;
 for(const it of items){const L=G.loops[it.i];if(!L||L.muted)continue;
  c.exec({type:"load",i:it.i,data:it.data,len:it.len,t0:it.t0-G.origin,vol:L.vol,pan:L.pan,fx:L.fx,hp:L.shp||0,wid:L.swid||0},0);
  const o=c.loops[it.i];o.g=o.vol;o.gt=1;max=Math.max(max,it.len)}
 c.msgs=[];if(!max){flashHint("Niente da esportare: i loop sono fermi.");return}
 const L=new Float32Array(max),R=new Float32Array(max),a=new Float32Array(512),b=new Float32Array(512),none=[null,null,null];
 for(let f=0;f<max;f+=512){const n=Math.min(512,max-f),A=a.subarray(0,n),B=b.subarray(0,n);
  c.process(none,A,f,n,B);L.set(A,f);R.set(B,f);c.msgs=[]}
 const t=new Date(),p=x=>String(x).padStart(2,"0"),name=`giro-${t.getFullYear()}${p(t.getMonth()+1)}${p(t.getDate())}-${p(t.getHours())}${p(t.getMinutes())}.wav`;
 const url=URL.createObjectURL(wavBlob(L,R,sr)),el=document.createElement("a");el.href=url;el.download=name;document.body.appendChild(el);el.click();el.remove();
 setTimeout(()=>URL.revokeObjectURL(url),10000);
 flashHint(`<b>${name}</b> scaricato: ${(max/sr).toFixed(1)} s, un giro dei loop.`)}
