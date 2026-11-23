# はじめての設定から最初の配信まで、質問に答えるだけで進める。何度動かしてもよい（済んだところは飛ばす）。
#   python tools/setup.py            … 足りない設定を質問して config.json を作り、Cloudflare の準備・Anki からの移行・配信・端末の番号まで
#   python tools/setup.py --check    … 準備の点検だけ（tools/doctor.py と同じ）
#   python tools/setup.py --config-only … config.json を作るところまで
# config.json がすでに埋まっていれば何も聞かない（AI や自動化から動かすときはこちら）。
import glob, json, os, platform, re, secrets, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
HERE = os.path.dirname(os.path.abspath(__file__))
INTERACTIVE = sys.stdin.isatty()

def step(n, msg): print(f'\n=== {n}. {msg} ===', flush=True)

def ask(q, default=None):
    if not INTERACTIVE: raise SetupError(L(f'config.json が足りません（{q}）。README の「手順 2」のとおりに config.json を書いてから、もう一度動かしてください。',
                                           f'config.json is incomplete ({q}). Write config.json as in README "Step 2", then run this again.'))
    s = input(f'{q}' + ((L(f' [Enter で {default}]', f' [Enter for {default}]')) if default not in (None, '') else '') + ': ').strip()
    return s or (default or '')

def run_tool(name, *args):
    r = subprocess.run([sys.executable, os.path.join(HERE, name)] + list(args), cwd=ROOT)
    if r.returncode != 0: raise SetupError(L(f'{name} が失敗しました。上の [止まりました] の説明を読んでください。直したら、もう一度 python tools/setup.py を動かせば続きから進みます。',
                                             f'{name} failed. Read the [Stopped] message above. After fixing it, run python tools/setup.py again and it continues where it left off.'))

def anki_base_dirs():
    s = platform.system(); home = os.path.expanduser('~')
    if s == 'Windows': return [os.path.join(os.environ.get('APPDATA', os.path.join(home, 'AppData', 'Roaming')), 'Anki2')]
    if s == 'Darwin': return [os.path.join(home, 'Library', 'Application Support', 'Anki2')]
    return [os.path.join(os.environ.get('XDG_DATA_HOME', os.path.join(home, '.local', 'share')), 'Anki2'),
            os.path.join(home, '.var', 'app', 'net.ankiweb.Anki', 'data', 'Anki2')]   # Linux（ふつう／Flatpak）

def choose_collection():
    found = []
    for b in anki_base_dirs():
        for c in sorted(glob.glob(os.path.join(b, '*', 'collection.anki2'))): found.append(c)
    if not found:
        print(L('Anki のデータが見つかりませんでした（Anki のパソコン版を一度でも起動していれば、ふつうは自動で見つかります）。',
                'Could not find your Anki data (it is normally found automatically if Anki for desktop has been started at least once).'))
        p = ask(L('collection.anki2 の場所を入れてください（Anki の「ツール→アドオン→ファイルを表示」で開くフォルダの1つ上の「Anki2」の中、プロファイル名のフォルダにある）',
                  'Enter the path of collection.anki2 (in the profile-name folder inside "Anki2", one level above the folder that Anki\'s Tools → Add-ons → View Files opens)'))
        return p.strip('"')
    if len(found) == 1:
        print(L('Anki のデータ:', 'Anki data:'), found[0]); return found[0]
    print(L('Anki のプロファイルが複数あります:', 'There are several Anki profiles:'))
    for i, c in enumerate(found, 1): print(f'  {i}. {os.path.basename(os.path.dirname(c))}  ({c})')
    while True:
        s = ask(L('移すプロファイルの番号', 'Number of the profile to move'), '1')
        if s.isdigit() and 1 <= int(s) <= len(found): return found[int(s) - 1]

