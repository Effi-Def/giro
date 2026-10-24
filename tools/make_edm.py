"""Genera una volta i suoni EDM e li salva come campioni (ogg Opus, 48 kHz) in samples/, come gli altri strumenti:
Sub 808, Reese bass, Supersaw, Acid 303, Stab dub e Ondes. Un campione ogni 3 semitoni, 3,2 s, intonati sulla nota del nome del file.
Oscillatori senza aliasing: tabelle a dente di sega con le sole armoniche sotto Nyquist.
Supersaw, reese e ondes sono periodici: ogni frequenza è un multiplo di 1/L, con L ≈ 1,7 s scelto perché la nota sia esatta
(loop_len); così il tratto 1,2 s … 1,2 s + L si ripete senza buchi di volume (Giro lo legge da "lp" in sounds_meta.js).
Uso: python tools/make_edm.py [cartelle…] (senza argomenti li rigenera tutti)"""
import os;os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","samples"))
import sys
import numpy as np,soundfile as sf
from scipy.signal import butter,sosfilt,lfilter
SR=48000;DUR=3.2;N=int(SR*DUR);t=np.arange(N)/SR;T=4096
hz=lambda m:440*2**((m-69)/12)
def saw(f,phase0=0.):
  # dente di sega limitato in banda, letto da una tabella con le armoniche che stanno sotto i 20 kHz
  nh=max(1,int(20000/f));k=np.arange(1,nh+1)[:,None];ph=np.arange(T)/T
  tab=(np.sin(2*np.pi*k*ph)*((-1.)**(k+1)/k)).sum(0)*2/np.pi;tab=np.append(tab,tab[0])
  idx=((f*t+phase0)%1)*T;return np.interp(idx,np.arange(T+1),tab)
def env(x,att=.005,fade=.03):
  a=np.minimum(1,t/att);z=np.minimum(1,(DUR-t)/fade);return x*a*z
lp=lambda x,fc,o=2:sosfilt(butter(o,fc,'lp',fs=SR,output='sos'),x,axis=0)
hp=lambda x,fc,o=2:sosfilt(butter(o,fc,'hp',fs=SR,output='sos'),x,axis=0)
def norm(x,pk=.8):return x*pk/np.abs(x).max() # margine: la codifica Opus alza un po' i picchi
def loop_len(f0):return round(f0*1.7)/f0 # stessa formula in build_sounds.py
def snap(f,L,f0):
  # frequenza stonata portata al multiplo di 1/L più vicino, ma mai uguale alla nota (deve battere)
  n=round(f*L);n0=round(f0*L)
  if n==n0 and f!=f0:n=n0+(1 if f>f0 else -1)
  return n/L
def supersaw(m,rng):
  # 7 denti di sega stonati fino a ±28 cent, aperti da sinistra a destra (potenza costante), fasi a caso
  f0=hz(m);L=loop_len(f0);cents=[-28,-17,-8,0,8,17,28];pans=[-.9,-.6,-.3,0,.3,.6,.9];out=np.zeros((N,2))
  for c,p in zip(cents,pans):
    x=saw(snap(f0*2**(c/1200),L,f0),rng.random())*(1 if c==0 else .8);a=(p+1)*np.pi/4;out[:,0]+=x*np.cos(a);out[:,1]+=x*np.sin(a)
  out=lp(hp(out,90),12000);return norm(env(out[:, :].T).T)
def reese(m,rng):
  # tre denti di sega (0, ±12 cent) più il sub, passa-basso a 4 poli che segue la nota, saturazione
  f0=hz(m);L=loop_len(f0);x=sum(saw(snap(f0*2**(c/1200),L,f0),rng.random()) for c in(-12,0,12))/3+.5*np.sin(2*np.pi*f0*t)
  x=lp(x,min(2500,700*(f0/55)**.5),4);x=np.tanh(2.5*x)/np.tanh(2.5);x=lp(x,5000);return norm(env(x))
