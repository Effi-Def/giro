# Una scheda sola: con Giro aperto due volte l'Axiom arriva a tutte e due. La scheda accesa per ultima mette in pausa
# l'altra (audio sospeso, note ignorate); USA QUESTA SCHEDA la riprende e mette in pausa l'altra.
from pathlib import Path
import asyncio,json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        a=['--autoplay-policy=no-user-gesture-required']
        try:b=await p.chromium.launch(args=a)
        except Exception:b=await p.chromium.launch(args=a,channel='chrome') # sul PC dell'utente c'è solo Chrome
        c=await b.new_context(viewport={'width':1366,'height':768})
        url=(Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri();errs=[]
        A=await c.new_page();A.on('pageerror',lambda e:errs.append(str(e)));await A.goto(url)
        await A.keyboard.press('Enter');await A.wait_for_timeout(3000)
        # una nota nella prima scheda: suona
        st=lambda pg:pg.evaluate('({away,ctx:ctx.state,box:!document.querySelector("#away").hidden})')
        played='''()=>{let n=0;const v=window.voice;window.voice=(...x)=>{n++;return v(...x)};noteOn(64,.8);noteOff(64);window.voice=v;return n}'''
        r={'a0':await st(A),'a0play':await A.evaluate(played)}
        B=await c.new_page();B.on('pageerror',lambda e:errs.append(str(e)));await B.goto(url)
        r['aGate']=await st(A) # la seconda scheda ancora ferma davanti a INIZIA: la prima continua
        await B.keyboard.press('Enter');await B.wait_for_timeout(2500)
        r['a1']=await st(A);r['b1']=await st(B)
        # tasti del PC nella scheda in pausa: niente note
        r['a1keys']=await A.evaluate('''()=>{let n=0;const v=window.voice;window.voice=(...x)=>{n++;return v(...x)};
          dispatchEvent(new KeyboardEvent("keydown",{key:"a",code:"KeyA"}));dispatchEvent(new KeyboardEvent("keyup",{key:"a",code:"KeyA"}));window.voice=v;return n}''')
        await A.click('#awayBtn');await A.wait_for_timeout(500)
        r['a2']=await st(A);r['b2']=await st(B);r['a2play']=await A.evaluate(played)
        print(json.dumps(r))
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        ok(r['a0']=={'away':False,'ctx':'running','box':False} and r['a0play']==1,'una scheda sola: suona')
        ok(r['aGate']['away']==False,'la seconda scheda non ancora accesa non ferma la prima')
        ok(r['a1']=={'away':True,'ctx':'suspended','box':True} and r['b1']=={'away':False,'ctx':'running','box':False},'accesa la seconda, la prima va in pausa')
        ok(r['a1keys']==0,'nella scheda in pausa i tasti non suonano')
        ok(r['a2']=={'away':False,'ctx':'running','box':False} and r['b2']['away'] and r['b2']['ctx']=='suspended' and r['a2play']==1,'USA QUESTA SCHEDA: riprende questa e ferma l\'altra')
        ok(not errs,'nessun errore '+str(errs))
        await b.close()
asyncio.run(main())
