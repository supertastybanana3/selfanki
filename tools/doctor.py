# 準備ができているかを上から順に確かめて、足りないものと次にすることを表示する。どの手順の途中でも何度でも動かしてよい
#   python tools/doctor.py
import json, os, shutil, subprocess, sys, urllib.request, urllib.error
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
ok_all = True
def show(ok, what, fix=''):
    global ok_all
    print(('[OK] ' if ok else '[NG] ') + what + ('' if ok or not fix else '\n      → ' + fix))
    ok_all &= bool(ok)
    return ok
show(sys.version_info >= (3, 9), f'Python {sys.version.split()[0]}（3.9 以上）', 'Python 3.12 を入れる（README の手順 1）')
try:
    from anki.buildinfo import version as v
    show(v.startswith('25.09'), f'Python の anki パッケージ {v}（25.09.x）', 'pip install anki==25.9.4')
except ImportError: show(False, 'Python の anki パッケージ', 'pip install anki==25.9.4（README の手順 1）')
npx = shutil.which('npx') or shutil.which('npx.cmd')
if show(bool(npx), 'Node.js の npx', 'Node.js 20 以上を入れる（README の手順 1）'):
    node = shutil.which('node') or shutil.which('node.exe')
    out = subprocess.run([node, '-v'], capture_output=True, text=True).stdout.strip() if node else ''
    show(out.startswith('v') and int(out[1:].split('.')[0]) >= 20, f'Node.js {out}（20 以上）', 'Node.js を新しくする')
try: cfg = load_config()
except SetupError as e: show(False, 'config.json', str(e)); sys.exit(1)
show(True, 'config.json を読めた')
for k in ('project_name', 'anki_collection'):
    v = cfg.get(k); show(bool(v) and not str(v).startswith('<'), f'config.json の "{k}"', 'README の手順 2 のとおりに埋める')
col = expand(cfg.get('anki_collection') or '')
show(os.path.isfile(col), f'Anki のコレクション {col}', 'Anki のメニュー「ツール→プロファイルを管理」→「フォルダを開く」で場所を確かめる（README の手順 2）')
md = expand(cfg.get('anki_media_dir') or '')
if md: show(os.path.isdir(md), f'画像・音声のフォルダ {md}', 'collection.anki2 と同じ場所の collection.media を書く')
else: print('[--] anki_media_dir が空（画像・音声は AnkiConnect で Anki から取る。Anki の起動が要る）')
show(os.path.isfile(os.path.join(VENDOR, 'mathjax', 'tex-chtml.js')), 'MathJax（cloud/vendor/mathjax）', 'python tools/fetch_vendor.py')
show(os.path.isfile(os.path.join(VENDOR, 'sqljs', 'sql-wasm-browser.wasm')) and os.path.isfile(os.path.join(VENDOR, 'fzstd', 'index.mjs')), 'sql.js・fzstd（cloud/vendor。.apkg・.colpkg の書き出しと読み込み）', 'python tools/fetch_vendor.py')
show(os.path.exists(token_path(cfg)), f'合言葉のファイル {token_path(cfg)}', 'python tools/setup_cloud.py')
show(os.path.exists(os.path.join(CLOUD, 'wrangler.toml')), 'cloud/wrangler.toml', 'python tools/setup_cloud.py')
url = (cfg.get('site_url') or '').rstrip('/')
if show(url.startswith(('https://', 'http://127.0.0.1', 'http://localhost')), f'site_url {url or "(空)"}', 'python tools/setup_cloud.py が書き込む'):
    def get(path, auth=None):
        req = urllib.request.Request(url + path, headers={'User-Agent': 'selfanki-doctor', **({'Authorization': 'Bearer ' + auth} if auth else {})})
        try:
            with urllib.request.urlopen(req, timeout=30) as r: return r.status, r.read()
        except urllib.error.HTTPError as e: return e.code, b''
        except OSError as e: return None, str(e).encode()
    st, _ = get('/bundle/manifest.json')
    unauth401 = st == 401
    show(st == 401, f'合言葉なしでは中身が見えない（{st}）', '401 でないなら手順 4 の secret（SA_TOKEN）を確かめる。None ならまだ一度も上げていない')
    try: tok = read_token(cfg)
    except SetupError: tok = None
    if tok and not unauth401: print('[--] 合言葉つきの確認は飛ばした（合言葉なしで 401 が返る、自分のサイトだと確かめられないうちは合言葉を送らない）')
    if tok and unauth401:
        st, body = get('/bundle/manifest.json', tok)
        if show(st == 200, f'合言葉ありで manifest が読める（{st}）', 'python tools/build_site.py --deploy（手順 5）'):
            m = json.loads(body); print(f'      カード {m.get("cards")} 枚・組んだ時刻 {m.get("built")}')
if cfg.get('ankiconnect_url'):
    try: show(bool(ac(cfg, 'version')), f'AnkiConnect（{cfg["ankiconnect_url"]}）につながる')
    except Exception as e: print(f'[--] AnkiConnect につながらない（書き戻し mirror.py を使うときだけ要る）: {str(e)[:120]}')
print('\nすべて OK' if ok_all else '\nNG の行の → のとおりに直して、もう一度 python tools/doctor.py を動かす')
