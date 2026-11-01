#!/usr/bin/env python3
"""
Orecchio — l'"orecchio" di Giro.

Legge il log di debug esportato da Giro (giro_debug_*.json, formato in FORMATO.md)
e scrive un report in italiano su DOVE nasce l'errore di tempo:
ingresso MIDI, latenza, griglia, calcolo della quantizzazione, rendering dei
campioni, durata dei giri.

Uso:
    python orecchio.py giro_debug.json              # stampa il report
    python orecchio.py giro_debug.json -o report.md # lo salva
    python orecchio.py giro_debug.json --json riassunto.json

Richiede: numpy, scipy.
"""
import argparse
import base64
import io
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

NOMI_NOTE = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"]


# ----------------------------------------------------------------- utilità
def ms(x):
    return f"{x * 1000:+.1f} ms"


def ms_abs(x):
    return f"{abs(x) * 1000:.1f} ms"


def nome_nota(p):
    if p is None:
        return "?"
    p = int(p)
    return f"{NOMI_NOTE[p % 12]}{p // 12 - 1}"


def circ_diff(a, b, periodo):
    """a - b ridotto nell'intervallo [-periodo/2, periodo/2)."""
    return (a - b + periodo / 2) % periodo - periodo / 2


class Reperto:
    ORDINE = {"grave": 0, "attenzione": 1, "info": 2}

    def __init__(self, chiave, gravita, titolo, evidenza, dove, prova):
        self.chiave, self.gravita, self.titolo = chiave, gravita, titolo
        self.evidenza, self.dove, self.prova = evidenza, dove, prova

    def as_dict(self):
        return dict(chiave=self.chiave, gravita=self.gravita, titolo=self.titolo,
                    evidenza=self.evidenza, dove=self.dove, prova=self.prova)


# ----------------------------------------------------------------- audio
def carica_wav(loop, cartella):
    sorgente = None
    if loop.get("wavBase64"):
        sorgente = io.BytesIO(base64.b64decode(loop["wavBase64"]))
    elif loop.get("wav"):
        p = Path(cartella) / loop["wav"]
        if p.exists():
            sorgente = p
    if sorgente is None:
        return None, None
    sr, d = wavfile.read(sorgente)
    if d.dtype.kind == "i":
        d = d.astype(np.float64) / np.iinfo(d.dtype).max
    elif d.dtype.kind == "u":
        d = (d.astype(np.float64) - 128) / 128
    else:
        d = d.astype(np.float64)
    if d.ndim > 1:
        d = d.mean(axis=1)
    return sr, d


class Inviluppo:
    """Inviluppo RMS di un loop circolare, per cercare attacchi vicino a punti attesi."""

    def __init__(self, d, sr):
        self.sr, self.L = sr, len(d) / sr
        self.hop, self.win = max(1, round(sr * 0.0005)), max(2, round(sr * 0.012))
        self.pre = round(0.2 * sr)
        dd = np.concatenate([d[-self.pre:], d, d[:self.pre]])   # il loop è circolare
        cs = np.concatenate([[0.0], np.cumsum(dd * dd)])
        self.starts = np.arange(0, len(dd) - self.win, self.hop)
        self.env = np.sqrt(np.maximum(cs[self.starts + self.win] - cs[self.starts], 0) / self.win)
        self.lag = max(2, round(0.012 * sr / self.hop))

    def attacco_vicino(self, t, finestra):
        """(tempo, forza) della salita di energia più netta entro ±finestra da t."""
        h = self.hop / self.sr
        c = int((t * self.sr + self.pre) / self.hop)
        a, b = max(self.lag, c - int(finestra / h)), min(len(self.env), c + int(finestra / h) + 1)
        if b <= a:
            return None, 0.0
        salita = self.env[a:b] - self.env[a - self.lag:b - self.lag]
        k = a + int(np.argmax(salita))
        base, picco = self.env[k - self.lag], self.env[k]
        forza = picco - base
        j = k - self.lag
        while j < k and self.env[j] <= base + 0.25 * forza:
            j += 1
        tempo = ((self.starts[j] + self.win) - self.pre) / self.sr
        return tempo, forza


def attacchi_audio(d, sr):
    """Istanti (s) degli attacchi in un loop circolare, con la regola di beatOnsets in app.js:
    energia a blocchi di 256 campioni, salita di almeno 6 dB sui 3 blocchi prima, non oltre 30 dB sotto il massimo."""
    B = 256
    n = len(d) // B
    if n < 4:
        return np.array([])
    e = (d[:n * B].reshape(n, B) ** 2).sum(axis=1)
    if e.max() < 1e-5:          # silenzio
        return np.array([])
    db = 10 * np.log10(e + 1e-12)
    prima = np.max([np.roll(db, k) for k in (1, 2, 3)], axis=0)
    tenuti = []
    for i in np.flatnonzero((db > db.max() - 30) & (db - prima >= 6)):
        if not tenuti or i - tenuti[-1] > 8:
            tenuti.append(i)
    return np.array(tenuti) * B / sr


