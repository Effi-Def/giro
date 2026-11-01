# Interfaccia: a ogni finestra da 1024×600 in su tutto sta in una schermata, i pad restano grandi, i testi non escono e
# niente si sposta quando cambia stato. Sotto i 1000 px è una colonna sola: scorre in verticale, mai in orizzontale.
from pathlib import Path
import asyncio
from playwright.async_api import async_playwright
ZONE=['.top','#hintBox','#grid','.soundbar','.knobs','#playBtn','#dropBtn','#dubBtn','.bottom']
POS='''Z=>Z.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return [r.left,r.top,r.width,r.height].map(Math.round).join()}).join(' ')'''
MIS='''()=>{const d=document.documentElement,p=document.querySelector('.loop').getBoundingClientRect(),s=document.querySelector('#sounds');
 const fuori=[...document.querySelectorAll('.top *,.tools *,.knobs *,.bottom *,.loop *,#sounds *')].filter(e=>{if(e.offsetParent===null||e.closest('svg')||e.classList.contains('rprog'))return false;const r=e.getBoundingClientRect();
   return r.right>innerWidth+1||r.left<-1}).map(e=>e.id||e.className);
 const tagliati=[...document.querySelectorAll('.big,.small,.seg button,.snd,.dj small,.dj span,.st,.dk')].filter(e=>e.offsetParent!==null&&e.scrollWidth>e.clientWidth+1).map(e=>e.textContent);
 return {sw:d.scrollWidth,sh:d.scrollHeight,w:innerWidth,h:innerHeight,padW:p.width,padH:p.height,elenco:[s.scrollHeight,s.clientHeight],fuori,tagliati}}'''
STATI=[('pronto','(async()=>{await loadSound(0);tap(0);render()})()'),
 ('registra','noteOn(60,.8);render()'),
 ('suona','(async()=>{noteOff(60);await new Promise(r=>setTimeout(r,1200));tap(0);await new Promise(r=>setTimeout(r,200));render()})()'),
 ('effetti','setKnobMode("dj");knob(0,20);knob(3,96);knob(5,90);render()'),
 ('un loop','setFxScope("loop");render()'),
 ('batteria','SET.sound=SOUNDS.findIndex(s=>s.drum);render()'),
 ('sovraincidi','SET.sound=0;dubButton();render()'),
 ('pan','dubButton();setKnobMode("pan");render()'),
 ('pieni','''(()=>{setKnobMode("vol");setFxScope("mix");stopAllFx();for(let i=1;i<8;i++){const L=G.loops[i];L.state="play";L.has=true;L.sound=SOUNDS.findIndex(s=>s.name==="Mellotron archi");L.len=G.base;L.t0=G.origin;L.pend={muted:!0};L.peaks=G.loops[0].peaks;drawWave(i)}render()})()''')]
async def main():
    fails=0
    def ok(c,m):
        nonlocal fails
        print(('OK  ' if c else 'FAIL')+' '+m)
        if not c:fails+=1
    async with async_playwright() as p:
        a=['--autoplay-policy=no-user-gesture-required']
        try:b=await p.chromium.launch(args=a)
        except Exception:b=await p.chromium.launch(args=a,channel='chrome') # sul PC dell'utente c'è solo Chrome
        url=(Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri()
        for w,h in [(1024,600),(1280,600),(1366,625),(1536,730),(1920,950),(2560,1300),(900,700),(420,800)]:
            pg=await b.new_page(viewport={'width':w,'height':h});errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
            await pg.goto(url);await pg.evaluate('document.querySelector("#startBtn").click()');await pg.wait_for_timeout(2500)
            largo=w>=1000;pos0=await pg.evaluate(POS,ZONE);pos=[];bad=[]
            for nome,js in STATI:
                await pg.evaluate(js);await pg.wait_for_timeout(120)
                m=await pg.evaluate(MIS)
                if m['sw']>m['w']:bad.append(f'{nome}: scorre di lato ({m["sw"]})')
                if largo and m['sh']>m['h']:bad.append(f'{nome}: scorre ({m["sh"]} su {m["h"]})')
                if largo and m['padH']<150:bad.append(f'{nome}: pad alto {m["padH"]}')
                if m['padW']<100:bad.append(f'{nome}: pad largo {m["padW"]}')
                if largo and m['elenco'][0]>m['elenco'][1]+1:bad.append(f'{nome}: i suoni non ci stanno {m["elenco"]}')
                if m['fuori']:bad.append(f'{nome}: fuori dalla finestra {m["fuori"][:4]}')
                if m['tagliati']:bad.append(f'{nome}: testi tagliati {m["tagliati"][:4]}')
                pos.append(await pg.evaluate(POS,ZONE))
            ok(not bad,f'{w}×{h}: tutto in vista'+(' · '+' · '.join(bad) if bad else ''))
            if largo:ok(all(x==pos0 for x in pos),f'{w}×{h}: le zone non si spostano mai'+('' if all(x==pos0 for x in pos) else ' · '+str([x for x in pos if x!=pos0][:1])))
            ok(not errs,f'{w}×{h}: nessun errore {errs[:2]}')
            await pg.close()
        # con tanti suoni aggiunti scorre solo l'elenco, e il suono scelto resta in vista
        pg=await b.new_page(viewport={'width':1366,'height':625})
        await pg.goto(url);await pg.evaluate('document.querySelector("#startBtn").click()');await pg.wait_for_timeout(2500)
        r=await pg.evaluate('''()=>{for(let i=0;i<40;i++)SOUNDS.push({id:"x"+i,name:"Suono aggiunto "+i,cat:"Miei "+(i%6),gain:1,off:0,rel:.3,att:.01});refreshSounds();SET.sound=SOUNDS.length-1;render();
          const s=document.querySelector('#sounds'),e=s.querySelector('.snd.on').getBoundingClientRect(),q=s.getBoundingClientRect(),d=document.documentElement;
          return {scorre:s.scrollHeight>s.clientHeight,visto:e.top>=q.top&&e.bottom<=q.bottom,pagina:d.scrollHeight<=innerHeight}}''')
        ok(r['scorre'] and r['visto'] and r['pagina'],f'tanti suoni: scorre solo l\'elenco, quello scelto resta in vista {r}')
        # i comandi stanno nel loro foglio, Esc chiude
        await pg.click('#openHelp');aperto=await pg.evaluate('!document.querySelector("#help").hidden&&!!document.querySelector("#help #diag")')
        await pg.keyboard.press('Escape');chiuso=await pg.evaluate('document.querySelector("#help").hidden')
        ok(aperto and chiuso,'foglio COMANDI: si apre e si chiude con Esc')
        # i pulsanti MANOPOLE scelgono il modo
        await pg.click('#knobBtn [data-m="pan"]');a=await pg.evaluate('knobMode');await pg.click('#knobBtn [data-m="dj"]');d=await pg.evaluate('knobMode')
        ok(a=='pan' and d=='dj','pulsanti MANOPOLE: scelgono il modo')
        await b.close()
    print('Falliti:',fails)
    raise SystemExit(1 if fails else 0)
asyncio.run(main())
