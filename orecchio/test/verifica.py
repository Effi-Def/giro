#!/usr/bin/env python3
"""Verifica che orecchio.py riconosca ogni difetto simulato, e solo quello."""
import json
import sys
import tempfile
from pathlib import Path

QUI = Path(__file__).resolve().parent
sys.path.insert(0, str(QUI.parent))
sys.path.insert(0, str(QUI))
from orecchio import analizza, scrivi_report  # noqa: E402
from genera_scenari import SCENARI, scenario  # noqa: E402

ATTESI = {
    "pulito": set(),
    "raffiche": set(),
    "latenza_non_compensata": {"latenza_non_compensata"},
    "ora_di_arrivo": {"ingresso_in_ritardo"},
    "attacco_lento_basso": {"rendering_in_ritardo:basso"},
    "bug_fine_giro": {"bug_fine_giro"},
    "deriva": {"deriva:0", "deriva:1", "deriva:2"},
    "battiti_sbagliati": {"griglia_non_combacia"},
    "doppio_trigger": {"doppio_trigger"},
    "sciolta": set(),
    "q_spenta": set(),
    "q_spenta_anticipo": {"scarto_sistematico"},
    "q_spenta_battiti_sbagliati": {"griglia_non_combacia"},
    "annullato": set(),
    "annullato_anticipo": {"loop_senza_note:2"},
}
# reperti informativi che possono comparire senza essere un errore
TOLLERATI = {"molte_note_al_limite", "note_accorpate", "scarto_da_ingresso"}

ok = True
for nome, kw in SCENARI.items():
    for seme in (1, 2, 3):
        log = scenario(nome, seme=seme, **kw)
        reperti, num, peggiori, passo = analizza(log)
        trovati = {r.chiave for r in reperti if r.gravita != "info"} - TOLLERATI
        atteso = ATTESI[nome]
        mancano, inattesi = atteso - trovati, trovati - atteso
        esito = "OK " if not mancano and not inattesi else "NO "
        # a quantizzazione spenta niente è grave, e il report dice che non l'ha misurata
        if nome.startswith("q_spenta") and (any(r.gravita == "grave" for r in reperti)
                                            or "non misurata" not in scrivi_report(nome, reperti, num, peggiori, passo)):
            esito = "NO "
        # il loop senza note si misura dall'audio, con il segno giusto, e il report lo dice
        if nome.startswith("annullato"):
            lid, atteso_ms = (1, 0) if nome == "annullato" else (2, -65)
            m = num.get("senza_note", {}).get(lid, {})
            if abs(m.get("scarto_medio_ms", 999) - atteso_ms) > 10 or f"Loop {lid} senza note" not in scrivi_report(nome, reperti, num, peggiori, passo):
                esito = "NO "
        if esito == "NO ":
            ok = False
        print(f"{esito} {nome:24s} seme {seme}  trovati={sorted(trovati)}"
              + (f"  MANCANO={sorted(mancano)}" if mancano else "")
              + (f"  INATTESI={sorted(inattesi)}" if inattesi else ""))
print("\nTUTTO OK" if ok else "\nCI SONO ERRORI")
sys.exit(0 if ok else 1)
