import os;os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)),"..","samples"))
import subprocess,numpy as np,os,json
def dec(f):
  r=subprocess.run(['ffmpeg','-v','error','-i',f,'-f','f32le','-ac','1','-ar','44100','-'],capture_output=True).stdout
  return np.frombuffer(r,dtype=np.float32)
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
  if ins in('pad_2_warm','string_ensemble_1','drawbar_organ','choir_aahs'):print('   env/0.1s',env)
json.dump(out,open('analysis.json','w'))
