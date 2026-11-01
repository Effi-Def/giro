# Compito per Claude Code: aggiungere a Giro l'esportazione di debug per Orecchio

Leggi prima `CLAUDE.md` di Giro e `orecchio/FORMATO.md`.

## Obiettivo

Giro deve poter esportare un file JSON con tutto quello che serve a capire **dove** nasce un errore di tempo (note che dopo la quantizzazione non sono a tempo, tempistiche strane). Il file viene poi analizzato da `orecchio/orecchio.py`, che produce un report.

**Questo compito aggiunge solo misure. Non correggere niente del comportamento di Giro**, anche se mentre lo strumenti noti un errore: annotalo nel messaggio finale. Prima si misura, poi si corregge in base al report.

## Cosa fare

1. **Raccolta sempre attiva e leggera** (`app.js`): un oggetto `DBG` con un buffer circolare di massimo 2000 note e 500 ripartenze. Nessun costo percepibile mentre si suona.

2. **Per ogni note-on che finisce in un loop** registra i campi di `notes` del formato. In particolare:
   - `midiTs` = `event.timeStamp`, `perfArrival` = `performance.now()` e `ctxArrival` = `audioCtx.currentTime`, letti **all'inizio** di `onmidimessage`;
   - `ctxUsed`, `latencyComp`, `pos`, `qpos` = i valori **che Giro usa davvero** nel codice attuale, presi dalle stesse variabili, non ricalcolati a parte. Se Giro non compensa la latenza, `latencyComp` è 0;
   - `cycle` e `overdub` come descritti nel formato.
   Vale anche per la tastiera del PC, se suona note (in quel caso `midiTs` = `performance.now()`).

3. **Griglia**: quando il primo giro si chiude, salva in `DBG.grid` i valori esatti usati per la quantizzazione (lunghezza, bpm, battiti, divisione, passo).

4. **Ripartenze** (`core.js`, nel worklet): quando l'indice di lettura di un loop torna a 0, invia con `port.postMessage` `{type: 'wrap', loop, ctx: currentTime + i / sampleRate}`, dove `i` è l'indice del frame dentro il blocco da 128. In `app.js` aggiungile a `DBG.wraps`.

5. **Audio dei loop**: al momento dell'esportazione chiedi al worklet una copia di ogni buffer (messaggio `dump`), convertila in WAV PCM 16 bit mono e mettila in `wavBase64`. Scrivi una piccola funzione `encodeWav(float32, sampleRate)`, nessuna libreria.

6. **Esportazione**: con **Ctrl+Shift+D** sulla tastiera del PC, scarica `giro_debug_AAAAMMGG-HHMMSS.json` (Blob + link, funziona offline). La riga dei suggerimenti in alto mostra per due secondi "Debug esportato". Nessun pulsante nuovo nell'interfaccia.

7. Ricostruisci con `python tools/build.py` e lancia i test esistenti: devono passare tutti.

8. **Verifica**: con Playwright apri `dist/giro.html`, simula un primo giro e una sovraincisione con note MIDI finte, esporta, e lancia `python orecchio/orecchio.py <file>`. Il file deve essere letto senza errori e il report deve contenere tutte le sezioni (ingresso, griglia, quantizzazione, rendering, giri). Riporta il report che esce: è già una prima diagnosi.

## Vincoli

- Resta un unico file HTML, nessuna dipendenza esterna.
- Niente funzioni visibili in più oltre alla scorciatoia.
- Aggiorna `CLAUDE.md` con una sezione breve "Debug e Orecchio": scorciatoia, cosa raccoglie, come si lancia l'analisi.
