# 外から借りる部品を npm の公式の置き場から取ってきて cloud/vendor に入れる（最初の1回だけ。ネットが無くても使えるようにするため）
#   MathJax 3.2.2 … 数式
#   sql.js 1.14.2 … .apkg・.colpkg の中の SQLite を読み書きする（書き出し・読み込み）
#   fzstd 0.1.1   … 新しい形の .apkg・.colpkg（zstd で縮めてある）を開く
#   python tools/fetch_vendor.py
import base64, hashlib, io, os, shutil, sys, tarfile, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# 名前, 版, npm の dist.integrity（sha512）, 入れる先, 取り出すもの（tar の中の道筋 → 入れる名前。末尾が / ならその下を全部）
PARTS = [
    ('mathjax', '3.2.2', 'Bt+SSVU8eBG27zChVewOicYs7Xsdt40qm4+UpHyX7k0/O9NliPc+x77k1/FEsPsjKPZGJvtRZM1vO+geW0OhGw==', 'mathjax', 'tex-chtml.js',
     {'package/es5/': ''}),
    ('sql.js', '1.14.2', '3ZGPovObMFrdw79zrUHbfdE/DLIsy8jdNdssmMSQuRAymedU6q84asPt0kgiqrdMYlPegDItiIMfmIXzZnYFcw==', 'sqljs', 'sql-wasm-browser.wasm',
     {'package/dist/sql-wasm-browser.js': 'sql-wasm-browser.js', 'package/dist/sql-wasm-browser.wasm': 'sql-wasm-browser.wasm', 'package/LICENSE': 'LICENSE'}),
    ('fzstd', '0.1.1', 'dkuVSOKKwh3eas5VkJy1AW1vFpet8TA/fGmVA5krThl8YcOVE/8ZIoEA1+U1vEn5ckxxhLirSdY837azmbaNHA==', 'fzstd', 'index.mjs',
     {'package/esm/index.mjs': 'index.mjs', 'package/LICENSE': 'LICENSE'}),
]


def fetch(name, ver, sha512, sub, mark, pick):
    dst = os.path.join(VENDOR, sub)
    if os.path.isfile(os.path.join(dst, mark)):
        print(L(f'{name} はもう入っている:', f'{name} is already installed:'), dst); return
    print(L(f'{name} {ver} を取ってくる…', f'Downloading {name} {ver}…'))
    b = urllib.request.urlopen(f'https://registry.npmjs.org/{name}/-/{name.split("/")[-1]}-{ver}.tgz', timeout=300).read()
    if base64.b64encode(hashlib.sha512(b).digest()).decode() != sha512: die(L(f'{name}: 取ってきたファイルの指紋が合いません（途中で壊れたか、別物です）。もう一度動かしてください。', f'{name}: the downloaded file\'s hash does not match (corrupted or not the expected file). Run this again.'))
    tmp = dst + '.tmp'; shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
    with tarfile.open(fileobj=io.BytesIO(b), mode='r:gz') as t:
        for m in t.getmembers():
            if not m.isfile() or '..' in m.name: continue
            rel = None
            for src, out in pick.items():
                if src.endswith('/') and m.name.startswith(src): rel = out + m.name[len(src):]
                elif m.name == src: rel = out
            if rel is None: continue
            p = os.path.join(tmp, *rel.split('/'))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as f: f.write(t.extractfile(m).read())
    if not os.path.isfile(os.path.join(tmp, mark)): die(L(f'{name}: 中に {mark} が見つかりません。', f'{name}: {mark} was not found inside.'))
    shutil.rmtree(dst, ignore_errors=True); os.replace(tmp, dst)
    print(L('入れた:', 'Installed:'), dst, sum(len(f) for _, _, f in os.walk(dst)), L('ファイル', 'files'))


for part in PARTS: fetch(*part)
