// ---------- Consigli sugli strumenti ----------
// Tre suoni sempre in vista sopra il pannello: i primi due coprono i ruoli che mancano al giro (nell'ordine di una band:
// ritmo, basso, accordi, tappeto, melodia, colore acuto) restando nel «mondo» dei suoni già usati; il terzo è un
// abbinamento inatteso, lo stesso ruolo da un altro mondo. Cambiano solo quando cambiano i loop (chiusi, sovraincisi, cancellati).
const ROLE_ORDER=["rit","bas","acc","tap","mel","col"];
const ROLE_WHY={rit:"ritmo",bas:"basso",acc:"accordi",tap:"tiene le note",mel:"melodia",col:"aria in alto"};
// mondi: ac acustico, in indie/vintage, el elettronico
const WORLD_ID={rhodes:"in",synthbass:"el",synthbass2:"el",archi:"ac",coro:"ac",cristallo:"el","808":"el",cr8000:"in",house909:"el"};
const WORLD_CAT={Atmosfere:"el",Indie:"in",Synth:"el",Techno:"el"};
const soundWorld=s=>WORLD_ID[s.id]||WORLD_CAT[s.cat]||"ac";
let tipCache={key:null,list:[]};
function tips(){
 const full=G.loops.filter(L=>L.has&&L.mx),roles=new Set(full.map(loopRole));if(roles.has("per"))roles.add("rit");
 const used=new Set(),wn={};
 for(const L of full)for(const id in L.mx.w){used.add(id);const s=SOUNDS.find(x=>x.id===id);if(s)wn[soundWorld(s)]=(wn[soundWorld(s)]||0)+L.mx.w[id]}
 const world=Object.keys(wn).sort((a,b)=>wn[b]-wn[a])[0]||null;
 const key=[...roles].sort()+"|"+[...used].sort()+"|"+world+"|"+SOUNDS.length;
 if(key===tipCache.key)return tipCache.list;
 let need=ROLE_ORDER.filter(r=>!roles.has(r));if(!need.length)need=["col","mel","tap"]; // c'è tutto: un colore o una melodia in più
 const out=[],pick=(r,ok)=>{const c=SOUNDS.map((s,i)=>i).filter(i=>{const s=SOUNDS[i];return soundRole(s.id,true)===r&&!used.has(s.id)&&!out.some(t=>t.i===i)&&ok(soundWorld(s))});
  return c.length?c[Math.floor(Math.random()*c.length)]:-1};
 const same=w=>!world||w===world,add=(r,odd)=>{let i=pick(r,odd?w=>world?w!==world:true:same);if(i<0&&!odd)i=pick(r,()=>true);if(i>=0)out.push({i,why:ROLE_WHY[r],odd})};
 add(need[0]);add(need[1]||need[0]);add(need[0],true);
 tipCache={key,list:out};return out}
