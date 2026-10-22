# Rimette in samples/ i campioni già incorporati in src/sounds_data.js, così build_sounds.py
# può rigenerare tutto senza riscaricare (le batterie vecchie non hanno uno script di download).
# I suoni EDM generati (edm_*) sono in ogg; kit house e campioni del drop hanno i loro nomi.
import os;os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","samples"))
import json,base64,ast
src=open('../tools/build_sounds.py',encoding='utf-8').read()
# cartelle e mappe delle batterie lette da build_sounds.py, per non duplicarle
tree=ast.parse(src);V={}
for n in tree.body:
  if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) and n.targets[0].id in('LM','TR','H909'):V[n.targets[0].id]=ast.literal_eval(n.value)
S=[x for x in ast.parse(src).body if isinstance(x,ast.Assign) and getattr(x.targets[0],'id','')=='S'][0]
folders={e.elts[0].value:e.elts[3].value for e in S.value.elts}
s=open('../src/sounds_data.js',encoding='utf-8').read();data=json.loads(s[s.index('=')+1:s.rstrip().rindex(';')])
n=0
for id,files in data.items():
  if id in folders:folder=folders[id];name=(lambda k:f'{k}.ogg') if folder.startswith('edm_') else (lambda k:f'{k}.mp3')
  elif id=='batteria':folder,name='lm2',lambda k:V['LM'][int(k)]+'.ogg'
  elif id=='808':folder,name='tr808',lambda k:V['TR'][int(k)]+'.ogg'
  elif id=='house909':folder,name='house909',lambda k:V['H909'][int(k)]+'.ogg'
  elif id=='drop_fx':folder,name='drop_fx',lambda k:f'{k}.ogg'
  else:print('salto',id);continue
  os.makedirs(folder,exist_ok=True)
  for k,b in files.items():
    p=f'{folder}/{name(k)}'
    if not os.path.exists(p):open(p,'wb').write(base64.b64decode(b));n+=1
print('estratti',n,'file')
