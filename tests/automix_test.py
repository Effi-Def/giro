# Mix automatico: ogni loop prende un ruolo dai suoni suonati dentro e riceve pan, passa-alto e apertura stereo.
# Primo loop al centro, basso e batteria al centro senza passa-alto, accordi alternati ai lati, tappeto aperto,
# pan girato a mano che resta, spento = tutto al centro, export con laterale solo a mix automatico acceso.
from pathlib import Path
import asyncio,json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        a=['--autoplay-policy=no-user-gesture-required']
        try:b=await p.chromium.launch(args=a)
        except Exception:b=await p.chromium.launch(args=a,channel='chrome') # sul PC dell'utente c'è solo Chrome
        pg=await b.new_page(viewport={'width':1366,'height':768})
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto((Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri())
        await pg.keyboard.press('Enter');await pg.wait_for_timeout(3500)
        r=await pg.evaluate('''async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms));const res={};
          const snd=id=>setSound(SOUNDS.findIndex(s=>s.id===id));
          const S=i=>{const L=G.loops[i];return{r:L.ar,pan:+L.pan.toFixed(2),hp:L.shp,wid:L.swid}};
          SET.quant=0;SET.amix=1;
          const T=()=>tips().map(t=>({s:SOUNDS[t.i].id,w:soundWorld(SOUNDS[t.i]),why:t.why,odd:!!t.odd}));
          res.tips0=T();res.tipsDom=document.querySelectorAll("#tips .snd.tip").length;
          // primo loop, pianoforte sul Do centrale: da solo resta al centro, passa-alto degli accordi
          snd("piano");tap(0);await wait(30);const T0=ctx.currentTime;noteOn(60,.8);await wait(150);noteOff(60);
          while(ctx.currentTime-T0<2)await wait(1);tap(0);await wait(100);res.first=S(0);res.tips1=T();
          const rec=async(i,id,notes)=>{snd(id);tap(i);await wait(30);for(const n of notes){noteOn(n,.8);await wait(120);noteOff(n)}
           await wait(300);tap(i);while(G.loops[i].state!=="play")await wait(20);await wait(60)};
          await rec(1,"basso",[40,43]);res.bass=S(1);res.firstWithBass=S(0);res.tips2=T();
          await rec(2,"pad",[60,64,67]);res.pad=S(2);
          await rec(3,"rhodes",[64,67]);res.keys2=S(3);
          await rec(4,"elettrica",[67]);res.keys3=S(4);
          await rec(5,"batteria",[42,42,42]);res.hats=S(5);
          await rec(6,"808",[36,42]);res.kit=S(6);res.tipsAll=T();
          res.tipsStable=JSON.stringify(T())===JSON.stringify(res.tipsAll);render();res.tipsShown=[...document.querySelectorAll("#tips .snd.tip")].map(b=>SOUNDS[+b.dataset.s].id);
          // pan a mano: resta anche spegnendo e riaccendendo
          setKnobMode("pan");knob(3,100);const man=G.loops[3].pan;
          toggleAutoMix();await wait(60);res.off=G.loops.map((L,i)=>i===3?L.pan===man:L.pan===0&&!L.shp&&!L.swid).every(Boolean);
          toggleAutoMix();await wait(60);res.on=S(2).wid===.6&&G.loops[3].pan===man&&S(4).pan!==0;
          // export: con il mix automatico c'è laterale, senza no (i loop al centro: sinistra = destra)
          let cap=null;const wb=window.wavBlob;window.wavBlob=(L,R,rate)=>{cap={L,R};return wb(L,R,rate)};
          const width=async()=>{cap=null;exportWav();while(!cap)await wait(20);let s=0,m=0;for(let k=0;k<cap.L.length;k++){s+=(cap.L[k]-cap.R[k])**2;m+=(cap.L[k]+cap.R[k])**2}return 10*Math.log10(s/m+1e-12)};
          setKnobMode("pan");knob(3,64);G.loops[3].pm=false;G.loops[3].ar=null;await wait(60);
          res.wOn=+(await width()).toFixed(1);toggleAutoMix();await wait(100);res.wOff=+(await width()).toFixed(1);
          return res}''')
        print(json.dumps(r,ensure_ascii=False))
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        ok(r['first']=={'r':'acc','pan':0,'hp':150,'wid':.2},'primo loop (pianoforte) da solo al centro, passa-alto 150 Hz')
        ok(r['bass']['r']=='bas' and r['bass']['pan']==0 and r['bass']['hp']==0 and r['bass']['wid']==0,'basso al centro, niente passa-alto, mono')
        ok(r['firstWithBass']['pan']==0,'il primo loop non si sposta quando arriva il secondo')
        ok(r['pad']['r']=='tap' and r['pad']['pan']==0 and r['pad']['wid']==.6 and r['pad']['hp']==220,'tappeto al centro, aperto, passa-alto 220 Hz')
        ok(r['keys2']['pan']==-.35 and r['keys3']['pan']==.35,'accordi alternati ai lati: %s %s'%(r['keys2']['pan'],r['keys3']['pan']))
        ok(r['hats']['r']=='per' and r['hats']['hp']==150 and r['hats']['pan']!=0,'charleston senza cassa: percussioni di lato con passa-alto')
        ok(r['kit']['r']=='rit' and r['kit']['pan']==0 and r['kit']['hp']==0,'batteria con la cassa al centro, intera')
        ok(r['off'],'mix automatico spento: tutto al centro e senza filtri, il pan girato a mano resta')
        ok(r['on'],'riacceso: tornano apertura e lati, il pan a mano resta')
        ok(r['wOn']>-20 and r['wOff']<-60,'export: laterale %s dB col mix automatico, %s dB senza'%(r['wOn'],r['wOff']))
        why=lambda k:[t['why']+('*' if t['odd'] else '') for t in r[k]]
        ok(len(r['tips0'])==3 and r['tipsDom']==3,'consigli: tre suoni in vista anche prima di registrare')
        ok(why('tips1')==['ritmo','basso','ritmo*'] and r['tips1'][2]['w']!='ac' and all(t['w']=='ac' for t in r['tips1'][:2]),'dopo il pianoforte: ritmo e basso acustici, ritmo inatteso da un altro mondo %s'%r['tips1'])
        ok(why('tips2')==['ritmo','tiene le note','ritmo*'],'dopo il basso: ritmo e un tappeto %s'%why('tips2'))
        used={'piano','basso','pad','rhodes','elettrica','batteria','808'}
        ok(why('tipsAll')==['melodia','aria in alto','melodia*'] and not used&{t['s'] for t in r['tipsAll']},'col giro pieno: melodia e colore, mai suoni già usati %s'%r['tipsAll'])
        ok(r['tipsStable'] and r['tipsShown']==[t['s'] for t in r['tipsAll']],'consigli fermi finché i loop non cambiano, uguali a quelli disegnati')
        ok(not errs,'nessun errore '+str(errs))
        await b.close()
asyncio.run(main())
