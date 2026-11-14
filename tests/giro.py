"""Per i test: apre dist/giro.html in Chromium con l'Axiom finto (axiom_finto.js) al posto del MIDI vero.
Uso: b=await browser(p); pg,errs=await apri(b) — la pagina è già dopo INIZIA, con i suoni caricati."""
import sys
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8') # la console di Windows non stampa ● ◀ ▶
T=Path(__file__).resolve().parent
GIRO=(T.parent/'dist'/'giro.html').as_uri()
AXIOM=(T/'axiom_finto.js').read_text(encoding='utf-8')
ARGS=['--autoplay-policy=no-user-gesture-required']
async def browser(p,chrome=False):
    # il Chromium di Playwright; sul PC dell'utente c'è solo Chrome
    if not chrome:
        try:return await p.chromium.launch(args=ARGS)
        except Exception:pass
    return await p.chromium.launch(args=ARGS,channel='chrome')
# ctx: un contesto del browser in comune, per più schede di Giro che si vedono fra loro
async def apri(b,w=1366,h=768,inizia=True,ctx=None):
    if ctx:pg=await ctx.new_page();await pg.set_viewport_size({'width':w,'height':h})
    else:pg=await b.new_page(viewport={'width':w,'height':h})
    errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.add_init_script(AXIOM)
    await pg.goto(GIRO)
    if inizia:await pg.keyboard.press('Enter');await pg.wait_for_timeout(3500)
    return pg,errs