def misura_attacchi(d, sr, griglia):
    """Dove cadono gli attacchi di un loop di cui il log non ha le note."""
    t = attacchi_audio(d, sr)
    m = dict(attacchi=len(t))
    if len(t) < 4:
        return m
    battiti = griglia.get("beats")
    battito = griglia["loopLength"] / battiti if battiti else None
    candidati = [battito / 4, battito / 2, battito] if battiti else [griglia["step"]]
    z = [(p, np.exp(2j * np.pi * t / p).mean()) for p in candidati]
    # La più larga che spiega quasi quanto la migliore, come beatGrid in app.js: un anticipo costante su una parte
    # a ottavi si raccoglie anche sui sedicesimi, ma lì sembrerebbe un ritardo.
    migliore = max(abs(v) for _, v in z)
    p, v = [x for x in z if abs(x[1]) >= 0.9 * migliore][-1]
    medio = np.angle(v) * p / (2 * np.pi)
    e = circ_diff(t, medio, p) + medio
    m.update(passo_ms=p * 1000, concentrazione=abs(v), scarto_medio_ms=medio * 1000, dispersione_ms=e.std() * 1000,
             min_ms=e.min() * 1000, max_ms=e.max() * 1000)
    if battiti and p > battito / 4 * 1.01:
        m["oltre_sedicesimo"] = int((np.abs(e) > battito / 8).sum())
        m["sedicesimo_ms"] = battito / 4 * 1000
    return m


