"""Assembla dist/giro.html da src/. Uso: python tools/build.py"""
from pathlib import Path
R=Path(__file__).resolve().parent.parent;S=R/'src'
js='"use strict";\n'+''.join((S/f).read_text(encoding='utf-8')+'\n' for f in ['sounds_meta.js','sampler.js','custom.js','core.js','app.js','ui.js'])
html=(S/'shell.html').read_text(encoding='utf-8').replace('<!--SCRIPT-->','<script>\n'+(S/'sounds_data.js').read_text(encoding='utf-8')+'</script>\n<script>\n'+js+'</script>')
(R/'dist').mkdir(exist_ok=True);(R/'dist'/'giro.html').write_text(html,encoding='utf-8')
print('dist/giro.html',round(len(html.encode())/1e6,2),'MB')
