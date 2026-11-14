// ---------- Pezzo ripetuto (tasto V): IN e OUT a tempo sul loop selezionato ----------
// Come il roll, ma il pezzo lo scegli tu: primo tocco IN, secondo OUT (tutti e due sul sedicesimo più vicino), e da OUT
// il loop ripete il pezzo (lo fa il core, comando cut: il pezzo può essere già passato). Terzo tocco: esce subito, ed è
// già a tempo perché la griglia ha continuato a contare. Gli altri loop vanno avanti.
let CUT=null; // {i, s: IN in frame, p: lunghezza in frame (0 finché manca OUT)}
const cutStep=()=>G.base/(G.beats*4),cutSnap=f=>Math.round(G.origin+Math.round((f-G.origin)/cutStep())*cutStep());
function cutLen(p){const n=Math.round(p/cutStep());return n<4?["","1/16","1/8","3/16"][n]+" di battito":n===4?"1 battito":String(n/4).replace(".",",")+" battiti"}
function cutButton(){if(!ready)return;
 if(CUT&&CUT.p){const i=CUT.i;cutOff();flashHint(`Loop ${i+1}: <b>fine del pezzo</b>, torna normale a tempo.`);return}
 const i=CUT?CUT.i:G.sel,L=G.loops[i];
 if(!G.base||!G.running||!L.has){CUT=null;flashHint("Il pezzo si sceglie su un loop che suona: selezionalo (<b>Maiusc</b>+numero) mentre gira, poi <b>V</b>.");return}
 const f=cutSnap(nowF());
 if(!CUT){CUT={i,s:f,p:0};render();return}
 const p=Math.max(f-CUT.s,Math.round(cutStep()));
 if(p>=L.len){CUT=null;flashHint("Pezzo lungo quanto tutto il loop: niente da ripetere. Riprova con <b>V</b>, più corto.");return}
 CUT.p=p;send({type:"cut",i,s:CUT.s,p});render()}
function cutOff(){if(!CUT)return;if(CUT.p)send({type:"cut",i:CUT.i,end:nowF()});CUT=null;render()}
