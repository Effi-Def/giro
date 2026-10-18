# Giro

Looper audio dal vivo nel browser, pensato per suonare con una **M-Audio Axiom AIR Mini 32**. Funziona come una Boss RC-50 / Loopy Pro: suoni sulla tastiera con strumenti campionati, i pad registrano e lanciano fino a 8 loop. È un unico file HTML (`dist/giro.html`, ~9 MB con i campioni dentro) che si apre in Chrome su Windows, senza installazione né internet.

Rispondi sempre in italiano. L'interfaccia è in italiano.

## Cosa vuole l'utente (requisiti emersi provando le versioni precedenti)

- **È un looper, non una DAW.** Niente arrangiamento, timeline, scene, impostazioni in vista. Ogni funzione in più va giustificata; le versioni che hanno aggiunto funzioni "alla Ableton" sono state bocciate come complicate.
- **Come la RC-50:** il primo loop ha lunghezza libera, la decide chi suona ripremendo il pad. Niente tempo o battute da impostare prima, niente pre-conteggio.
- **La registrazione parte alla prima nota suonata**, non alla pressione del pad (il pad mette il loop in "pronto").
- **Tutto dall'Axiom**, senza dover assegnare controlli: la mappa è fissa nel codice (vedi sotto).
- **Suoni veri e facili da trovare:** i suoni sintetizzati sono stati giudicati pessimi. I suoni stanno sempre in vista, divisi per famiglia.
- **Quantizzazione** delle note registrate, per non andare fuori tempo.
- Intuitivo prima di tutto: una riga in alto dice sempre cosa fare adesso.

## Struttura

```
src/shell.html       HTML + CSS; il segnaposto <!--SCRIPT--> viene sostituito dal build
src/sounds_meta.js   elenco dei 20 suoni (generato da tools/build_sounds.py)
src/sounds_data.js   campioni in base64 (generato, 8,7 MB: non aprirlo, non modificarlo a mano)
src/sampler.js       caricamento campioni, voice() dal vivo, renderNote() per la quantizzazione, preview()
src/core.js          LoopCore: motore del looper, gira dentro l'AudioWorklet
src/app.js           audio graph, stato dei loop (G), azioni, quantizzazione, MIDI, tastiera del PC
src/ui.js            interfaccia: griglia degli 8 loop, pannello suoni, suggerimenti, forme d'onda
tools/build.py       assembla dist/giro.html — da lanciare dopo OGNI modifica a src/
tools/extract_samples.py, fetch_samples.py, analyze_samples.py, build_sounds.py   pipeline dei campioni (in samples/)
tests/               test (vedi sotto)
```

Dopo ogni modifica: `python tools/build.py`, poi i test.

## Architettura

**Audio.** I suoni dal vivo escono su 3 bus (`liveBus`) che vanno sia al master sia agli ingressi dell'AudioWorklet. I bus ruotano (`G.cur`) dopo ogni registrazione così le code delle note (tails) finiscono nel loop giusto. Uscita: `masterIn` → filtro → riverbero a convoluzione → compressore → `masterOut`.

**LoopCore (`core.js`).** Classe autonoma, lavora in frame audio assoluti. Ogni loop è un buffer mono riprodotto all'indice `(F - t0) mod len`; l'uscita è stereo (`process(ins,out,F0,n,outR)`, senza `outR` resta mono come nei test) con pan per loop (legge di bilanciamento: al centro il livello non cambia) e un filtro SVF per loop sull'uscita (`fx` −1…1: passa-basso 20 kHz→150 Hz, passa-alto 20 Hz→6 kHz, zona morta al centro), smussati a ~30 ms. Riceve comandi via `port.postMessage`: `rec`, `recEnd`, `cancelRec`, `dub`, `undub`, `gate` (play/stop a un frame preciso), `vol`, `pan`, `fx`, `shift`, `clear`, `undo`, `redo`, `reset`, `fill`, `pend`. Manda indietro `state`, `peaks`, `done`. Ha annulla/ripeti per strato. Il codice della classe viene serializzato con `LoopCore.toString()` e caricato nel worklet: **non deve dipendere da nient'altro**.