def choose_excludes(col_path):
    """最上位デッキを枚数つきで並べて、移さないものを番号で選ばせる"""
    try:
        import snapshot
        from anki.collection import Collection
    except ImportError:
        raise SetupError(L('Python の anki パッケージがありません。README の「手順 1」の pip install をしてください。',
                           'The Python package "anki" is not installed. Do the pip install in README "Step 1".'))
    snap = snapshot.take({'anki_collection': col_path}, 'decks')
    col = Collection(snap['path'])
    try:
        counts = {}
        for did, n in col.db.all('select case when odid != 0 then odid else did end, count() from cards group by 1'):
            d = col.decks.get(did, default=False)
            if d: counts[d['name'].split('::')[0]] = counts.get(d['name'].split('::')[0], 0) + n
    finally: col.close()
    tops = sorted(counts.items(), key=lambda x: x[0])
    total = sum(n for _, n in tops)
    print(L(f'\nAnki の最上位デッキ（全部で {total} 枚）:', f'\nTop-level decks in Anki ({total} cards in all):'))
    for i, (name, n) in enumerate(tops, 1): print(L(f'  {i:>3}. {name}  （{n} 枚）', f'  {i:>3}. {name}  ({n} card{"" if n == 1 else "s"})'))
    print(L('移さない（このアプリに出さない）デッキがあれば番号を空白区切りで入れてください。全部移すなら何も入れずに Enter。',
            'Enter the numbers of decks to exclude (not shown in this app), separated by spaces. To move everything, just press Enter.'))
    while True:
        s = ask(L('移さないデッキの番号', 'Numbers of decks to exclude'), '')
        nums = s.replace(',', ' ').split()
        if all(x.isdigit() and 1 <= int(x) <= len(tops) for x in nums): return [tops[int(x) - 1][0] for x in nums]
        print(L('番号がおかしいです。もう一度入れてください。', 'Invalid number. Please enter it again.'))

def pick(q, options, default='1'):
    for i, o in enumerate(options, 1): print(f'  {i}. {o}')
    while True:
        x = ask(q, default)
        if x.isdigit() and 1 <= int(x) <= len(options): return int(x)

def choose_language():
    """画面の言語。Anki にある言語から選ぶ（Anki 本体の画面は Anki の訳、アプリの文言は Anki の訳にあるものはその訳・無いものは英語）"""
    try:
        import anki.lang
        langs = list(anki.lang.langs)
    except ImportError: return 'ja_JP'
    codes = [c for _, c in langs]
    print(L('\n画面の言語（Language）:', '\nScreen language:'))
    for i, (name, code) in enumerate(langs, 1): print(f'  {i:>2}. {name} ({code})')
    pref = 'ja_JP' if is_ja() else 'en_US'   # 既定は、道具の文言と同じ言語（日本語か英語）
    d = str(codes.index(pref) + 1) if pref in codes else '1'
    while True:
        x = ask(L('番号 / number', 'Number'), d)
        if x.isdigit() and 1 <= int(x) <= len(codes): return codes[int(x) - 1]

def choose_extras():
    """本家に無い、このアプリ独自の機能を入れるか。入れなければ AnkiMobile 25.09 と同じ動きだけになる"""
    print(L('\nこのアプリは、既定では AnkiMobile 25.09 と同じ動きです。本家に無い機能を足すこともできます（あとで config.json の extras を直して組み直せば変えられる）。',
            '\nBy default this app behaves the same as AnkiMobile 25.09. You can also add features the official app does not have (change "extras" in config.json and rebuild later to switch).'))
    print(L('\n書き込み（Apple Pencil でカードの上に直接書く。本家の「手書きパッド」とは別の機能）:',
            '\nInk (write directly on the card with Apple Pencil; separate from the official app\'s "Scratchpad"):'))
    n = pick(L('番号', 'Number'), L(['使わない（本家どおり）',
                     '作者のデザイン（見本）を使う … 左下に道具の帯（一画戻す・消しゴム・色・キーボードモード・全部消す）。iOS の殻を入れれば、スクイーズで消しゴム・ダブルタップで一画戻す',
                     '自分で作ったデザインを使う … app/designs/<名前>/design.mjs を自分で作っておく（作り方は app/designs/README.md）'],
                     ['Do not use (same as the official app)',
                      'Use the sample design … a tool strip at the bottom left (undo stroke, eraser, colors, keyboard mode, clear all). With the iOS shell app, squeeze for the eraser and double-tap to undo a stroke',
                      'Use your own design … create app/designs/<name>/design.mjs yourself first (see app/designs/README.md)']))
    pen = ''
    if n == 2: pen = 'sample'
    elif n == 3:
        while True:
            pen = ask(L('デザインのフォルダ名（app/designs/ の中の名前）', 'Design folder name (a name inside app/designs/)'))
            if re.fullmatch(r'[A-Za-z0-9_-]+', pen) and os.path.isfile(os.path.join(ROOT, 'app', 'designs', pen, 'design.mjs')): break
            print(L(f'app/designs/{pen}/design.mjs が見つかりません。先に作ってから名前を入れてください（英数字・-・_ だけ）。',
                    f'app/designs/{pen}/design.mjs was not found. Create it first, then enter the name (letters, digits, - and _ only).'))
    print(L('\n同期のしかた:', '\nHow to sync:'))
    m = pick(L('番号', 'Number'), L(['本家どおり … 下の「同期」を押したときだけ送受信する', '答えるたびに自動で同期する（このアプリ独自） … 数秒後に送り、開いたとき・戻ったときにも同期する'],
                                  ['Same as the official app … send and receive only when you press "Sync" at the bottom',
                                   'Auto sync after every answer (this app only) … sends a few seconds later, and also syncs when you open or return to the app']))
    return {'pen_design': pen, 'auto_sync': m == 2}

