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
          const sent=[];const _s=send;send=c=>{sent.push(c);_s(c)};
          const wait=ms=>new Promise(r=>setTimeout(r,ms));
          const at=async(sec,t0)=>{while((ctx.currentTime-t0)<sec)await wait(1)};
          const onsets=(d)=>{const W=Math.round(sr*.004),e=[];for(let k=0;k+W<=d.length;k+=W){let s=0;for(let j=k;j<k+W;j++)s+=d[j]*d[j];e.push(Math.sqrt(s/W))}
            const o=[];let last=-1;for(let w=1;w<e.length;w++){const prev=Math.max(e[w-1],e[w-2]||0,.002);if(e[w]>prev*2.2&&e[w]>.03&&(last<0||w-last>20)){o.push(+(w*W/sr).toFixed(3));last=w}}return o};
          SET.quant=4;
          tap(0);await wait(50);
          const T=ctx.currentTime;
          // primo loop: 2 s esatti -> 120 bpm, griglia 0.125 s; note volutamente sporche
          const plan=[[0,60],[.53,64],[.97,67],[1.47,72]];
          for(const [t,n] of plan){await at(t,T);noteOn(n,.8);await wait(120);noteOff(n)}
          await at(2.0,T);tap(0);
          const fill=sent.find(c=>c.type==="fill");
          const res={bpm:bpm().toFixed(1),beats:G.beats,len:(G.base/sr).toFixed(3),fillOnsets:fill?onsets(fill.data):null,real:plan.map(x=>x[0])};
          // sovraincisione: nota a 0.29 s dentro il giro -> deve finire a 0.25
          await wait(300);G.sel=0;dubButton();
          const L=G.loops[0];
          while((((nowF()-L.t0)%L.len)+L.len)%L.len/sr>0.2||(((nowF()-L.t0)%L.len)+L.len)%L.len/sr<0.1)await wait(2);
          while((((nowF()-L.t0)%L.len)+L.len)%L.len/sr<0.29)await wait(1);
          const realPos=((((nowF()-L.t0)%L.len)+L.len)%L.len)/sr;
          noteOn(76,.8);await wait(100);noteOff(76);await wait(50);dubButton();
          const pend=sent.find(c=>c.type==="pend");
          res.dub={real:+realPos.toFixed(3),start:pend?+(pend.start/sr).toFixed(3):null,activatesAfter:pend?+((pend.at-nowF())/sr).toFixed(2):null,latComp:+(latencyFrames()/sr).toFixed(3)};
          await wait(2500);res.state=G.loops[0].state;res.undo=G.loops[0].undo;
          // spenta: niente fill
          SET.quant=0;tap(1);await wait(30);noteOn(60,.8);await wait(200);noteOff(60);await wait(700);tap(1);await wait(2500);
          res.offFills=sent.filter(c=>c.type==="fill").length;res.loop2=G.loops[1].state;
          return res}''')
        print(json.dumps(r,indent=1))
        await pg.screenshot(path=str(Path(__file__).resolve().parent/'g7.png'))
        print('errori',errs)
        await b.close()
asyncio.run(main())
