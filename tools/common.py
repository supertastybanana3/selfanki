# 道具に共通の部品: 設定（config.json）・合言葉・場所・AnkiConnect・wrangler（Cloudflare の道具）
import json, os, sys, shutil, subprocess, urllib.request
# 出力はいつも UTF-8（Windows でパイプに流すと cp932 になり、AI や記録で文字化けするため）
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError): pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # リポジトリの根元
CLOUD = os.path.join(ROOT, 'cloud')          # Cloudflare に上げるもの（functions/・wrangler.toml）と、作業で生まれるもの
STATE = os.path.join(CLOUD, 'state')         # 移行時点の状態・書き戻しの記録など（git に入れない）
SITE = os.path.join(CLOUD, 'site')           # 組み上がったサイト（git に入れない）
MEDIA = os.path.join(CLOUD, 'media')         # 画像・音声の置き場（git に入れない）
VENDOR = os.path.join(CLOUD, 'vendor')       # MathJax（tools/fetch_vendor.py が入れる。git に入れない）
CONFIG_PATH = os.path.join(ROOT, 'config.json')

class SetupError(Exception):
    """手順の途中で止まるべきとき。メッセージに「次に何をするか」を書く"""

def die(msg):
    print('\n[止まりました] ' + msg, file=sys.stderr); sys.exit(1)

def load_config(required=()):
    if not os.path.exists(CONFIG_PATH):
        raise SetupError('config.json がありません。config.example.json を config.json という名前で写して、中身を埋めてください（README の「手順 2」）。')
    try: cfg = json.load(open(CONFIG_PATH, encoding='utf-8-sig'))
    except UnicodeDecodeError:
        raise SetupError('config.json の文字コードが UTF-8 ではありません。メモ帳などで「UTF-8」を選んで保存し直してください。')
    except json.JSONDecodeError as e:
        raise SetupError(f'config.json の書き方がまちがっています（{e}）。Windows のパスは C:/Users/... のように / で書くか、\\\\ と2つ重ねてください。')
    for k in required:
        v = cfg.get(k)
        if v in (None, '') or (isinstance(v, str) and v.startswith('<')):
            raise SetupError(f'config.json の "{k}" が埋まっていません（README の「手順 2」）。')
    return cfg

def expand(p): return os.path.abspath(os.path.expanduser(os.path.expandvars(p))) if p else p

def token_path(cfg): return expand(cfg.get('token_file') or '~/.config/selfanki/token')

def read_token(cfg):
    p = token_path(cfg)
    if not os.path.exists(p): raise SetupError(f'合言葉のファイル {p} がありません。先に python tools/setup_cloud.py を動かしてください。')
    t = open(p, encoding='utf-8').read().strip()
    if len(t) < 20: raise SetupError(f'合言葉のファイル {p} の中身が短すぎます。')
    return t

def site_url(cfg):
    u = (cfg.get('site_url') or '').rstrip('/')
    from urllib.parse import urlsplit
    sp = urlsplit(u)
    if sp.scheme == 'http' and sp.hostname in ('127.0.0.1', 'localhost') and sp.path in ('', '/'): return u   # 手元の試験（wrangler pages dev）だけ
    if not u.startswith('https://'): raise SetupError('config.json の "site_url" が埋まっていません。python tools/setup_cloud.py が最後に表示した https://… を入れてください。')
    return u

# ---------- AnkiConnect（Anki 本体のアドオン。画像の取り寄せと、毎晩の書き戻しで使う） ----------
def ac(cfg, action, **params):
    url = cfg.get('ankiconnect_url') or 'http://127.0.0.1:8765'
    body = json.dumps({'action': action, 'version': 6, 'params': params}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json; charset=utf-8'})
    try:
        with urllib.request.urlopen(req, timeout=600) as r: res = json.loads(r.read().decode('utf-8'))
    except OSError as e:
        raise SetupError(f'AnkiConnect（{url}）につながりません: {e}。Anki を起動しているか、アドオン AnkiConnect が入っているかを確かめてください。')
    if res.get('error'): raise RuntimeError(f"AnkiConnect {action}: {res['error']}")
    return res['result']

# ---------- wrangler（npx で決まった版を使う） ----------
WRANGLER = 'wrangler@4.165.0'   # 確かめた版に固める（出力の形に頼っているため）
def wrangler(args, input_text=None, check=True, capture=True, cwd=CLOUD):
    npx = shutil.which('npx') or shutil.which('npx.cmd')
    if not npx: raise SetupError('npx が見つかりません。Node.js（20 以上）を入れてください（README の「手順 1」）。')
    env = dict(os.environ)
    env.setdefault('NODE_OPTIONS', '--dns-result-order=ipv4first')   # IPv6 が不調な回線で Cloudflare への接続が止まるのを避ける
    env['WRANGLER_SEND_METRICS'] = 'false'
    try:   # Cloudflare のアカウントが複数あるときは config.json の cloudflare_account_id で選ぶ
        acc = json.load(open(CONFIG_PATH, encoding='utf-8')).get('cloudflare_account_id') if os.path.exists(CONFIG_PATH) else None
        if acc: env['CLOUDFLARE_ACCOUNT_ID'] = acc
    except (OSError, json.JSONDecodeError): pass
    r = subprocess.run([npx, '--yes', WRANGLER] + list(args), cwd=cwd, input=input_text, text=True, encoding='utf-8', errors='replace',
                       capture_output=capture, env=env)
    if check and r.returncode != 0:
        out = ((r.stdout or '') + (r.stderr or ''))[-1500:]
        raise SetupError(f'wrangler {" ".join(args[:3])} が失敗しました:\n{out}')
    return r
