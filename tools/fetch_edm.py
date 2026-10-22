"""Scarica in samples/ il kit house (Roland TR-909, da smpldsnds/drum-abuse-vol3) e i due campioni del drop
(boom e piatto, CC0, da smpldsnds/sonic-pi-samples). La 909 arriva in wav a 44,1 kHz: la porto a 48 kHz
e la salvo in ogg Opus come le altre batterie. Uso: python tools/fetch_edm.py"""
import os;os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","samples"))
import io,urllib.request,urllib.parse
import numpy as np,soundfile as sf
from scipy.signal import resample_poly
TR909='https://raw.githubusercontent.com/smpldsnds/drum-abuse-vol3/main/samples/roland-tr-909/1/'
SONIC='https://raw.githubusercontent.com/smpldsnds/sonic-pi-samples/main/samples/'
# tasto della mappa batteria (Do = 0 … Si = 11) -> (file della 909, nome in samples/house909)
H909={0:('TR-909Kick 01','kick'),1:('TR-909Rim','rim'),2:('TR-909Snare 01','snare'),3:('TR-909Clap','clap'),
 4:('TR-909Snare 08','snare2'),5:('TR-909Tom Low 02','tom-l'),6:('TR-909Hat C 02','hhclosed'),7:('TR-909Tom Mid 02','tom-m'),
 8:('TR-909Hat C 01','hhclosed-short'),9:('TR-909Tom Hi 02','tom-h'),10:('TR-909Hat O 03','hhopen'),11:('TR-909Crash','crash')}
FX={'boom':'bd_boom','crash':'drum_splash_hard'}
def get(u):return urllib.request.urlopen(u,timeout=30).read()
os.makedirs('house909',exist_ok=True);os.makedirs('drop_fx',exist_ok=True)
for k,(src,name) in H909.items():
  p=f'house909/{name}.ogg'
  if os.path.exists(p):continue
  x,r=sf.read(io.BytesIO(get(TR909+urllib.parse.quote(src)+'.wav')),dtype='float32')
  if r!=48000:x=resample_poly(x,48000,r).astype('float32')
  sf.write(p,np.clip(x,-1,1),48000,format='OGG',subtype='OPUS');print(p)
for name,src in FX.items():
  p=f'drop_fx/{name}.ogg'
  if not os.path.exists(p):open(p,'wb').write(get(SONIC+src+'.ogg'));print(p)
