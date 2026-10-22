import os;os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","samples"))
import subprocess,numpy as np,os,json,shutil,base64
def dec_ffmpeg(f):
  r=subprocess.run(['ffmpeg','-v','error','-i',f,'-f','f32le','-ac','1','-ar','44100','-'],capture_output=True).stdout
  return np.frombuffer(r,dtype=np.float32)
# senza ffmpeg decodifica con Chromium (Playwright): è lo stesso decoder che usa Giro
DECODE_JS="""async b=>{const u=Uint8Array.from(atob(b),c=>c.charCodeAt(0));
 const a=await new OfflineAudioContext(1,1,44100).decodeAudioData(u.buffer),m=new Float32Array(a.length);
 const w=a.numberOfChannels===2?Math.SQRT1_2:1/a.numberOfChannels; // come il downmix di ffmpeg -ac 1
 for(let c=0;c<a.numberOfChannels;c++){const d=a.getChannelData(c);for(let i=0;i<m.length;i++)m[i]+=d[i]*w}
 let s="";const by=new Uint8Array(m.buffer);for(let i=0;i<by.length;i+=32768)s+=String.fromCharCode.apply(null,by.subarray(i,i+32768));return btoa(s)}"""
_pg=None
def dec_chromium(f):
  global _pg
  if _pg is None:
    from playwright.sync_api import sync_playwright
    pw=sync_playwright().start()
    try:_pg=pw.chromium.launch().new_page()
    except Exception:_pg=pw.chromium.launch(channel='chrome').new_page() # senza il Chromium di Playwright: Chrome installato
  r=_pg.evaluate(DECODE_JS,base64.b64encode(open(f,'rb').read()).decode())
  return np.frombuffer(base64.b64decode(r),dtype=np.float32)
dec=dec_ffmpeg if shutil.which('ffmpeg') else dec_chromium
out={}
for ins in sorted(d for d in os.listdir('.') if os.path.isdir(d)):
  fs=sorted(os.listdir(ins));onsets=[];rms=[];peaks=[]
  for f in fs:
    x=dec(f'{ins}/{f}')
    if not len(x):continue
    th=max(1e-3,np.abs(x).max()*0.02);on=int(np.argmax(np.abs(x)>th))
    onsets.append(on/44100*1000);seg=x[on:on+int(.5*44100)];rms.append(float(np.sqrt((seg**2).mean())));peaks.append(float(np.abs(x).max()))
  mid=dec(f'{ins}/{fs[len(fs)//2]}')
  env=[round(float(np.sqrt((mid[i:i+4410]**2).mean())),3) for i in range(0,len(mid),4410)]
  out[ins]=dict(onset_ms=[round(min(onsets),1),round(float(np.median(onsets)),1),round(max(onsets),1)],rms=round(float(np.median(rms)),3),peak=round(max(peaks),2))
  print(f"{ins:24s} onset {out[ins]['onset_ms']} rms {out[ins]['rms']} peak {out[ins]['peak']}")
  if ins in('pad_2_warm','string_ensemble_1','drawbar_organ','choir_aahs','lead_2_sawtooth','pad_3_polysynth','synth_brass_1','synth_strings_1','pad_8_sweep'):print('   env/0.1s',env)
json.dump(out,open('analysis.json','w'))
