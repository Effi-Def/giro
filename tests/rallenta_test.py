# Velocità (manopola 4) ed eco. Velocità: un tono dentro il loop scende a sinistra del centro, sale a destra, si ferma tutta a
# sinistra, torna a tempo su un 1; le note suonate non cambiano. Eco: ripetizioni distanti un battito, ogni volta più basse,
# che continuano dopo aver abbassato la manopola.
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
          const grab=async(src,ms)=>{const sp=ctx.createScriptProcessor(2048,1,1),out=[];sp.onaudioprocess=e=>out.push(new Float32Array(e.inputBuffer.getChannelData(0)));
            src.connect(sp);sp.connect(ctx.destination);await wait(ms);src.disconnect(sp);sp.disconnect();const x=new Float32Array(out.length*2048);out.forEach((c,j)=>x.set(c,j*2048));return x};
          // dal periodo mediano: un buffer di cattura perso a pagina appena aperta non conta
          const freq=x=>{const p=[];let l=-1;for(let j=1;j<x.length;j++)if(x[j-1]<0&&x[j]>=0){if(l>=0)p.push(j-l);l=j}p.sort((a,b)=>a-b);if(!p.length)return 0;
            const m=p[p.length>>1],ok=p.filter(v=>Math.abs(v-m)<=2);return sr*ok.length/ok.reduce((a,b)=>a+b,0)};
          const rms=x=>{let s=0;for(const v of x)s+=v*v;return Math.sqrt(s/x.length)};
          const toBack=L=>wait(Math.max(0,(L.rb/sr-ctx.currentTime)*1000)+200);
          await Promise.all(SOUNDS.map((_,i)=>loadSound(i))); // caricare i suoni ferma la pagina
          // un giro, poi dentro il loop un tono di 440 Hz circa (un numero intero di periodi)
          SET.quant=0;tap(0);await wait(30);noteOn(60,.8);await wait(100);noteOff(60);await wait(1900);tap(0);await wait(300);
          setKnobMode("dj");await wait(3200);
          const L=G.loops[0],len=L.len,cyc=Math.round(440*len/sr),f0=cyc*sr/len,d=new Float32Array(len);for(let j=0;j<len;j++)d[j]=.3*Math.sin(2*Math.PI*cyc*j/len);
          send({type:'load',i:0,data:d,len,t0:L.t0,vol:.8,pan:0,fx:0});send({type:'gate',i:0,on:1,frame:0});await wait(200);
          res.f0exp=f0;res.route=loopTo.every(n=>n===masterIn||n===PG.pump);
          // l'avviso accanto alla riga dei suggerimenti, che intanto resta
          const note=()=>{const e=document.querySelector('#speedNote');return e.hidden?'':e.textContent},riga=()=>document.querySelector('#hint').textContent;
          res.f0=freq(await grab(masterIn,300));res.text0=djText(3);res.note0=note();
          // 141%: non si può agganciare; ½× e 2× sì, sul prossimo 1
          const inviati=[],send0=send;send=(c,t)=>{if(c.type==='rate')inviati.push(c);send0(c,t)};
          knob(3,90);await wait(200);res.homeLibero=inviati.at(-1).home;res.noteLibero=note();
          knob(3,127);await wait(200);res.home2=inviati.at(-1);res.home2Bar=((inviati.at(-1).home-G.origin)%barF()+barF())%barF();res.note2=note();
          knob(3,33);await wait(200);res.home05=inviati.at(-1);res.home05Bar=((inviati.at(-1).home-G.origin)%barF()+barF())%barF();send=send0;
          knob(3,32);await wait(800);res.textS=djText(3);res.noteS=note();res.hintS=riga();res.fS=freq(await grab(masterIn,400));res.expS=f0/2;
          // una nota suonata non cambia
          const n=ctx.createOscillator();n.frequency.value=1000;const ng=ctx.createGain();ng.gain.value=.3;n.connect(ng);ng.connect(masterIn);n.start();
          send({type:'vol',i:0,v:0});await wait(150);res.fLive=freq(await grab(masterIn,200));n.stop();n.disconnect();ng.disconnect();send({type:'vol',i:0,v:.8});
          knob(3,96);await wait(800);res.textF=djText(3);res.fF=freq(await grab(masterIn,400));res.expF=f0*(1+(96-64)/63);
          knob(3,127);await wait(800);res.fMax=freq(await grab(masterIn,400));res.textMax=djText(3);
          knob(3,0);await wait(1200);res.textStop=djText(3);res.noteStop=note();res.rmsStop=rms(await grab(masterIn,300));
          // al centro: torna a tempo su un 1
          knob(3,64);await wait(100);res.back=L.rb;res.textBack=djText(3);res.noteBack=note();res.onBar=L.rb?(((L.rb-G.origin)%barF())+barF())%barF():-1;
          await toBack(L);res.textOff=djText(3);res.rbOff=L.rb;res.noteOff=note();res.f1=freq(await grab(masterIn,300));
          // ■: niente velocità a loop fermi; ▶ con la manopola girata la riprende
          knob(3,127);await wait(300);stopAll();await wait(100);res.stopRt=L.rt;res.noteFermo=note();playAll();await wait(200);res.playRt=L.rt;
          // con le manopole su un altro modo la manopola 4 non arriva alla velocità
          setKnobMode("vol");await wait(50);res.noteVol=note();setKnobMode("dj");
          // STOP EFFETTI: torna al centro e a tempo
          stopAllFx();await wait(100);res.fxOff=DJV[3]===0&&L.rt===1&&djText(3)==="a tempo sull'1";res.noteFx=note();await toBack(L);res.noteFxOff=note();
          // sul singolo loop: vale solo per lui
          G.sel=0;setFxScope('loop');knob(3,32);await wait(100);res.loopRt=L.rt;res.otherRt=G.loops[1].rt??1;res.noteLoop=note();res.padLoop=document.querySelector('.loop[data-loop="0"] .snm').textContent;
          G.sel=1;setFxScope('loop');await wait(50);render();res.noteAltro=note();res.padAltro=document.querySelector('.loop[data-loop="0"] .snm').textContent;G.sel=0;
          setFxScope('mix');await wait(50);res.noteLoopMix=note();stopAllFx();await wait(100);await toBack(L);res.padFine=document.querySelector('.loop[data-loop="0"] .snm').textContent;
          send({type:'vol',i:0,v:0});await wait(100);
          // eco: un colpo solo; le ripetizioni cadono a un battito l'una dall'altra e calano
          knob(1,100);await wait(400);const c=ctx.createBufferSource(),bf=ctx.createBuffer(1,64,sr);bf.getChannelData(0).fill(.8);c.buffer=bf;c.connect(DJ.r);
          const beat=beatS(),gr=grab(DJ.eWet,Math.round(beat*4.5*1000));await wait(100);c.start();const x=await gr;c.disconnect();
          const W=Math.round(beat*sr),peaks=[];let at=0;for(let j=0;j<x.length;j++)if(Math.abs(x[j])>.02){at=j;break}
          // istante di ogni ripetizione: il primo campione oltre il 30% del suo massimo (il massimo si sposta col filtro)
          for(let k=0;k<3;k++){const j0=Math.max(0,at+k*W-sr*.03|0),j1=Math.min(x.length,at+k*W+sr*.03|0);let m=0,q=-1;for(let j=j0;j<j1;j++)m=Math.max(m,Math.abs(x[j]));
            for(let j=j0;j<j1;j++)if(Math.abs(x[j])>=m*.3){q=j;break}peaks.push({m:+m.toFixed(4),q})}
          res.echo={beat:+beat.toFixed(4),gaps:[1,2].map(k=>+(((peaks[k].q-peaks[k-1].q)/sr-beat)*1000).toFixed(2)),lev:peaks.map(p=>p.m)};
          // abbassando la manopola entra niente di nuovo, ma le ripetizioni continuano
          const c2=ctx.createBufferSource();c2.buffer=bf;c2.connect(DJ.r);c2.start();await wait(50);knob(1,0);await wait(100);
          const tail=await grab(DJ.eWet,Math.round(beat*1.4*1000));c2.disconnect();res.tail=+Math.max(...tail.map(Math.abs)).toFixed(4);res.sendOff=DJ.eSend.gain.value<.01;
          return res}''')
        import sys;sys.stdout.reconfigure(encoding='utf-8')
        print(json.dumps(r,ensure_ascii=False))
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        ok(r['route'],'i loop vanno a masterIn o alla pompa')
        ok(abs(r['f0']-r['f0exp'])<3 and r['text0']=='normale','al centro: frequenza intatta (%.1f Hz)'%r['f0'])
        ok(abs(r['fS']-r['expS'])<3 and r['textS']=='50%','a sinistra rallenta, a metà esatta (%.1f Hz, attesi %.1f, «%s»)'%(r['fS'],r['expS'],r['textS']))
        ok(r['homeLibero']==0 and 'fuori tempo' in r['noteLibero'],'a 141%% niente aggancio, e l\'avviso dice fuori tempo («%s»)'%r['noteLibero'])
        ok(r['home2']['v']==2 and r['home2']['home']>0 and r['home2Bar']==0 and 'a tempo' in r['note2'],'a 2×: aggancio su un 1 («%s»)'%r['note2'])
        ok(r['home05']['v']==.5 and r['home05']['home']>0 and r['home05Bar']==0,'a ½×: aggancio su un 1, anche un valore accanto')
        ok(abs(r['fLive']-1000)<5,'le note suonate non cambiano (%.1f Hz)'%r['fLive'])
        ok(abs(r['fF']-r['expF'])<8 and r['textF']=='151%','a destra accelera (%.1f Hz, attesi %.1f, «%s»)'%(r['fF'],r['expF'],r['textF']))
        ok(abs(r['fMax']-2*r['f0exp'])<10 and r['textMax']=='200%','tutta a destra: il doppio (%.1f Hz)'%r['fMax'])
        ok(r['textStop']=='fermo' and r['rmsStop']<.002,'tutta a sinistra: fermo e in silenzio (rms %.4f)'%r['rmsStop'])
        ok(r['back'] and r['onBar']==0 and r['textBack']=="a tempo sull'1",'al centro: ritorno sull\'1 (resto %s, «%s»)'%(r['onBar'],r['textBack']))
        ok(r['rbOff']==0 and r['textOff']=='normale' and abs(r['f1']-r['f0exp'])<3,'dopo l\'1 di nuovo normale (%.1f Hz)'%r['f1'])
        ok(r['stopRt']==1 and r['playRt']==2,'■ la spegne, ▶ con la manopola girata la riprende')
        ok(r['fxOff'],'STOP EFFETTI: torna al centro e a tempo')
        ok(r['loopRt']==.5 and r['otherRt']==1,'sul singolo loop vale solo per lui')
        ok(r['note0']=='' and r['noteOff']=='' and r['noteFxOff']=='','avviso: non c\'è a velocità normale')
        ok('LOOP AL 50%' in r['noteS'] and 'ottava sotto' in r['noteS'] and 'manopola 4 al centro' in r['noteS'] and r['hintS'],'avviso: percentuale e cosa fare, la riga resta («%s» · «%s»)'%(r['noteS'],r['hintS']))
        ok('LOOP FERMI' in r['noteStop'],'avviso: tutta a sinistra («%s»)'%r['noteStop'])
        ok('sull\'1' in r['noteBack'] and 'sull\'1' in r['noteFx'],'avviso: al centro e con STOP EFFETTI dice che torna a tempo («%s»)'%r['noteBack'])
        ok('LOOP AL 200%' in r['noteFermo'],'avviso: anche a loop fermi, perché ▶ la riprende')
        ok('tasto centrale tenuto' in r['noteVol'] and 'manopola' not in r['noteVol'],'avviso: col modo volume indica il tasto centrale tenuto («%s»)'%r['noteVol'])
        ok('LOOP 1 AL 50%' in r['noteLoop'] and 'manopola 4' in r['noteLoop'] and 'tasto centrale tenuto' in r['noteLoopMix'],'avviso: sul singolo loop («%s», poi su tutto il mix «%s»)'%(r['noteLoop'],r['noteLoopMix']))
        ok('LOOP 1 AL 50%' in r['noteAltro'] and 'seleziona il loop 1' in r['noteAltro'],'avviso: con un altro loop selezionato dice quale («%s»)'%r['noteAltro'])
        ok(r['padLoop'].endswith('· 50%') and r['padAltro'].endswith('· 50%') and '·' not in r['padFine'],'sul pad la velocità del loop, anche selezionandone un altro («%s»), e dopo lo stop sparisce («%s»)'%(r['padAltro'],r['padFine']))
        e=r['echo'];ok(all(abs(g)<2 for g in e['gaps']),'eco a tempo: scarto dal battito %s ms (battito %s s)'%(e['gaps'],e['beat']))
        ok(e['lev'][0]>e['lev'][1]>e['lev'][2]>0,'ogni ripetizione più bassa %s'%e['lev'])
        ok(r['sendOff'] and r['tail']>.002,'abbassando la manopola la coda continua (%s)'%r['tail'])
        ok(not errs,'nessun errore '+str(errs))
        await b.close()
asyncio.run(main())
