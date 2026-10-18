from pathlib import Path
import asyncio,json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1366,'height':768})
        errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto((Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri())
        await pg.wait_for_timeout(300)
        await pg.screenshot(path=str(Path(__file__).resolve().parent/'g_gate.png'))
        await pg.keyboard.press('Enter')
        await pg.wait_for_timeout(600)
        st=lambda: pg.evaluate('JSON.stringify({w:usingWorklet,ready,base:G.base,sr,run:G.running,L:G.loops.slice(0,3).map(l=>[l.state,l.has,l.len,l.peaks?Math.max(...l.peaks):null,l.undo])})')
        print('avvio',await st())
        # loop 1: pad, suona 4 note, chiudi dopo ~2 s dalla prima
        await pg.keyboard.down('1');await pg.keyboard.up('1')
        await pg.wait_for_timeout(300)
        for k in 'adgj':
            await pg.keyboard.down(k);await pg.wait_for_timeout(350);await pg.keyboard.up(k);await pg.wait_for_timeout(150)
        await pg.keyboard.down('1');await pg.keyboard.up('1')
        await pg.wait_for_timeout(2500)
        print('loop1',await st())
        # loop 2 con il basso: arma, suona, chiudi a ~1.3 giri -> dovrebbe diventare 1 giro
        await pg.keyboard.press('ArrowUp')
        await pg.keyboard.down('2');await pg.keyboard.up('2')
        await pg.keyboard.press('z')
        await pg.wait_for_timeout(200)
        await pg.keyboard.down('a');await pg.wait_for_timeout(900);await pg.keyboard.up('a')
        await pg.keyboard.down('g');await pg.wait_for_timeout(900);await pg.keyboard.up('g')
        await pg.wait_for_timeout(300)
        await pg.keyboard.down('2');await pg.keyboard.up('2')
        await pg.wait_for_timeout(2600)
        print('loop2',await st())
        # sovraincisione sul loop 2 e annulla
        await pg.keyboard.press('r');await pg.wait_for_timeout(200)
        await pg.keyboard.down('k');await pg.wait_for_timeout(300);await pg.keyboard.up('k')
        await pg.wait_for_timeout(600);
        await pg.screenshot(path=str(Path(__file__).resolve().parent/'g_dub.png'))
        await pg.keyboard.press('r');await pg.wait_for_timeout(2000)
        print('dub',await st())
        await pg.keyboard.press('Backspace');await pg.wait_for_timeout(400)
        print('undo',await st())
        # ferma il loop 1 (quantizzato)
        await pg.keyboard.down('1');await pg.keyboard.up('1');await pg.wait_for_timeout(100)
        await pg.screenshot(path=str(Path(__file__).resolve().parent/'g_live.png'))
        await pg.wait_for_timeout(1500)
        print('mute',await pg.evaluate('JSON.stringify(G.loops[0])'))
        # tieni premuto 3 per niente (vuoto) e 2 per cancellare
        await pg.keyboard.down('2');await pg.wait_for_timeout(1000);await pg.keyboard.up('2');await pg.wait_for_timeout(300)
        print('clear2',await st())
        await pg.set_viewport_size({'width':420,'height':900});await pg.wait_for_timeout(300)
        await pg.screenshot(path=str(Path(__file__).resolve().parent/'g_phone.png'),full_page=True)
        print('sw',await pg.evaluate('document.documentElement.scrollWidth'),'errors',errs)
        await b.close()
asyncio.run(main())
