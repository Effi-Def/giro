# Genere (manopola 4 degli effetti DJ): un ritmo classico di batteria (cassa su 1 e 3, rullante su 2 e 4, charleston
# a ottavi) viene risuonato in un altro ordine. Controlla gli schemi (drum & bass, metà tempo, dub, shuffle) costruiti
# dai colpi suonati, che il loop di pianoforte resti com'è, l'eco del dub e lo spegnimento.
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
          const msgs=[],sd=window.send;window.send=(c,tr)=>{if(c.type==="gen")msgs.push(c);return sd(c,tr)};
          const snd=id=>setSound(SOUNDS.findIndex(s=>s.id===id));
          // primo loop: 2 s di batteria quantizzata a 1/16 (4 battiti a 120), cassa 48, rullante 50, charleston 54
          SET.quant=4;snd("batteria");tap(0);await wait(30);
          // ogni colpo all'istante esatto (evT: l'istante dell'evento, come per le note dall'Axiom), così il test non dipende dai timer
          const beat=[[48,54],[54],[50,54],[54],[48,54],[54],[50,54],[54]],T0=ctx.currentTime+.1;
          const at=async(t,fn)=>{while(ctx.currentTime<t-.005)await wait(1);evT=t;try{fn()}finally{evT=null}};
          for(let k=0;k<8;k++){await at(T0+k*.25,()=>beat[k].forEach(n=>noteOn(n,.8)));await wait(40);beat[k].forEach(n=>noteOff(n))}
          await at(T0+2,()=>tap(0));await wait(300);
          snd("piano");tap(1);await wait(30);noteOn(60,.8);await wait(150);noteOff(60);await wait(600);tap(1);
          while(G.loops[1].state!=="play")await wait(20);await wait(100);
          res.hits=G.loops[0].mx.h.length;res.beats=G.beats;
          const M=g=>[...genMap(0,g)];const A=m=>m.filter((x,j)=>j%2===0).map(x=>+x.toFixed(2)),B=m=>m.filter((x,j)=>j%2===1);
          res.db=A(M(1));res.half=A(M(2));res.dub=A(M(3));res.dubB=B(M(3));res.shuffle=A(M(4));
          // dalla manopola: drum & bass sul loop di batteria, dal prossimo sedicesimo; il pianoforte non si tocca
          setKnobMode("dj");msgs.length=0;knob(3,30);await wait(100);
          const step=G.base/(G.beats*4),m0=msgs.filter(c=>c.i===0);
          res.knobDb=m0.length===1&&A([...m0[0].map]).join()===res.db.join()&&!msgs.some(c=>c.i===1);
          res.onGrid=m0.length?Math.abs(((m0[0].frame+Math.round(sr*.008)-G.origin)/step)%1)<1e-6:false;
          res.text=djText(3);
          msgs.length=0;knob(3,90);await wait(100);res.dubOn=!!geOn[0]&&!geOn[1]&&msgs.length===1;
          msgs.length=0;knob(3,127);await wait(100);res.knobShuffle=msgs.length===1&&!geOn[0];
          // nuova sovraincisione sul loop di batteria: lo schema si rifà con i colpi nuovi
          msgs.length=0;snd("batteria");G.sel=0;startDub(0);noteOn(49,.8);await wait(60);noteOff(49);endDub(0);await wait(100);
          res.redoOnHit=msgs.length===1&&G.loops[0].mx.h.length===res.hits+1;
          // sul singolo loop: il pianoforte non cambia
          setFxScope("loop");G.sel=1;knob(3,30);await wait(50);res.loopText=djText(3);setFxScope("mix");
          msgs.length=0;knob(3,0);await wait(100);res.off=msgs.length===1&&msgs[0].i===0&&msgs[0].map===null&&djText(3)==="spento";
          knob(3,30);await wait(50);msgs.length=0;stopAllFx();await wait(100);res.stopFx=msgs.length===1&&msgs[0].map===null;
          return res}''')
        print(json.dumps(r,ensure_ascii=False))
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        ok(r['hits']==12 and r['beats']==4,'colpi annotati: %s, battiti %s'%(r['hits'],r['beats']))
        ok(r['db']==[0,1,2,3,4,5,6,7,6,9,8,11,12,13,14,15],'drum & bass: la cassa del 3 va in levare, al suo posto un charleston %s'%r['db'])
        ok(r['half']==[0,1,2,3,2,5,6,7,4,9,10,11,10,13,14,15],'metà tempo: un solo rullante, sul 3 %s'%r['half'])
        ok(r['dub'][0]==2 and r['dub'][8]==8 and r['dubB'][8]==4 and r['dub'][4]==2 and r['dub'][12]==10,'dub: niente sull\'1, cassa e rullante insieme sul 3 %s'%r['dub'])
        ok(r['shuffle'][:4]==[0,0.67,2,2.67],'shuffle: levare un terzo in ritardo %s'%r['shuffle'][:4])
        ok(r['knobDb'] and r['onGrid'],'manopola 4: drum & bass solo sul loop di batteria, dal prossimo sedicesimo')
        ok(r['text']=='drum & bass','testo della manopola: %s'%r['text'])
        ok(r['dubOn'] and r['knobShuffle'],'dub con la sua eco, che si stacca passando allo shuffle')
        ok(r['redoOnHit'],'colpi sovraincisi: lo schema si rifà')
        ok(r['loopText']=='drum & bass · solo sui loop di batteria','sul singolo loop di pianoforte: %s'%r['loopText'])
        ok(r['off'] and r['stopFx'],'tutta a sinistra o STOP EFFETTI: torna il ritmo di prima')
        ok(not errs,'nessun errore '+str(errs))
        await b.close()
asyncio.run(main())
