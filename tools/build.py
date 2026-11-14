"""Assembla dist/giro.html da src/. Uso: python tools/build.py"""
from pathlib import Path
R=Path(__file__).resolve().parent.parent;S=R/'src'
# src/app/: l'applicazione divisa per argomento. Finisce tutto in un solo script, quindi l'ordine conta solo per il codice
# che gira subito al caricamento (costanti e collegamenti), non per le funzioni
APP=['audio','orologio','effetti','looper','quantizza','pezzo','tempo','sessione','esibizione','telefono','export','debug',
 'messaggi','automix','consigli','note','midi','schede','manopole','tastiera']
assert sorted(p.stem for p in (S/'app').glob('*.js'))==sorted(APP),'i file in src/app/ e la lista APP in build.py non coincidono'
FILES=['sounds_meta.js','sampler.js','custom.js','core.js',*[f'app/{f}.js' for f in APP],'ui.js']
js='"use strict";\n'+''.join((S/f).read_text(encoding='utf-8')+'\n' for f in FILES)
html=(S/'shell.html').read_text(encoding='utf-8').replace('<!--SCRIPT-->','<script>\n'+(S/'sounds_data.js').read_text(encoding='utf-8')+'</script>\n<script>\n'+js+'</script>')
(R/'dist').mkdir(exist_ok=True);(R/'dist'/'giro.html').write_text(html,encoding='utf-8')
# telecomando dal telefono: il ponte e il file da cliccare stanno accanto a giro.html
(R/'dist'/'telecomando.py').write_text((S/'telecomando.py').read_text(encoding='utf-8'),encoding='utf-8')
(R/'dist'/'telecomando.bat').write_text('@echo off\r\ntitle Giro - telecomando\r\ncd /d "%~dp0"\r\nwhere py >nul 2>nul\r\n'
 'if %errorlevel%==0 (py -3 telecomando.py) else (python telecomando.py)\r\npause\r\n',encoding='utf-8',newline='')
print('dist/giro.html',round(len(html.encode())/1e6,2),'MB')