def make_config():
    cfg = json.load(open(CONFIG_PATH, encoding='utf-8')) if os.path.exists(CONFIG_PATH) else json.load(open(os.path.join(ROOT, 'config.example.json'), encoding='utf-8'))
    changed = False
    def blank(k): v = cfg.get(k); return v in (None, '') or (isinstance(v, str) and v.startswith('<'))
    if blank('anki_collection'):
        cfg['anki_collection'] = choose_collection().replace('\\', '/'); changed = True
    if blank('anki_media_dir'):
        md = os.path.join(os.path.dirname(expand(cfg['anki_collection'])), 'collection.media')
        cfg['anki_media_dir'] = md.replace('\\', '/') if os.path.isdir(md) else ''; changed = True
    if blank('project_name'):
        print(L('\nCloudflare に作る置き場の名前を決めます。英小文字・数字・ハイフンだけ。あなたのアプリの住所 https://<名前>.pages.dev になります。',
                '\nChoose the project name to create on Cloudflare. Lowercase letters, digits and hyphens only. Your app will be at https://<name>.pages.dev.'))
        default = 'anki-' + secrets.token_hex(3)
        while True:
            n = ask(L('名前', 'Name'), default).lower()
            if re.fullmatch(r'[a-z0-9][a-z0-9-]{0,56}[a-z0-9]', n): cfg['project_name'] = n; break
            print(L('英小文字・数字・ハイフンだけで、2〜58文字にしてください。', 'Use 2 to 58 lowercase letters, digits and hyphens.'))
        changed = True
    if INTERACTIVE and not os.path.exists(CONFIG_PATH):   # はじめての設定のときだけ聞く（あとで変えるなら config.json の exclude_top_decks・extras を直して組み直す）
        cfg['exclude_top_decks'] = choose_excludes(expand(cfg['anki_collection']))
        cfg['language'] = choose_language(); set_lang(cfg['language'])
        cfg['extras'] = choose_extras(); changed = True
    cfg.setdefault('extras', {'pen_design': '', 'auto_sync': False})
    if changed:
        json.dump(cfg, open(CONFIG_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print(L(f'\n設定を {CONFIG_PATH} に書きました（あとで手で直してもよい）。', f'\nWrote the settings to {CONFIG_PATH} (you can edit it by hand later).'))
    return cfg

def ensure_login():
    r = wrangler(['whoami'], check=False)
    if r.returncode == 0 and 'not authenticated' not in (r.stdout + r.stderr).lower(): return
    if not INTERACTIVE: raise SetupError(L('Cloudflare にログインしていません。人間が次を動かしてブラウザでログインしてください: npx --yes wrangler@4.165.0 login',
                                           'Not logged in to Cloudflare. A human needs to run this and log in in the browser: npx --yes wrangler@4.165.0 login'))
    print(L('Cloudflare にログインします。ブラウザが開いたら、Cloudflare のアカウントでログインして「Allow（許可）」を押してください（アカウントが無ければ無料で作れます）。',
            'Logging in to Cloudflare. When the browser opens, log in with your Cloudflare account and press "Allow" (you can create an account for free).'))
    wrangler(['login'], capture=False)
    r = wrangler(['whoami'], check=False)
    if 'not authenticated' in (r.stdout + r.stderr).lower(): raise SetupError(L('ログインできませんでした。もう一度 python tools/setup.py を動かしてください。', 'Could not log in. Run python tools/setup.py again.'))

def menu():
    """2回目からは、することを選ぶ（バッチ・setup.sh をダブルクリック／実行したとき）"""
    print(L('\n設定はもう済んでいます。することを番号で選んでください。', '\nSetup is already done. Choose what to do by number.'))
    n = pick(L('番号', 'Number'), L(['端末を足す（6桁の番号を出す）',
                     'Anki で足したり直したりしたカードを上げる',
                     'Anki に書き戻す・試し（mirror.py。数えるだけ。何も書かない）',
                     'Anki に書き戻す・本番（mirror.py。先に Anki のバックアップを取っておく）',
                     '準備の点検',
                     '最初の設定をもう一度通す（Cloudflare の準備から上げるところまで）',
                     'Anki のアドオン「暗記と同期」のファイルを作る'],
                    ['Add a device (show a 6-digit pairing code)',
                     'Upload cards you added or changed in Anki',
                     'Write-back to Anki: dry run (mirror.py; only counts, writes nothing)',
                     'Write-back to Anki: for real (mirror.py; back up Anki first)',
                     'Check the setup',
                     'Run the first-time setup again (from preparing Cloudflare to uploading)',
                     'Build the file for the Anki add-on "selfanki Sync"']), '1')
    if n == 1: run_tool('pair_code.py')
    elif n == 2: run_tool('export_anki.py'); run_tool('build_site.py', '--deploy'); print(L('上げました。端末は次に開いたときに新しい中身を取ってきます。', 'Uploaded. Devices fetch the new content the next time they open the app.'))
    elif n == 3: run_tool('mirror.py', '--dry')
    elif n == 4:
        if ask(L('Anki のバックアップは取りましたか？ 取ったなら y', 'Did you back up Anki? If so, enter y'), 'n').lower() != 'y': print(L('やめました。Anki の「ファイル」→「バックアップを作成」をしてから、もう一度選んでください。', 'Cancelled. In Anki, do File → Create Backup, then choose this again.')); return
        run_tool('mirror.py')
    elif n == 5: run_tool('doctor.py')
    elif n == 7: run_tool('build_addon.py')
    return n == 6

def main():
    if '--check' in sys.argv: run_tool('doctor.py'); return
    if INTERACTIVE and '--config-only' not in sys.argv and os.path.exists(CONFIG_PATH) and os.path.exists(os.path.join(STATE, 'base.json')):
        try: done = (load_config().get('site_url') or '').startswith('https://')
        except SetupError: done = False
        if done and not menu(): return
    step(1, L('設定', 'Settings'))
    cfg = make_config()
    if '--config-only' in sys.argv: return
    step(2, L('MathJax（数式の表示）を取ってくる', 'Download MathJax (for math)'))
    run_tool('fetch_vendor.py')
    step(3, L('Cloudflare の準備（ログイン・置き場・合言葉）', 'Prepare Cloudflare (login, project, passphrase)'))
    ensure_login()
    run_tool('setup_cloud.py')
    step(4, L('Anki から書き出す（本物のコレクションには触らず、写しを読む）', 'Export from Anki (reads a copy; the real collection is not touched)'))
    run_tool('export_anki.py')
    step(5, L('組み立てて Cloudflare に上げる（はじめては数分かかる）', 'Build and upload to Cloudflare (takes a few minutes the first time)'))
    run_tool('build_site.py', '--deploy')
    step(6, L('端末で使えるようにする', 'Set up your devices'))
    run_tool('pair_code.py')
    cfg = load_config()
    print(L(f'''
できました。
  ・スマホ・タブレット・別のパソコン: ブラウザで {cfg.get("site_url")} を開き、上の6桁の番号を入れる
    （iPhone・iPad は、先に Safari の共有ボタン→「ホーム画面に追加」をして、ホーム画面のアイコンから開いて番号を入れる）
  ・はじめて作ったときは、つながるまで数分かかることがある。開けなければ少し待って開き直す
  ・番号は15分で切れる。もう1台足す・カードを上げ直す・Anki に書き戻すときは、同じもの（setup_windows.bat か setup.sh）をもう一度動かすと選べる
''', f'''
Done.
  - Phone, tablet or another computer: open {cfg.get("site_url")} in a browser and enter the 6-digit pairing code above
    (on iPhone/iPad, first do Safari's Share button → "Add to Home Screen", then open it from the Home Screen icon and enter the code there)
  - Right after creating it, it can take a few minutes before the site responds. If it does not open, wait a little and try again
  - The code expires in 15 minutes. To add another device, upload cards again or write back to Anki, run the same thing again (setup_windows.bat or setup.sh) and choose
'''))

if __name__ == '__main__':
    try: main()
    except SetupError as e: die(str(e))
    except KeyboardInterrupt: die(L('中断しました。もう一度 python tools/setup.py を動かせば続きから進みます。', 'Interrupted. Run python tools/setup.py again to continue where you left off.'))
