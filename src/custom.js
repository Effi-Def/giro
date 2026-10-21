// ---------- Suoni aggiunti dall'utente ----------
// Due strade: catalogo (i 100+ strumenti General MIDI dello stesso soundfont MusyngKite, scaricati una volta sola)
// e file audio del PC. I campioni restano in IndexedDB (db giro_sounds) e rientrano in SOUNDS all'avvio.
const GM_URL="https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/MusyngKite";
const NOTE_NAMES=["C","Db","D","Eb","E","F","Gb","G","Ab","A","Bb","B"];
// [famiglia nel pannello, [[cartella del soundfont, nome]...], tenuto (si ripete finché tieni il tasto)]
const GM=[
 ["Tastiere",[["bright_acoustic_piano","Piano brillante"],["electric_grand_piano","Piano elettrico"],["honkytonk_piano","Piano honky-tonk"],["electric_piano_2","Rhodes 2"],["harpsichord","Clavicembalo"],["clavinet","Clavinet"],["celesta","Celesta"],["music_box","Carillon"]]],
 ["Tastiere",[["percussive_organ","Organo percussivo"],["rock_organ","Organo rock"],["church_organ","Organo da chiesa"],["reed_organ","Armonium"],["accordion","Fisarmonica"],["tango_accordion","Bandoneon"],["harmonica","Armonica"]],1],
 ["Percussioni",[["glockenspiel","Glockenspiel"],["marimba","Marimba"],["xylophone","Xilofono"],["tubular_bells","Campane"],["dulcimer","Dulcimer"],["tinkle_bell","Campanelli"],["steel_drums","Steel drum"],["kalimba","Kalimba"],["woodblock","Woodblock"],["taiko_drum","Taiko"],["melodic_tom","Tom melodico"],["synth_drum","Synth drum"]]],
 ["Chitarre",[["acoustic_guitar_nylon","Chitarra classica"],["electric_guitar_jazz","Chitarra jazz"],["electric_guitar_muted","Chitarra muted"],["overdriven_guitar","Chitarra overdrive"],["distortion_guitar","Chitarra distorta"],["guitar_harmonics","Armonici"]]],
 ["Etnici",[["sitar","Sitar"],["banjo","Banjo"],["shamisen","Shamisen"],["koto","Koto"],["orchestral_harp","Arpa"],["fiddle","Fiddle"],["shanai","Shanai"]]],
 ["Bassi",[["electric_bass_pick","Basso plettro"],["fretless_bass","Basso fretless"],["slap_bass_1","Slap bass 1"],["slap_bass_2","Slap bass 2"]]],
 ["Orchestra",[["violin","Violino"],["viola","Viola"],["cello","Violoncello"],["pizzicato_strings","Archi pizzicato"],["timpani","Timpani"],["orchestra_hit","Orchestra hit"]]],
 ["Orchestra",[["tremolo_strings","Archi tremolo"],["string_ensemble_2","Archi 2"],["synth_strings_2","Synth strings 2"]],1],
 ["Fiati",[["trumpet","Tromba"],["trombone","Trombone"],["tuba","Tuba"],["muted_trumpet","Tromba con sordina"],["french_horn","Corno"],["brass_section","Sezione ottoni"],["synth_brass_2","Synth brass 2"],
  ["soprano_sax","Sax soprano"],["alto_sax","Sax contralto"],["tenor_sax","Sax tenore"],["baritone_sax","Sax baritono"],["oboe","Oboe"],["english_horn","Corno inglese"],["bassoon","Fagotto"],["clarinet","Clarinetto"],
  ["piccolo","Ottavino"],["flute","Flauto"],["recorder","Flauto dolce"],["pan_flute","Flauto di Pan"],["blown_bottle","Bottiglia"],["shakuhachi","Shakuhachi"],["whistle","Fischio"],["ocarina","Ocarina"],["bagpipe","Cornamusa"]],1],
 ["Atmosfere",[["voice_oohs","Voci ooh"],["synth_choir","Synth choir"],["pad_1_new_age","Pad new age"],["pad_4_choir","Pad choir"],["pad_5_bowed","Pad bowed"],["pad_6_metallic","Pad metallico"],["pad_7_halo","Pad halo"],
  ["fx_1_rain","FX pioggia"],["fx_2_soundtrack","FX soundtrack"],["fx_3_crystal","FX cristallo"],["fx_4_atmosphere","FX atmosfera"],["fx_5_brightness","FX brillante"],["fx_6_goblins","FX goblin"],["fx_7_echoes","FX echi"],["fx_8_scifi","FX sci-fi"]],1],
 ["Synth",[["lead_1_square","Lead onda quadra"],["lead_3_calliope","Lead calliope"],["lead_4_chiff","Lead chiff"],["lead_5_charang","Lead charang"],["lead_6_voice","Lead voce"],["lead_7_fifths","Lead quinte"],["lead_8_bass__lead","Lead basso"]],1]];