**Worklet da file locale.** Chrome rifiuta `addModule` con URL `blob:` quando la pagina è aperta da `file://`; si usa un URL `data:` e, se fallisce, `blob:`. Se l'AudioWorklet non parte, c'è il ripiego su ScriptProcessor con lo stesso LoopCore (più latenza).

**Stato (`app.js`, oggetto `G`).** `G.base` = lunghezza del primo loop in frame; `G.origin` = frame d'inizio della griglia; `G.beats` = battiti del giro base. Stati di un loop: `empty → armed → rec → (closing) → play ⇄ dub`, più `muted` e `pend` (stop/ripartenza in attesa).

- Primo loop: lunghezza = da prima nota a ripressione. Il tempo si ricava supponendo 1/2/4/8… battiti con BPM tra 70 e 140 (`beatsFor`). Il tempo è ambiguo (75 o 150 bpm?): `checkDouble` raddoppia `G.beats` se in una ripresa (o sovraincisione, `G.dubTake`) almeno il 30% delle note cade a 1/4 o 3/4 del battito stimato, cioè sono ottavi in levare di un tempo doppio (solo se il doppio resta ≤ 200 bpm). Senza questo, sopra i 140 bpm con 1/8 i levare finivano sul battere precedente.
- Loop successivi: lunghezza = multiplo intero più vicino di `G.base`; se ripremi prima, continua fino al confine (stato `closing`).
- Stop/ripartenza dei loop pieni avvengono alla suddivisione successiva (`nextQ`).
- Drop (`dropToggle`): al prossimo 1 della battuta (`nextBar`, battuta = `G.base` se il giro ha meno di 4 battiti) ferma con `pend`/`gate` tutti i loop pieni che suonano tranne quello selezionato e li segna `dropped`; il secondo tocco li fa rientrare sul prossimo 1. Build-up (`buildStart`/`buildEnd`): rampa esponenziale del filtro di `cutF` verso 300 Hz con risonanza fino a 8 in 2 battute (2–8 s); al rilascio filtro e Q tornano di colpo al valore delle impostazioni sul prossimo 1 e finisce il drop. `stopAll`/`clearAll` annullano drop e build-up.
- ■ a loop avviati imposta `G.stopAt` al prossimo confine del giro base e manda subito al core `gate` off (e `undub`) con quel frame, così lo stop è preciso; `tick` poi chiama `stopAll`. In alto un battito grande (1–4, l'1 evidenziato) segue il movimento che si sente, tolto il ritardo d'uscita.
- Latenza: i suoni sono tutti interni e note e loop escono con lo stesso ritardo, quindi la compensazione automatica (`latencyFrames()`) è 0 con l'AudioWorklet (1024 frame col ripiego ScriptProcessor). Compensare `outputLatency + baseLatency` spostava le note in anticipo (66 ms su questo PC, più di mezzo sedicesimo a 120 bpm). Nelle impostazioni si vede solo il ritardo audio reale (`audioDelayMs`), senza niente da regolare.

**Quantizzazione.** Il looper registra audio, quindi non si possono spostare le note dopo. Con la quantizzazione accesa (default 1/16; 1/8 o spenta):
- le note dal vivo vanno direttamente a `masterIn` (si sentono subito, senza ritardo) e **non** entrano nel looper;
- ogni nota viene annotata (`G.ev`: nota, velocity, suono, frame di on/off);
- alla chiusura di una registrazione `renderRec` ricostruisce le note con `renderNote()` (stessa catena di `voice()`: campione, intonazione, inviluppo, loop interno) nella posizione quantizzata e le manda al core con `fill`;
- in sovraincisione ogni nota, al rilascio, viene mandata con `pend` e diventa udibile solo quando la testina la raggiunge al giro dopo (così non si sente doppia).

Il modo (suddivisione o spenta) si fissa in `L.q` quando parte la registrazione o la sovraincisione (●): cambiare Q a metà vale dalla ripresa successiva. Regola: una nota va su `masterIn` solo se è annotata in `G.ev`, altrimenti va su `liveBus[G.cur]`.

Si quantizza solo l'attacco, non la durata. La griglia è relativa a `G.origin` e divide `G.base` in `G.beats × suddivisione` parti. Limite noto: presume 4/4.

## Suoni

20 suoni, campionati, incorporati in `sounds_data.js`:
- Tastiere: Pianoforte, Rhodes, Organo, Vibrafono
- Chitarre: Acustica, Elettrica
- Bassi: Basso elettrico, Contrabbasso, Synth bass, Synth bass 2 (trasposti −12, così suonano già nel registro giusto)
- Atmosfere: Archi, Pad, Coro
- Synth: Lead (dente di sega), Polysynth, Synth brass, Synth strings, Pad sweep
- Batterie: Batteria (LinnDrum LM-2), Drum machine 808

Fonti: soundfont **MusyngKite** da `raw.githubusercontent.com/gleitz/midi-js-soundfonts` (un campione ogni 3 semitoni) e batterie da `raw.githubusercontent.com/smpldsnds/drum-machines` (ogg Opus).

Dettagli:
- I campioni durano ~3,16 s. Organo, Archi, Pad, Coro e tutti i Synth (`loop:1`) ottengono un tratto ripetuto con dissolvenza incrociata tra 1,2 e 2,9 s (`makeLoop`), così durano finché tieni il tasto.
- `gain` è normalizzato sull'RMS (`analyze_samples.py`) e corretto a orecchio con i moltiplicatori in `build_sounds.py`.
- `off` salta il silenzio iniziale degli mp3: conta per il tempismo dei loop.
- Batterie: stessa mappa in ogni ottava. Do cassa, Do# rim, Re rullante, Re# clap, Mi rullante 2, Fa tom basso, Fa# charleston, Sol tom medio, Sol# charleston corto, La tom alto, La# charleston aperto (chiuso dal charleston chiuso), Si piatto.
- Per aggiungere o cambiare un suono: modifica `INST` in `fetch_samples.py` e la lista `S` in `build_sounds.py`, poi `extract → fetch → analyze → build_sounds → build`. `samples/` non è nel repo: `extract_samples.py` ci rimette i campioni già incorporati (le batterie non hanno uno script di download). Senza ffmpeg, `analyze_samples.py` decodifica con Chromium via Playwright, con lo stesso downmix di ffmpeg (i guadagni tornano identici).
- Non c'è anteprima quando scegli un suono: è stata tolta perché suonava sopra i loop.

## Mappa dell'Axiom (fissa, letta dalla diagnostica dell'utente)

Due modi, scelti col pulsante dei modi accanto alle manopole (LED Volume → Pan → Inst/FX → tutti spenti = MIDI). In **modo MIDI** tutto arriva sul canale 1 con i numeri della tabella. Nei modi **HyperControl** (LED accesi) l'Axiom usa la porta HyperControl e il canale 16 con altri numeri (letti dallo script di Ableton `Axiom_AIR_Mini32`, non verificati sull'Axiom dell'utente): manopole CC 33–40, ■ ▶ ● CC 116 117 118, tasto centrale CC 98, frecce ◀ ▶ ▲ ▼ CC 99 100 101 102, pad note 81–84 (pad 1–4) e 85–88 (pad 5–8) su canale 15 (banco B sul 16); il pulsante dei modi manda CC 58 entrando in Volume o Pan (alterna), 59 in Inst/FX, 60 in MIDI. `onMIDI` traduce questi messaggi negli stessi comandi del modo MIDI.

| Controllo | MIDI | Funzione |
|---|---|---|
| Pad 1–8 | note 36–43 | loop 1–8: vuoto → pronto; registra → chiudi; pieno → stop alla suddivisione / rientro sull'1 della battuta; tenuto 0,8 s → cancella |
| Manopole 1–8 | CC 1–8 (HyperControl: 33–40) | volume, pan o filtro dei loop 1–8 secondo `knobMode`: Volume/MIDI = volume, Pan = pan, Inst/FX = filtro (sinistra passa-basso, destra passa-alto, centro niente). Le manopole saltano al valore (niente soft takeover). Il modo si vede e si cambia anche dal pulsante MANOPOLE in alto o col tasto M |
| ■ ▶ ● | CC 16 17 18 | stop alla fine del giro (ripremuto: subito; tenuto 2 s: cancella tutto, solo se il tasto manda anche il rilascio) · da fermo play da capo; mentre suona tocco = drop / rientro sull'1, tenuto = build-up col filtro (tenuto solo se il tasto manda il rilascio) · sovraincidi sul loop selezionato |
| ◀ ▶ ▲ ▼ | CC 19 20 21 22 | annulla · ripeti · famiglia di suoni successiva · precedente (riprende l'ultimo suono usato in quella famiglia) |
| Tasto centrale | CC 23 | suono successivo nella stessa famiglia |
| Pitch bend | 0xE0 | su / giù: seleziona il loop pieno successivo / precedente senza fermarlo (scatta una volta per spinta, si riarma al centro; non verificato sull'Axiom) |
| Sustain | CC 64 | pedale |

Insidie note:
- I pad mandano le stesse note dei tasti sullo stesso canale: le note 36–43 sono sempre trattate come pad, anche se arrivano dalla tastiera abbassata di ottava.
- Il tasto Mod potrebbe mandare CC 1 come la manopola 1 (non verificato).
- I layout dei pad a schermo seguono la disposizione fisica: 5–8 sopra, 1–4 sotto.

Dal PC: `A…K` note, `Z/X` ottava, `1–8` loop, `Maiusc+1–8` seleziona il loop senza fermarlo, `R` sovraincidi, `B` come ▶ mentre suona (drop / build-up), `Q` quantizzazione, `M` modo delle manopole (volume / pan / filtro), spazio play/stop (tenuto 2 s: cancella tutto), Backspace annulla, frecce su/giù famiglia, sinistra/destra suono nella famiglia.

## Test

- `node tests/core_test.js` — test numerici del LoopCore (registrazione, code, compensazione, multipli, sovraincisione, annulla/ripeti, gate, cancella, shift, ripiegamento, uscita stereo, pan, filtro, reset che conserva volume/pan/filtro). Devono dare tutti OK.
- `python tests/flow_test.py` — flusso reale in Chromium headless con Playwright: primo loop, secondo loop, sovraincisione, annulla, stop a tempo, cancella; controlla che non ci siano errori e scroll orizzontale a 420 px.
- `python tests/quant_test.py` — suona note fuori griglia e verifica che nel loop finiscano sulla griglia; verifica la sovraincisione quantizzata, i cambi di Q a metà ripresa e i levare a 150 bpm con 1/8.
- `python tests/live_test.py` — comandi dal vivo: famiglie di suoni e tasto centrale, pitch bend che seleziona il loop, drop e build-up con ▶, rientro dei pad sull'1, modi delle manopole e messaggi HyperControl simulati (pulsante dei modi, manopole, tasto centrale, pad), battito visivo, ▶ ignorato mentre suona, ■ a fine giro, ■■ subito, ■ tenuto che cancella tutto (e pressione breve che non cancella).
- `python tests/sounds_test.py` — caricamento dei 20 suoni, livelli misurati, registrazione con pianoforte e batteria.

Nel container il Chromium di Playwright è già installato; avvialo con `--autoplay-policy=no-user-gesture-required`. Il MIDI reale non si può testare: risulta "non consentito" ed è normale.

## Vincoli

- Deve restare **un solo file HTML** che funziona aperto da disco in Chrome. Web MIDI non funziona dentro gli artifact di claude.ai: non pubblicarlo come artifact.
- Il PC dell'utente è un HP ProDesk 600 G1 mini (i5-4590T, 16 GB, Windows 10): niente elaborazioni pesanti in tempo reale.
- Nessuna libreria esterna a runtime; i font Google sono l'unica risorsa di rete e hanno fallback.
- Prima di aggiungere funzioni, chiedi: l'utente preferisce poche cose che funzionano bene.

## Possibili prossimi passi (non ancora richiesti)

- Salvare la sessione (i loop audio) in IndexedDB.
- Campioni di qualità più alta per pianoforte e Rhodes (es. Splendid Grand Piano su smpldsnds).
- Supporto a tempi dispari per la quantizzazione.
