import os;os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","samples"))
import json,base64,os
A=json.load(open('analysis.json'))
def g(ins,target=.11,cap=8):return round(min(cap,target/A[ins]['rms']),2)
S=[ # id, nome, categoria, cartella, extra
 ('piano','Pianoforte','Tastiere','acoustic_grand_piano',dict(rel=.35)),
 ('rhodes','Rhodes','Tastiere','electric_piano_1',dict(rel=.4)),
 ('organo','Organo','Tastiere','drawbar_organ',dict(rel=.07,loop=1)),
 ('vibra','Vibrafono','Tastiere','vibraphone',dict(rel=.6)),
 ('acustica','Chitarra acustica','Chitarre','acoustic_guitar_steel',dict(rel=.25)),
 ('elettrica','Chitarra elettrica','Chitarre','electric_guitar_clean',dict(rel=.25)),
 ('basso','Basso elettrico','Bassi','electric_bass_finger',dict(rel=.1,tr=-12)),
 ('contrabbasso','Contrabbasso','Bassi','acoustic_bass',dict(rel=.12,tr=-12)),
 ('synthbass','Synth bass','Bassi','synth_bass_1',dict(rel=.08,tr=-12)),
 ('archi','Archi','Atmosfere','string_ensemble_1',dict(rel=.5,att=.06,loop=1)),
 ('pad','Pad','Atmosfere','pad_2_warm',dict(rel=.9,att=.12,loop=1)),
 ('coro','Coro','Atmosfere','choir_aahs',dict(rel=.5,att=.05,loop=1)),
]
LM={0:'kick',1:'stick-m',2:'snare-m',3:'clap',4:'snare-h',5:'tom-l',6:'hhclosed',7:'tom-m',8:'hhclosed-short',9:'tom-h',10:'hhopen',11:'crash'}
TR={0:'kick_bd5025',1:'rimshot_rs',2:'snare_sd5025',3:'clap_cp',4:'snare_sd2550',5:'tom-low_lt25',6:'hihat-close_ch',7:'mid-tom_mt25',8:'maraca_ma',9:'tom-hi_ht25',10:'hihat-open_oh25',11:'cymbal_cy5025'}
meta=[];data={}
for id,name,cat,folder,ex in S:
  m=dict(id=id,name=name,cat=cat,gain=g(folder),off=round(A[folder]['onset_ms'][1]/1000,4),**ex)
  meta.append(m);data[id]={int(f[:-4]):base64.b64encode(open(f'{folder}/{f}','rb').read()).decode() for f in os.listdir(folder)}
for id,name,folder,mp,gain in [('batteria','Batteria','lm2',LM,.55),('808','Drum machine 808','tr808',TR,1.1)]:
  meta.append(dict(id=id,name=name,cat='Batterie',gain=gain,off=0,drum=1))
  data[id]={k:base64.b64encode(open(f'{folder}/{v}.ogg','rb').read()).decode() for k,v in mp.items()}
mul={'organo':.5,'coro':.65,'archi':1.5,'pad':1.4,'808':.6,'batteria':.75,'synthbass':1.2,'piano':1.15,'rhodes':1.15,'vibra':1.1}
for x in meta:x['gain']=round(x['gain']*mul.get(x['id'],1),2)
open('../src/sounds_meta.js','w').write('const SOUNDS='+json.dumps(meta,ensure_ascii=False)+';\n')
open('../src/sounds_data.js','w').write('const SAMPLE_DATA='+json.dumps(data,separators=(',',':'))+';\n')
print(json.dumps(meta,ensure_ascii=False,indent=0)[:1500]);print('dati',os.path.getsize('../src/sounds_data.js')//1024,'KB')
