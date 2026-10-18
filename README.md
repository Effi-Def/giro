# Giro

Looper audio dal vivo nel browser, pensato per suonare con una **M-Audio Axiom AIR Mini 32**.
Funziona come una Boss RC-50: suoni sulla tastiera con strumenti campionati, i pad registrano e lanciano fino a 8 loop.

È un unico file HTML che si apre in Chrome, senza installazione né internet.

## Come si usa

1. Scarica `giro.html` dall'ultima [Release](../../releases/latest) e aprilo in Chrome.
2. Metti l'Axiom in **modo MIDI** (tasto H finché i LED Volume/Pan/Inst-FX sono spenti).
3. Premi un pad e suona: il primo loop parte dalla prima nota. Ripremi lo stesso pad nel punto in cui deve ricominciare.

| Controllo | Funzione |
|---|---|
| Pad 1–8 | loop 1–8: vuoto → pronto · registra → chiudi · pieno → stop/ripartenza a tempo · tenuto 0,8 s → cancella |
| Manopole 1–8 | volume dei loop |
| ■ ▶ ● | stop (da fermo, due volte = cancella tutto) · play da capo · sovraincidi |
| ◀ ▶ ▲ ▼ | annulla · ripeti · suono successivo · suono precedente |

Senza tastiera MIDI: `A…K` note, `Z/X` ottava, `1–8` loop, `R` sovraincidi, `Q` quantizzazione, spazio play/stop, Backspace annulla, frecce su/giù suono.

## Sviluppo

```
python tools/build.py      # assembla dist/giro.html da src/
node tests/core_test.js    # test del motore del looper
python tests/flow_test.py  # test nel browser (Playwright + Chromium)
```

I dettagli su architettura, quantizzazione e mappa MIDI sono in [CLAUDE.md](CLAUDE.md).

## Crediti dei suoni

- Tastiere, chitarre, bassi e atmosfere: soundfont **MusyngKite**, nella conversione di
  [gleitz/midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts), rilasciato con licenza
  [Creative Commons Attribution-ShareAlike 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
  I campioni incorporati in `src/sounds_data.js` e nel file della Release sono distribuiti con la stessa licenza.
- Batterie (LinnDrum LM-2, Roland TR-808): [smpldsnds/drum-machines](https://github.com/smpldsnds/drum-machines),
  campioni descritti come di pubblico dominio.
