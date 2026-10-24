import os;os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","samples"))
import concurrent.futures as cf, urllib.request, os, json
NAMES=['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
def nn(m):return NAMES[m%12]+str(m//12-1)
INST={ # cartella: (lo, hi, passo)
 'acoustic_grand_piano':(33,96,3),'electric_piano_1':(36,93,3),'drawbar_organ':(36,93,3),'vibraphone':(53,89,3),
 'acoustic_guitar_steel':(40,84,3),'electric_guitar_clean':(40,84,3),
 'electric_bass_finger':(28,64,3),'acoustic_bass':(28,64,3),'synth_bass_1':(28,64,3),
 'string_ensemble_1':(36,93,3),'pad_2_warm':(36,84,3),'choir_aahs':(48,84,3),
 'lead_2_sawtooth':(36,93,3),'pad_3_polysynth':(36,93,3),'synth_brass_1':(36,93,3),
 'synth_strings_1':(36,93,3),'pad_8_sweep':(36,84,3),'synth_bass_2':(28,64,3),
 'pad_7_halo':(36,84,3),'pad_4_choir':(36,84,3),'fx_4_atmosphere':(36,84,3),'fx_3_crystal':(48,96,3),
 'glockenspiel':(60,105,3),'celesta':(48,96,3),'steel_drums':(48,84,3),'sitar':(40,84,3)}
jobs=[]
for ins,(lo,hi,st) in INST.items():
  os.makedirs(ins,exist_ok=True)
  for m in range(lo,hi+1,st):jobs.append((ins,m))
def get(j):
  ins,m=j;p=f'{ins}/{m}.mp3'
  if os.path.exists(p) and os.path.getsize(p)>500:return 0
  u=f'https://raw.githubusercontent.com/gleitz/midi-js-soundfonts/gh-pages/MusyngKite/{ins}-mp3/{nn(m)}.mp3'
  try:
    d=urllib.request.urlopen(u,timeout=30).read();open(p,'wb').write(d);return 0
  except Exception as e:return f'{u} {e}'
with cf.ThreadPoolExecutor(16) as ex:
  errs=[r for r in ex.map(get,jobs) if r]
print('errori',errs[:5],len(errs))
for ins in INST:
  s=sum(os.path.getsize(f'{ins}/{f}') for f in os.listdir(ins));print(f'{ins:24s} {len(os.listdir(ins)):3d} file {s/1024:7.0f} KB')
