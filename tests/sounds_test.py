from pathlib import Path
import asyncio,json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1366,'height':768})
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto((Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri())
        await pg.keyboard.press('Enter');await pg.wait_for_timeout(4000)
        print('caricati',await pg.evaluate('Object.keys(BUF).length+"/"+SOUNDS.length'),'worklet',await pg.evaluate('usingWorklet'))
        print('campioni per suono',await pg.evaluate('JSON.stringify(Object.fromEntries(Object.entries(BUF).map(([k,v])=>[k,v.length])))'))
        print('loop org',await pg.evaluate('JSON.stringify(BUF.organo[5][2])'))
        # misura il livello di ogni suono con un analizzatore sul master
        lv=await pg.evaluate('''async()=>{const an=ctx.createAnalyser();an.fftSize=2048;masterIn.connect(an);const out={};const d=new Float32Array(2048);
          for(let i=0;i<SOUNDS.length;i++){const t=ctx.currentTime+.02;const v=voice(i,SOUNDS[i].drum?60:60,.8,t,masterIn);let m=0;
            for(let k=0;k<12;k++){await new Promise(r=>setTimeout(r,25));an.getFloatTimeDomainData(d);let s=0;for(const x of d)s+=x*x;m=Math.max(m,Math.sqrt(s/d.length))}
            v.release(ctx.currentTime);out[SOUNDS[i].id]=+m.toFixed(3);await new Promise(r=>setTimeout(r,500))}
          masterIn.disconnect(an);return out}''')
        print('livelli',lv)
        # registra un loop col pianoforte
        await pg.keyboard.down('1');await pg.keyboard.up('1');await pg.wait_for_timeout(200)
        for k in 'adgj':
            await pg.keyboard.down(k);await pg.wait_for_timeout(300);await pg.keyboard.up(k);await pg.wait_for_timeout(150)
        await pg.keyboard.down('1');await pg.keyboard.up('1')
        # batteria sul loop 2
        await pg.click('.snd >> text=Batteria');await pg.wait_for_timeout(300)
        await pg.keyboard.down('2');await pg.keyboard.up('2')
        for k in 'ajdj':
            await pg.keyboard.down(k);await pg.wait_for_timeout(100);await pg.keyboard.up(k);await pg.wait_for_timeout(350)
        await pg.keyboard.down('2');await pg.keyboard.up('2');await pg.wait_for_timeout(2500)
        lp=json.loads(await pg.evaluate('JSON.stringify(G.loops.slice(0,2).map(l=>[l.state,SOUNDS[l.sound].name,l.peaks&&Math.max(...l.peaks)]))'));print('loop',lp)
        print('OK  ' if all(l[0]=='play' and (l[2] or 0)>.01 for l in lp) and lp[1][1]=='Batteria' else 'FAIL','pianoforte e batteria registrati nei loop 1 e 2')
        await pg.screenshot(path=str(Path(__file__).resolve().parent/'g6.png'))
        await pg.set_viewport_size({'width':420,'height':900});await pg.wait_for_timeout(300)
        await pg.screenshot(path=str(Path(__file__).resolve().parent/'g6p.png'),full_page=True)
        sw=await pg.evaluate('document.documentElement.scrollWidth');print('sw',sw,'errori',errs)
        print('OK  ' if sw<=420 and not errs else 'FAIL','a 420 px niente scorrimento di lato, nessun errore')
        await b.close()
asyncio.run(main())
