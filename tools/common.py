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

# ---------- 道具の文言の言語: 日本語（ja で始まる）か英語。L('日本語', 'English') で選ぶ ----------
# 決め方: 環境変数 SELFANKI_LANG → config.json の language → OS の表示言語 → 英語
def _detect_lang():
    v = os.environ.get('SELFANKI_LANG', '').strip()
    if v: return v
    try:
        if os.path.exists(CONFIG_PATH):
            v = (json.load(open(CONFIG_PATH, encoding='utf-8-sig')).get('language') or '').strip()
            if v and not v.startswith('<'): return v
    except Exception: pass
    if os.name == 'nt':
        try:
            import ctypes
            return 'ja' if (ctypes.windll.kernel32.GetUserDefaultUILanguage() & 0x3ff) == 0x11 else 'en'   # 0x11＝日本語
        except Exception: pass
    for k in ('LC_ALL', 'LC_MESSAGES', 'LANG'):
        v = os.environ.get(k, '').strip()
        if v: return v
    if sys.platform == 'darwin':
        try: return subprocess.run(['defaults', 'read', '-g', 'AppleLocale'], capture_output=True, text=True, timeout=5).stdout.strip() or 'en'
        except Exception: pass
    return 'en'

_JA = None
def is_ja():
    global _JA
    if _JA is None: _JA = _detect_lang().lower().startswith('ja')
    return _JA

def set_lang(code):
    """言語を決め直す（setup.py で画面の言語を選んだあと。環境変数 SELFANKI_LANG があればそちらが勝つ）"""
    global _JA
    _JA = (os.environ.get('SELFANKI_LANG', '').strip() or code or 'en').lower().startswith('ja')

def L(ja, en): return ja if is_ja() else en

class SetupError(Exception):
    """手順の途中で止まるべきとき。メッセージに「次に何をするか」を書く"""

def die(msg):
    print('\n' + L('[止まりました] ', '[Stopped] ') + msg, file=sys.stderr); sys.exit(1)

def load_config(required=()):
    if not os.path.exists(CONFIG_PATH):
        raise SetupError(L('config.json がありません。config.example.json を config.json という名前で写して、中身を埋めてください（README の「手順 2」）。',
                           'config.json is missing. Copy config.example.json to config.json and fill it in (README, "Step 2").'))
    try: cfg = json.load(open(CONFIG_PATH, encoding='utf-8-sig'))
    except UnicodeDecodeError:
        raise SetupError(L('config.json の文字コードが UTF-8 ではありません。メモ帳などで「UTF-8」を選んで保存し直してください。',
                           'config.json is not UTF-8. Save it again as "UTF-8" (for example in Notepad).'))
    except json.JSONDecodeError as e:
        raise SetupError(L(f'config.json の書き方がまちがっています（{e}）。Windows のパスは C:/Users/... のように / で書くか、\\\\ と2つ重ねてください。',
                           f'config.json is not valid JSON ({e}). Write Windows paths with / (C:/Users/...) or double the backslashes (\\\\).'))
    for k in required:
        v = cfg.get(k)
        if v in (None, '') or (isinstance(v, str) and v.startswith('<')):
            raise SetupError(L(f'config.json の "{k}" が埋まっていません（README の「手順 2」）。', f'"{k}" in config.json is not filled in (README, "Step 2").'))
    return cfg

def expand(p): return os.path.abspath(os.path.expanduser(os.path.expandvars(p))) if p else p

def token_path(cfg): return expand(cfg.get('token_file') or '~/.config/selfanki/token')

def read_token(cfg):
    p = token_path(cfg)
    if not os.path.exists(p): raise SetupError(L(f'合言葉のファイル {p} がありません。先に python tools/setup_cloud.py を動かしてください。',
                                                 f'The passphrase file {p} is missing. Run python tools/setup_cloud.py first.'))
    t = open(p, encoding='utf-8').read().strip()
    if len(t) < 20: raise SetupError(L(f'合言葉のファイル {p} の中身が短すぎます。', f'The passphrase file {p} is too short.'))
    return t

def site_url(cfg):
    u = (cfg.get('site_url') or '').rstrip('/')
    from urllib.parse import urlsplit
    sp = urlsplit(u)
    if sp.scheme == 'http' and sp.hostname in ('127.0.0.1', 'localhost') and sp.path in ('', '/'): return u   # 手元の試験（wrangler pages dev）だけ
    if not u.startswith('https://'): raise SetupError(L('config.json の "site_url" が埋まっていません。python tools/setup_cloud.py が最後に表示した https://… を入れてください。',
                                                        '"site_url" in config.json is not filled in. Put the https://… address that python tools/setup_cloud.py printed at the end.'))
    return u

# ---------- AnkiConnect（Anki 本体のアドオン。画像の取り寄せと、毎晩の書き戻しで使う） ----------
def ac(cfg, action, **params):
    url = cfg.get('ankiconnect_url') or 'http://127.0.0.1:8765'
    body = json.dumps({'action': action, 'version': 6, 'params': params}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json; charset=utf-8'})
    try:
        with urllib.request.urlopen(req, timeout=600) as r: res = json.loads(r.read().decode('utf-8'))
    except OSError as e:
        raise SetupError(L(f'AnkiConnect（{url}）につながりません: {e}。Anki を起動しているか、アドオン AnkiConnect が入っているかを確かめてください。',
                           f'Cannot connect to AnkiConnect ({url}): {e}. Check that Anki is running and the AnkiConnect add-on is installed.'))
    if res.get('error'): raise RuntimeError(f"AnkiConnect {action}: {res['error']}")
    return res['result']

# ---------- wrangler（npx で決まった版を使う） ----------
WRANGLER = 'wrangler@4.165.0'   # 確かめた版に固める（出力の形に頼っているため）
def wrangler(args, input_text=None, check=True, capture=True, cwd=CLOUD):
    npx = shutil.which('npx') or shutil.which('npx.cmd')
    if not npx: raise SetupError(L('npx が見つかりません。Node.js（20 以上）を入れてください（README の「手順 1」）。', 'npx was not found. Install Node.js 20 or later (README, "Step 1").'))
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
        raise SetupError(L(f'wrangler {" ".join(args[:3])} が失敗しました:\n{out}', f'wrangler {" ".join(args[:3])} failed:\n{out}'))
    return r
