# Comandi pensati per suonare dal vivo: ■ a fine giro, ■■ subito, ▶ solo da fermo, ■ tenuto = cancella tutto,
# ▲▼ per famiglia e tasto centrale dentro la famiglia, pitch bend che seleziona il loop, battito visivo,
# drop e build-up con ▶, rientro dei pad sull'1, modi delle manopole e messaggi HyperControl.
from pathlib import Path
import asyncio,json
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(args=['--autoplay-policy=no-user-gesture-required'])
        pg=await b.new_page(viewport={'width':1366,'height':768})
        errs=[];pg.on('pageerror',lambda e:errs.append(str(e)))
        await pg.goto((Path(__file__).resolve().parent.parent/'dist'/'giro.html').as_uri())
        await pg.keyboard.press('Enter');await pg.wait_for_timeout(3500)
        r=await pg.evaluate('''async()=>{
          const wait=ms=>new Promise(r=>setTimeout(r,ms));const res={};
          const cc=(n,v)=>onMIDI({data:[0xB0,n,v]});
          // famiglie: dal Pianoforte ▲ va alle Chitarre, centrale scorre dentro, ▼▲ ricorda l'ultimo
          setSound(0);cc(21,127);res.fam1=SOUNDS[SET.sound].name;cc(23,127);res.inFam=SOUNDS[SET.sound].name;
          cc(22,127);cc(21,127);res.back=SOUNDS[SET.sound].name;cc(22,127);
          // primo loop di 2 s
          SET.quant=0;tap(0);await wait(30);const T=ctx.currentTime;noteOn(60,.8);await wait(150);noteOff(60);
          while(ctx.currentTime-T<2)await wait(1);tap(0);await wait(300);
          res.beatShown=!document.querySelector('#beat').hidden&&document.querySelectorAll('#beat i.on').length===1;
          // pitch bend: seleziona i loop pieni senza fermarli (una volta per spinta, si riarma al centro)
          tap(1);await wait(30);noteOn(64,.8);await wait(150);noteOff(64);await wait(600);tap(1);await wait(2200);
          const pb=v=>onMIDI({data:[0xE0,v&127,v>>7]});
          G.sel=1;pb(10000);pb(14000);pb(16383);pb(14000);res.pbOnce=G.sel;pb(8192);pb(16383);pb(8192);res.pbAgain=G.sel;
          pb(0);pb(8192);res.pbDown=G.sel;res.pbPlaying=G.loops[0].state==="play"&&!G.loops[0].muted&&G.loops[1].state==="play"&&!G.loops[1].muted;
          // drop: tocco breve di ▶ (rilascio già visto) -> al prossimo 1 resta solo il loop selezionato
          const onBar=at=>Math.abs((at-G.origin)%barF())<1;
          G.sel=1;cc(17,0);cc(17,127);await wait(100);cc(17,0);
          const L0=G.loops[0];res.dropPend=G.drop&&!!L0.pend&&L0.pend.muted&&onBar(L0.pend.at);
          const atD=L0.pend?L0.pend.at:0;while(nowF()<atD+sr*.08)await wait(5);
          res.dropped=L0.muted&&L0.dropped&&!G.loops[1].muted;
          // build-up: ▶ tenuto chiude il filtro; al rilascio tutto rientra e il filtro si riapre sull'1
          const f0=cutF.frequency.value;cc(17,127);await wait(1200);res.buildClosing=building&&cutF.frequency.value<f0*.8;
          cc(17,0);res.returnPend=!G.drop&&!!L0.pend&&!L0.pend.muted&&onBar(L0.pend.at);
          const atR=L0.pend?L0.pend.at:0;while(nowF()<atR+sr*.08)await wait(5);
          res.back=!L0.muted&&!L0.dropped&&Math.abs(cutF.frequency.value-cutHz())<1;
          // pad pieno: si ferma alla suddivisione, rientra sull'1 della battuta
          tap(0);const atS=L0.pend.at;while(nowF()<atS+sr*.05)await wait(5);tap(0);res.padOnOne=onBar(L0.pend.at);
          while(L0.pend)await wait(10);
          // HyperControl (canale 16): pulsante dei modi, manopole CC 33–40, tasto centrale CC 98, pad note 81–88
          const hc=(n,v)=>onMIDI({data:[0xBF,n,v]});
          // le manopole si agganciano passando dal valore attuale: kc/kh prima la portano lì, poi al valore voluto
          const kc=(n,v)=>{cc(n,Math.round(knobTarget(n-1)));cc(n,v)},kh=(n,v)=>{hc(n,Math.round(knobTarget(n-33)));hc(n,v)};
          hc(58,127);hc(58,0);res.hcVol=knobMode;hc(58,127);hc(58,0);res.hcPan=knobMode;kh(33,0);res.pan0=G.loops[0].pan;
          hc(59,127);hc(59,0);res.hcFx=knobMode;kh(34,127);res.fx1=G.loops[1].fx;
          res.fxBar=document.querySelector('.loop[data-loop="1"] .vol').classList.contains('fx');
          hc(60,127);hc(60,0);res.hcMidi=knobMode;
          res.knobLabel=document.querySelector('#knobBtn').textContent;
          // modo MIDI (LED spenti): manopole CC 1–8 = effetti DJ sul mix
          const v0=G.loops[0].vol;kc(1,0);kc(2,127);kc(4,127);kc(5,127);kc(6,127);kc(7,60);kc(8,64);await wait(400);
          res.djBar=!document.querySelector('#djBar').hidden;res.djVolUntouched=G.loops[0].vol===v0;
          res.djFilter=DJ.lp.frequency.value<1000;res.djEcho=DJ.eWet.gain.value>.4&&DJ.eFb.gain.value>.5;
          res.djFlanger=DJ.flWet.gain.value>.5;res.djCrush=!!DJ.crush.curve;res.djGate=!!DJ.gateOsc;
          res.djRoll=DJ.rollK===2;res.djLive=Math.abs(DJV[7]-64/127)<1e-6;
          await wait(Math.round(G.base/G.beats/2/sr*1000)*2+150);res.djRollOn=DJ.rWet.gain.value===1&&DJ.rDry.gain.value===0;
          // tutto spento di nuovo: il suono torna com'era
          kc(1,64);kc(2,0);kc(4,0);kc(5,0);kc(6,0);kc(7,0);kc(8,127);await wait(400);
          res.djOff=DJ.lp.frequency.value>15000&&DJ.hp.frequency.value<20&&DJ.eWet.gain.value<.01&&DJ.flWet.gain.value<.01&&!DJ.crush.curve&&!DJ.gateOsc&&DJ.rollK===0&&DJ.rDry.gain.value===1&&DJ.rWet.gain.value===0&&DJV[7]===1;
          // effetti sul singolo loop: il loop 1 tiene l'eco, le manopole passano al loop 2 (flanger); la manopola 8 è il volume del loop
          G.sel=0;setFxScope('loop');kc(2,127);await wait(300);
          const an=ctx.createAnalyser();LDJ[0].out.connect(an);await wait(300);const buf=new Float32Array(2048);an.getFloatTimeDomainData(buf);
          res.fxLoopSound=buf.some(x=>Math.abs(x)>1e-4);
          G.sel=1;kc(4,127);kc(8,64);await wait(300);
          res.fxLoopKeep=LDJ[0].eWet.gain.value>.4&&LDJ[0].flWet.gain.value<.01&&LDJ[1].flWet.gain.value>.5&&DJ.eWet.gain.value<.01&&DJ.flWet.gain.value<.01;
          res.fxLoopVol=Math.abs(G.loops[1].vol-64/127)<1e-6&&DJV[7]===1;
          res.fxBadge=document.querySelector('.loop[data-loop="0"] .snm').textContent.endsWith('FX');
          setFxScope('mix');kc(2,127);await wait(100);stopAllFx();await wait(300);
          res.fxStop=LDJ.every(d=>!d)&&DJ.eWet.gain.value<.01&&!djAll().some(fxActive);
          G.loops[1].vol=.8;send({type:'vol',i:1,v:.8});
          // aggancio: lontana dal valore la manopola non fa niente, passandoci sopra lo prende
          setKnobMode("vol");const lv=G.loops[0].vol;cc(1,5);res.pickWait=G.loops[0].vol===lv&&document.querySelector('#hint').textContent.includes('agganciarla');
          cc(1,90);cc(1,115);res.pickCross=Math.abs(G.loops[0].vol-115/127)<1e-6;
          // manopola 5 lasciata alta in VOLUME: passando a EFFETTI DJ non accende il crusher
          kc(5,120);setKnobMode("dj");cc(5,121);res.pickDj=!DJ.crush.curve;knob(4,102);
          // dopo STOP EFFETTI la manopola rimasta girata non riaccende l'effetto
          kc(2,120);stopAllFx();cc(2,121);res.pickAfterStop=DJ.eWet.gain.value<.01&&DJV[1]===0;
          // note bloccate: «all notes off» dall'Axiom le spegne, anche col pedale
          setSustain(true);noteOn(67,.8);noteOff(67);onMIDI({data:[0xB0,123,0]});res.allOff=held.size===0&&!sustain;
          // dal telefono: tenuto = build-up, rilascio = si riapre
          telCmd({c:'play',v:'down'});await wait(600);res.telBuild=building;telCmd({c:'play',v:'up'});res.telBuildEnd=!building;
          const s0=SET.sound;hc(98,127);hc(98,0);res.hcCenter=SET.sound!==s0;
          onMIDI({data:[0x9E,81,100]});onMIDI({data:[0x8E,81,0]});res.hcPad=!!G.loops[0].pend;
          onMIDI({data:[0x9E,81,100]});onMIDI({data:[0x8E,81,0]});res.hcPad2=!G.loops[0].pend;
          setKnobMode("pan");knob(0,64);setKnobMode("fx");knob(1,64);setKnobMode("vol");knob(0,102);
          res.reset=G.loops[0].pan===0&&G.loops[1].fx===0;
          // ▶ mentre suona: niente
          const o0=G.origin;playButton();res.playIgnored=G.origin===o0&&G.running;
          // ■: si ferma alla fine del giro
          const L=G.loops[0];const pos=()=>((((nowF()-L.t0)%L.len)+L.len)%L.len)/sr;
          while(pos()<0.5)await wait(2);
          cc(16,127);cc(16,0);const at=G.stopAt;res.stopAtBoundary=at>0&&((at-G.origin)%G.base)===0;res.stillRunning=G.running;
          res.label=document.querySelector('#playBtn').textContent;
          while(nowF()<at+sr*.08)await wait(5);res.stoppedAfter=!G.running&&!G.stopAt;
          // da fermo ▶ riparte; ■ ■ ferma subito
          // ■ da fermo: spegne le note rimaste accese
          noteOn(60,.8);setSustain(true);noteOn(64,.8);noteOff(64);cc(16,127);cc(16,0);res.panic=held.size===0&&!sustain;
          playButton();await wait(300);cc(16,127);cc(16,0);cc(16,127);cc(16,0);res.immediate=!G.running&&!G.stopAt;
          // ■ tenuto: cancella tutto solo dopo 2 s (il rilascio è stato visto, quindi vale anche dall'Axiom)
          cc(16,127);await wait(800);res.notYet=anyHas();await wait(1500);res.cleared=!anyHas();cc(16,0);
          // pressione breve: non cancella
          tap(0);await wait(30);const T2=ctx.currentTime;noteOn(62,.8);await wait(150);noteOff(62);
          while(ctx.currentTime-T2<1.5)await wait(1);tap(0);await wait(200);
          cc(16,127);await wait(200);cc(16,0);await wait(2200);res.shortKeeps=anyHas();
          return res}''')
        # tastiera del PC: E e L sono note (Re# e Re sopra), N registra l'esibizione, C cambia l'ambito degli effetti;
        # la finestra che perde il focus spegne le note tenute
        await pg.keyboard.down('e');r['keyE']=await pg.evaluate('held.size===1&&!perf');await pg.keyboard.up('e')
        await pg.keyboard.down('l');r['keyL']=await pg.evaluate('held.size===1&&fxScope==="mix"');await pg.keyboard.up('l')
        await pg.keyboard.press('n');r['keyN']=await pg.evaluate('!!perf');await pg.evaluate('perf=null')
        await pg.keyboard.press('c');r['keyC']=await pg.evaluate('fxScope==="loop"');await pg.keyboard.press('c')
        await pg.keyboard.down('a');await pg.evaluate('dispatchEvent(new Event("blur"))');r['blurOff']=await pg.evaluate('held.size===0&&pcHeld.size===0');await pg.keyboard.up('a')
        print(json.dumps(r,indent=1));print('errori',errs)
        exp={'fam1':'Chitarra acustica','inFam':'Chitarra elettrica','back':'Chitarra elettrica','beatShown':True,'pbOnce':0,'pbAgain':1,'pbDown':0,'pbPlaying':True,'dropPend':True,'dropped':True,'buildClosing':True,'returnPend':True,'back':True,'padOnOne':True,'hcVol':'vol','hcPan':'pan','pan0':-1,'hcFx':'fx','fx1':1,'fxBar':True,'hcMidi':'dj','knobLabel':'MANOPOLE EFFETTI DJ','djBar':True,'djVolUntouched':True,'djFilter':True,'djEcho':True,'djFlanger':True,'djCrush':True,'djGate':True,'djRoll':True,'djLive':True,'djRollOn':True,'djOff':True,'fxLoopSound':True,'fxLoopKeep':True,'fxLoopVol':True,'fxBadge':True,'fxStop':True,'pickWait':True,'pickCross':True,'pickDj':True,'pickAfterStop':True,'allOff':True,'panic':True,'keyE':True,'keyL':True,'keyN':True,'keyC':True,'blurOff':True,'telBuild':True,'telBuildEnd':True,'hcCenter':True,'hcPad':True,'hcPad2':True,'reset':True,'playIgnored':True,
             'stopAtBoundary':True,'stillRunning':True,'label':'■ SUBITO','stoppedAfter':True,'immediate':True,'notYet':True,'cleared':True,'shortKeeps':True}
        bad={k:(r.get(k),v) for k,v in exp.items() if r.get(k)!=v}
        assert not bad and not errs,bad
        print('OK')
        await b.close()
asyncio.run(main())
