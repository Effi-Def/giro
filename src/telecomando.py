"""Telecomando di Giro: un ponte fra il telefono e la pagina di Giro aperta sul PC.
Si avvia con telecomando.bat (doppio clic). Solo libreria standard di Python, niente internet.
Il telefono apre http://<indirizzo del PC>:8765 e manda i comandi; Giro (file://) si collega a localhost:8765,
riceve i comandi con Server-Sent Events e rimanda il suo stato, che il ponte gira ai telefoni."""
import json,queue,socket,sys,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer

PORT=8765
lock=threading.Lock()
clients={'giro':[],'tel':[]}  # code dei client collegati in SSE
state={'giro':False}           # ultimo stato mandato da Giro

def lan_ip():
    # l'indirizzo con cui il PC si vede nella rete locale (UDP: non manda niente)
    try:
        s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);s.connect(('10.255.255.255',1));ip=s.getsockname()[0];s.close();return ip
    except OSError:
        return socket.gethostbyname(socket.gethostname())

def push(who,msg):
    data=json.dumps(msg)
    with lock:
        for q in clients[who]:q.put(data)

def giro_changed():
    with lock:on=bool(clients['giro'])
    state['giro']=on;push('tel',state)

# ---------- QR code (modo byte, correzione L, versioni 1–5 a blocco unico, maschera 0) ----------
# Basta per un indirizzo come http://192.168.100.200:8765. Segue lo schema di Nayuki (qrcodegen).
QR_V=[None,(19,7,[]),(34,10,[6,18]),(55,15,[6,22]),(80,20,[6,26]),(108,26,[6,30])]  # codeword dati, codeword ECC, allineamento

def _rs(data,n):
    exp=[0]*512;log=[0]*256;x=1
    for i in range(255):exp[i]=x;log[x]=i;x<<=1;x^=0x11d if x&0x100 else 0
    for i in range(255,512):exp[i]=exp[i-255]
    mul=lambda a,b:0 if a==0 or b==0 else exp[log[a]+log[b]]
    gen=[1]
    for i in range(n):gen=[a^mul(b,exp[i]) for a,b in zip(gen+[0],[0]+gen)]
    rem=[0]*n
    for d in data:
        f=d^rem[0];rem=rem[1:]+[0]
        for k in range(n):rem[k]^=mul(gen[k+1],f)
    return rem

def qr(text):
    b=text.encode('utf-8');ver=next(v for v in range(1,6) if len(b)+2<=QR_V[v][0])
    nd,ne,al=QR_V[ver];size=17+4*ver
    bits=[int(c) for c in '0100'+format(len(b),'08b')+''.join(format(x,'08b') for x in b)]
    bits+=[0]*min(4,nd*8-len(bits));bits+=[0]*(-len(bits)%8)
    data=[int(''.join(map(str,bits[i:i+8])),2) for i in range(0,len(bits),8)]
    k=0
    while len(data)<nd:data.append((0xEC,0x11)[k%2]);k+=1
    data+=_rs(data,ne)
    M=[[False]*size for _ in range(size)];F=[[False]*size for _ in range(size)]
    def put(x,y,v):M[y][x]=v;F[y][x]=True
    for cx,cy in ((3,3),(size-4,3),(3,size-4)):
        for dy in range(-4,5):
            for dx in range(-4,5):
                x,y=cx+dx,cy+dy
                if 0<=x<size and 0<=y<size:put(x,y,max(abs(dx),abs(dy)) not in (2,4))
    for i in range(size):
        if not F[6][i]:put(i,6,i%2==0)
        if not F[i][6]:put(6,i,i%2==0)
    for i,ax in enumerate(al):
        for j,ay in enumerate(al):
            if (i,j) in ((0,0),(0,len(al)-1),(len(al)-1,0)):continue
            for dy in range(-2,3):
                for dx in range(-2,3):put(ax+dx,ay+dy,max(abs(dx),abs(dy))!=1)
    fd=(1<<3)|0;rem=fd  # correzione L (=1), maschera 0
    for _ in range(10):rem=(rem<<1)^((rem>>9)*0x537)
    fb=((fd<<10)|rem)^0x5412;bit=lambda i:(fb>>i)&1==1
    for i in range(6):put(8,i,bit(i))
    put(8,7,bit(6));put(8,8,bit(7));put(7,8,bit(8))
    for i in range(9,15):put(14-i,8,bit(i))
    for i in range(8):put(size-1-i,8,bit(i))
    for i in range(8,15):put(8,size-15+i,bit(i))
    put(8,size-8,True)
    i=0;right=size-1
    while right>=1:
        if right==6:right=5
        for vert in range(size):
            for j in range(2):
                x=right-j;y=size-1-vert if ((right+1)&2)==0 else vert
                if not F[y][x]:
                    v=i<len(data)*8 and (data[i>>3]>>(7-(i&7)))&1==1;i+=1
                    M[y][x]=v^((x+y)%2==0)
        right-=2
    return M

