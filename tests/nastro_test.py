# Suonare sopra un loop a velocità cambiata (sovraincisione «a nastro»), velocità normale col tasto centrale tenuto (9),
# STOP EFFETTI che azzera anche il filtro del loop, strumento del loop che torna selezionandolo (anche dopo aver riaperto Giro).
# Scarti: loop 1 = metronomo (un clic su ogni battito), loop 0 vuoto. A velocità 0,8 e 1,25 si sovraincide sul loop 0 con note
# volutamente fuori tempo rispetto ai clic che si sentono; poi si ascoltano le uscite dei due loop insieme (stessa cattura, quindi
# lo scarto fra nota e clic è esatto) al giro dopo, ancora a quella velocità, e tornati a 1. Dall'attacco misurato si toglie quello
# del campione (misurato su renderNote con la stessa regola).
from pathlib import Path
import asyncio,json,sys
from playwright.async_api import async_playwright
GIRO=(Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri()
async def page(c):
    pg=await c.new_page();errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
    await pg.goto(GIRO);await pg.keyboard.press('Enter');await pg.wait_for_timeout(3500);return pg,errs
async def main():
    async with async_playwright() as p:
        a=['--autoplay-policy=no-user-gesture-required']
        try:b=await p.chromium.launch(args=a)
        except Exception:b=await p.chromium.launch(args=a,channel='chrome') # sul PC dell'utente c'è solo Chrome
        c=await b.new_context(viewport={'width':1366,'height':768}) # una sola: la riapertura ritrova la sessione in IndexedDB
        pg,errs=await page(c)
        r=await pg.evaluate('''async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms)),until=async t=>{while(ctx.currentTime<t)await wait(1)};const res={};
          const si=SOUNDS.findIndex(s=>s.id==="batteria"),NOTE=62;await loadSound(si);
          SET.amix=0;autoMix();SET.quant=0;
          tap(0);await wait(30);noteOn(60,.8);await wait(100);noteOff(60);await wait(1900);tap(0);await wait(300);
          tap(1);await wait(30);noteOn(64,.8);await wait(100);noteOff(64);await wait(1900);tap(1);await wait(2300);
          const L0=G.loops[0],L1=G.loops[1],len=L0.len,beatF=len/G.beats,ms=f=>+(f/sr*1000).toFixed(2);
          res.bpm=+bpm().toFixed(1);
          // attacco del campione: primo campione oltre il 30% del massimo della finestra
          const att=(x,a,b)=>{let m=0;for(let j=Math.max(0,a);j<Math.min(x.length,b);j++)m=Math.max(m,Math.abs(x[j]));for(let j=Math.max(0,a);j<b;j++)if(Math.abs(x[j])>=m*.3)return j;return -1};
          const seg=renderNote(si,NOTE,.9,Math.round(sr*.06),1);let A=att(seg,0,seg.length);res.attackMs=ms(A);
          const click=new Float32Array(len);for(let b=0;b<G.beats;b++)for(let j=0;j<96;j++)click[b*beatF+j|0]=.5*Math.sin(2*Math.PI*1000*j/sr);
          // uscite dei loop 0 e 1 nella stessa cattura: per ogni clic, l'attacco della nota vicina (−80…+150 ms), in ms
          const listen=async dur=>{const m=ctx.createChannelMerger(2),sp=ctx.createScriptProcessor(2048,2,1),a=[],c=[];
            loopOut[0].connect(m,0,0);loopOut[1].connect(m,0,1);m.connect(sp);sp.connect(ctx.destination);
            sp.onaudioprocess=e=>{a.push(new Float32Array(e.inputBuffer.getChannelData(0)));c.push(new Float32Array(e.inputBuffer.getChannelData(1)))};
            await wait(dur);loopOut[0].disconnect(m);loopOut[1].disconnect(m);sp.disconnect();
            const n=a.length*2048,x=new Float32Array(n),y=new Float32Array(n);a.forEach((v,j)=>x.set(v,j*2048));c.forEach((v,j)=>y.set(v,j*2048));
            const out=[];for(let j=1;j<n;j++)if(Math.abs(y[j])>.1&&Math.abs(y[j-1])<=.1&&!(out.length&&j-out.at(-1).c<sr*.2)){
              const w0=j-Math.round(sr*.08),w1=j+Math.round(sr*.15);if(w0<4096||w1>n)continue; // i primi blocchi della cattura possono mancarelet m=0;for(let k=w0;k<w1;k++)m=Math.max(m,Math.abs(x[k]));
              if(m<.01)continue;out.push({c:j,d:att(x,w0,w1)-j})}return out};
          // l'attacco come si sente dal loop: la nota resa sui battiti del loop 0, a velocità normale
          {const d=new Float32Array(len);for(let b=0;b<G.beats;b++)d.set(seg.subarray(0,Math.min(seg.length,beatF*.8|0)),b*beatF|0);
           for(const [i,x] of[[0,d],[1,click]]){send({type:'load',i,data:x,len,t0:L0.t0,vol:1,pan:0,fx:0});G.loops[i].t0=L0.t0;send({type:'gate',i,on:1,frame:0})}
           await wait(300);const o=(await listen(len/sr*1000+400)).map(x=>x.d).sort((a,b)=>a-b);res.attackLoopMs=ms(o[o.length>>1]);A=o[o.length>>1]}
          setSound(si); // le note della sovraincisione con lo stesso suono di cui si è misurato l'attacco
          const plan=[[0,-17],[1,23],[2,-29],[3,31]]; // battito, ms di anticipo/ritardo rispetto al clic che si sente
          res.takes=[];
          for(const [v,q] of[[.8,4],[.8,0],[1.25,4],[1.25,0]]){
            for(const [i,d] of[[0,new Float32Array(len)],[1,click]]){send({type:'load',i,data:d.slice(),len,t0:L0.t0,vol:1,pan:0,fx:0});G.loops[i].t0=L0.t0;send({type:'gate',i,on:1,frame:0})}
            await wait(300);setKnobMode("dj");setFxScope("mix");djKnob(3,64+(v-1)*63);await wait(1200);
            // dove legge adesso il loop 0 (come per una nota): da lì il frame in cui si sente ogni battito
            const ref={};MARKS.set(-1,ref);const Fr=nowF();send({type:'mark',i:0,frame:Fr,id:-1});await wait(100);
            SET.quant=q;G.sel=0;dubButton();
            let Fb=Fr+(len-ref.mk.q)/v;while(Fb<nowF()+sr*.4)Fb+=len/v;
            for(const [b,d] of plan){const F=Fb+b*beatF/v+d*sr/1000;await until(F/sr-.05);evT=F/sr;noteOn(NOTE,.9);evT=null;
              await until(F/sr+.07);evT=F/sr+.06;noteOff(NOTE);evT=null}
            await wait(300);dubButton();await wait(len/v/sr*1000*1.6);
            const slow=await listen(len/v/sr*1000+400);
            djKnob(3,64);await wait(Math.max(0,(L0.rb/sr-ctx.currentTime)*1000)+300);
            const back=await listen(len/sr*1000+400);
            // atteso: quantizzata sul battito (0); libera: lo scarto suonato, a velocità 1 accorciato di v come su un nastro
            const want=(s,k)=>q?0:plan[k][1]*(s?1:v),aSlow=A,aBack=A*v;
            const byBeat=(o,a,s)=>o.map(x=>x.d-a).map(d=>+(d/sr*1000).toFixed(2));
            const sl=byBeat(slow,aSlow,1),bk=byBeat(back,aBack,0);
            // ogni misura va col battito più vicino del piano: l'ordine dei clic nella cattura dipende da dove inizia
            const match=(arr,s)=>arr.map(m=>{let best=null;for(let k=0;k<plan.length;k++){const e=m-want(s,k);if(best==null||Math.abs(e)<Math.abs(best))best=e}return +best.toFixed(2)});
            res.takes.push({v,q:q?QNAMES[q]:"NO",slow:sl,back:bk,errSlow:match(sl,1),errBack:match(bk,0)});
            stopAllFx();await wait(Math.max(0,(L0.rb/sr-ctx.currentTime)*1000)+200)}
          SET.quant=4;return res}''')
        sys.stdout.reconfigure(encoding='utf-8')
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        print('tempo',r['bpm'],'bpm · attacco del campione',r['attackMs'],"ms, dall'uscita del loop",r['attackLoopMs'],'ms')
        for t in r['takes']:
            print('velocità %s, Q %s: scarto dal previsto al giro dopo %s ms · tornati a 1.0 %s ms (misurati nota−clic: %s / %s)'%(t['v'],t['q'],t['errSlow'],t['errBack'],t['slow'],t['back']))
            ok(len(t['errSlow'])>=4 and len(t['errBack'])>=4 and max(map(abs,t['errSlow']+t['errBack']))<1.5,'velocità %s, Q %s: tutte e 4 le note dove dovevano, scarto massimo %.2f ms'%(t['v'],t['q'],max(map(abs,t['errSlow']+t['errBack']+[0]))))
        # velocità normale (tasto 9 e tasto centrale tenuto), STOP EFFETTI, strumento del loop
        r=await pg.evaluate('''async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms));const res={};
          const kb=(t,k,o)=>document.body.dispatchEvent(new KeyboardEvent(t,{key:k,code:o.code,shiftKey:!!o.shift,bubbles:true}));
          const key=async(k,o={})=>{kb('keydown',k,o);await wait(30);kb('keyup',k,o)};
          const midi=(cc,v)=>onMIDI({data:[0xB0,cc,v]});
          if(!G.running)playAll();await wait(200);
          setKnobMode("dj");setFxScope("mix");djKnob(0,30);djKnob(3,51.4);G.sel=0;setFxScope("loop");djKnob(0,100);djKnob(3,32.5); // loop a ½ sul mix a 0,8
          G.loops[0].fx=-.6;send({type:'fx',i:0,v:-.6});await wait(200);
          await key('9');await wait(100);
          res.reset={mix:DJV[3],own:LDJ[0].v[3],mixF:DJV[0],ownF:LDJ[0].v[0],loopFx:G.loops[0].fx,rb:G.loops[0].rb>0,hint:document.querySelector('#hint').textContent};
          // tasto centrale: il primo tocco è un tocco (non si sa ancora se manda il rilascio), poi tenuto = velocità normale
          djKnob(3,40);await wait(50);const s0=SET.sound;midi(23,127);midi(23,0);res.tap1=SET.sound!==s0;
          const s1=SET.sound;midi(23,127);await wait(750);midi(23,0);res.held={own:LDJ[0].v[3],sound:SET.sound===s1};
          midi(23,127);await wait(100);midi(23,0);res.tap2=SET.sound!==s1;
          stopAllFx();await wait(100);res.stopFx={loopFx:G.loops[0].fx,mixF:DJV[0],LDJ0:!!LDJ[0]};
          // strumento del loop: Pianoforte nel loop 0, Rhodes nel loop 1
          clearAll();await wait(300);SET.quant=0;const pf=SOUNDS.findIndex(s=>s.id==="piano"),rh=SOUNDS.findIndex(s=>s.id==="rhodes");res.ids=[pf,rh];
          setSound(pf);tap(0);await wait(30);noteOn(60,.8);await wait(100);noteOff(60);await wait(1900);tap(0);await wait(300);
          setSound(rh);tap(1);await wait(30);noteOn(64,.8);await wait(100);noteOff(64);await wait(1900);tap(1);await wait(300);
          setSound(5);await key('!',{code:'Digit1',shift:true});res.shift1=SET.sound===pf&&G.sel===0;res.hint1=document.querySelector('#hint').textContent;
          onMIDI({data:[0xE0,127,127]});onMIDI({data:[0xE0,0,64]});res.bend=SET.sound===rh&&G.sel===1;
          setSound(5);padDown(0);padUp(0);await wait(50);res.padKeeps=SET.sound===5;padDown(0);padUp(0);
          await wait(6000);
          const rec=await idb("readonly",s=>s.get("s"));res.saved=rec.loops.map(l=>l.sid);
          return res}''')
        print(json.dumps(r,ensure_ascii=False))
        x=r['reset'];ok(x['mix']==0 and x['own']==0 and x['rb'],'tasto 9: velocità normale sul loop selezionato (mix e loop), rientra sull\'1')
        ok(x['mixF']!=0 and x['ownF']!=0 and x['loopFx']==-.6,'tasto 9: filtro ed effetti restano come sono')
        ok('Velocità normale' in x['hint'],'tasto 9: lo dice in alto («%s»)'%x['hint'])
        ok(r['tap1'] and r['held']['own']==0 and r['held']['sound'] and r['tap2'],'tasto centrale: tocco = suono successivo, tenuto = velocità normale (senza cambiare suono)')
        x=r['stopFx'];ok(x['loopFx']==0 and x['mixF']==0 and not x['LDJ0'],'STOP EFFETTI azzera anche il filtro del loop')
        ok(r['shift1'] and 'Pianoforte' in r['hint1'],'Maiusc+1: seleziona il loop 1 e ne riprende lo strumento («%s»)'%r['hint1'])
        ok(r['bend'],'pitch bend: il loop dopo, col suo strumento')
        ok(r['padKeeps'],'il tocco del pad non cambia il suono')
        ok(r['saved']==['piano','rhodes'],'nella sessione lo strumento è salvato per id %s'%r['saved'])
        await pg.close()
        # riaperto Giro: i loop tornano, e selezionandoli torna il loro strumento
        pg2,errs2=await page(c)
        r=await pg2.evaluate('''async()=>{const wait=ms=>new Promise(r=>setTimeout(r,ms));await wait(1000);setSound(5);
          document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'@',code:'Digit2',shiftKey:true,bubbles:true}));await wait(50);
          const res={has:G.loops.map(L=>L.has).slice(0,2),sound:SOUNDS[SET.sound].id};clearAll();return res}''')
        ok(r['has']==[True,True] and r['sound']=='rhodes','dopo la riapertura: Maiusc+2 riprende il Rhodes del loop 2 (%s)'%r)
        ok(not errs and not errs2,'nessun errore '+str(errs+errs2))
        await b.close()
asyncio.run(main())