# ----------------------------------------------------------------- analisi
def analizza(log, cartella="."):
    reperti, num = [], {}
    sr = log.get("sampleRate", 48000)
    lat = (log.get("outputLatency") or 0) + (log.get("baseLatency") or 0)
    griglia = log["grid"]
    passo = griglia["step"]
    base_len = griglia["loopLength"]
    loops = {l["id"]: l for l in log.get("loops", [])}
    note = log.get("notes", [])

    def lunghezza(loop_id):
        l = loops.get(loop_id)
        if l and l.get("lengthSamples"):
            return l["lengthSamples"] / sr
        return base_len

    num["griglia"] = dict(bpm=griglia.get("bpm"), passo_ms=passo * 1000,
                          giro_s=base_len, caselle=base_len / passo, battiti=griglia.get("beats"),
                          divisione=griglia.get("division"))
    num["latenza_dichiarata_ms"] = lat * 1000

    # --- 1. griglia e lunghezze dei loop
    caselle = base_len / passo
    if abs(caselle - round(caselle)) * passo > 0.0005:
        reperti.append(Reperto(
            "griglia_non_intera", "grave",
            "Il giro non contiene un numero intero di caselle",
            f"Giro di {base_len:.4f} s diviso in caselle da {passo*1000:.2f} ms = {caselle:.3f} caselle.",
            "app.js — dove si ricava bpm e passo dal primo giro.",
            "Il passo va calcolato come lunghezza del giro / numero intero di caselle, non dai bpm arrotondati."))
    for lid, l in loops.items():
        ls = l.get("lengthSamples")
        if ls is None:
            continue
        if abs(ls - round(ls)) > 1e-6:
            reperti.append(Reperto(
                "lunghezza_frazionaria", "grave",
                f"Il loop {lid} ha una lunghezza non intera in campioni",
                f"lengthSamples = {ls}. Ogni giro accumula l'arrotondamento.",
                "core.js — lunghezza del buffer / indice di lettura.",
                "Arrotonda la lunghezza a un numero intero di campioni una volta sola, quando chiudi il primo giro."))
        multiplo = (ls / sr) / base_len
        if abs(multiplo - round(multiplo)) * base_len > 1.5 / sr:
            reperti.append(Reperto(
                "loop_non_multiplo", "grave",
                f"Il loop {lid} non è un multiplo esatto del primo giro",
                f"Dura {ls/sr:.5f} s = {multiplo:.4f} volte il primo giro: i due loop si sfasano a ogni passaggio.",
                "app.js / core.js — dove si fissa la lunghezza dei loop successivi.",
                "Ricava la lunghezza come multiplo intero di lengthSamples del primo giro."))

    # --- 2. ingresso MIDI: tempo usato vs pressione reale
    rit_in, usa_arrivo = [], 0
    # currentTime avanza a raffiche lunghe quanto il buffer della scheda (anche 14 ms), quindi una lettura sola non
    # dice dov'è l'orologio audio. Il riferimento è il massimo recente di currentTime − performance.now(): subito dopo una raffica.
    orologio = [(n["perfArrival"], n["ctxArrival"] - n["perfArrival"] / 1000) for n in note
                if n.get("perfArrival") is not None and n.get("ctxArrival") is not None]
    for n in note:
        if None in (n.get("midiTs"), n.get("perfArrival"), n.get("ctxArrival"), n.get("ctxUsed")):
            continue
        pressione = n["midiTs"] / 1000 + max(o for p, o in orologio if abs(p - n["perfArrival"]) < 30000)
        n["_rit_in"] = n["ctxUsed"] - pressione
        rit_in.append(n["_rit_in"])
        if abs(n["ctxUsed"] - n["ctxArrival"]) < 0.0005:
            usa_arrivo += 1
    if rit_in:
        r = np.array(rit_in)
        num["ingresso"] = dict(ritardo_medio_ms=r.mean() * 1000, dispersione_ms=r.std() * 1000,
                               massimo_ms=r.max() * 1000, note=len(r))
        if r.mean() > 0.006 or r.std() > 0.004:
            grave = r.mean() > 0.010 or r.std() > 0.006
            causa = ("Giro usa l'ora in cui il messaggio arriva alla pagina (audioCtx.currentTime nel gestore) "
                     "invece dell'ora in cui hai premuto il tasto (event.timeStamp)."
                     if usa_arrivo > 0.7 * len(r) else
                     "Il tempo assegnato alle note non corrisponde a quando hai premuto il tasto.")
            reperti.append(Reperto(
                "ingresso_in_ritardo", "grave" if grave else "attenzione",
                "Le note vengono datate in ritardo e in modo irregolare",
                f"Ritardo medio {ms_abs(r.mean())}, dispersione {ms_abs(r.std())}, massimo {ms_abs(r.max())}. {causa}",
                "app.js — gestore onmidimessage, dove si calcola la posizione della nota nel giro.",
                "Converti event.timeStamp (scala performance.now) in tempo audio con audioCtx.getOutputTimestamp(), "
                "invece di leggere audioCtx.currentTime all'arrivo: currentTime avanza a blocchi e il thread principale può essere in ritardo."))

    # --- 3. calcolo della quantizzazione
    errori_q, fuori = [], []
    for n in note:
        L = lunghezza(n.get("loop"))
        atteso = (round(n["pos"] / passo) * passo) % L
        n["_cella"] = round(n["pos"] / passo)
        n["_scarto"] = n["pos"] - round(n["pos"] / passo) * passo
        q = n.get("qpos")
        if q is None:
            continue
        if q >= L - 0.5 / sr or q < 0:
            fuori.append(n)
        elif abs(circ_diff(q, atteso, L)) > 1.5 / sr:
            errori_q.append(n)
    q_misurate = sum(n.get("qpos") is not None for n in note)
    num["quantizzazione"] = dict(errori_calcolo=len(errori_q), fuori_dal_giro=len(fuori), misurate=q_misurate,
                                 note=len(note), spente=sum(n.get("qpos") is None and n.get("stepUsed") == 0 for n in note))
    if fuori:
        ese = fuori[0]
        reperti.append(Reperto(
            "bug_fine_giro", "grave",
            f"{len(fuori)} note quantizzate fuori dal giro",
            f"Esempio: nota a {ese['pos']:.4f} s portata a {ese['qpos']:.4f} s in un giro lungo {lunghezza(ese.get('loop')):.4f} s. "
            "Le note suonate poco prima della fine vengono spinte oltre il giro invece che all'inizio del successivo: "
            "si perdono o finiscono nel posto sbagliato.",
            "app.js — funzione di quantizzazione.",
            "Dopo l'arrotondamento applica il modulo: qpos = (round(pos/passo)*passo) % lunghezza."))
    if errori_q:
        ese = errori_q[0]
        L = lunghezza(ese.get("loop"))
        atteso = (round(ese["pos"] / passo) * passo) % L
        reperti.append(Reperto(
            "calcolo_quantizzazione", "grave",
            f"{len(errori_q)} note quantizzate su una casella diversa da quella più vicina",
            f"Esempio: posizione {ese['pos']:.4f} s → {ese['qpos']:.4f} s, la casella più vicina era {atteso:.4f} s.",
            "app.js — funzione di quantizzazione (arrotondamento per difetto? origine della griglia diversa da 0?).",
            "Usa Math.round, non Math.floor, e misura la posizione dall'inizio del giro."))

    # --- 4. dove cadono le note rispetto alla griglia
    sovra = [n for n in note if n.get("overdub", n.get("loop", 0) > 0 or n.get("cycle", 0) > 0)]
    gruppo = sovra if len(sovra) >= 4 else note
    if len(gruppo) >= 4:
        pos = np.array([n["pos"] for n in gruppo])

        def raccolta(p):
            """(concentrazione, scarto medio) delle note su caselle lunghe p."""
            z = np.exp(2j * np.pi * pos / p).mean()
            return abs(z), np.angle(z) * p / (2 * np.pi)
        # Sui sedicesimi di un tempo veloce bastano 25 ms di dispersione per sembrare note sparse: la griglia è sbagliata
        # solo se le note non si raccolgono neanche su ottavi e battiti. Vale la casella più stretta che le spiega.
        battiti = griglia.get("beats")
        candidati = [passo] + [p for p in ((base_len / battiti / 2, base_len / battiti) if battiti else ()) if p > passo * 1.01]
        p_note = next((p for p in candidati if raccolta(p)[0] >= 0.45), passo)
        R, medio = raccolta(p_note)
        for n in note:
            n["_scarto"] = n["pos"] - round(n["pos"] / p_note) * p_note
        e = np.array([n["_scarto"] for n in gruppo])
        disp = np.std(circ_diff(e, medio, p_note))
        # senza quantizzazione nessuna nota cambia casella: "al limite" si conta sulla griglia delle note
        p_q = passo if q_misurate else p_note
        bordo = int((np.abs(pos - np.round(pos / p_q) * p_q) > 0.35 * p_q).sum())
        cambia = int((np.round((pos - medio) / p_q) != np.round(pos / p_q)).sum()) if R > 0.6 and q_misurate else None
        comp = float(np.mean([n.get("latencyComp", 0) or 0 for n in gruppo]))
        num["griglia_note"] = dict(note=len(gruppo), solo_sovraincisioni=gruppo is sovra, passo_ms=p_note * 1000,
                                   scarto_medio_ms=medio * 1000, dispersione_ms=disp * 1000,
                                   concentrazione=R, al_limite=bordo, cambierebbero_casella=cambia,
                                   compensazione_ms=comp * 1000)
        rit_medio_in = num.get("ingresso", {}).get("ritardo_medio_ms", 0) / 1000
        if len(gruppo) >= 6 and R < 0.45:
            reperti.append(Reperto(
                "griglia_non_combacia", "grave" if q_misurate else "attenzione",
                "Le note non si raccolgono intorno alla griglia: la griglia non è quella su cui suoni",
                f"Concentrazione {R:.2f} (1 = tutte vicine alla griglia, 0 = sparse a caso), bassa anche su ottavi e battiti. "
                f"Griglia dedotta: {griglia.get('bpm')} bpm, caselle da {passo*1000:.1f} ms."
                + ("" if q_misurate else " La quantizzazione è spenta: la griglia conta solo per il battito e gli effetti a tempo."),
                "app.js — deduzione di bpm e numero di battiti dal primo giro.",
                "Controlla in quanti battiti è stato diviso il primo giro: con un giro di 2 s, 4 o 8 battiti danno una griglia, 5 o 6 un'altra. "
                "Valuta di scegliere il numero di battiti che mette più note del primo giro vicino alla griglia."))
        elif abs(medio) > 0.010:
            spiega_lat = lat > 0.005 and comp < 0.5 * lat and abs(medio - (lat - comp)) < max(0.008, 0.35 * lat)
            spiega_in = rit_medio_in > 0.006 and abs(medio - rit_medio_in) < 0.006
            dettaglio = (f"Scarto medio {ms(medio)} su caselle da {p_note*1000:.1f} ms (dispersione {ms_abs(disp)}). "
                         f"{bordo} note su {len(gruppo)} cadono quasi a metà tra due caselle"
                         + (f"; compensando lo scarto, {cambia} {'nota finirebbe' if cambia == 1 else 'note finirebbero'} su un'altra casella." if cambia else "."))
            if spiega_lat:
                reperti.append(Reperto(
                    "latenza_non_compensata", "grave",
                    "Suoni sempre in ritardo della latenza audio: Giro non la compensa",
                    dettaglio + f" Il browser dichiara {ms_abs(lat)} di latenza e la compensazione applicata è {ms_abs(comp)}. "
                    "Tu suoni a tempo con quello che SENTI, che esce dalle casse con quel ritardo: senza compensazione ogni nota "
                    "sembra in ritardo e quelle vicine al limite scivolano sulla casella dopo.",
                    "app.js — calcolo di pos per le sovraincisioni.",
                    "Sottrai audioCtx.outputLatency + audioCtx.baseLatency dalla posizione delle note suonate sopra un loop che sta già girando "
                    "(non sul primo giro). Su Windows il valore dichiarato può essere impreciso: lasciane una correzione manuale fine."))
            elif spiega_in:
                reperti.append(Reperto(
                    "scarto_da_ingresso", "attenzione",
                    "Lo scarto dalla griglia coincide con il ritardo di ingresso",
                    dettaglio + " Risolvendo il ritardo di ingresso dovrebbe sparire anche questo.",
                    "app.js — gestore MIDI.", "Vedi il reperto sul ritardo di ingresso."))
            else:
                reperti.append(Reperto(
                    "scarto_sistematico", "grave" if cambia else "attenzione",
                    f"Le note cadono in media {ms(medio)} rispetto alla griglia",
                    dettaglio + (" In anticipo: la latenza non può spiegarlo, perché fa arrivare le note in ritardo. "
                                 "Di solito è il modo di suonare." if medio < 0 else
                                 " Non è spiegato né dalla latenza dichiarata né dal ritardo di ingresso: "
                                 "può essere il tuo modo di suonare, oppure una latenza che il browser non dichiara (interfaccia audio, driver)."),
                    "È dove hai premuto il tasto: prima di cercare in Giro, guarda se ingresso e giri sono a posto." if medio < 0 else
                    "app.js — compensazione della latenza.",
                    "Se si sente fuori tempo, accendi la quantizzazione: l'anticipo deve stare sotto mezza casella, "
                    "altrimenti la nota finisce sulla casella prima." if medio < 0 else
                    "Fai una prova a metronomo: se lo scarto resta uguale, aggiungi una regolazione di latenza manuale."))
        if q_misurate and bordo > 0.25 * len(gruppo) and R >= 0.45:
            reperti.append(Reperto(
                "molte_note_al_limite", "info",
                "Molte note cadono quasi a metà tra due caselle",
                f"{bordo} su {len(gruppo)} sono a più del 35% del passo dalla casella più vicina: per queste la quantizzazione tira a indovinare.",
                "Impostazione della quantizzazione.",
                f"Le note si raccolgono meglio su caselle da {p_note*1000:.1f} ms: prova una griglia più larga." if p_note > passo else
                "Se suoni terzine o swing, la griglia a sedicesimi le spezza: serve una griglia diversa o una quantizzazione parziale."))

    # --- 5. note doppie
    doppie, accorpate = [], []
    per_loop = {}
    for n in note:
        per_loop.setdefault((n.get("loop"), n.get("cycle")), []).append(n)
    for lst in per_loop.values():
        lst = sorted(lst, key=lambda n: n["pos"])
        for i in range(len(lst)):
            for j in range(i + 1, len(lst)):
                a, b = lst[i], lst[j]
                if b["pos"] - a["pos"] > passo:
                    break
                if a.get("pitch") != b.get("pitch"):
                    continue
                if b["pos"] - a["pos"] < 0.035:
                    doppie.append((a, b))
                elif a.get("qpos") is not None and abs(a["qpos"] - b["qpos"]) < 1e-6:
                    accorpate.append((a, b))
    num["note_doppie"] = dict(doppio_trigger=len(doppie), accorpate=len(accorpate))
    if doppie:
        a, b = doppie[0]
        reperti.append(Reperto(
            "doppio_trigger", "attenzione",
            f"{len(doppie)} note arrivate due volte a pochi millisecondi",
            f"Esempio: {nome_nota(a.get('pitch'))} a {a['pos']:.4f} e {b['pos']:.4f} s. Finiscono sulla stessa casella e suonano più forti o 'flangiate'.",
            "app.js — gestore MIDI (note-on duplicati, o note-on con velocity 0 trattati come nuove note).",
            "Ignora un note-on della stessa nota entro ~30 ms dal precedente, e tratta velocity 0 come note-off."))
    if accorpate:
        reperti.append(Reperto(
            "note_accorpate", "info",
            f"{len(accorpate)} coppie di note diverse finite sulla stessa casella",
            "Due pressioni distinte della stessa nota sono state portate nello stesso punto: una delle due si perde.",
            "Impostazione della quantizzazione.",
            "Se succede spesso, la griglia è troppo larga per quello che suoni (prova 1/16 invece di 1/8)."))

    # --- 6. rendering: dove entrano davvero i suoni nel loop
    render_per_suono, mancanti, con_audio, controllate, senza_note = {}, 0, 0, 0, {}
    for lid, l in loops.items():
        srw, d = carica_wav(l, cartella)
        if d is None:
            continue
        con_audio += 1
        if not any(n.get("loop") == lid for n in note):
            senza_note[lid] = misura_attacchi(d, srw, griglia)
        inv = Inviluppo(d, srw)
        L = inv.L
        nl = sorted([n for n in note if n.get("loop") == lid and n.get("qpos") is not None and n["qpos"] < L],
                    key=lambda n: n["qpos"])
        controllate += len(nl)
        gruppi = []
        for n in nl:
            if gruppi and n["qpos"] - gruppi[-1]["t"] < 0.02:
                gruppi[-1]["suoni"].add(n.get("sound"))
            else:
                gruppi.append(dict(t=n["qpos"], suoni={n.get("sound")}))
        finestra = min(0.45 * passo, 0.08)
        misure = [(g,) + inv.attacco_vicino(g["t"], finestra) for g in gruppi]
        forze = [f for _, _, f in misure if f > 0]
        tipica = float(np.median(forze)) if forze else 0.0
        for g, t, forza in misure:
            if t is None or forza < 0.15 * tipica or forza < 1e-3:
                mancanti += 1
            elif len(g["suoni"]) == 1:
                render_per_suono.setdefault(next(iter(g["suoni"])), []).append(circ_diff(t, g["t"], L))
    if con_audio:
        num["rendering"] = dict(
            loop_con_audio=con_audio, mancanti=mancanti, controllate=controllate,
            per_suono={s: dict(medio_ms=float(np.mean(v)) * 1000, dispersione_ms=float(np.std(v)) * 1000, note=len(v))
                       for s, v in render_per_suono.items()})
        for s, v in render_per_suono.items():
            if len(v) < 3:
                continue
            v = np.array(v)
            if abs(v.mean()) > 0.008:
                reperti.append(Reperto(
                    f"rendering_in_ritardo:{s}", "grave" if abs(v.mean()) > 0.015 else "attenzione",
                    f"Il suono «{s}» entra nel loop {ms(v.mean())} rispetto a dove è stato quantizzato",
                    f"Misurato su {len(v)} note (dispersione {ms_abs(v.std())}). La quantizzazione è giusta, ma il campione "
                    "ha silenzio o un attacco lento all'inizio: quello che senti arriva dopo la casella.",
                    "sampler.js — renderNote(), e la preparazione dei campioni (tools/analyze_samples.py).",
                    "Misura l'attacco di ogni campione una volta sola e anticipa renderNote di quel tempo, "
                    "oppure taglia il silenzio iniziale dei campioni quando li prepari."))
            elif v.std() > 0.005:
                reperti.append(Reperto(
                    f"rendering_irregolare:{s}", "attenzione",
                    f"Il suono «{s}» entra nel loop in punti irregolari",
                    f"Dispersione {ms_abs(v.std())} su {len(v)} note.",
                    "sampler.js — renderNote() (posizione di scrittura arrotondata? campioni diversi per altezza?).",
                    "Controlla che la posizione di scrittura sia qpos * sampleRate arrotondato una sola volta."))
        if mancanti:
            reperti.append(Reperto(
                "note_mancanti", "grave" if mancanti > 2 else "attenzione",
                f"{mancanti} note quantizzate non si sentono nel loop",
                "Nel log ci sono, nell'audio del loop no (nessun attacco vicino alla loro casella).",
                "sampler.js / app.js — scrittura delle note nel buffer del loop.",
                "Controlla le note vicino alla fine del giro e quelle in sovraincisione che entrano 'dal giro successivo'."))

    # --- 7. loop con l'audio ma senza note nel log (annullato, ripetuto, sessione ripresa): si misura dagli attacchi
    if senza_note:
        num["senza_note"] = senza_note
    for lid, m in senza_note.items():
        if m.get("concentrazione", 0) < 0.45 or abs(m["scarto_medio_ms"]) <= 10:
            continue
        anticipo = m["scarto_medio_ms"] < 0
        oltre = m.get("oltre_sedicesimo")
        reperti.append(Reperto(
            f"loop_senza_note:{lid}", "attenzione",
            f"Il loop {lid} cade in media {m['scarto_medio_ms']:+.1f} ms rispetto alla griglia (misurato dall'audio)",
            f"Le note di questo loop non sono nel log (annullato, ripetuto o sessione ripresa), quindi vale quello che si legge nell'audio: "
            f"{m['attacchi']} attacchi su caselle da {m['passo_ms']:.1f} ms, da {m['min_ms']:+.1f} a {m['max_ms']:+.1f} ms, "
            f"concentrazione {m['concentrazione']:.2f}. La misura sbaglia di qualche ms."
            + ("" if anticipo else " Un suono con l'attacco lento sembra in ritardo anche se è a tempo."),
            "Senza note non si distingue il modo di suonare da un errore di scrittura: rifai la parte senza annullare e riesporta, "
            "così il report confronta note e audio.",
            "Se si sente fuori tempo, rifai la parte con la quantizzazione accesa: lo scarto deve stare sotto mezza casella."
            + (f" A sedicesimi (caselle da {m['sedicesimo_ms']:.1f} ms) {oltre} attacchi su {m['attacchi']} finirebbero sulla casella accanto: "
               f"usa caselle da {m['passo_ms']:.1f} ms." if oltre else "")))

    # --- 8. durata reale dei giri
    giri = {}
    for w in log.get("wraps", []):
        giri.setdefault(w["loop"], []).append(w["ctx"])
    if giri:
        num["giri"] = {}
        base_id = min(giri, key=lambda l: (lunghezza(l), l))   # il più corto: il primo giro può non stare nel loop 0
        for lid, ts in giri.items():
            ts = sorted(ts)
            if len(ts) < 3:
                continue
            L = lunghezza(lid)
            der = np.diff(ts) - L
            num["giri"][lid] = dict(deriva_per_giro_ms=der.mean() * 1000, irregolarita_ms=der.std() * 1000, giri=len(ts))
            al_min = der.mean() * 60 / L
            if abs(der.mean()) > 0.00005:
                reperti.append(Reperto(
                    f"deriva:{lid}", "grave" if abs(al_min) > 0.005 else "attenzione",
                    f"Il loop {lid} dura {ms(der.mean())} in più a ogni giro",
                    f"Dopo un minuto è spostato di {ms_abs(al_min)}: all'inizio è a tempo, poi scivola.",
                    "core.js — avanzamento dell'indice di lettura (somma di frazioni? lunghezza in secondi invece che in campioni?).",
                    "Fai avanzare l'indice di un campione per frame e riportalo a 0 con il modulo sulla lunghezza intera in campioni."))
            if lid != base_id and giri.get(base_id):
                base_ts = np.array(sorted(giri[base_id]))
                # ogni ripartenza va confrontata con la ripartenza del primo giro più vicina nel tempo
                sfas = np.array([t - base_ts[np.argmin(np.abs(base_ts - t))] for t in ts
                                 if base_ts.min() - 0.01 <= t <= base_ts.max() + 0.01])
                if len(sfas) == 0:
                    continue
                if np.abs(sfas).max() > 0.002:
                    reperti.append(Reperto(
                        f"sfasati:{lid}", "grave",
                        f"Il loop {lid} non riparte insieme al primo",
                        f"Sfasamento fino a {ms_abs(np.abs(sfas).max())} tra l'inizio del loop {lid} e l'inizio del primo giro.",
                        "core.js — avvio dei loop successivi.",
                        "Fai partire i nuovi loop sul confine del primo giro, contato in campioni dentro il worklet."))

    reperti.sort(key=lambda r: Reperto.ORDINE[r.gravita])

    # note peggiori
    def peso(n):
        p = 0
        if n in fuori:
            p += 100
        if n in errori_q:
            p += 50
        p += abs(n.get("_scarto", 0)) * 1000 + abs(n.get("_rit_in", 0)) * 1000
        return p
    peggiori = sorted(note, key=peso, reverse=True)[:15]
    return reperti, num, peggiori, passo