def qr_svg(text):
    M=qr(text);n=len(M);q=4
    rects=''.join(f'<rect x="{x+q}" y="{y+q}" width="1" height="1"/>' for y in range(n) for x in range(n) if M[y][x])
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n+2*q} {n+2*q}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">{rects}</g></svg>'

def qr_text(text):
    # per la finestra nera: i moduli chiari sono pieni, così il QR esce scuro su chiaro; due righe per carattere
    M=qr(text);n=len(M);q=2;W=n+2*q
    light=lambda x,y:not(0<=x-q<n and 0<=y-q<n and M[y-q][x-q])
    rows=[]
    for y in range(0,W,2):
        rows.append(''.join({(1,1):'█',(1,0):'▀',(0,1):'▄',(0,0):' '}[(light(x,y),y+1<W and light(x,y+1))] for x in range(W)))
    return '\n'.join(rows)

PAGE=r'''<!doctype html>
<html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#111418"><title>Giro · telecomando</title>
<style>
:root{--bg:#111418;--panel:#191e25;--panel2:#222932;--line:#2f3844;--ink:#ece7db;--dim:#8a93a1;--sel:#7ea6f2;--rec:#ef4b50;--play:#3fb950;--dub:#f0a323;--arm:#e2a43a;color-scheme:dark}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.3 system-ui,sans-serif}
body{padding:14px 16px calc(14px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:14px;max-width:560px;margin:0 auto;user-select:none}
button{font:inherit;color:inherit;border:1px solid var(--line);background:var(--panel);border-radius:12px;touch-action:manipulation}
#st{font-size:13px;color:var(--rec);display:flex;gap:8px;align-items:center}
#st::before{content:"";width:9px;height:9px;border-radius:50%;background:currentColor}
#st.ok{color:var(--play)}
h2{margin:0 0 6px;font-size:12px;letter-spacing:.12em;color:var(--dim);font-weight:600}
#perf{width:100%;padding:22px 10px;font-size:22px;font-weight:700;letter-spacing:.05em;color:var(--rec);border-color:#5a2a2e}
#perf.on{background:var(--rec);color:#1b0608;border-color:var(--rec)}
.seg{display:flex;gap:8px}
.seg button{flex:1;padding:16px 4px;font-size:17px;font-weight:600}
.seg button.on{background:var(--sel);color:#0b1220;border-color:var(--sel)}
#fxOn{font-size:12px;color:var(--dub);margin-left:6px}
#play{width:100%;padding:20px 10px;font-size:20px;font-weight:700;letter-spacing:.05em;color:var(--sel);border-color:#34466a;touch-action:none}
#play.on{background:var(--sel);color:#0b1220}
#play:disabled{opacity:.35}
#fxstop{width:100%;margin-top:8px;padding:14px 4px;font-size:16px;font-weight:600}
#fxstop.on{color:var(--rec);border-color:#5a2a2e}
.pads{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.pads button{aspect-ratio:1;font-size:24px;font-weight:700;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:var(--dim)}
.pads small{font-size:10px;font-weight:600;letter-spacing:.06em;min-height:1em}
.pads .play{color:var(--play);border-color:#2b5a33}
.pads .rec{color:var(--rec);border-color:#5a2a2e}
.pads .dub{color:var(--dub);border-color:#5a4520}
.pads .arm{color:var(--arm)}
.pads .sel{outline:3px solid var(--sel);outline-offset:-3px}
.pads .empty{opacity:.45}
.off{opacity:.4;pointer-events:none}
</style></head><body>
<div id="st">Collegamento…</div>
<div id="ui" class="off">
 <button id="perf" data-c="perf">● REGISTRA ESIBIZIONE</button>
 <div style="height:14px"></div>
 <button id="play" disabled>BREAK · TIENI: SALITA E DROP</button>
 <div style="height:14px"></div>
 <h2>EFFETTI DJ <span id="fxOn"></span></h2>
 <div class="seg" id="fx"><button data-c="fx" data-v="mix">TUTTO</button><button data-c="fx" data-v="loop">SOLO LOOP</button></div>
 <button id="fxstop" data-c="fxstop">STOP EFFETTI</button>
 <div style="height:14px"></div>
 <h2>MANOPOLE</h2>
 <div class="seg" id="knob"><button data-c="knob" data-v="vol">VOLUME</button><button data-c="knob" data-v="pan">PAN</button><button data-c="knob" data-v="dj">EFFETTI DJ</button></div>
 <div style="height:14px"></div>
 <h2>QUANTIZZA</h2>
 <div class="seg" id="quant"><button data-c="quant" data-v="4">1/16</button><button data-c="quant" data-v="2">1/8</button><button data-c="quant" data-v="0">NO</button></div>
 <div style="height:14px"></div>
 <h2>LOOP SELEZIONATO <span style="font-weight:400;letter-spacing:0">(● ed effetti agiscono qui)</span></h2>
 <div class="pads" id="pads"></div>
</div>
<script>
const $=s=>document.querySelector(s),ORDER=[4,5,6,7,0,1,2,3];
$("#pads").innerHTML=ORDER.map(i=>`<button data-c="sel" data-v="${i}">${i+1}<small></small></button>`).join("");
document.body.addEventListener("click",e=>{const b=e.target.closest("button[data-c]");if(!b)return;
 if(navigator.vibrate)navigator.vibrate(15);
 fetch("/cmd",{method:"POST",body:JSON.stringify({c:b.dataset.c,v:b.dataset.v})}).catch(()=>{})});
const LBL={armed:"SUONA",rec:"REC",closing:"CHIUDE",dub:"SOVRAINC."};
// come ▶ dell'Axiom mentre suona: tocco = break / rientro, tenuto = salita, rilascio = drop
const pl=$("#play"),cmd=(c,v)=>fetch("/cmd",{method:"POST",body:JSON.stringify({c,v})}).catch(()=>{});
let plDown=false;
pl.addEventListener("pointerdown",e=>{if(pl.disabled)return;e.preventDefault();pl.setPointerCapture(e.pointerId);plDown=true;if(navigator.vibrate)navigator.vibrate(15);cmd("play","down")});
["pointerup","pointercancel"].forEach(t=>pl.addEventListener(t,()=>{if(!plDown)return;plDown=false;cmd("play","up")}));
pl.addEventListener("contextmenu",e=>e.preventDefault());
function show(s){const ok=!!s.giro;$("#st").className=ok?"ok":"";
 $("#st").textContent=ok?"Collegato a Giro":"Giro non collegato: apri giro.html sul PC";$("#ui").classList.toggle("off",!ok);if(!ok)return;
 const p=n=>String(n).padStart(2,"0");$("#perf").classList.toggle("on",s.perf);
 $("#perf").textContent=s.perf?`■ FERMA E SALVA  ${Math.floor(s.secs/60)}:${p(s.secs%60)}`:"● REGISTRA ESIBIZIONE";
 const seg=(id,v)=>document.querySelectorAll(`#${id} button`).forEach(b=>b.classList.toggle("on",b.dataset.v===String(v)));
 seg("fx",s.fx);seg("knob",s.knob);seg("quant",s.quant);$("#fxOn").textContent=s.fxOn?"● ATTIVI":"";$("#fxstop").classList.toggle("on",s.fxOn);
 pl.disabled=!s.running;pl.classList.toggle("on",s.drop||s.building);
 pl.textContent=s.building?"SALITA… LASCIA: DROP!":s.drop?"RIENTRA · TIENI: SALITA E DROP":"BREAK · TIENI: SALITA E DROP";
 document.querySelectorAll("#pads button").forEach(b=>{const i=+b.dataset.v,L=s.loops[i];
  b.className=(L.st==="play"?(L.muted||!s.running?"":"play"):L.st==="rec"||L.st==="closing"?"rec":L.st==="armed"?"arm":L.st)+(i===s.sel?" sel":"");
  b.querySelector("small").textContent=(LBL[L.st]||(L.st==="play"&&L.muted?"FERMO":""))+(L.fx?" FX":"")})}
function connect(){const es=new EventSource("/events?who=tel");es.onmessage=e=>show(JSON.parse(e.data));
 es.onerror=()=>{show({giro:false});$("#st").textContent="Ponte non raggiungibile: avvia telecomando.bat sul PC";if(es.readyState===2)setTimeout(connect,3000)}}
connect();
</script></body></html>'''

