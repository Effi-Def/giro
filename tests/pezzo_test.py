# Pezzo ripetuto (tasto V): IN e OUT sul sedicesimo, poi il loop selezionato ripete solo quel pezzo; V esce e il loop torna
# normale. Il contenuto del loop è una rampa (ogni indice ha il suo valore), così dall'uscita del loop si legge dove sta leggendo.
from pathlib import Path
import asyncio,json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        a=['--autoplay-policy=no-user-gesture-required']
        try:b=await p.chromium.launch(args=a)
        except Exception:b=await p.chromium.launch(args=a,channel='chrome') # sul PC dell'utente c'è solo Chrome
        pg=await b.new_page(viewport={'width':1366,'height':768})
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto((Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri())
        await pg.keyboard.press('Enter');await pg.wait_for_timeout(3500)
        await pg.evaluate('''async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));
          await Promise.all(SOUNDS.map((_,i)=>loadSound(i)));
          SET.quant=0;SET.amix=0;tap(0);await wait(30);noteOn(60,.8);await wait(100);noteOff(60);await wait(1900);tap(0);await wait(300);
          // rampa: indice j → .05 + .4·j/len (in uscita × volume .8)
          const L=G.loops[0],len=L.len,d=new Float32Array(len);for(let j=0;j<len;j++)d[j]=.05+.4*j/len;
          send({type:'load',i:0,data:d,len,t0:L.t0,vol:.8,pan:0,fx:0});send({type:'hp',i:0,v:0});send({type:'wid',i:0,v:0});send({type:'gate',i:0,on:1,frame:0});
          G.sel=0;await wait(300);
          window.grabIdx=async ms=>{const sp=ctx.createScriptProcessor(2048,1,1),out=[];sp.onaudioprocess=e=>out.push(new Float32Array(e.inputBuffer.getChannelData(0)));
            loopOut[0].connect(sp);sp.connect(ctx.destination);await wait(ms);loopOut[0].disconnect(sp);sp.disconnect();
            const r=[];out.forEach(c=>c.forEach(x=>r.push(Math.round((x/.8-.05)/.4*len))));return r.slice(4096)}}''')
        r={}
        st=lambda:pg.evaluate('''()=>({cut:CUT&&{...CUT},hint:document.querySelector('#hint').textContent,btn:document.querySelector('#cutBtn').textContent,
          pad:document.querySelector('.loop[data-loop="0"] .st').textContent,cr:!document.querySelector('.loop[data-loop="0"] .cutr').hidden,
          step:cutStep(),origin:G.origin,t0:G.loops[0].t0,len:G.loops[0].len})''')
        await pg.keyboard.press('v');await pg.wait_for_timeout(150);r['in']=await st()
        await pg.wait_for_timeout(450)
        await pg.keyboard.press('v');await pg.wait_for_timeout(250);r['out']=await st()
        idx=await pg.evaluate('grabIdx(900)')
        c=r['out']['cut'];n=r['out']['len'];s0=(c['s']-r['out']['t0'])%n if c else 0
        inside=[((j-s0)%n)<=c['p']+2 for j in idx] if c else [False]
        r['dentro']=sum(inside)/len(inside)
        # pulsante a schermo: esce
        await pg.dispatch_event('#cutBtn','pointerdown');await pg.wait_for_timeout(200);r['esci']=await st()
        idx2=await pg.evaluate('grabIdx(600)')
        r['fuori']=sum(1 for j in idx2 if c and ((j-s0)%n)>c['p']+2)/max(1,len(idx2))
        # con passi consecutivi la lettura avanza di un campione alla volta (niente ripetizioni)
        r['avanza']=sum(1 for k in range(1,len(idx2)) if (idx2[k]-idx2[k-1])%n in (0,1,2))/max(1,len(idx2)-1)
        # ■ e STOP EFFETTI escono dal pezzo; cancellare il loop anche
        r['stop']=await pg.evaluate('''async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms)),res={};
          cutButton();await wait(300);cutButton();await wait(100);res.on=!!CUT?.p;stopAllFx();res.fx=CUT===null;
          cutButton();await wait(300);cutButton();await wait(100);stopAll();res.stop=CUT===null;
          cutButton();res.fermo=CUT===null&&document.querySelector('#hint').textContent.includes('loop che suona');
          playAll();await wait(300);cutButton();await wait(300);cutButton();await wait(100);clearLoop(0);await wait(300);tick();res.clear=CUT===null;return res}''')
        import sys;sys.stdout.reconfigure(encoding='utf-8')
        print(json.dumps(r,ensure_ascii=False,default=str))
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        I,O=r['in'],r['out']
        ok(I['cut'] and not I['cut']['p'] and I['pad']=='IN…' and 'IN' in I['hint'] and I['btn'].endswith('OUT') and I['cr'],'V: IN segnato (pad, riga in alto, pulsante, forma d\'onda)')
        k=(I['cut']['s']-I['origin'])/I['step'] if I['cut'] else .5
        ok(abs(k-round(k))*I['step']<1.01,'IN sul sedicesimo')
        n16=O['cut']['p']/O['step'] if O['cut'] else 0
        ok(O['cut'] and O['cut']['p']>0 and abs(n16-round(n16))*O['step']<2 and O['pad']=='↻ PEZZO' and 'ripete il pezzo' in O['hint'] and O['btn'].endswith('ESCI'),'V di nuovo: OUT, pezzo di %.0f sedicesimi («%s»)'%(n16,O['hint']))
        ok(r['dentro']>.97,'il loop legge solo dentro il pezzo (%.1f%%)'%(r['dentro']*100))
        ok(r['esci']['cut'] is None and r['esci']['pad']=='' and r['esci']['btn'].endswith('IN') and not r['esci']['cr'],'pulsante a schermo: esce')
        ok(r['fuori']>.3 and r['avanza']>.99,'fuori dal pezzo il loop torna a leggere tutto, di seguito (fuori %.0f%%, di seguito %.1f%%)'%(r['fuori']*100,r['avanza']*100))
        S=r['stop'];ok(S['on'] and S['fx'] and S['stop'] and S['fermo'] and S['clear'],'STOP EFFETTI, ■ e cancella escono dal pezzo; da fermo non parte')
        ok(not errs,'nessun errore '+str(errs))
        await b.close()
asyncio.run(main())
