# export WAV: registra un loop, scarica il file e controlla intestazione, durata e che non sia silenzio
from pathlib import Path
import asyncio,struct
from playwright.async_api import async_playwright
URL=(Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri()
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(channel='chrome',args=['--autoplay-policy=no-user-gesture-required'])
        pg=await (await b.new_context(accept_downloads=True,viewport={'width':1366,'height':768})).new_page();errs=[]
        pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto(URL);await pg.wait_for_timeout(300);await pg.keyboard.press('Enter');await pg.wait_for_timeout(800)
        await pg.evaluate('exportWav()');print('senza loop:',await pg.inner_text('#hint'))
        await pg.keyboard.down('1');await pg.keyboard.up('1');await pg.wait_for_timeout(300)
        for k in 'adg':
            await pg.keyboard.down(k);await pg.wait_for_timeout(350);await pg.keyboard.up(k);await pg.wait_for_timeout(150)
        await pg.keyboard.down('1');await pg.keyboard.up('1');await pg.wait_for_timeout(1500)
        base=await pg.evaluate('G.base');sr=await pg.evaluate('sr')
        await pg.click('#openSettings')
        async with pg.expect_download() as d: await pg.click('#exportBtn')
        dl=await d.value;path=Path(__file__).resolve().parent/'_export.wav';await dl.save_as(str(path))
        data=path.read_bytes();path.unlink()
        ch,rate=struct.unpack('<HI',data[22:28]);n=struct.unpack('<I',data[40:44])[0]//4
        pcm=struct.unpack('<%dh'%(2*n),data[44:44+n*4]);pk=max(abs(x) for x in pcm)
        print('file',dl.suggested_filename,'canali',ch,'rate',rate,'frame',n,'attesi',base,'picco',pk,'errori',errs)
        print('OK' if data[:4]==b'RIFF' and ch==2 and rate==sr and n==base and pk>500 and not errs else 'FAIL')
        await b.close()
asyncio.run(main())