const GM_NAME={};GM.forEach(([c,l,t])=>l.forEach(([f,n])=>GM_NAME[f]={cat:c,name:n,loop:t}));

function sdb(mode,fn){return new Promise((ok,ko)=>{const r=indexedDB.open("giro_sounds",1);r.onupgradeneeded=()=>r.result.createObjectStore("snd",{keyPath:"id"});
 r.onerror=()=>ko(r.error);r.onsuccess=()=>{const d=r.result,t=d.transaction("snd",mode),q=fn(t.objectStore("snd"));
  t.oncomplete=()=>{d.close();ok(q&&q.result)};t.onerror=()=>ko(t.error)}})}

// guadagno e inizio dal campione, come tools/analyze_samples.py: livello RMS dei primi 0,5 s dopo l'attacco
async function analyzeSamples(samples){const oc=new OfflineAudioContext(1,1,44100),on=[],rm=[];
 for(const k in samples){let b;try{b=await oc.decodeAudioData(samples[k].slice(0))}catch(_){continue}
  const n=b.numberOfChannels,m=new Float32Array(b.length),w=n===2?Math.SQRT1_2:1/n;
  for(let c=0;c<n;c++){const d=b.getChannelData(c);for(let i=0;i<m.length;i++)m[i]+=d[i]*w}
  let pk=0;for(let i=0;i<m.length;i++)pk=Math.max(pk,Math.abs(m[i]));
  const th=Math.max(1e-3,pk*.02);let o=0;while(o<m.length&&Math.abs(m[o])<=th)o++;
  let s=0,c2=0;for(let i=o;i<Math.min(m.length,o+Math.round(.5*b.sampleRate));i++){s+=m[i]*m[i];c2++}
  on.push(o/b.sampleRate);rm.push(c2?Math.sqrt(s/c2):0)}
 if(!rm.length)throw new Error("file audio non leggibile");
 const med=a=>a.slice().sort((x,y)=>x-y)[a.length>>1];
 return{gain:+Math.min(8,.11/Math.max(1e-4,med(rm))).toFixed(2),off:+med(on).toFixed(4)}}

function registerSound(rec){
 const {samples,...meta}=rec;if(SOUNDS.some(s=>s.id===rec.id))return;
 SOUNDS.push(meta);SAMPLE_DATA[rec.id]=samples;refreshSounds()}
function refreshSounds(){CATS=[...new Set(SOUNDS.map(s=>s.cat))];buildSounds();render();if($("#addSounds")&&!$("#addSounds").hidden)drawAdd()}
async function saveSound(rec){await analyzeSamples(rec.samples).then(a=>Object.assign(rec,a));await sdb("readwrite",s=>s.put(rec));registerSound(rec)}
async function loadCustomSounds(){let list=[];try{list=await sdb("readonly",s=>s.getAll())||[]}catch(_){}
 list.sort((a,b)=>(a.t||0)-(b.t||0));list.forEach(registerSound);
 const i=SOUNDS.findIndex(s=>s.id===SET.sid);if(i>=0&&i!==SET.sound){SET.sound=i;if(ready)loadSound(i);render()}}
async function removeSound(id){const i=SOUNDS.findIndex(s=>s.id===id);if(i<0)return;
 try{await sdb("readwrite",s=>s.delete(id))}catch(_){}
 const cur=SET.sound,cid=SOUNDS[cur].id;
 SOUNDS.splice(i,1);delete BUF[id];delete SAMPLE_DATA[id];delete loading[id];
 for(const k in lastInCat)delete lastInCat[k];
 SET.sound=Math.max(0,SOUNDS.findIndex(s=>s.id===cid));G.loops.forEach(L=>{if(L.sound===i)L.sound=0;else if(L.sound>i)L.sound--});
 saveSet();refreshSounds()}

// ---------- Catalogo ----------
async function downloadGM(folder){
 const info=GM_NAME[folder],lo=/bass/.test(folder)?28:36,hi=/bass/.test(folder)?67:96,samples={};
 await Promise.all(Array.from({length:Math.floor((hi-lo)/3)+1},(_,k)=>lo+k*3).map(async m=>{
  try{const r=await fetch(`${GM_URL}/${folder}-mp3/${NOTE_NAMES[m%12]}${Math.floor(m/12)-1}.mp3`);if(r.ok)samples[m]=await r.arrayBuffer()}catch(_){}}));
 if(!Object.keys(samples).length)throw new Error("niente rete: il download non è riuscito");
 const held=!!info.loop;
 await saveSound({id:"gm_"+folder,name:info.name,cat:info.cat,gain:1,off:0,rel:held?.5:.3,att:held?.04:.003,loop:held?1:0,t:Date.now(),samples})}

