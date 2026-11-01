#!/usr/bin/env python3
"""
Genera log di debug FINTI di Giro, ognuno con un difetto noto, per verificare
che orecchio.py lo riconosca. Simula: un primo giro libero di 2 s (120 bpm,
sedicesimi), un basso e una batteria in sovraincisione, un esecutore umano
con ±12 ms di imprecisione, e l'audio dei loop.
"""
import base64
import io
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile

SR = 48000
LEN = 2.0
BPM_VERO = 120
PASSO_VERO = 60 / BPM_VERO / 4          # sedicesimi
QUANTO = 128 / SR                        # currentTime avanza a blocchi di 128 campioni
LAT = 0.045                              # outputLatency + baseLatency
PERF_OFF = 5.0                           # performance.now = (ctx + 5 s) * 1000


def scenario(nome, seme=1, latenza_comp=True, usa_arrivo=False, attacco=None,
             bug_modulo=False, deriva=0.0, battiti_dedotti=4, doppio=False, quanto=QUANTO,
             q_spenta=False, umano_ms=12, anticipo=0.0, parti_larghe=False, dimentica=(), anticipo_dimenticati=0.0):
    rng = np.random.default_rng(seme)
    attacco = attacco or {}
    passo = LEN / (battiti_dedotti * 4)
    t0 = 1.0
    note = []

    def suona(loop, ciclo, cella, pitch, suono, umano=None, sovra=True):
        g = cella * PASSO_VERO
        u = rng.normal(anticipo + (anticipo_dimenticati if loop in dimentica else 0), umano_ms / 1000) if umano is None else umano
        inizio_ciclo = t0 + ciclo * LEN
        pressione = inizio_ciclo + g + u + (LAT if sovra else 0)
        if not sovra and not note:
            pressione = t0                                   # la prima nota fa partire il giro
        rit = rng.uniform(2, 28) / 1000 if usa_arrivo else rng.uniform(1, 6) / 1000
        arrivo = pressione + rit
        ctx_arrivo = np.floor(arrivo / quanto) * quanto
        midi = (pressione + PERF_OFF) * 1000
        ctx_usato = ctx_arrivo if usa_arrivo else pressione
        comp = LAT if (latenza_comp and sovra) else 0.0
        pos = (ctx_usato - comp - inizio_ciclo) % LEN
        q = round(pos / passo) * passo
        if not bug_modulo:
            q %= LEN
        note.append(dict(loop=loop, cycle=ciclo, pitch=pitch, sound=suono, overdub=sovra,
                         midiTs=midi, perfArrival=(arrivo + PERF_OFF) * 1000, ctxArrival=ctx_arrivo,
                         ctxUsed=ctx_usato, latencyComp=comp, pos=pos, qpos=None if q_spenta else q,
                         stepUsed=0 if q_spenta else passo))

    # loop 0: primo giro, piano a ottavi
    for i, c in enumerate(range(0, 16, 2)):
        suona(0, 0, c, [60, 64, 67, 72][i % 4], "piano", umano=0.0 if i == 0 else None, sovra=False)
    # loop 1: basso in sovraincisione, giro 1
    for c, p in ([(0, 36), (4, 36), (6, 43), (8, 41), (12, 41), (14, 38)] if parti_larghe else
                 [(0, 36), (3, 36), (6, 43), (8, 41), (11, 41), (14, 38)]):
        suona(1, 1, c, p, "basso")
    # loop 2: batteria a sedicesimi (a ottavi con parti_larghe), giro 2 (con una nota suonata in anticipo sulla fine)
    for c in range(0, 16, 2 if parti_larghe else 1):
        suona(2, 2, c, 42 if c % 4 else 36, "batteria")
    suona(2, 3, 0, 38, "batteria", umano=-0.04)   # rullante anticipato: pos ~1.996 -> ultima casella o modulo
    if doppio:
        n = dict(note[-5]); n["pos"] += 0.006; n["midiTs"] += 6; n["perfArrival"] += 6
        note.append(n)

    # audio dei loop: quello che Giro ha scritto nei buffer
    loops = []
    for lid in range(3):
        d = np.zeros(int(LEN * SR))
        for n in note:
            scritta = n["pos"] if q_spenta else n["qpos"]
            if n["loop"] != lid or scritta >= LEN:
                continue
            t = scritta + attacco.get(n["sound"], 0.0)
            k0 = int(round(t * SR))
            dur = int(0.35 * SR)
            tt = np.arange(dur) / SR
            if n["sound"] == "batteria":
                s = rng.normal(0, 1, dur) * np.exp(-tt / 0.04) * 0.25
            else:
                f = 440 * 2 ** ((n["pitch"] - 69) / 12)
                s = np.sin(2 * np.pi * f * tt) * np.exp(-tt / 0.15) * 0.25
            s *= np.minimum(1, tt / 0.001)
            idx = (k0 + np.arange(dur)) % len(d)
            np.add.at(d, idx, s)
        d = np.clip(d, -1, 1)
        buf = io.BytesIO()
        wavfile.write(buf, SR, (d * 32767).astype(np.int16))
        loops.append(dict(id=lid, lengthSamples=int(LEN * SR), wavBase64=base64.b64encode(buf.getvalue()).decode()))

    wraps = []
    for lid in range(3):
        for k in range(lid, lid + 5):
            wraps.append(dict(loop=lid, ctx=t0 + k * (LEN + deriva)))

    return dict(giro_debug=1, scenario=nome, sampleRate=SR, baseLatency=0.01, outputLatency=LAT - 0.01,
                quantize=None if q_spenta else "1/16",
                grid=dict(loopLength=LEN, bpm=60 * battiti_dedotti / LEN, beats=battiti_dedotti,
                          division=None if q_spenta else "1/16", step=passo),
                loops=loops, notes=[n for n in note if n["loop"] not in dimentica], wraps=wraps)


SCENARI = {
    "pulito": dict(),
    "raffiche": dict(quanto=0.0138),     # pulito, con currentTime che avanza a raffiche da 13,8 ms come su Windows
    "latenza_non_compensata": dict(latenza_comp=False),
    "ora_di_arrivo": dict(usa_arrivo=True),
    "attacco_lento_basso": dict(attacco={"basso": 0.03}),
    "bug_fine_giro": dict(bug_modulo=True),
    "deriva": dict(deriva=0.0008),
    "battiti_sbagliati": dict(battiti_dedotti=5),
    "doppio_trigger": dict(doppio=True),
    # parti a ottavi suonate larghe (26 ms): sui sedicesimi sembrano sparse, ma la griglia è giusta
    "sciolta": dict(umano_ms=26, parti_larghe=True),
    "q_spenta": dict(q_spenta=True, umano_ms=26, parti_larghe=True),
    "q_spenta_anticipo": dict(q_spenta=True, umano_ms=26, parti_larghe=True, anticipo=-0.047),
    "q_spenta_battiti_sbagliati": dict(q_spenta=True, battiti_dedotti=5),
    # loop annullato: l'audio resta, le note no
    "annullato": dict(dimentica=(1,)),
    "annullato_anticipo": dict(q_spenta=True, parti_larghe=True, dimentica=(2,), anticipo_dimenticati=-0.065),
}

if __name__ == "__main__":
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "scenari")
    out.mkdir(parents=True, exist_ok=True)
    for nome, kw in SCENARI.items():
        (out / f"{nome}.json").write_text(json.dumps(scenario(nome, **kw)), encoding="utf-8")
        print("scritto", nome)
