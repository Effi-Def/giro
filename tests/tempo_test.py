# Tempo (− e +): i loop diventano più veloci o più lenti senza cambiare intonazione, sul prossimo 1. Un tono di 440 Hz resta a
# 440 Hz, i colpi sui battiti restano sui battiti della griglia nuova, tornando al tempo del primo giro i loop sono identici;
# limite ±15%, niente cambio mentre si registra, tasti e pulsanti, il thread principale non si blocca mentre stira.
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
        r=await pg.evaluate('''async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms));const res={};
          await Promise.all(SOUNDS.map((_,i)=>loadSound(i))); // caricare i suoni ferma la pagina
          res.offBtn=document.querySelector('#bpmUp').disabled;tempoStep(1);res.hintVuoto=document.querySelector('#hint').textContent;
          SET.quant=0;tap(0);await wait(30);noteOn(60,.8);await wait(100);noteOff(60);await wait(1900);tap(0);await wait(3200);
          const base0=G.base,b0=bpm();res.onBtn=!document.querySelector('#bpmUp').disabled;
          // loop 1: tono a 440 Hz circa (un numero intero di periodi); loop 2: un colpo breve su ogni battito della griglia, lungo 2 giri
          const len=base0,cyc=Math.round(440*len/sr),f0=cyc*sr/len,tone=new Float32Array(len);for(let j=0;j<len;j++)tone[j]=.3*Math.sin(2*Math.PI*cyc*j/len);
          const B=G.base/G.beats,len2=2*len,clk=new Float32Array(len2),off=1234; // t0 fuori griglia, come un loop dopo il primo
          for(let k=0;k<2*G.beats;k++){const p=dmod(Math.round(k*B)-off,len2);for(let j=0;j<96;j++)clk[(p+j)%len2]+=.8*Math.exp(-j/20)*Math.sin(j*.9)}
          send({type:'load',i:0,data:tone.slice(),len,t0:G.origin,vol:.8,pan:0,fx:0});send({type:'load',i:1,data:clk.slice(),len:len2,t0:G.origin+off,vol:.8,pan:0,fx:0});
          await wait(300);playAll();await wait(500);
          // audio dei loop dal core
          const dump=()=>new Promise(ok=>{const o=onCoreMsg;onCoreMsg=m=>{if(m.type==='dump'&&m.tag==='t'){onCoreMsg=o;
            ok(m.items.map(it=>{const d=new Float32Array(it.len);let q=0;for(const c of it.chunks){d.set(c,q);q+=c.length}return{i:it.i,len:it.len,t0:it.t0,d}}))}else o(m)};send({type:'dump',all:true,exp:true,tag:'t'})});
          const freq=x=>{const p=[];let l=-1;for(let j=1;j<x.length;j++)if(x[j-1]<0&&x[j]>=0){if(l>=0)p.push(j-l);l=j}return sr*p.length/p.reduce((a,b)=>a+b,0)};
          // colpi: primo campione oltre metà del massimo, contato dall'origine della griglia; scarto dal battito più vicino in ms
          const hits=it=>{const rot=dmod(it.t0-G.origin,it.len),w=new Float32Array(it.len);w.set(it.d.subarray(it.len-rot),0);w.set(it.d.subarray(0,it.len-rot),rot);
            const B=G.base/G.beats,out=[];let j=0;while(j<w.length){if(Math.abs(w[j])>.4){out.push(+(((j-Math.round(j/B)*B))/sr*1000).toFixed(2));j+=Math.round(B/2)}else j++}return out};
          const waitBase=async(ms)=>{const b=G.base,t=performance.now();while(G.base===b&&performance.now()-t<ms)await wait(50);return performance.now()-t};
          // il thread principale: il blocco più lungo mentre stira (i pezzi lasciano passare le note)
          let last=performance.now(),gap=0;const tm=setInterval(()=>{const n=performance.now();gap=Math.max(gap,n-last);last=n},4);
          const sent=[],send0=send;send=(c,t)=>{if(c.type==='tempo')sent.push({frame:c.frame,now:nowF(),bar:dmod(c.frame-G.origin,barF())});send0(c,t)};
          for(let k=0;k<8;k++)tempoStep(1);
          res.want=TEMPO.want;res.hintWant=document.querySelector('#hint').textContent;res.info=document.querySelector('#info').className;
          await wait(900);res.hintBusy=document.querySelector('#hint').textContent;
          const t1=await waitBase(8000);clearInterval(tm);send=send0;res.gapMs=+gap.toFixed(1);res.waitMs=Math.round(t1);
          await wait(300);
          res.sent=sent;res.bpm=+bpm().toFixed(2);res.baseRatio=+(G.base/base0).toFixed(5);res.base0=G.base0===base0;
          res.lens=[G.loops[0].len,G.loops[1].len,G.base];res.undo=G.loops[0].undo;res.hintDone=document.querySelector('#hint').textContent;res.wantDopo=TEMPO.want;
          let D=await dump();res.f0=+f0.toFixed(2);res.fNuovo=+freq(D[0].d).toFixed(2);res.hits=hits(D[1]);res.nHits=res.hits.length;
          // uscita vera: il tono che si sente
          // di nuovo al tempo del primo giro: identici
          for(let k=0;k<8;k++)tempoStep(-1);res.wantBack=TEMPO.want;await waitBase(8000);await wait(300);
          D=await dump();res.baseBack=G.base===base0;let e0=0,e1=0;for(let j=0;j<len;j++)e0=Math.max(e0,Math.abs(D[0].d[j]-tone[j]));for(let j=0;j<len2;j++)e1=Math.max(e1,Math.abs(D[1].d[j]-clk[j]));
          res.identici=[e0,e1];res.hitsBack=hits(D[1]);
          // più lento
          for(let k=0;k<10;k++)tempoStep(-1);await waitBase(8000);await wait(300);D=await dump();res.bpmLento=+bpm().toFixed(2);res.fLento=+freq(D[0].d).toFixed(2);res.hitsLento=hits(D[1]);
          // limite: ±15% dal primo giro
          for(let k=0;k<60;k++)tempoStep(1);res.wantMax=TEMPO.want;res.lim=tempoLim();res.hintMax=document.querySelector('#hint').textContent;tempoCancel();
          // mentre si registra non si cambia
          tap(2);await wait(30);noteOn(64,.8);await wait(50);tempoStep(1);res.hintRec=document.querySelector('#hint').textContent;res.wantRec=TEMPO.want;noteOff(64);undoSel(false);await wait(100);
          // pulsanti
          document.querySelector('#bpmUp').click();res.btnUp=TEMPO.want;tempoCancel();document.querySelector('#bpmDn').click();res.btnDn=TEMPO.want;tempoCancel();
          res.bpmNow=Math.round(bpm());
          return res}''')
        # tasti del PC
        await pg.keyboard.press('+');kp=await pg.evaluate('TEMPO.want');await pg.evaluate('tempoCancel()')
        await pg.keyboard.press('-');km=await pg.evaluate('TEMPO.want');await pg.evaluate('tempoCancel()')
        import sys;sys.stdout.reconfigure(encoding='utf-8')
        print(json.dumps(r,ensure_ascii=False))
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        ok(r['offBtn'] and 'primo giro' in r['hintVuoto'],'senza giro: − e + spenti, la riga dice di registrarlo')
        ok(r['onBtn'] and r['want']>0 and '→' in r['hintWant'] and r['info']=='on','dopo il primo giro: + chiede il tempo nuovo («%s»)'%r['hintWant'])
        ok('preparo' in r['hintBusy'] or r['waitMs']<900,'mentre prepara la riga lo dice («%s»)'%r['hintBusy'])
        ok(len(r['sent'])==1 and r['sent'][0]['bar']==0,'il cambio entra su un 1 (%s)'%r['sent'])
        ok(abs(r['bpm']-r['want'])<.05 and r['base0'] and r['lens'][0]==r['lens'][2] and r['lens'][1]==2*r['lens'][2],'tempo nuovo: %.2f bpm, loop lunghi 1 e 2 giri nuovi'%r['bpm'])
        ok(abs(r['fNuovo']-r['f0'])<r['f0']*.005,'intonazione uguale: %.2f Hz (prima %.2f)'%(r['fNuovo'],r['f0']))
        ok(r['nHits']==2*4 and max(map(abs,r['hits']))<4,'colpi sui battiti della griglia nuova (scarti ms: %s)'%r['hits'])
        ok(r['gapMs']<40,'il thread principale non si blocca mentre stira (blocco più lungo %.1f ms, pronto in %d ms)'%(r['gapMs'],r['waitMs']))
        ok(r['undo']==0 and r['wantDopo']==0 and 'Tempo' in r['hintDone'],'dopo: annulla vuoto, la riga dice il tempo («%s»)'%r['hintDone'])
        ok(r['baseBack'] and r['identici']==[0,0],'tornando al tempo del primo giro i loop sono identici (%s)'%r['identici'])
        ok(abs(r['fLento']-r['f0'])<r['f0']*.005 and max(map(abs,r['hitsLento']))<4,'più lento (%.2f bpm): %.2f Hz, colpi %s'%(r['bpmLento'],r['fLento'],r['hitsLento']))
        ok(r['wantMax']==r['lim'][1] and 'Più veloce' in r['hintMax'],'limite +15%%: %s («%s»)'%(r['wantMax'],r['hintMax']))
        ok(r['wantRec']==0 and 'registrazione' in r['hintRec'],'mentre registri niente cambio («%s»)'%r['hintRec'])
        ok(r['btnUp']==r['bpmNow']+1 and r['btnDn']==r['bpmNow']-1 and kp==r['bpmNow']+1 and km==r['bpmNow']-1,'pulsanti − + e tasti − + del PC')
        ok(not errs,'nessun errore '+str(errs))
        await b.close()
asyncio.run(main())