# ----------------------------------------------------------------- report
def scrivi_report(nome, reperti, num, peggiori, passo):
    r = [f"# Orecchio — report di `{nome}`", ""]
    g = num["griglia"]
    r.append(f"Griglia: **{g['bpm']} bpm**, "
             + (f"divisione {g['divisione']}, caselle da {g['passo_ms']:.1f} ms, giro di {g['giro_s']:.4f} s ({g['caselle']:.2f} caselle). "
                if g.get("divisione") else f"quantizzazione spenta, giro di {g['giro_s']:.4f} s ({g.get('battiti')} battiti). ")
             + f"Latenza dichiarata dal browser: {num['latenza_dichiarata_ms']:.1f} ms.")
    r.append("")
    r.append("## Verdetto")
    r.append("")
    if not reperti:
        r.append("Nessun problema trovato. Se senti ancora qualcosa di strano, esporta subito dopo che succede "
                 "e annota a che giro e su quale loop.")
    for i, x in enumerate(reperti, 1):
        etichetta = {"grave": "🔴 grave", "attenzione": "🟠 da guardare", "info": "⚪ informazione"}[x.gravita]
        r += [f"### {i}. {x.titolo}", f"*{etichetta}*", "", f"- **Cosa si misura:** {x.evidenza}",
              f"- **Dove guardare:** {x.dove}", f"- **Cosa provare:** {x.prova}", ""]
    r.append("## Numeri")
    r.append("")
    if "ingresso" in num:
        x = num["ingresso"]
        r.append(f"- **Ingresso MIDI:** ritardo medio {x['ritardo_medio_ms']:.1f} ms, dispersione {x['dispersione_ms']:.1f} ms, "
                 f"massimo {x['massimo_ms']:.1f} ms ({x['note']} note).")
    if "griglia_note" in num:
        x = num["griglia_note"]
        quali = "sovraincisioni" if x["solo_sovraincisioni"] else "tutte le note"
        r.append(f"- **Note rispetto alla griglia** ({quali}, {x['note']}, caselle da {x['passo_ms']:.1f} ms): scarto medio {x['scarto_medio_ms']:+.1f} ms, "
                 f"dispersione {x['dispersione_ms']:.1f} ms, concentrazione {x['concentrazione']:.2f}, "
                 f"{x['al_limite']} al limite, compensazione applicata {x['compensazione_ms']:.1f} ms.")
    x = num["quantizzazione"]
    if x["misurate"]:
        altre = x["note"] - x["misurate"]
        r.append(f"- **Quantizzazione:** {x['errori_calcolo']} errori di calcolo, {x['fuori_dal_giro']} note fuori dal giro, "
                 f"su {x['misurate']} note quantizzate" + (f" ({altre} non controllate)." if altre else "."))
    elif x["note"] and x["spente"] == x["note"]:
        r.append(f"- **Quantizzazione:** spenta per tutte le {x['note']} note, non misurata.")
    else:
        r.append("- **Quantizzazione:** nessuna nota da controllare, non misurata.")
    x = num["note_doppie"]
    r.append(f"- **Note doppie:** {x['doppio_trigger']} doppi trigger, {x['accorpate']} coppie accorpate.")
    if "rendering" in num:
        x = num["rendering"]
        r.append(f"- **Rendering** ({x['loop_con_audio']} loop con audio): {x['mancanti']} note non udibili." if x["controllate"] else
                 f"- **Rendering** ({x['loop_con_audio']} loop con audio): nessuna nota quantizzata da cercare nell'audio, controllo saltato.")
        for s, v in x["per_suono"].items():
            r.append(f"  - {s}: entra a {v['medio_ms']:+.1f} ms (dispersione {v['dispersione_ms']:.1f} ms, {v['note']} note)")
    else:
        r.append("- **Rendering:** nessun audio dei loop nel log, controllo saltato.")
    for lid, m in num.get("senza_note", {}).items():
        if "concentrazione" not in m:
            r.append(f"- **Loop {lid} senza note nel log:** {m['attacchi']} attacchi nell'audio, troppo pochi per misurare.")
        elif m["concentrazione"] < 0.45:
            r.append(f"- **Loop {lid} senza note nel log:** {m['attacchi']} attacchi nell'audio, sparsi rispetto alla griglia "
                     f"(concentrazione {m['concentrazione']:.2f}).")
        else:
            r.append(f"- **Loop {lid} senza note nel log** (dall'audio, {m['attacchi']} attacchi, caselle da {m['passo_ms']:.1f} ms): "
                     f"scarto medio {m['scarto_medio_ms']:+.1f} ms, da {m['min_ms']:+.1f} a {m['max_ms']:+.1f} ms, "
                     f"concentrazione {m['concentrazione']:.2f}.")
    if num.get("giri"):
        for lid, v in num["giri"].items():
            r.append(f"- **Giri del loop {lid}:** {v['deriva_per_giro_ms']:+.3f} ms per giro, irregolarità {v['irregolarita_ms']:.2f} ms ({v['giri']} giri).")
    r.append("")
    r.append("Nota: una dispersione di 10–20 ms rispetto alla griglia è normale per chi suona; "
             "il report cerca gli errori di Giro, non giudica il tuo tempo.")
    r.append("")
    r.append("## Note da guardare")
    r.append("")
    r.append("| loop | giro | nota | suono | posizione | quantizzata | scarto griglia | ritardo ingresso |")
    r.append("|---|---|---|---|---|---|---|---|")
    for n in peggiori:
        rit = f"{n['_rit_in']*1000:+.1f} ms" if "_rit_in" in n else "—"
        q = f"{n['qpos']:.4f} s" if n.get("qpos") is not None else "—"
        r.append(f"| {n.get('loop')} | {n.get('cycle', 0)} | {nome_nota(n.get('pitch'))} | {n.get('sound', '?')} | "
                 f"{n['pos']:.4f} s | {q} | {n.get('_scarto', 0)*1000:+.1f} ms | {rit} |")
    return "\n".join(r) + "\n"


def main():
    ap = argparse.ArgumentParser(description="Analizza il log di debug di Giro.")
    ap.add_argument("log")
    ap.add_argument("-o", "--output", help="salva il report markdown qui")
    ap.add_argument("--json", help="salva anche un riassunto JSON")
    a = ap.parse_args()
    p = Path(a.log)
    log = json.loads(p.read_text(encoding="utf-8"))
    reperti, num, peggiori, passo = analizza(log, p.parent)
    testo = scrivi_report(p.name, reperti, num, peggiori, passo)
    if a.output:
        Path(a.output).write_text(testo, encoding="utf-8")
        print(f"Report salvato in {a.output}")
    else:
        sys.stdout.reconfigure(encoding="utf-8")
        print(testo)
    if a.json:
        Path(a.json).write_text(json.dumps(dict(reperti=[x.as_dict() for x in reperti], numeri=num),
                                           ensure_ascii=False, indent=2, default=float), encoding="utf-8")


if __name__ == "__main__":
    main()
