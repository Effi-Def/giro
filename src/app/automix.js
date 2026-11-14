// ---------- Mix automatico ----------
// Come farebbe un fonico: ogni loop prende un ruolo dai suoni suonati dentro e riceve pan, passa-alto e apertura stereo.
// I loop sono mono: senza questo finivano tutti al centro uno sopra l'altro, e accordi e tappeti riempivano i bassi
// insieme al basso (nelle esibizioni registrate dall'utente: quasi mono, −24 dB di laterale, il grosso fra 60 e 400 Hz).
// hp: passa-alto in Hz · pan: quanto va di lato (il lato lo sceglie autoMix) · wid: apertura stereo (core.js)
const ROLES={rit:{hp:0,pan:0,wid:0},per:{hp:150,pan:.3,wid:0},bas:{hp:0,pan:0,wid:0},acc:{hp:150,pan:.35,wid:.2},
 tap:{hp:220,pan:0,wid:.6},mel:{hp:200,pan:.2,wid:.15},col:{hp:350,pan:.5,wid:.3}};
const ROLE_ID={vibra:"acc",cristallo:"col",mtarchi:"tap",mtcoro:"tap",mtflauto:"mel",ondes:"mel",celesta:"col",glock:"col",steeldrum:"col",sitar:"mel",
 lead:"mel",polysynth:"acc",synthbrass:"acc",synthstrings:"tap",sweep:"tap",sub808:"bas",reese:"bas",acid:"bas",supersaw:"tap",stab:"acc"};
const ROLE_CAT={Tastiere:"acc",Chitarre:"acc",Bassi:"bas",Atmosfere:"tap",Synth:"acc",Etnici:"mel",Fiati:"mel",Orchestra:"mel",Percussioni:"col"};
// i file del PC («Miei») non hanno un ruolo: restano come sono
function soundRole(id,kick){const s=SOUNDS.find(x=>x.id===id);if(!s)return null;if(s.drum)return kick?"rit":"per";
 return ROLE_ID[s.id]||(s.cat==="Orchestra"&&s.loop?"tap":ROLE_CAT[s.cat])||null}
// mx: note suonate nel loop per suono (w), nota più bassa che si sente (lo), se la batteria ha cassa o tom basso (kick)
const freshMx=()=>({w:{},lo:null,kick:false});
function mxNote(L,s,note){const M=L.mx||(L.mx=freshMx());M.w[s.id]=(M.w[s.id]||0)+1;
 if(s.drum){if(note%12===0||note%12===5)M.kick=true}else{const n=note+(s.tr||0);if(M.lo==null||n<M.lo)M.lo=n}}
// il ruolo è quello del suono con più note
function loopRole(L){const M=L.mx;if(!M||!L.has)return null;let r=null,w=0;
 for(const id in M.w){const q=soundRole(id,M.kick);if(q&&M.w[id]>w){r=q;w=M.w[id]}}return r}
function autoTarget(i){const L=G.loops[i],r=SET.amix?loopRole(L):null;if(!r)return{r:null,hp:0,wid:0};
 const M=L.mx,bass=G.loops.some((o,j)=>j!==i&&loopRole(o)==="bas");let hp=Infinity;
 for(const id in M.w){const q=soundRole(id,M.kick);hp=Math.min(hp,q?ROLES[q].hp:0)} // con dentro anche un basso, il passa-alto è quello del basso
 // le note più basse restano: senza un basso nel giro sono loro il basso, con il basso ne perdono solo la fondamentale
 if(hp&&M.lo!=null)hp=Math.min(hp,(bass?1.2:.7)*440*Math.pow(2,(M.lo-69)/12));
 return{r,hp:hp>=40?Math.round(hp):0,wid:ROLES[r].wid}}
// gira in tick: manda al core solo quello che cambia. Il pan si decide una volta, quando il loop prende il suo ruolo,
// dal lato che bilancia gli altri; il primo loop resta al centro. Un pan girato a mano (pm) non si tocca più.
function autoMix(){
 G.loops.forEach((L,i)=>{const t=autoTarget(i);
  if(t.hp!==L.shp){L.shp=t.hp;send({type:"hp",i,v:t.hp})}
  if(t.wid!==L.swid){L.swid=t.wid;send({type:"wid",i,v:t.wid})}
  if(!L.has||L.pm||t.r===L.ar)return;L.ar=t.r;let x=0;
  if(t.r&&ROLES[t.r].pan&&G.loops.some((o,j)=>j!==i&&o.has)){const S=G.loops.reduce((a,o,j)=>a+(j!==i&&o.has?o.pan:0),0);
   x=(S>.01?-1:S<-.01?1:t.r==="mel"?1:-1)*ROLES[t.r].pan}
  if(x!==L.pan){L.pan=x;send({type:"pan",i,v:x});saveSoon()}})}

function toggleAutoMix(){SET.amix=SET.amix?0:1;saveSet();autoMix();
 flashHint(SET.amix?"Mix automatico acceso: ogni loop prende il suo posto (pan, bassi puliti, apertura).":"Mix automatico spento: i loop restano al centro, senza filtri.");render()}
