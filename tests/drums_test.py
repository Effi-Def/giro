# Batteria (per ora senza comando: drumSet = quantità). Batterista: senza batteria nel giro crea un loop di batteria col kit
# scelto, lungo quanto i loop (raddoppiato fino a ~6 s) e dall'1 del giro anche con un giro di 3 battiti; cassa e rullante
# sugli attacchi della melodia, anche sfasati; quantità da essenziale (niente charleston) a piena con rullata; segue un
# loop nuovo (cassa sul basso); terzine; cambio di kit; se ne va con la manopola a sinistra. Correttore: sopra una
# batteria suonata aggiunge solo quello che manca, lasciando com'è l'audio suonato (tranne nella rullata).
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
          let cap=null;const dm=window.drumMix;window.drumMix=(si,notes,len,off)=>{const x=dm(si,notes,len,off);cap={si,notes:notes.map(n=>({...n})),len,off,x};return x};
          const snd=id=>setSound(SOUNDS.findIndex(s=>s.id===id));
          // la nota parte 20 ms prima del suo istante, programmata lì: un ritardo della pagina headless non la sposta
          await Promise.all(SOUNDS.map((_,i)=>loadSound(i))); // caricare i suoni ferma la pagina anche per 80 ms
          const at=async(t,fn)=>{while(ctx.currentTime<t-.02)await wait(1);evT=t;try{fn()}finally{evT=null}};
          const play=async(T0,notes,len)=>{for(const[t,n]of notes){await at(T0+t,()=>noteOn(n,.85));await wait(80);noteOff(n)}};
          const S=x=>x/sr,cl=n=>n.note%12,ks=()=>cap.notes.filter(n=>cl(n)===0||cl(n)===2&&n.v>.5);
          const nextOne=()=>(G.origin+Math.ceil((nowF()+sr*.15-G.origin)/G.base)*G.base)/sr;
          // giro di 3 battiti (1,8 s) con accenti sfasati: 3+3+2+2+2 ottavi da 0,15 s, senza quantizzazione
          SET.quant=0;snd("piano");tap(0);await wait(30);const T0=ctx.currentTime+.1,MEL=[0,.45,.9,1.2,1.5];
          await play(T0,MEL.map((t,j)=>[t,[48,55,52,55,57][j]]));await at(T0+1.8,()=>tap(0));await wait(300);
          snd("house909");snd("piano");
          // quantità 2: il batterista entra nel loop 2, lungo 4 giri (7,2 s), dall'1 del giro
          cap=null;drumSet(45);res.text0=drumText();await wait(1200);const L=G.loops[1];
          res.bat={has:L.has,bat:L.bat,kit:SOUNDS[L.sound].id,giri:L.len/G.base,t0:L.t0===G.origin,text:drumText(),beats:G.beats};
          res.onMel=cap?ks().every(n=>MEL.some(m=>Math.abs(S(n.t%G.base)-m)<.003)):false;
          res.ksPos=cap?[...new Set(ks().map(n=>+S(n.t%G.base).toFixed(3)))].sort():null;
          res.hats2=cap?cap.notes.filter(n=>cl(n)===6).length:0;
          // nell'audio del loop: la cassa sull'1 di ogni giro
          const lows=async(i,pos)=>{const sp=ctx.createScriptProcessor(1024,2,2),lp=ctx.createBiquadFilter();lp.type="lowpass";lp.frequency.value=120;
            const out=[];let t0=null;sp.onaudioprocess=e=>{if(t0==null)t0=Math.round(e.playbackTime*sr);out.push(new Float32Array(e.inputBuffer.getChannelData(0)))};
            loopOut[i].connect(lp);lp.connect(sp);sp.connect(ctx.destination);await wait(4200);sp.disconnect();lp.disconnect();loopOut[i].disconnect(lp);
            const x=new Float32Array(out.length*1024);out.forEach((c,j)=>x.set(c,j*1024));const s0=G.origin+Math.ceil((t0-G.origin)/G.base)*G.base,E=[];
            for(const q of pos){const a=Math.round(s0+q*sr-t0);let m=0;for(let j=a;j<a+sr*.05&&j<x.length;j++)m=Math.max(m,Math.abs(x[j]));E.push(+m.toFixed(2))}return E};
          await wait(2600);res.kick=await lows(1,[0,1.8,.25,2.05]);
          // quantità 1: solo cassa e rullante, 2 per giro
          cap=null;drumSet(20);await wait(2400);res.lv1=cap?{hats:cap.notes.filter(n=>cl(n)===6||cl(n)===10).length,ks:ks().length,giri:cap.len/G.base}:null;
          // quantità 5: charleston fitto, fantasmi, rullata nell'ultimo battito, piatto sull'1
          cap=null;drumSet(127);await wait(2400);
          res.lv5=cap?{hats:cap.notes.filter(n=>cl(n)===6).length,open:cap.notes.some(n=>cl(n)===10),ghosts:cap.notes.filter(n=>cl(n)===2&&n.v<.45).length,
            crash:cap.notes.some(n=>cl(n)===11&&n.t===0),fill:cap.notes.filter(n=>cl(n)===2&&n.t>=cap.len-sr*.45-1).length}:null;
          // un basso nuovo (loop 3) con note fuori dagli accenti della melodia: il batterista lo segue, cassa sul basso
          msgs.length=0;cap=null;snd("basso");tap(2);await wait(30);const T1=nextOne(),BAS=[0,.75,1.35];
          await play(T1,BAS.map(t=>[t,45]));await at(T1+1.8,()=>tap(2));
          for(let j=0;j<80&&!msgs.some(m=>m.type==="swap"&&m.i===1);j++)await wait(100); // si rilegge quando la coda delle note è entrata nel loop
          res.follow={swap:msgs.some(m=>m.type==="swap"&&m.i===1),kickBass:cap?BAS.slice(1).filter(t=>cap.notes.some(n=>cl(n)===0&&Math.abs(S(n.t%G.base)-t)<.003)).length:0};
          // un altro kit scelto: il batterista lo prende
          snd("batteria");await wait(2400);res.kit=SOUNDS[L.sound].id;snd("piano");
          // tutta a sinistra: se ne va
          drumSet(0);await wait(300);res.gone=!L.has&&!L.bat&&drumText()==="spento";
          // correttore: batteria suonata 40 ms in ritardo, solo cassa e rullante: resta com'è
          clearLoop(2);await wait(200);snd("batteria");tap(2);await wait(30);const T2=nextOne(),late=.04;
          await play(T2,[[0,48],[.45+late,50],[.9+late,48],[1.35+late,50]]);await at(T2+1.8,()=>tap(2));await wait(300);
          cap=null;msgs.length=0;drumSet(127);await wait(1500);const U=G.loops[2];
          res.fixText=drumText();res.noNew=!G.loops[1].has;
          const N=cap?cap.notes:[],sw=msgs.find(m=>m.type==="swap"&&m.i===2&&m.keep);
          let diff=0,inFill=0;if(sw&&cap&&U.org){const o=U.org,n=sw.data.length,f0=n-sr*.45-sr*.03;
           for(let p=0;p<n;p++)if(Math.abs(sw.data[p]-cap.x[p]-o[p%o.length])>1e-5){if((((p-cap.off)%n)+n)%n>=f0)inFill++;else diff++}}
          res.fix={keep:!!sw,giri:cap?cap.len/G.base:0,kit:cap?SOUNDS[cap.si].id:null,outside:sw?diff:-1,inFill,
            hats:N.filter(n=>cl(n)===6).length,ghosts:N.filter(n=>cl(n)===2&&n.v<.45).length,
            addedKicks:N.filter(n=>cl(n)===0&&n.t<cap.len-sr*1.25).length,crash:N.some(n=>cl(n)===11&&n.t===0)};
          drumSet(0);await wait(2600);res.back=!U.fixed&&msgs.some(m=>m.type==="swap"&&m.i===2&&m.len===null);
          // STOP EFFETTI non tocca la batteria
          drumSet(127);await wait(1500);stopAllFx();await wait(300);res.stopKeeps=drumLv>0&&U.fixed;
          // melodia in terzine (ottavi in terzina a 100 bpm, giro di 2,4 s): charleston in terzina
          drumSet(0);await wait(300);clearAll();await wait(500);snd("piano");tap(0);await wait(30);const T3=ctx.currentTime+.1;
          await play(T3,Array.from({length:12},(_,j)=>[j*.2,j%3?60:48]));await at(T3+2.4,()=>tap(0));await wait(300);
          cap=null;drumSet(69);await wait(1500);
          const hs=cap?cap.notes.filter(n=>cl(n)===6).map(n=>S(n.t)/.2):[];
          res.trip={n:hs.length,grid:hs.every(x=>Math.abs(x-Math.round(x))<.01),offBeat:hs.filter(x=>Math.round(x)%3).length};
          return res}''')
        print(json.dumps(r,ensure_ascii=False))
        ok=lambda c,m:print(('OK  ' if c else 'FAIL')+' '+m)
        ok(r['text0']=='charleston · batterista','testo della manopola: %s'%r['text0'])
        ok(r['bat']=={'has':True,'bat':2,'kit':'house909','giri':4,'t0':True,'text':'charleston · batterista nel loop 2','beats':4},'batterista nel loop 2, 4 giri dall\'1, col kit scelto prima del pianoforte %s'%r['bat'])
        ok(r['onMel'] and r['ksPos']==[0,.45,.9],'cassa e rullante sugli accenti sfasati della melodia %s'%r['ksPos'])
        k=r['kick'];ok(min(k[:2])>.1 and max(k[2:])<min(k[:2])/2,"nell'audio la cassa sull'1 di ogni giro di 3 battiti %s"%k)
        ok(r['hats2']>0 and r['lv1'] and r['lv1']['hats']==0 and r['lv1']['ks']==8,'essenziale: solo cassa e rullante, 2 per giro %s'%r['lv1'])
        l5=r['lv5'];ok(l5 and l5['hats']>r['hats2'] and l5['open'] and l5['ghosts']>=3 and l5['crash'] and l5['fill']>=3,'piena con rullata: charleston fitto, aperto, fantasmi, piatto, rullata %s'%l5)
        ok(r['follow']['swap'] and r['follow']['kickBass']>=1,'segue un loop nuovo: cassa sulle note del basso %s'%r['follow'])
        ok(r['kit']=='batteria','cambiando kit il batterista lo prende')
        ok(r['gone'],'manopola tutta a sinistra: il batterista se ne va')
        f=r['fix']
        ok(r['fixText']=='piena con rullata · corregge la tua batteria' and r['noNew'],'con una batteria suonata corregge quella, niente batterista')
        ok(f['keep'] and f['kit']=='batteria','correttore: kit suonato, originale tenuto %s'%f)
        ok(f['outside']==0 and f['inFill']>1000 and f['addedKicks']==0,"l'audio suonato resta com'è (campioni cambiati fuori dalla rullata: %s, dentro: %s), nessuna cassa aggiunta"%(f['outside'],f['inFill']))
        ok(f['hats']>=20 and f['ghosts']>=2 and f['crash'],'aggiunti charleston, fantasmi e piatto %s'%f)
        ok(r['back'],'tutta a sinistra torna la batteria suonata')
        ok(r['stopKeeps'],'STOP EFFETTI non tocca la batteria')
        t=r['trip'];ok(t['n']>=30 and t['grid'] and t['offBeat']>=t['n']//2,'melodia in terzine: charleston in terzina %s'%t)
        ok(not errs,'nessun errore '+str(errs))
        await b.close()
asyncio.run(main())
