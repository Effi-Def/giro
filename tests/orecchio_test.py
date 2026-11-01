# Log di debug per Orecchio: primo giro, secondo loop che parte fuori griglia, sovraincisione con note MIDI finte,
# Ctrl+Shift+D, file letto da orecchio.py. Note e audio devono combaciare anche sui loop con t0 fuori griglia,
# una Q spenta non deve sembrare un errore di calcolo, un loop annullato deve sparire dalle note.
from pathlib import Path
import asyncio,base64,io,json,sys,tempfile
from playwright.async_api import async_playwright
import numpy as np
from scipy.io import wavfile
ROOT=Path(__file__).resolve().parent.parent
sys.path.insert(0,str(ROOT/'orecchio'))
from orecchio import analizza,scrivi_report
SUONA='''async()=>{
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 // come onmidimessage: l'evento passa da atEvent col suo timeStamp
 const midi=(st,a,b)=>atEvent({timeStamp:performance.now(),data:[st,a,b]},()=>onMIDI({data:[st,a,b]}));
 const on=async(n,ms=90)=>{midi(0x90,n,100);await wait(ms);midi(0x80,n,0)};
 const until=async t=>{while(ctx.currentTime<t)await wait(1)};
 setSound(0);await loadSound(0);
 // primo giro: 4 quarti da 0,5 s
 midi(0x90,36,100);midi(0x80,36,0);await wait(30);
 const t0=ctx.currentTime;on(60);
 for(let k=1;k<4;k++){await until(t0+k*.5);on(64+k)}
 await until(t0+2);midi(0x90,36,100);midi(0x80,36,0);
 const o=G.origin/sr,B=G.base/sr;
 // secondo loop: parte fuori griglia (t0 lontano dall'origine), note vicine agli ottavi, una prima della fine
 await until(o+B+.33);midi(0x90,37,100);midi(0x80,37,0);await wait(20);
 for(const c of [.41,.75,1.26,1.74]){await until(o+B+c*B/2);on(50+Math.round(c*4),80)}
 await until(o+2*B-.03);on(55,60);
 await until(o+2*B+.38);midi(0x90,37,100);midi(0x80,37,0);
 await wait(700);
 // sovraincisione sul primo loop
 G.sel=0;midi(0xB0,18,127);await wait(10);
 const b=Math.ceil(ctx.currentTime/.5-o/.5)*.5+o;
 for(let k=1;k<=4;k++){await until(b+k*.25);await on(72+k,60)}
 midi(0xB0,18,127);
 await wait(2500);
 return{base:G.base/sr,beats:G.beats,origin:G.origin,t1:G.loops[1].t0,noteRec:DBG.notes.length}}'''
async def scarica(pg,dest):
    async with pg.expect_download() as d:
        await pg.keyboard.press('Control+Shift+D')
    dl=await d.value
    p=Path(dest)/dl.suggested_filename;await dl.save_as(p);return p
