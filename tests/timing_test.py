# Tempo degli eventi: le note e i pad valgono all'istante dell'evento (timeStamp), non a quando vengono gestiti,
# e quell'istante portato sull'orologio audio non ha il jitter di ctx.currentTime (che avanza a raffiche).
from pathlib import Path
import asyncio,json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1366,'height':768})
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto((Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri())
        await pg.keyboard.press('Enter');await pg.wait_for_timeout(3500)
        r=await pg.evaluate('''async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms));const res={};
          // orologio: un evento appena successo cade da poco prima di currentTime a mezzo buffer dopo, sempre con lo stesso scarto
          let n=0,late=0,far=0,lo=1e9,hi=-1e9,rlo=1e9,rhi=-1e9;
          for(let k=0;k<200;k++){const p=performance.now(),t=eventTime(p),c=ctx.currentTime;if(t==null)break;n++;
           if(t<c-.003)late++;if(t>c+.04)far++;lo=Math.min(lo,t-p/1000);hi=Math.max(hi,t-p/1000);rlo=Math.min(rlo,c-p/1000);rhi=Math.max(rhi,c-p/1000);
           await wait(2+Math.random()*5)}
          res.clock=n===200&&late<=6&&far===0;res.spreadMs=+((hi-lo)*1000).toFixed(2);res.rawSpreadMs=+((rhi-rlo)*1000).toFixed(2);
          res.noStamp=atEvent({},()=>evT)===null&&atEvent(null,()=>evT)===null;
          // primo loop: la nota suona 30 ms prima di essere gestita, il pad 2 s dopo la nota ma gestito 45 ms in ritardo:
          // la lunghezza è quella fra i due eventi
          setSound(0);tap(0);await wait(50);
          const tn=performance.now()-30;atEvent({timeStamp:tn},()=>noteOn(60,.8));await wait(200);atEvent({timeStamp:tn+230},()=>noteOff(60));
          while(performance.now()<tn+2045)await wait(1);
          atEvent({timeStamp:tn+2000},()=>tap(0));
          res.baseMs=+(G.base/sr*1000).toFixed(2);res.firstOk=Math.abs(G.base/sr-2)<.001;
          // nota sul secondo giro: annotata all'istante dell'evento
          tap(1);await wait(30);const t2=performance.now()-20,c2=ctx.currentTime;atEvent({timeStamp:t2},()=>noteOn(64,.8));
          const ev=G.ev.find(e=>e.note===64);res.noteAt=!!ev&&Math.abs(ev.on-Math.round(eventTime(t2)*sr))<=sr*.0005&&ev.on<Math.round(c2*sr);
          atEvent({timeStamp:t2+100},()=>noteOff(64));undoSel(false);clearAll();
          return res}''')
        print(json.dumps(r,indent=1));print('errori',errs)
        exp={'clock':True,'noStamp':True,'firstOk':True,'noteAt':True}
        bad={k:(r.get(k),v) for k,v in exp.items() if r.get(k)!=v}
        if r.get('spreadMs',99)>1.5:bad['spreadMs']=(r.get('spreadMs'),'<= 1.5')
        assert not bad and not errs,bad
        print('OK')
        await b.close()
asyncio.run(main())
