# Orecchio

L'"orecchio" di Giro: trasforma "a volte le note non sono a tempo" in numeri e indica dove guardare nel codice.

## Come si usa

1. **Una volta sola:** copia questa cartella dentro il progetto di Giro (`giro-project/orecchio/`), apri Claude Code lì e scrivi: *"Esegui il compito in orecchio/ISTRUZIONI_GIRO.md"*. Giro imparerà a esportare un log di debug con **Ctrl+Shift+D**.
2. **Quando senti un errore:** suona in Giro finché il problema si presenta, poi premi subito **Ctrl+Shift+D**. Scarica `giro_debug_….json`.
3. **Analizza:**
   ```
   pip install numpy scipy
   python orecchio/orecchio.py giro_debug_….json -o report.md
   ```
4. **Correggi:** dai `report.md` a Claude Code ("correggi Giro in base a questo report"), ricostruisci, risuona, riesporta e rianalizza. Quando il verdetto è vuoto, è a posto.

## Cosa controlla

| Controllo | Cosa trova |
|---|---|
| Ingresso MIDI | note datate all'arrivo invece che alla pressione del tasto (ritardo e irregolarità) |
| Note rispetto alla griglia | latenza audio non compensata, scarto costante, griglia dedotta male dal primo giro |
| Calcolo della quantizzazione | arrotondamenti sbagliati, note spinte fuori dal giro vicino alla fine |
| Note doppie | doppi trigger MIDI, note diverse accorpate nella stessa casella |
| Rendering | suoni che entrano nel loop dopo la casella (silenzio o attacco lento nei campioni), note quantizzate che non si sentono |
| Giri | loop che durano un po' più del dovuto e scivolano, loop che non ripartono insieme |
| Loop senza note | loop annullati, ripetuti o ripresi da una sessione: dove cadono gli attacchi letti dall'audio |

## Verifica

`python test/verifica.py` genera log finti con quindici situazioni (cinque pulite e dieci difetti noti, ognuna con tre esecuzioni umane diverse, anche con la quantizzazione spenta o un loop annullato) e controlla che Orecchio trovi ogni difetto e nient'altro. Oggi passano tutti e 45.

## Limiti

- Misura gli errori di Giro, non il tuo tempo: 10–20 ms di dispersione sono normali per chi suona.
- Su Windows `outputLatency` può essere imprecisa: se il report trova uno scarto costante non spiegato, la causa può essere la latenza reale dell'interfaccia audio.
- Il controllo del rendering ha un errore di circa 2 ms; segnala solo scarti sopra gli 8 ms.
- Un loop senza note si misura dall'audio: non si distingue il modo di suonare da un errore di scrittura, e un suono con l'attacco lento sembra in ritardo.

Formato del log: `FORMATO.md`.
