# Batteria (manopola 4 degli effetti DJ). Batterista: senza batteria nel giro crea un loop di batteria col kit scelto,
# cambia con genere e kit, se ne va con la manopola tutta a sinistra. Correttore: sopra una batteria suonata senza
# charleston aggiunge charleston, rullanti fantasma, rullata e piatto, lasciando com'è l'audio suonato (tranne nella
# rullata); con una batteria in terzine le aggiunte vanno in terzina; tutta a sinistra torna com'era.
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
          const msgs=[],sd=window.send;window.send=(c,tr)=>{if(c.type==="swap"||c.type==="load")msgs.push({type:c.type,i:c.i,len:c.data?c.data.length:null,keep:!!c.keep,frame:c.frame,data:c.type==="swap"?c.data:null});return sd(c,tr)};
          let cap=null;const dm=window.drumMix;window.drumMix=(si,notes,len,off)=>{const x=dm(si,notes,len,off);cap={si,notes:notes.map(n=>({...n})),len,x};return x};
          const snd=id=>setSound(SOUNDS.findIndex(s=>s.id===id)),idx=id=>SOUNDS.findIndex(s=>s.id===id);
          const at=async(t,fn)=>{while(ctx.currentTime<t-.005)await wait(1);evT=t;try{fn()}finally{evT=null}};
          // giro di pianoforte di 2 s (4 battiti a 120), poi il kit 909 scelto e di nuovo il pianoforte
          SET.quant=4;snd("piano");tap(0);await wait(30);const T0=ctx.currentTime+.1;
          await at(T0,()=>noteOn(60,.8));await wait(150);noteOff(60);await at(T0+2,()=>tap(0));await wait(300);
          snd("house909");snd("piano");setKnobMode("dj");
          // house: il batterista entra nel loop 2, lungo 4 battute, col kit 909
          knob(3,75);res.text0=djText(3);await wait(400);const L=G.loops[1];
          res.bat={has:L.has,bat:L.bat,kit:SOUNDS[L.sound].id,bars:L.len/G.base,role:L.ar,text:djText(3)};
          res.load=msgs.filter(m=>m.type==="load").length;
          // nei bassi del loop: la cassa su tutti e 4 i battiti (house); si misura un giro intero dopo l'entrata
          const lows=async(i)=>{const sp=ctx.createScriptProcessor(1024,2,2),lp=ctx.createBiquadFilter();lp.type="lowpass";lp.frequency.value=120;
            const out=[];let t0=null;sp.onaudioprocess=e=>{if(t0==null)t0=Math.round(e.playbackTime*sr);out.push(new Float32Array(e.inputBuffer.getChannelData(0)))};
            loopOut[i].connect(lp);lp.connect(sp);sp.connect(ctx.destination);await wait(2600);sp.disconnect();lp.disconnect();loopOut[i].disconnect(lp);
            const x=new Float32Array(out.length*1024);out.forEach((c,j)=>x.set(c,j*1024));const bt=G.base/4,s0=G.origin+Math.ceil((t0-G.origin)/bt)*bt,E=[];
            for(let k=0;k<8;k++){const a=Math.round(s0+k*bt/2-t0);let m=0;for(let j=a;j<a+bt/4&&j<x.length;j++)m=Math.max(m,Math.abs(x[j]));E.push(+m.toFixed(2))}return E};
          await wait(1500);res.house=await lows(1);
          // rock: lo stesso loop cambia sul prossimo 1, con la rullata di tom alla quarta battuta
          msgs.length=0;knob(3,90);await wait(400);res.rock={bat:L.bat,swap:msgs.filter(m=>m.type==="swap"&&m.i===1).length,
            toms:cap.notes.filter(n=>[5,7,9].includes(n.note%12)).length,onBar:Math.abs(((msgs[0]?.frame+Math.round(sr*.008)-G.origin)/G.base)%1)<1e-6};
          // un altro kit scelto: il batterista lo prende
          snd("batteria");await wait(400);res.kit=SOUNDS[L.sound].id;snd("piano");
          // tutta a sinistra: se ne va
          knob(3,0);await wait(300);res.gone=!L.has&&!L.bat&&djText(3)==="spento";
          // correttore: batteria suonata 40 ms in ritardo e senza quantizzazione, solo cassa e rullante: resta com'è
          SET.quant=0;snd("batteria");tap(2);await wait(30);const T1=(G.origin+Math.ceil((nowF()+sr*.1-G.origin)/G.base)*G.base)/sr,late=.04; // sull'1 del giro, come seguendolo
          const beat=[[0,48],[.5,50],[1,48],[1.5,50]];
          for(const[t,n]of beat){await at(T1+t+(t?late:0),()=>noteOn(n,.9));await wait(60);noteOff(n)}
          await at(T1+2,()=>tap(2));await wait(300);
          cap=null;msgs.length=0;knob(3,127);await wait(400);const U=G.loops[2],st=G.base/16;
          res.fixText=djText(3);res.noNew=!G.loops[1].has;
          const N=cap?cap.notes:[],cl=n=>n.note%12;
          const sw=msgs.find(m=>m.type==="swap"&&m.i===2&&m.keep);
          // l'audio mandato al core = quello suonato (ripetuto) + le aggiunte, diverso solo dove tace per la rullata
          let diff=0,inFill=0;if(sw&&cap&&U.org){const o=U.org,n=sw.data.length,off=((G.origin-U.t0)%o.length+o.length)%o.length,f0=3*G.base+11.5*st-sr*.006;
           for(let p=0;p<n;p++)if(Math.abs(sw.data[p]-cap.x[p]-o[p%o.length])>1e-5){if((((p-off)%n)+n)%n>=f0)inFill++;else diff++}}
          res.fix={keep:!!sw,bars:cap?cap.len/G.base:0,kit:cap?SOUNDS[cap.si].id:null,outside:sw?diff:-1,inFill,
            hats:N.filter(n=>cl(n)===6).length,ghosts:N.filter(n=>cl(n)===2&&n.v<.45).length,
            addedKicks:N.filter(n=>cl(n)===0&&n.t<3*G.base).length,crash:N.some(n=>cl(n)===11&&n.t===0),
            fill:N.filter(n=>cl(n)===2&&n.t>=3*G.base+12*st).length};
          await wait(2600);res.fixLen=U.len/G.base;
          knob(3,0);await wait(2600);res.back=U.len/G.base===1&&!U.fixed&&msgs.some(m=>m.type==="swap"&&m.i===2&&m.len===null);
          // STOP EFFETTI non tocca la batteria
          knob(3,127);await wait(400);stopAllFx();await wait(300);res.stopKeeps=DJV[3]>.9&&U.fixed;
          // batteria in terzine (cassa a 1/3 e 2/3 del battito, come uno shuffle): le aggiunte vanno in terzina
          knob(3,0);await wait(400);clearLoop(2);await wait(100);snd("batteria");tap(2);await wait(30);
          const T2=(G.origin+Math.ceil((nowF()+sr*.1-G.origin)/G.base)*G.base)/sr;
          for(const[t,n]of[[0,48],[.5,50],[.833,48],[1,48],[1.5,50],[1.667,48]]){await at(T2+t,()=>noteOn(n,.9));await wait(40);noteOff(n)}
          await at(T2+2,()=>tap(2));await wait(300);cap=null;knob(3,127);await wait(600);
          const ph=n=>+(((n.t/st)%4+4)%4).toFixed(2);res.trip=cap?[...new Set(cap.notes.filter(n=>cl(n)===6).map(ph))].sort():null;
          return res}''')
        print(json.dumps(r,ensure_ascii=False))
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        ok(r['text0']=='house · batterista','testo della manopola prima del batterista: %s'%r['text0'])
        ok(r['bat']=={'has':True,'bat':5,'kit':'house909','bars':4,'role':'rit','text':'house · batterista nel loop 2'} and r['load']==1,'batterista: loop 2 di 4 battute col kit scelto prima del pianoforte %s'%r['bat'])
        h=r['house'];ok(min(h[0::2])>.1 and max(h[1::2])<min(h[0::2])/2,'house: cassa su tutti e 4 i battiti, niente in mezzo %s'%h)
        ok(r['rock']['bat']==6 and r['rock']['swap']==1 and r['rock']['toms']>=6 and r['rock']['onBar'],"rock: cambia sull'1 con la rullata di tom %s"%r['rock'])
        ok(r['kit']=='batteria','cambiando kit il batterista lo prende')
        ok(r['gone'],'manopola tutta a sinistra: il batterista se ne va')
        f=r['fix']
        ok(r['fixText']=='funk · corregge la tua batteria' and r['noNew'],'con una batteria suonata corregge quella, niente batterista')
        ok(f['keep'] and f['bars']==4 and f['kit']=='batteria','correttore: 4 battute col kit suonato, originale tenuto %s'%f)
        ok(f['outside']==0 and f['inFill']>1000 and f['addedKicks']==0,"l'audio suonato resta com'è (campioni cambiati fuori dalla rullata: %s, dentro: %s), nessuna cassa aggiunta"%(f['outside'],f['inFill']))
        ok(f['hats']>=40 and f['ghosts']>=6 and f['crash'] and f['fill']>=3,'aggiunti charleston, rullanti fantasma, piatto e rullata %s'%f)
        ok(r['trip']==[0,1.33,2.67],'batteria in terzine: charleston aggiunti in terzina %s'%r['trip'])
        ok(r['fixLen']==4 and r['back'],'il loop diventa di 4 battute; tutta a sinistra torna quello suonato')
        ok(r['stopKeeps'],'STOP EFFETTI non tocca la batteria')
        ok(not errs,'nessun errore '+str(errs))
        await b.close()
asyncio.run(main())