async def main():
    bad=[]
    def ck(c,m):
        print('OK  ' if c else 'FAIL',m)
        if not c:bad.append(m)
    async with async_playwright() as p:
        a=['--autoplay-policy=no-user-gesture-required']
        try:b=await p.chromium.launch(args=a)
        except Exception:b=await p.chromium.launch(args=a,channel='chrome') # sul PC dell'utente c'è solo Chrome
        ctx=await b.new_context(viewport={'width':1366,'height':768},accept_downloads=True);pg=await ctx.new_page()
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto((ROOT/'dist'/'giro.html').as_uri())
        await pg.keyboard.press('Enter');await pg.wait_for_timeout(3500)
        with tempfile.TemporaryDirectory() as tmp:
            # senza loop niente file, solo l'avviso
            await pg.keyboard.press('Control+Shift+D');await pg.wait_for_timeout(200)
            ck('niente da esportare' in (await pg.evaluate('hintOverride')),'senza loop: avviso, nessun file')
            r=await pg.evaluate(SUONA);print(r)
            f=await scarica(pg,tmp)
            ck(f.name.startswith('giro_debug_') and len(f.stem)==len('giro_debug_AAAAMMGG-HHMMSS'),'nome del file: '+f.name)
            await pg.wait_for_timeout(100)
            ck(await pg.evaluate('hintOverride')=='Debug esportato','riga dei suggerimenti: Debug esportato')
            log=json.loads(f.read_text(encoding='utf-8'))
            rep,num,peg,passo=analizza(log,tmp)
            testo=scrivi_report(f.name,rep,num,peg,passo)
            sys.stdout.reconfigure(encoding='utf-8');print(testo)
            sr=log['sampleRate'];L1=next(l for l in log['loops'] if l['id']==1)
            ck(abs((r['t1']-r['origin'])/sr-round((r['t1']-r['origin'])/sr/passo)*passo)>.01,'il secondo loop parte fuori griglia (la prova vale)')
            for k in ('ingresso','griglia_note','quantizzazione','note_doppie','rendering','giri'):ck(k in num,'sezione del report: '+k)
            ch={x.chiave for x in rep}
            for k in ('griglia_non_intera','calcolo_quantizzazione','bug_fine_giro','note_mancanti','doppio_trigger','loop_non_multiplo'):ck(k not in ch,'nessun falso allarme: '+k)
            ck(not any(k.startswith(('sfasati','deriva')) for k in ch),'giri puliti: '+str(sorted(ch)))
            ck(num['quantizzazione']['errori_calcolo']==0 and num['quantizzazione']['fuori_dal_giro']==0,'qpos è la casella più vicina')
            ck(L1['lengthSamples']%round(r['base']*sr)==0,'lunghezza del secondo loop multipla del primo')
            sr2,d=wavfile.read(io.BytesIO(base64.b64decode(L1['wavBase64'])))
            ck(sr2==sr and d.dtype==np.int16 and d.ndim==1 and len(d)==L1['lengthSamples'],'WAV PCM 16 bit mono')
            # il campione vero sta nel WAV esattamente a qpos, anche sul loop con t0 fuori griglia (correlazione col campione reso a parte)
            nl1=[n for n in log['notes'] if n['loop']==1]
            segs=await pg.evaluate('ps=>Object.fromEntries(ps.map(n=>[n,Array.from(renderNote(0,n,100/127,sr*.08,1).subarray(0,Math.round(sr*.04)))]))',sorted({n['pitch'] for n in nl1}))
            x=np.tile(d.astype(float),3);M=round(.02*sr);lag=[]
            for n in nl1:
                s=np.array(segs[str(n['pitch'])]);c=len(d)+round(n['qpos']*sr)
                lag.append(int(np.argmax(np.correlate(x[c-M:c+M+len(s)],s,'valid')))-M)
            ck(len(lag)==5 and all(abs(l)<=1 for l in lag),'campioni nel WAV esattamente a qpos, scarti in campioni: '+str(lag))
            ck(all(0<=n['qpos']<L1['lengthSamples']/sr for n in log['notes'] if n['loop']==1),'note del secondo loop dentro il giro')
            ck(any(n['loop']==1 and n['qpos']==0 for n in log['notes']),'nota prima della fine portata sullo 0 del giro')
            ck(any(not n['overdub'] for n in log['notes']) and all(n['overdub'] or n['loop']==0 for n in log['notes']),'overdub falso solo nel primo giro')
            ck(all(n['midiTs']<=n['perfArrival'] for n in log['notes']),'midiTs e perfArrival sulla stessa scala')
            # Q spenta: qpos nullo, niente errori di calcolo
            await pg.evaluate('''async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));const midi=(st,a,b)=>atEvent({timeStamp:performance.now()},()=>onMIDI({data:[st,a,b]}));
             setQuant(0);G.sel=1;midi(0xB0,18,127);await wait(50);for(const n of[80,81,82]){midi(0x90,n,100);await wait(170);midi(0x80,n,0);await wait(40)}midi(0xB0,18,127);await wait(300)}''')
            log2=json.loads((await scarica(pg,tmp)).read_text(encoding='utf-8'))
            sp=[n for n in log2['notes'] if n['pitch'] in (80,81,82)]
            ck(len(sp)==3 and all(n['qpos'] is None for n in sp),'Q spenta: qpos nullo')
            rep2,num2,_,_=analizza(log2,tmp)
            ck(num2['quantizzazione']['errori_calcolo']==0,'Q spenta: nessun errore di calcolo')
            ck(num2['quantizzazione']['spente']==3 and num2['quantizzazione']['misurate']>0,'Q spenta: le note contate come non misurate')
            # annulla: le note di quel loop non descrivono più il suo audio
            await pg.evaluate('G.sel=1;undoSel(false)');await pg.wait_for_timeout(200)
            log3=json.loads((await scarica(pg,tmp)).read_text(encoding='utf-8'))
            ck(not [n for n in log3['notes'] if n['loop']==1] and [n for n in log3['notes'] if n['loop']==0],'annulla: spariscono solo le note di quel loop')
            _,num3,_,_=analizza(log3,tmp)
            ck(num3.get('senza_note',{}).get(1,{}).get('attacchi',0)>=4 and 0 not in num3['senza_note'],'annulla: il loop senza note si misura dagli attacchi nell\'audio '+str(num3.get('senza_note')))
            ck(abs(num3['senza_note'][1]['scarto_medio_ms'])<10,'annulla: quel loop era quantizzato, gli attacchi stanno sulla griglia')
            await pg.evaluate('clearAll()')
            await pg.keyboard.press('Control+Shift+D');await pg.wait_for_timeout(200)
            ck(await pg.evaluate('DBG.notes.length+DBG.wraps.length')==0,'cancella tutto: log vuoto')
        ck(not errs,'nessun errore nella pagina '+str(errs))
        await b.close()
    # primo giro nel loop 3 e loop 0 lungo il doppio: non è sfasato
    w=[dict(loop=3,ctx=1.+k) for k in range(6)]+[dict(loop=0,ctx=1.+2*k) for k in range(3)]
    rep,_,_,_=analizza(dict(sampleRate=1000,grid=dict(step=.125,loopLength=1.),notes=[],wraps=w,loops=[dict(id=3,lengthSamples=1000),dict(id=0,lengthSamples=2000)]))
    ck(not [x for x in rep if x.chiave.startswith('sfasati')],'il riferimento dei giri è il loop più corto')
    assert not bad,bad
    print('OK')
asyncio.run(main())
