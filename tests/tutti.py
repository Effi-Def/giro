"""Tutti i test di Giro uno dopo l'altro: ricostruisce dist/giro.html, poi il core, i test nel browser e l'analisi di Orecchio.
Uso: python tests/tutti.py            tutti
     python tests/tutti.py live axiom  solo questi (nome del file senza _test)
Un test fallisce se esce con un errore, se scrive una riga che comincia con FAIL o FALLITO, o se dura più di 10 minuti.
Alla fine il riepilogo; esce con 1 se ne è fallito almeno uno (così GitHub segna la prova come fallita)."""
import os,subprocess,sys,time
from pathlib import Path
R=Path(__file__).resolve().parent.parent
TESTS=[('core',['node','tests/core_test.js'])]+[(p.stem[:-5],[sys.executable,'tests/'+p.name]) for p in sorted((R/'tests').glob('*_test.py'))]+[
 ('orecchio-verifica',[sys.executable,'orecchio/test/verifica.py'])]
def main(nomi):
    sys.stdout.reconfigure(encoding='utf-8')
    if nomi and (sconosciuti:=set(nomi)-{n for n,_ in TESTS}):sys.exit('test sconosciuti: '+', '.join(sorted(sconosciuti)))
    subprocess.run([sys.executable,'tools/build.py'],cwd=R,check=True)
    env={**os.environ,'PYTHONIOENCODING':'utf-8'};esito=[]
    for nome,cmd in TESTS:
        if nomi and nome not in nomi:continue
        print(f'\n===== {nome}',flush=True);t=time.time()
        try:p=subprocess.run(cmd,cwd=R,env=env,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=600);out=p.stdout+p.stderr;rc=p.returncode
        except subprocess.TimeoutExpired as e:out=(e.stdout or '')+'\nTEMPO SCADUTO';rc=-1
        fail=[l for l in out.splitlines() if l.startswith(('FAIL','FALLITO'))]
        bene=rc==0 and not fail
        # di un test riuscito bastano le righe FAIL (nessuna); di uno fallito tutto l'output
        print(out if not bene else '',flush=True)
        esito.append((nome,bene,time.time()-t,fail or ([f'uscito con {rc}'] if rc else [])))
    print('\n===== RIEPILOGO')
    for nome,bene,s,fail in esito:print(f"{'OK  ' if bene else 'FAIL'} {nome:<18} {s:5.0f} s"+('' if bene else '  · '+' | '.join(fail)[:300]))
    nf=sum(not b for _,b,_,_ in esito);print(f'\n{len(esito)-nf} su {len(esito)} riusciti')
    sys.exit(1 if nf else 0)
if __name__=='__main__':main(sys.argv[1:])
