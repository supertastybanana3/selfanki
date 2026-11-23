# Anki のアドオン「暗記と同期」を、Anki に入れられるファイル（dist/selfanki_sync.ankiaddon）にまとめる
#   python tools/build_addon.py
# できたファイルは、Anki の「ツール」→「アドオン」→「ファイルからインストール」で入れる
import os, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, L
src = os.path.join(ROOT, 'addon', 'selfanki_sync')
os.makedirs(os.path.join(ROOT, 'dist'), exist_ok=True)
out = os.path.join(ROOT, 'dist', 'selfanki_sync.ankiaddon')
with zipfile.ZipFile(out + '.tmp', 'w', zipfile.ZIP_DEFLATED) as z:
    for dp, dn, fn in os.walk(src):
        dn[:] = [d for d in dn if d not in ('__pycache__', 'user_files')]
        for f in sorted(fn):
            if f == 'meta.json' or f.endswith('.pyc'): continue
            p = os.path.join(dp, f); z.write(p, os.path.relpath(p, src))
os.replace(out + '.tmp', out)
print(L('作った:', 'Built:'), out)
print(L('Anki の「ツール」→「アドオン」→「ファイルからインストール」で入れて、Anki を再起動する', 'Install it from Anki\'s Tools → Add-ons → Install from file, then restart Anki'))
