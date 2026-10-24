"""Scarica in samples/ tre nastri di Mellotron (da smpldsnds/archiveorg-mellotron) e la batteria Roland CR-8000
(da smpldsnds/drum-machines). Mellotron: un tasto ogni 3 dei 35 (G…F), i primi 4 s dei nastri da 8 s con dissolvenza,
mono a 24 kHz in ogg Opus. I nomi dei file del Mellotron non dicono l'ottava vera: la misuro sul campione centrale
(spettro a prodotto armonico) e sposto tutti i tasti dello stesso numero di ottave. Uso: python tools/fetch_vintage.py"""
import os;os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","samples"))
import io,json,re,urllib.request,urllib.parse
import numpy as np,soundfile as sf
MT='https://raw.githubusercontent.com/smpldsnds/archiveorg-mellotron/main/'
DM='https://raw.githubusercontent.com/smpldsnds/drum-machines/main/Roland-CR-8000/'
# cartella in samples/ -> nastro
TAPES={'mt_violins':'MKII VIOLINS','mt_choir':'8VOICE CHOIR','mt_flute':'TRON FLUTE'}
CR8000=['kick','rimshot','snare','clap','cowbell','tom-low','hihat-closed','conga-low','clave','tom-high','hihat-open','cymball']
NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def get(u):return urllib.request.urlopen(u,timeout=30).read()
def q(s):return urllib.parse.quote(s)
def name_midi(n): # "A#2 …" -> MIDI con Do4 = 60, come scritto nel nome
  m=re.match(r'([A-G]#?)\s*(\d)',n);return NAMES.index(m[1])+12*(int(m[2])+1)
def f0(x,r): # fondamentale con lo spettro a prodotto armonico, sul tratto stabile 1…3 s
  s=x[int(r):int(3*r)];f=np.abs(np.fft.rfft(s*np.hanning(len(s)),8*len(s)));fr=np.fft.rfftfreq(8*len(s),1/r);h=f.copy()
  for k in(2,3,4):h[:len(f)//k]*=f[::k][:len(f)//k]
  h[fr<50]=0;h[len(f)//4:]=0;return fr[np.argmax(h)]
for folder,tape in TAPES.items():
  if os.path.isdir(folder) and os.listdir(folder):continue
  files=json.loads(get(MT+q(tape)+'/files.json'));files.sort(key=name_midi)
  keys=files[::3];mid=keys[len(keys)//2]
  x,r=sf.read(io.BytesIO(get(MT+q(tape)+'/'+q(mid)+'.ogg')))
  shift=12*round((69+12*np.log2(f0(x,r)/440)-name_midi(mid))/12);os.makedirs(folder)
  for n in keys:
    x,r=sf.read(io.BytesIO(get(MT+q(tape)+'/'+q(n)+'.ogg')),dtype='float32')
    if x.ndim>1:x=x.mean(1)
    x=x[:4*r];x[-int(.3*r):]*=np.linspace(1,0,int(.3*r),dtype='float32')
    sf.write(f'{folder}/{name_midi(n)+shift}.ogg',x,r,format='OGG',subtype='OPUS')
  print(folder,tape,'ottave',shift//12,len(keys),'campioni',sum(os.path.getsize(f'{folder}/{f}') for f in os.listdir(folder))//1024,'KB')
os.makedirs('cr8000',exist_ok=True)
for n in CR8000:
  p=f'cr8000/{n}.ogg'
  if not os.path.exists(p):open(p,'wb').write(get(DM+n+'.ogg'));print(p)
