# MathJax 3.2.2 を npm の公式の置き場から取ってきて cloud/vendor/mathjax に入れる（最初の1回だけ。ネットが無くても数式が出るようにするため）
#   python tools/fetch_vendor.py
import base64, hashlib, io, os, shutil, sys, tarfile, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
URL = 'https://registry.npmjs.org/mathjax/-/mathjax-3.2.2.tgz'
SHA512 = 'Bt+SSVU8eBG27zChVewOicYs7Xsdt40qm4+UpHyX7k0/O9NliPc+x77k1/FEsPsjKPZGJvtRZM1vO+geW0OhGw=='   # npm の dist.integrity と同じ値
dst = os.path.join(VENDOR, 'mathjax')
if os.path.isfile(os.path.join(dst, 'tex-chtml.js')):
    print('MathJax はもう入っている:', dst); sys.exit(0)
print('MathJax 3.2.2 を取ってくる…')
b = urllib.request.urlopen(URL, timeout=300).read()
if base64.b64encode(hashlib.sha512(b).digest()).decode() != SHA512: die('取ってきたファイルの指紋が合いません（途中で壊れたか、別物です）。もう一度動かしてください。')
tmp = dst + '.tmp'; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
with tarfile.open(fileobj=io.BytesIO(b), mode='r:gz') as t:
    for m in t.getmembers():
        if not m.name.startswith('package/es5/') or not m.isfile() or '..' in m.name: continue
        rel = m.name[len('package/es5/'):]; out = os.path.join(tmp, *rel.split('/'))
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, 'wb') as f: f.write(t.extractfile(m).read())
shutil.rmtree(dst, ignore_errors=True); os.replace(tmp, dst)
print('入れた:', dst, sum(len(f) for _, _, f in os.walk(dst)), 'ファイル')
