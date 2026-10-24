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
 ('synthbass2','Synth bass 2','Bassi','synth_bass_2',dict(rel=.08,tr=-12)),
 ('archi','Archi','Atmosfere','string_ensemble_1',dict(rel=.5,att=.06,loop=1)),
 ('pad','Pad','Atmosfere','pad_2_warm',dict(rel=.9,att=.12,loop=1)),
 ('coro','Coro','Atmosfere','choir_aahs',dict(rel=.5,att=.05,loop=1)),
 ('halo','Pad halo','Atmosfere','pad_7_halo',dict(rel=1.2,att=.08,loop=1)),
 ('padcoro','Pad corale','Atmosfere','pad_4_choir',dict(rel=.9,att=.1,loop=1)),
 ('atmosfera','Atmosfera','Atmosfere','fx_4_atmosphere',dict(rel=1,loop=1)),
 ('cristallo','Cristallo','Atmosfere','fx_3_crystal',dict(rel=1.2)),
 # Indie: Mellotron veri (tools/fetch_vintage.py), ondes generate (make_edm.py), percussioni e sitar del soundfont
 ('mtarchi','Mellotron archi','Indie','mt_violins',dict(rel=.3,loop=1)),
 ('mtcoro','Mellotron coro','Indie','mt_choir',dict(rel=.35,loop=1)),
 ('mtflauto','Mellotron flauto','Indie','mt_flute',dict(rel=.25,loop=1)),
 ('ondes','Ondes Martenot','Indie','edm_ondes',dict(rel=.3,att=.02,loop=1)),
 ('celesta','Celesta','Indie','celesta',dict(rel=.6)),
 ('glock','Glockenspiel','Indie','glockenspiel',dict(rel=.8)),
 ('steeldrum','Steel drum','Indie','steel_drums',dict(rel=.5)),
 ('sitar','Sitar','Indie','sitar',dict(rel=.5)),
 ('lead','Lead','Synth','lead_2_sawtooth',dict(rel=.15,loop=1)),
 ('polysynth','Polysynth','Synth','pad_3_polysynth',dict(rel=.4,loop=1)),
 ('synthbrass','Synth brass','Synth','synth_brass_1',dict(rel=.2,att=.01,loop=1)),
 ('synthstrings','Synth strings','Synth','synth_strings_1',dict(rel=.6,att=.04,loop=1)),
 ('sweep','Pad sweep','Synth','pad_8_sweep',dict(rel=.9,att=.1,loop=1)),
 # Techno: generati da tools/make_edm.py (ogg Opus); sub 808 due ottave sotto, reese e acid un'ottava sotto
 ('sub808','Sub 808','Techno','edm_sub808',dict(rel=.15,tr=-24)),
 ('reese','Reese bass','Techno','edm_reese',dict(rel=.12,tr=-12,loop=1)),
 ('supersaw','Supersaw','Techno','edm_supersaw',dict(rel=.3,loop=1)),
 ('acid','Acid 303','Techno','edm_acid',dict(rel=.08,tr=-12)),
 ('stab','Stab dub','Techno','edm_stab',dict(rel=.3)),
]
LM={0:'kick',1:'stick-m',2:'snare-m',3:'clap',4:'snare-h',5:'tom-l',6:'hhclosed',7:'tom-m',8:'hhclosed-short',9:'tom-h',10:'hhopen',11:'crash'}
# kit house: Roland TR-909 scaricata da tools/fetch_edm.py (nomi dei file in samples/house909)
H909={0:'kick',1:'rim',2:'snare',3:'clap',4:'snare2',5:'tom-l',6:'hhclosed',7:'tom-m',8:'hhclosed-short',9:'tom-h',10:'hhopen',11:'crash'}
# Roland CR-8000 da tools/fetch_vintage.py: campanaccio al posto del rullante 2, conga bassa al tom medio, clave al charleston corto
CR={0:'kick',1:'rimshot',2:'snare',3:'clap',4:'cowbell',5:'tom-low',6:'hihat-closed',7:'conga-low',8:'clave',9:'tom-high',10:'hihat-open',11:'cymball'}
TR={0:'kick_bd5025',1:'rimshot_rs',2:'snare_sd5025',3:'clap_cp',4:'snare_sd2550',5:'tom-low_lt25',6:'hihat-close_ch',7:'mid-tom_mt25',8:'maraca_ma',9:'tom-hi_ht25',10:'hihat-open_oh25',11:'cymbal_cy5025'}
meta=[];data={}
for id,name,cat,folder,ex in S:
  m=dict(id=id,name=name,cat=cat,gain=g(folder),off=round(A[folder]['onset_ms'][1]/1000,4),**ex)
  # suoni generati periodici: il loop dura L ≈ 1,7 s, con la stessa formula di loop_len in make_edm.py
  if folder.startswith('edm_') and ex.get('loop'):
    m['lp']={int(f[:-4]):[1.2,round(1.2+round(440*2**((int(f[:-4])-69)/12)*1.7)/(440*2**((int(f[:-4])-69)/12)),6)] for f in os.listdir(folder)}
  meta.append(m);data[id]={int(f[:-4]):base64.b64encode(open(f'{folder}/{f}','rb').read()).decode() for f in os.listdir(folder)}
for id,name,cat,folder,mp,gain in [('batteria','Batteria','Batterie','lm2',LM,.55),('808','Drum machine 808','Batterie','tr808',TR,1.1),('house909','House 909','Techno','house909',H909,.5),('cr8000','CR-8000','Batterie','cr8000',CR,.5)]:
  meta.append(dict(id=id,name=name,cat=cat,gain=gain,off=0,drum=1))
  data[id]={k:base64.b64encode(open(f'{folder}/{v}.ogg','rb').read()).decode() for k,v in mp.items()}
# campioni del drop (boom e piatto, tools/fetch_edm.py): non sono suoni da suonare, li usa il drop su ▶
data['drop_fx']={k:base64.b64encode(open(f'drop_fx/{k}.ogg','rb').read()).decode() for k in('boom','crash')}
mul={'organo':.5,'coro':.65,'archi':1.5,'pad':1.4,'808':.6,'batteria':.75,'synthbass':1.2,'piano':1.15,'rhodes':1.15,'vibra':1.1,
 'synthbass2':.9,'synthbrass':.85,'polysynth':1.1,'sweep':1.3,'supersaw':.85,'house909':.85,
 'glock':.45,'steeldrum':.6,'stab':.6,'acid':.75,'mtflauto':1.5,'celesta':1.25,'cristallo':.8,'mtarchi':.8,'atmosfera':.8}
for x in meta:x['gain']=round(x['gain']*mul.get(x['id'],1),2)
open('../src/sounds_meta.js','w').write('const SOUNDS='+json.dumps(meta,ensure_ascii=False)+';\n')
open('../src/sounds_data.js','w').write('const SAMPLE_DATA='+json.dumps(data,separators=(',',':'))+';\n')
print(json.dumps(meta,ensure_ascii=False,indent=0)[:1500]);print('dati',os.path.getsize('../src/sounds_data.js')//1024,'KB')
