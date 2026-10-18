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
        # loop registrato senza quantizzazione, poi Q acceso e sovraincisione: la nota deve entrare nel loop
        # (e spegnere Q durante una registrazione quantizzata non deve perdere le note nuove)
        r2=await pg.evaluate('''async()=>{
          const sent=[];const _s=send;send=c=>{sent.push(c);_s(c)};
          const wait=ms=>new Promise(r=>setTimeout(r,ms));
          const at=async(sec,t0)=>{while((ctx.currentTime-t0)<sec)await wait(1)};
          const pos=L=>((((nowF()-L.t0)%L.len)+L.len)%L.len)/sr;
          const onsets=(d)=>{const W=Math.round(sr*.004),e=[];for(let k=0;k+W<=d.length;k+=W){let s=0;for(let j=k;j<k+W;j++)s+=d[j]*d[j];e.push(Math.sqrt(s/W))}
            const o=[];let last=-1;for(let w=1;w<e.length;w++){const prev=Math.max(e[w-1],e[w-2]||0,.002);if(e[w]>prev*2.2&&e[w]>.03&&(last<0||w-last>20)){o.push(+(w*W/sr).toFixed(3));last=w}}return o};
          clearAll();await wait(100);
          SET.quant=0;tap(0);await wait(50);
          const T=ctx.currentTime;noteOn(60,.8);await wait(120);noteOff(60);
          await at(2.0,T);tap(0);
          const res={fillsOff:sent.filter(c=>c.type==="fill").length};
          await wait(300);
          SET.quant=4;G.sel=0;dubButton();const L=G.loops[0];
          while(pos(L)>0.2||pos(L)<0.1)await wait(2);
          while(pos(L)<0.29)await wait(1);
          noteOn(76,.8);res.dubRouted=held.get(76).ev?"quant":"bus";await wait(100);noteOff(76);await wait(50);dubButton();
          const pend=sent.find(c=>c.type==="pend"&&c.i===0);
          res.dubPend=pend?+(pend.start/sr).toFixed(3):null;
          await wait(2500);
          // nota suonata appena prima del battito (a orecchio): deve restare sul battito, non finire un sedicesimo prima
          SET.latMs=null;dubButton();
          while(pos(L)>0.4||pos(L)<0.3)await wait(2);
          while(pos(L)<0.49)await wait(1);
          noteOn(79,.8);await wait(100);noteOff(79);await wait(50);dubButton();
          const pend2=sent.filter(c=>c.type==="pend"&&c.i===0)[1];
          res.onBeat=pend2?+(pend2.start/sr).toFixed(3):null;
          await wait(2500);
          // l'anteprima dei suoni non esiste più
          res.previews=typeof preview;
          // secondo caso: registrazione partita quantizzata, Q spento a metà
          SET.quant=4;tap(1);await wait(30);
          while(pos(L)<0.05||pos(L)>0.1)await wait(2);
          const T2=ctx.currentTime;noteOn(60,.8);await wait(120);noteOff(60);
          SET.quant=0;
          await at(0.97,T2);noteOn(67,.8);res.recRouted=held.get(67).ev?"quant":"bus";await wait(120);noteOff(67);
          await at(1.8,T2);tap(1);await wait(800);
          const fill=sent.find(c=>c.type==="fill"&&c.i===1);
          res.recFill=fill?onsets(fill.data):null;res.loop2=G.loops[1].state;
          return res}''')
        print(json.dumps(r2,indent=1))
        assert r2['fillsOff']==0,r2
        assert r2['dubRouted']=='quant' and r2['dubPend'] is not None and abs(r2['dubPend']-0.25)<0.02,r2
        assert r2['onBeat'] is not None and abs(r2['onBeat']-0.5)<0.02,r2
        assert r2['previews']=='undefined',r2
        assert r2['recRouted']=='quant' and r2['recFill'] and len(r2['recFill'])==2,r2
        await pg.screenshot(path=str(Path(__file__).resolve().parent/'g7.png'))
        print('errori',errs)
        await b.close()
asyncio.run(main())
