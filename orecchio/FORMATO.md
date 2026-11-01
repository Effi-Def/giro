# Formato del log di debug di Giro

Un unico file JSON, `giro_debug_AAAAMMGG-HHMMSS.json`, scaricato dal browser. Tutti i tempi `ctx…` sono in secondi sulla scala di `audioCtx.currentTime`; quelli `midiTs` / `perf…` in millisecondi sulla scala di `performance.now()`.

```jsonc
{
  "giro_debug": 1,
  "sampleRate": 48000,            // audioCtx.sampleRate
  "baseLatency": 0.01,            // audioCtx.baseLatency
  "outputLatency": 0.035,         // audioCtx.outputLatency
  "quantize": "1/16",             // impostazione attuale (null se spenta)

  "grid": {                       // la griglia COSÌ COME GIRO LA USA, ricavata dal primo giro
    "loopLength": 2.0,            // durata del primo giro in secondi
    "bpm": 120,
    "beats": 4,                   // battiti in cui è stato diviso il primo giro
    "division": "1/16",
    "step": 0.125                 // passo della griglia in secondi
  },

  "loops": [                      // uno per loop registrato
    {
      "id": 0,
      "lengthSamples": 96000,     // lunghezza del buffer, in campioni
      "wavBase64": "UklGR..."     // contenuto del buffer del loop: WAV PCM 16 bit mono, in base64
    }
  ],

  "notes": [                      // una per ogni note-on registrato in un loop (max ~2000, le più recenti)
    {
      "loop": 1,                  // id del loop in cui è finita
      "cycle": 3,                 // numero del giro (del primo loop) in cui è stata suonata
      "overdub": true,            // false solo per le note del primo giro
      "pitch": 36,
      "sound": "basso",           // nome del suono attivo
      "midiTs": 12345.67,         // event.timeStamp del messaggio MIDI
      "perfArrival": 12348.9,     // performance.now() all'inizio del gestore
      "ctxArrival": 7.3504,       // audioCtx.currentTime all'inizio del gestore
      "ctxUsed": 7.3504,          // il tempo audio che Giro ha attribuito alla nota (prima della compensazione)
      "latencyComp": 0.0,         // secondi sottratti per compensare la latenza (0 se nessuna)
      "pos": 1.3802,              // posizione nel loop prima della quantizzazione (s)
      "qpos": 1.375               // posizione dopo la quantizzazione (s) — uguale a pos se spenta
    }
  ],

  "wraps": [                      // ogni volta che un loop riparte da capo (dal worklet)
    { "loop": 0, "ctx": 9.0 }     // currentTime + indice del frame / sampleRate, cioè al campione esatto
  ]
}
```

Come lo scrive Giro:

- `pos`, `qpos`, `wraps` e il WAV sono contati **dall'inizio del giro** (`G.origin`), non dall'inizio del buffer: nel buffer l'indice 0 di un loop è la sua prima nota, che dopo il primo loop non cade sulla griglia. Il WAV è il buffer ruotato; `wraps[].ctxBuf` è la ripartenza vera dell'indice 0.
- `qpos` è `null` se la nota non è quantizzata sulla griglia di `step` (Q spenta, Q cambiata, battiti raddoppiati dopo) o non è ancora arrivata nel buffer (sovraincisione che entra al giro dopo): i controlli di quantizzazione e rendering la saltano. `qposUsed` e `stepUsed` dicono cosa è stato usato davvero (`stepUsed` 0 = Q spenta). A Q spenta `grid.division` è `null` e `grid.step` vale comunque i sedicesimi: non è una griglia usata, e il report dice che quantizzazione e rendering non sono stati misurati.
- `midiTs` è il `timeStamp` dell'evento anche per la tastiera del PC (`performance.now()` solo se l'evento non ce l'ha).
- `grid` è la griglia al momento dell'esportazione; `gridClose` quella alla chiusura del primo giro.

Campi mancanti = controllo saltato: senza `wavBase64` niente analisi del rendering, senza `wraps` niente analisi della durata dei giri. Un loop con `wavBase64` ma nessuna nota in `notes` si misura dagli attacchi nell'audio. I nomi dei campi aggiuntivi sono liberi: Orecchio li ignora.
