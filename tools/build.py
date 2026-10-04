from pathlib import Path
import re,json
root=Path(__file__).resolve().parent.parent
work=root/'src';out=root
three=(work/'vendor/three.cjs').read_text()
orbit=(work/'vendor/OrbitControls.js').read_text()
orbit=re.sub(r"import\s*\{(.*?)\}\s*from 'three';",r'const {\1}=THREE;',orbit,flags=re.S).replace('export { OrbitControls };','window.OrbitControls=OrbitControls;')
files={k:(out/'wokwi'/f).read_text() for k,f in [('sketch','sketch.ino'),('diagram','diagram.json'),('libraries','libraries.txt')]}
core=(work/'controller.js').read_text().replace('export class','class')
scripts='<script>(function(){var exports={};\n'+three+'\nwindow.THREE=exports;})();</script>\n<script>(function(){\n'+orbit+'})();</script>\n<script>\n'+(work/'vendor/mqtt.min.js').read_text()+'</script>\n<script>\nconst FILES='+json.dumps(files,ensure_ascii=False)+';\n'+core+'\n'+(work/'app.js').read_text()+'\n</script>'
html=(work/'shell.html').read_text().replace('<!--SCRIPTS-->',scripts)
(out/'index.html').write_text(html)
print('Standalone HTML:',len(html),'characters. No CDN required.')