// ---------- File del PC ----------
const PC_NOTE={c:0,d:2,e:4,f:5,g:7,a:9,b:11};
function rootFromName(n){const m=n.match(/(?:^|[^a-z])([a-g])(#|b)?(-?\d)(?!\d)/i);if(!m)return 60;
 return Math.max(0,Math.min(127,(+m[3]+1)*12+PC_NOTE[m[1].toLowerCase()]+(m[2]==="#"?1:m[2]==="b"?-1:0)))}
async function addFiles(files){let ok=0,bad=[];
 for(const f of files){const name=f.name.replace(/\.[^.]+$/,"").replace(/[_-]+/g," ").trim()||"Suono";
  try{await saveSound({id:"f_"+Date.now().toString(36)+Math.random().toString(36).slice(2,6),name,cat:"Miei",gain:1,off:0,rel:.3,att:.003,loop:0,t:Date.now(),
   samples:{[rootFromName(f.name)]:await f.arrayBuffer()}});ok++}catch(_){bad.push(f.name)}}
 return(ok?`Aggiunti ${ok} suoni nella famiglia «Miei».`:"")+(bad.length?` Non leggibili: ${bad.join(", ")}.`:"")}

// ---------- Pannello «Aggiungi suoni» ----------
let addMsg="",busyId="";
function drawAdd(){
 const have=new Set(SOUNDS.map(s=>s.id)),cats=[...new Set(GM.map(g=>g[0]))],mine=SOUNDS.filter(s=>s.t);
 $("#addBody").innerHTML=`
  <section><h3>Catalogo</h3>
   <p class="help">Scegli e aspetta qualche secondo: il suono si scarica una volta sola (serve internet), poi resta salvato qui e funziona anche senza rete. Compare nella sua famiglia.</p>
   ${cats.map(c=>`<div class="cat"><span class="catn">${c}</span><div class="tiles">${GM.filter(g=>g[0]===c).flatMap(g=>g[1]).map(([f,n])=>
    `<button class="snd${have.has("gm_"+f)?" on":""}${busyId===f?" wait":""}" data-gm="${f}"${have.has("gm_"+f)||busyId?" disabled":""}>${have.has("gm_"+f)?"✓ ":""}${n}</button>`).join("")}</div></div>`).join("")}
  </section>
  <section><h3>Dal mio computer</h3>
   <p class="help">Un file audio (wav, mp3, ogg) diventa un suono suonabile su tutta la tastiera. Se il nome contiene la nota, per esempio <kbd>basso A2.wav</kbd>, la tastiera si intona su quella; altrimenti il Do centrale. Si possono scegliere più file.</p>
   <div><label class="small" style="cursor:pointer;display:inline-block">SCEGLI FILE AUDIO<input type="file" id="addFile" accept="audio/*" multiple hidden></label></div>
  </section>
  ${mine.length?`<section><h3>I tuoi suoni</h3>${mine.map(s=>`<div class="sl"><span>${s.name} <small style="color:var(--dim)">${s.cat}</small></span><button class="small" data-rm="${s.id}">RIMUOVI</button></div>`).join("")}</section>`:""}
  <p class="help" id="addMsg">${addMsg}</p>`}
function openAdd(){$("#addSounds").hidden=false;drawAdd()}
function initAddUI(){
 $("#addBtn").onclick=openAdd;$("#closeAdd").onclick=()=>{$("#addSounds").hidden=true};
 $("#addSounds").addEventListener("pointerdown",e=>{if(e.target.id==="addSounds")$("#addSounds").hidden=true});
 $("#addBody").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;
  if(b.dataset.rm){await removeSound(b.dataset.rm);addMsg="Suono rimosso.";drawAdd();return}
  if(b.dataset.gm){busyId=b.dataset.gm;addMsg="Scarico…";drawAdd();
   try{await downloadGM(busyId);addMsg=`«${GM_NAME[busyId].name}» aggiunto: lo trovi in ${GM_NAME[busyId].cat}.`}catch(err){addMsg="Non riuscito: "+err.message}
   busyId="";drawAdd()}});
 $("#addBody").addEventListener("change",async e=>{if(e.target.id!=="addFile")return;const fs=[...e.target.files];if(!fs.length)return;
  addMsg="Carico…";drawAdd();addMsg=await addFiles(fs);drawAdd()})}
