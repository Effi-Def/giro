# sessione: registra un loop, aspetta il salvataggio, ricarica la pagina e controlla la ripresa; poi cancella tutto
from pathlib import Path
import asyncio
from playwright.async_api import async_playwright
URL=(Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(channel='chrome',args=['--autoplay-policy=no-user-gesture-required'])
        ctx=await b.new_context(viewport={'width':1366,'height':768})
        pg=await ctx.new_page();errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        async def open_():
            await pg.goto(URL);await pg.wait_for_timeout(300);await pg.keyboard.press('Enter');await pg.wait_for_timeout(800)
        st=lambda:pg.evaluate('JSON.stringify({base:G.base,run:G.running,L:G.loops.slice(0,2).map(l=>[l.state,l.has,l.len,l.peaks?Math.max(...l.peaks)>0.01:false,l.vol])})')
        await open_()
        await pg.keyboard.down('1');await pg.keyboard.up('1');await pg.wait_for_timeout(300)
        for k in 'adg':
            await pg.keyboard.down(k);await pg.wait_for_timeout(350);await pg.keyboard.up(k);await pg.wait_for_timeout(150)
        await pg.keyboard.down('1');await pg.keyboard.up('1')
        before=await pg.evaluate('G.base')
        await pg.wait_for_timeout(4500)   # salvataggio dopo 2,5 s
        await open_()
        s=await st();print('dopo ricarica',s)
        ok1=await pg.evaluate('G.base')==before and '"play",true' in s and not await pg.evaluate('G.running')
        await pg.keyboard.press('Space');await pg.wait_for_timeout(500)
        print('play dopo ripresa',await pg.evaluate('G.running'))
        # cancella tutto e controlla che la prossima apertura sia pulita
        await pg.evaluate('clearAll()');await pg.wait_for_timeout(4500)
        await open_();s2=await st();print('dopo cancella',s2)
        ok2=await pg.evaluate('G.base')is None
        print('ERRORI',errs)
        print('OK' if ok1 and ok2 and not errs else 'FAIL',ok1,ok2)
        await b.close()
asyncio.run(main())