def sub808(m,rng):
  # sinusoide che all'attacco parte più alta e scende alla nota in ~60 ms, decadimento lungo, saturazione leggera
  f0=hz(m);f=f0*(1+1.2*np.exp(-t/.025));ph=2*np.pi*np.cumsum(f)/SR;x=np.sin(ph)*np.exp(-t/2.2)
  x=np.tanh(1.8*x)/np.tanh(1.8);return norm(env(x,.002,.05))
def sweep_lp(x,fc,res):
  # passa-basso risonante a 3 poli (biquad + 1 polo) con il taglio che si muove: coefficienti a blocchi di 32 campioni
  out=np.empty_like(x);z1=np.zeros(2);z2=np.zeros(1)
  for i in range(0,len(x),32):
    w=2*np.pi*min(fc[i],SR*.45)/SR;al=np.sin(w)/(2*res);c=np.cos(w);a0=1+al
    b=np.array([(1-c)/2,1-c,(1-c)/2])/a0;a=np.array([1,-2*c/a0,(1-al)/a0]);p=np.exp(-w)
    y,z1=lfilter(b,a,x[i:i+32],zi=z1);out[i:i+32],z2=lfilter([1-p],[1,-p],y,zi=z2)
  return out
def acid(m,rng):
  # alla TB-303: dente di sega in un passa-basso risonante che si chiude subito dopo l'attacco, poi saturazione
  f0=hz(m);fc=(220+3200*np.exp(-t/.16))*(f0/55)**.35;x=sweep_lp(saw(f0,rng.random()),fc,7)
  x=np.tanh(2.2*x)/np.tanh(2.2)*(.55+.45*np.exp(-t/.35));x=hp(x,40);return norm(env(x,.003,.05))
def stab(m,rng):
  # accordo minore di settima (0 3 7 10) da denti di sega appena stonati, filtro che si chiude in fretta: lo stab del dub techno
  f0=hz(m);x=sum(saw(f0*2**((n+d)/12),rng.random()) for n in(0,3,7,10) for d in(-.06,.06))/8
  x=sweep_lp(x,500+4500*np.exp(-t/.09),1.2)*np.exp(-t/.45);x=hp(x,80);return norm(env(x,.002,.05))
def ondes(m,rng):
  # alla Ondes Martenot: sinusoide con un po' di 2ª e 3ª armonica e vibrato che entra dopo l'attacco.
  # Periodico come il supersaw: nota e vibrato multipli di 1/L, così il tratto 1,2 s … 1,2 s + L si ripete pulito
  f0=hz(m);L=loop_len(f0);fv=round(5.5*L)/L;d=f0*(2**(14/1200)-1)
  ph=2*np.pi*f0*t+d/fv*np.clip((t-.25)/.6,0,1)*np.sin(2*np.pi*fv*t)
  x=np.sin(ph)+.18*np.sin(2*ph)+.06*np.sin(3*ph);return norm(env(x,.06,.03))
SOUNDS={'edm_supersaw':(supersaw,range(36,97,3)),'edm_reese':(reese,range(24,64,3)),'edm_sub808':(sub808,range(21,58,3)),
 'edm_acid':(acid,range(24,64,3)),'edm_stab':(stab,range(36,85,3)),'edm_ondes':(ondes,range(48,97,3))}
for folder,(fn,notes) in SOUNDS.items():
  if sys.argv[1:] and folder not in sys.argv[1:]:continue
  os.makedirs(folder,exist_ok=True)
  for m in notes:
    rng=np.random.default_rng(m) # stessa nota, stesso suono a ogni rigenerazione
    x=fn(m,rng).astype('float32');sf.write(f'{folder}/{m}.ogg',x,SR,format='OGG',subtype='OPUS')
  print(folder,len(notes),'campioni',sum(os.path.getsize(f'{folder}/{f}') for f in os.listdir(folder))//1024,'KB')