class H(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*a):pass
    def cors(self):
        self.send_header('Access-Control-Allow-Origin','*')
        self.send_header('Access-Control-Allow-Headers','Content-Type')
        self.send_header('Access-Control-Allow-Private-Network','true')
    def reply(self,code,body=b'',ctype='text/plain; charset=utf-8'):
        self.send_response(code);self.cors();self.send_header('Content-Type',ctype)
        self.send_header('Content-Length',str(len(body)));self.send_header('Cache-Control','no-store');self.end_headers();self.wfile.write(body)
    def do_OPTIONS(self):self.reply(204)
    def do_GET(self):
        if self.path=='/':return self.reply(200,PAGE.encode(),'text/html; charset=utf-8')
        if self.path.split('?')[0]=='/qr.svg':return self.reply(200,qr_svg(f'http://{lan_ip()}:{PORT}').encode(),'image/svg+xml')
        if self.path=='/info':return self.reply(200,json.dumps({'ip':lan_ip(),'port':PORT}).encode(),'application/json')
        if self.path.startswith('/events?who='):return self.stream(self.path.split('=',1)[1])
        self.reply(404)
    def do_POST(self):
        n=int(self.headers.get('Content-Length') or 0);body=self.rfile.read(n)
        try:msg=json.loads(body or b'{}')
        except ValueError:return self.reply(400)
        if self.path=='/cmd':push('giro',msg)
        elif self.path=='/bye':state['giro']=False;push('tel',state)  # Giro chiuso o ricaricato
        elif self.path=='/state':state.update(msg);state['giro']=True;push('tel',state)
        else:return self.reply(404)
        self.reply(204)
    def stream(self,who):
        if who not in clients:return self.reply(404)
        self.close_connection=True
        self.send_response(200);self.cors();self.send_header('Content-Type','text/event-stream')
        self.send_header('Cache-Control','no-store');self.end_headers()
        q=queue.Queue()
        with lock:clients[who].append(q)
        if who=='giro':giro_changed()
        else:q.put(json.dumps(state))
        try:
            while True:
                # un ping ogni 3 s: se il client se n'è andato la scrittura fallisce e il telefono lo sa subito
                try:data='data: '+q.get(timeout=3)+'\n\n'
                except queue.Empty:data=': ping\n\n'
                self.wfile.write(data.encode());self.wfile.flush()
        except OSError:pass
        finally:
            with lock:clients[who].remove(q)
            if who=='giro':giro_changed()

if __name__=='__main__':
    # niente riuso dell'indirizzo: su Windows permetterebbe due ponti sulla stessa porta, che si dividerebbero i client
    ThreadingHTTPServer.allow_reuse_address=False
    try:srv=ThreadingHTTPServer(('0.0.0.0',PORT),H)
    except OSError:
        print('Il telecomando è già acceso (o la porta',PORT,'è occupata): puoi chiudere questa finestra.');raise SystemExit
    srv.daemon_threads=True
    try:sys.stdout.reconfigure(encoding='utf-8',errors='replace')  # i blocchi del QR, anche se l'uscita non è la console
    except (AttributeError,ValueError):pass
    url=f'http://{lan_ip()}:{PORT}'
    print('Telecomando di Giro attivo.')
    print('Inquadra il QR con la fotocamera del telefono (stessa rete Wi-Fi):')
    print();print(qr_text(url));print()
    print('oppure apri: ',url);print()
    print('Lascia aperta questa finestra mentre suoni; chiudila per spegnere il telecomando.')
    try:srv.serve_forever()
    except KeyboardInterrupt:pass
