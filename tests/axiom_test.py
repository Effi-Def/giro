# Una sessione suonata solo dall'Axiom finto (axiom_finto.js): ogni messaggio passa dalle porte MIDI come con la tastiera vera
# (onmidimessage, atEvent col timeStamp, onMIDI). Porte nell'indicatore MIDI; primo loop lungo quanto il tempo fra la prima
# nota e il pad anche con la nota che arriva alla pagina 40 ms dopo; secondo loop agganciato; ● e ◀; manopole in modo MIDI
# e dalla porta HyperControl; ■ dalla porta HyperControl a fine giro; seconda scheda che mette in pausa la prima (l'Axiom
# arriva a tutte e due, suona solo quella accesa per ultima); cavo staccato che spegne le note tenute dal pedale.
import asyncio,json
from playwright.async_api import async_playwright
from giro import browser,apri
async def main():
    async with async_playwright() as p:
        b=await browser(p);c=await b.new_context();A,errs=await apri(b,ctx=c)
        r=await A.evaluate('''async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms)),res={},L=G.loops;
          res.porte=document.querySelector('#midi').textContent;
          SET.quant=0;
          // primo loop: pad 1, una nota, pad 1 dopo 2 s. La nota arriva alla pagina 40 ms dopo essere nata, il pad subito:
          // contando da quando la pagina li riceve il loop verrebbe 40 ms più corto
          axiom.pad(1);axiom.pad(1,false);await wait(100);res.pronto=L[0].state;
          axiom.ritardo=40;const t0=performance.now();axiom.nota(60);await wait(200);axiom.rilascia(60);axiom.ritardo=0;
          while(performance.now()-t0<2000)await wait(1);const t1=performance.now();axiom.pad(1);axiom.pad(1,false);await wait(300);
          res.primo=L[0].state;res.scartoMs=+((G.base/sr-(t1-t0)/1000)*1000).toFixed(2);
          // secondo loop sul pad 2, chiuso un po' prima della fine del giro: si aggancia alla lunghezza del primo
          axiom.pad(2);axiom.pad(2,false);await wait(50);axiom.nota(64);await wait(150);axiom.rilascia(64);await wait(1500);
          axiom.pad(2);axiom.pad(2,false);for(let k=0;k<100&&L[1].state!=='play';k++)await wait(20);
          res.secondo=L[1].state==='play'&&L[1].len===G.base&&G.sel===1;
          // ● sovraincide sul loop selezionato, ● di nuovo smette, ◀ annulla lo strato
          axiom.premi(18);await wait(50);res.dub=L[1].state;axiom.nota(67);await wait(150);axiom.rilascia(67);await wait(300);
          axiom.premi(18);await wait(500);const u0=L[1].undo;axiom.premi(19);await wait(300);res.annulla=[u0,L[1].undo];
          // manopola 1 in modo VOLUME: si aggancia passando dal valore attuale, poi comanda il volume del loop 1
          axiom.cc(1,Math.round(L[0].vol*127));axiom.cc(1,40);res.volume=Math.abs(L[0].vol-40/127)<1e-6;
          // porta HyperControl: pulsante dei modi due volte = PAN, manopola 1 (CC 33) tutta a destra
          axiom.hcCC(58,127);axiom.hcCC(58,0);axiom.hcCC(58,127);axiom.hcCC(58,0);res.modo=knobMode;
          axiom.hcCC(33,64);axiom.hcCC(33,127);res.pan=L[0].pan;
          axiom.hcCC(58,127);axiom.hcCC(58,0);
          // ■ dalla porta HyperControl (CC 116): si ferma alla fine del giro
          axiom.hcCC(116,127);axiom.hcCC(116,0);res.stopAFineGiro=G.stopAt>0&&(G.stopAt-G.origin)%G.base===0&&G.running;
          while(G.running)await wait(20);res.fermo=!G.running;
          return res}''')
        # seconda scheda accesa: la prima va in pausa e le note dell'Axiom suonano solo nella seconda
        B,errsB=await apri(b,ctx=c)
        suona='''()=>{let n=0;const v=window.voice;window.voice=(...x)=>{n++;return v(...x)};axiom.nota(62);axiom.rilascia(62);window.voice=v;return n}'''
        r['inPausa']=await A.evaluate('away');r['suonaA']=await A.evaluate(suona);r['suonaB']=await B.evaluate(suona)
        await B.close()
        # cavo staccato: le note tenute dal pedale si spengono, l'indicatore lo dice
        await A.click('#awayBtn');await A.wait_for_timeout(300)
        r.update(await A.evaluate('''async()=>{axiom.cc(64,127);axiom.nota(60);axiom.rilascia(60);const tenute=held.size;
          axiom.stacca();await new Promise(r=>setTimeout(r,100));return{tenute,staccato:held.size,porteDopo:document.querySelector('#midi').textContent}}'''))
        print(json.dumps(r,ensure_ascii=False))
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        ok('Axiom AIR Mini 32' in r['porte'],'indicatore MIDI con le porte dell\'Axiom («%s»)'%r['porte'])
        ok(r['pronto']=='armed' and r['primo']=='play','pad 1: pronto, poi primo loop chiuso')
        # la precisione fine dell'orologio la misura timing_test; qui conta che i 40 ms siano recuperati
        ok(abs(r['scartoMs'])<5,'primo loop lungo quanto il tempo fra la nota e il pad, con la nota ricevuta 40 ms dopo (scarto %.2f ms, senza compensazione −40)'%r['scartoMs'])
        ok(r['secondo'],'secondo loop agganciato al primo, e selezionato')
        ok(r['dub']=='dub' and r['annulla'][0]>=1 and r['annulla'][1]==r['annulla'][0]-1,'● sovraincide, ◀ annulla lo strato %s'%r['annulla'])
        ok(r['volume'],'manopola 1 (CC 1) agganciata: volume del loop 1')
        ok(r['modo']=='pan' and r['pan']==1,'HyperControl: pulsante dei modi su PAN, manopola 1 (CC 33) tutta a destra')
        ok(r['stopAFineGiro'] and r['fermo'],'HyperControl: ■ (CC 116) ferma alla fine del giro')
        ok(r['inPausa'] and r['suonaA']==0 and r['suonaB']==1,'due schede: suona solo quella accesa per ultima')
        ok(r['tenute']==1 and r['staccato']==0 and 'Nessuna tastiera' in r['porteDopo'],'cavo staccato: note spente («%s»)'%r['porteDopo'])
        ok(not errs and not errsB,'nessun errore '+str(errs+errsB))
        await b.close()
asyncio.run(main())
