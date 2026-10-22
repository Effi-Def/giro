"""Suoni aggiunti dall'utente: catalogo (download simulato) e file del PC, salvataggio e rimozione."""
from pathlib import Path
import asyncio,struct,math,tempfile,os
from playwright.async_api import async_playwright
def wav(f=220,sec=1.0,sr=22050):
    n=int(sr*sec);d=b''.join(struct.pack('<h',int(12000*math.sin(2*math.pi*f*i/sr)*math.exp(-i/sr*2))) for i in range(n))
    return b'RIFF'+struct.pack('<I',36+len(d))+b'WAVEfmt '+struct.pack('<IHHIIHH',16,1,1,sr,sr*2,2,16)+b'data'+struct.pack('<I',len(d))+d
async def main():
    ok=True
    def chk(n,c):
        nonlocal ok;print(('OK  ' if c else 'ERR ')+n);ok&=bool(c)
    tmp=Path(tempfile.mkdtemp());f=tmp/'basso A2.wav';f.write_bytes(wav())
    async with async_playwright() as p:
        b=await p.chromium.launch(channel='chrome',args=['--autoplay-policy=no-user-gesture-required'])
        ctx=await b.new_context(viewport={'width':1366,'height':768})
        pg=await ctx.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        calls=[]
        async def route(r):
            calls.append(r.request.url);await r.fulfill(body=wav(300),content_type='audio/wav',headers={'access-control-allow-origin':'*'})
        await pg.route('https://raw.githubusercontent.com/**',route)
        await pg.goto((Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri())
        await pg.keyboard.press('Enter');await pg.wait_for_timeout(3000)
        n0=await pg.evaluate('SOUNDS.length');chk('24 suoni di base',n0==24)
        await pg.click('#addBtn');await pg.click('[data-gm="violin"]');await pg.wait_for_timeout(2500)
        chk('violino scaricato e aggiunto',await pg.evaluate('SOUNDS.some(s=>s.id==="gm_violin")') and len(calls)>=15)
        await pg.set_input_files('#addFile',str(f));await pg.wait_for_timeout(1500)
        r=await pg.evaluate('(()=>{const s=SOUNDS.find(s=>s.cat==="Miei");return s&&[s.name,Object.keys(SAMPLE_DATA[s.id])[0],s.gain]})()')
        print(r);chk('file del PC: nome e nota dal nome (A2=45)',r and r[0]=='basso A2' and r[1]=='45')
        await pg.click('#closeAdd')
        await pg.click('#sounds .snd >> text=Violino');await pg.wait_for_timeout(800)
        chk('suono scelto e caricato',await pg.evaluate('!!BUF[SOUNDS[SET.sound].id]'))
        await pg.click('#sounds .snd >> text=basso A2');await pg.wait_for_timeout(800)
        lv=await pg.evaluate('''async()=>{const an=ctx.createAnalyser();an.fftSize=2048;masterIn.connect(an);const d=new Float32Array(2048);
         const v=voice(SET.sound,57,.8,ctx.currentTime+.02,masterIn);let m=0;for(let k=0;k<10;k++){await new Promise(r=>setTimeout(r,30));an.getFloatTimeDomainData(d);let s=0;for(const x of d)s+=x*x;m=Math.max(m,Math.sqrt(s/d.length))}
         v.release(ctx.currentTime);return m}''')
        print('livello',lv);chk('il file suona',lv>.01)
        await pg.reload();await pg.keyboard.press('Enter');await pg.wait_for_timeout(2500)
        chk('dopo il riavvio i suoni ci sono ancora',await pg.evaluate('SOUNDS.length')==n0+2)
        chk('il suono scelto è ripreso',await pg.evaluate('SOUNDS[SET.sound].name')=='basso A2')
        await pg.click('#addBtn');await pg.click('[data-rm]');await pg.wait_for_timeout(300);await pg.click('[data-rm]');await pg.wait_for_timeout(300)
        chk('rimossi',await pg.evaluate('SOUNDS.length')==n0 and await pg.evaluate('SET.sound<SOUNDS.length'))
        chk('nessun errore JS',not errs);print(errs)
        await b.close()
    print('TUTTO OK' if ok else 'FALLITO')
asyncio.run(main())
