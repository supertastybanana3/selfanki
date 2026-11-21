# 配る用のファイル（site/）を組む。Cloudflare Pages にはこの site/ を丸ごと上げる（wrangler pages deploy）。
#   python tools/build_site.py                     … cloud/state/export_new から組む（ふだん。カードの中身・デッキ・画像を最新に）
#   python tools/build_site.py --deploy            … 組んでから Cloudflare Pages に上げる
#   python tools/build_site.py 書き出しの場所 …     … 書き出しの場所を指定する
#   --rebase は「移行した時点の状態」を作り直す。使い始めた（答えた）あとに使うと、その日までの答えの扱いがおかしくなるので、最初の1回以外は使わない
# 中身:
#   site/app, site/fsrs           アプリ本体（リポジトリの app/・fsrs/ から写す）
#   site/sw.js                    オフライン用（app/ の sw.js を根元に置く）
#   site/vendor/mathjax           MathJax 3.2.2（ネットが無くても数式が出るように。tools/fetch_vendor.py が cloud/vendor に入れる）
#   site/bundle/manifest.json     下のファイルの一覧（名前に中身のハッシュが入る）
#   site/bundle/c/NNN.<h>.json    カードの中身（表・裏の HTML、デッキ、タグ）。カード id 順に約1000枚ずつ
#   site/bundle/meta.<h>.json     デッキ・プリセット・ノートタイプの CSS・設定
#   site/bundle/state.<h>.json    移行した時点のカードの状態（間隔・期日・記憶の値）。以後の変化は D1
#   site/bundle/revlog.<h>.json   移行した時点の復習記録
#   site/bundle/media/            画像・音声（cloud/media から。cloud/media へは Anki の collection.media から写す）
import json, os, sys, hashlib, shutil, collections, base64, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
HERE = CLOUD
ST = STATE
CHUNK, CHUNK_MAX = 1000, 1500

def h8(b): return hashlib.sha256(b).hexdigest()[:10]
def dump(obj): return json.dumps(obj, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
def card_rev(c, last_rev):
    return max(c['mod'] * 1000, last_rev.get(c['id'], 0))
STATE_KEYS = ['type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left', 'data']
CONTENT_KEYS = ['id', 'nid', 'did', 'mid', 'ord', 'flags', 'tags', 'q', 'a', 'qav', 'aav', 'sfld', 'tname', 'inDyn', 'typ']

def ensure_media(names, log=print):
    """足りない画像・音声を cloud/media に揃える。config.json の anki_media_dir（Anki の collection.media）があればそこから写し、
    無ければ AnkiConnect（ankiconnect_url）で Anki から取ってくる。中身が変わったもの（大きさか更新時刻が違う）も写し直す"""
    cfg = load_config()
    os.makedirs(MEDIA, exist_ok=True)
    have = set(os.listdir(MEDIA))
    ok_name = safe_name
    mdir = expand(cfg.get('anki_media_dir') or '')
    if mdir:
        if not os.path.isdir(mdir): raise SetupError(f'config.json の "anki_media_dir" のフォルダがありません: {mdir}')
        got, missing = [], []
        for n in names:
            if not ok_name(n): continue
            s_ = os.path.join(mdir, n); d_ = os.path.join(MEDIA, n)
            if not os.path.isfile(s_): missing.append(n); continue
            st = os.stat(s_)
            if n in have:
                dt = os.stat(d_)
                if dt.st_size == st.st_size and int(dt.st_mtime) == int(st.st_mtime): continue
            shutil.copy2(s_, d_ + '.tmp'); os.replace(d_ + '.tmp', d_); got.append(n)
        log(f'画像・音声: collection.media から写した {len(got)}、見つからない {len(missing)}')
        return got, missing
    need = [n for n in names if n not in have and ok_name(n)]
    if not need: return [], []
    got, missing = [], []
    def one(n):
        b = ac(cfg, 'retrieveMediaFile', filename=n)
        if not b: return n, False
        tmp = os.path.join(MEDIA, '.tmp_' + h8(n.encode()))
        with open(tmp, 'wb') as f: f.write(base64.b64decode(b))
        os.replace(tmp, os.path.join(MEDIA, n)); return n, True
    with cf.ThreadPoolExecutor(6) as ex:
        for n, ok in ex.map(one, need): (got if ok else missing).append(n)
    log(f'画像・音声: 取ってきた {len(got)}、Anki にも無い {len(missing)}')
    return got, missing

def build(export_dir, rebase=False, fetch_media=True, log=print):
    os.makedirs(ST, exist_ok=True)
    meta = json.load(open(os.path.join(export_dir, 'meta.json'), encoding='utf-8'))
    cards = json.load(open(os.path.join(export_dir, 'cards.json'), encoding='utf-8'))
    revlog = json.load(open(os.path.join(export_dir, 'revlog.json'), encoding='utf-8'))
    media = json.load(open(os.path.join(export_dir, 'media.json'), encoding='utf-8'))
    out = os.path.join(HERE, 'site.new')
    if os.path.exists(out): shutil.rmtree(out)
    os.makedirs(os.path.join(out, 'bundle', 'c'))
    # アプリ本体
    shutil.copytree(os.path.join(ROOT, 'app'), os.path.join(out, 'app'), ignore=shutil.ignore_patterns('test', '*.bak*', '__pycache__'))
    shutil.copytree(os.path.join(ROOT, 'fsrs'), os.path.join(out, 'fsrs'), ignore=shutil.ignore_patterns('*.bak*'))
    if os.path.exists(os.path.join(out, 'app', 'sw.js')): shutil.move(os.path.join(out, 'app', 'sw.js'), os.path.join(out, 'sw.js'))
    if not os.path.isfile(os.path.join(VENDOR, 'mathjax', 'tex-chtml.js')): raise SetupError('MathJax がありません。先に python tools/fetch_vendor.py を動かしてください。')
    shutil.copytree(VENDOR, os.path.join(out, 'vendor'), copy_function=link_or_copy)
    # Anki 本体のウェブ画面（統計・デッキのオプションなど。aqt 25.9.4 の SvelteKit を取り出したもの）と日本語の文言
    aw = os.path.join(ROOT, 'ankiweb')
    for n in os.listdir(aw):
        (shutil.copytree if os.path.isdir(os.path.join(aw, n)) else shutil.copy2)(os.path.join(aw, n), os.path.join(out, n))
    with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8') as f: f.write('<!doctype html><meta http-equiv="refresh" content="0;url=/app/index.html">')
    # 移行した時点の状態（最初の1回だけ作り、以後は同じものを出し続ける）
    base_p = os.path.join(ST, 'base.json')
    if rebase or not os.path.exists(base_p):
        last = {}
        for r in revlog: last[r[1]] = max(last.get(r[1], 0), r[0])
        base = {'at': meta['exported_at'], 'source': meta['source'], 'project': load_config().get('project_name'),
                'state': [[c['id']] + [c[k] for k in STATE_KEYS] + [card_rev(c, last)] for c in cards],
                'revlog': revlog}
        if os.path.exists(base_p): shutil.copy(base_p, base_p + '.old')
        with open(base_p, 'wb') as f: f.write(dump(base))
        log(f'移行時点の状態を作った: カード {len(base["state"])}・記録 {len(revlog)}')
    base = json.load(open(base_p, encoding='utf-8'))
    pn = load_config().get('project_name')
    if base.get('project') and base['project'] != pn:
        raise SetupError(f'cloud/state/base.json は置き場「{base["project"]}」用です（今の config.json は「{pn}」）。別の置き場で最初からやり直すなら、cloud/state を別の名前に変えてから動かしてください。')
    # 移行した時点のあとに Anki で足したカード（と、あとから移す対象にしたデッキのカード）の状態と記録。
    # 移行時点の状態は作り直さず、足りない分だけを別のファイルで配る（端末で答えた分は D1 の差分が上に重なる）
    base_ids = {row[0] for row in base['state']}; base_rev_ids = {r[0] for r in base['revlog']}
    last_all = {}
    for r in revlog: last_all[r[1]] = max(last_all.get(r[1], 0), r[0])
    add_cards = [c for c in cards if c['id'] not in base_ids]
    add_ids = {c['id'] for c in add_cards}
    add = {'state': [[c['id']] + [c[k] for k in STATE_KEYS] + [card_rev(c, last_all)] for c in add_cards],
           'revlog': [r for r in revlog if r[1] in add_ids and r[0] not in base_rev_ids]}
    files = {}
    def put(rel, b):
        p = os.path.join(out, 'bundle', rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as f: f.write(b)
        return rel
    b = dump(base['state']); files['state'] = put(f'state.{h8(b)}.json', b)
    b = dump(base['revlog']); files['revlog'] = put(f'revlog.{h8(b)}.json', b)
    b = dump(meta); files['meta'] = put(f'meta.{h8(b)}.json', b)
    if add['state']: b = dump(add); files['add'] = put(f'stateadd.{h8(b)}.json', b)
    # カードの中身を id 順に分ける。分け目は前回のものを使い回す（中身が変わった束だけ名前が変わる）
    ch_p = os.path.join(ST, 'chunks.json')
    starts = json.load(open(ch_p, encoding='utf-8')) if os.path.exists(ch_p) else []
    cards.sort(key=lambda c: c['id'])
    if not starts: starts = [cards[i]['id'] for i in range(0, len(cards), CHUNK)]; starts[0] = 0
    groups = collections.defaultdict(list)
    import bisect
    for c in cards: groups[bisect.bisect_right(starts, c['id']) - 1].append({k: c[k] for k in CONTENT_KEYS if k in c})
    last_i = len(starts) - 1
    while len(groups[last_i]) > CHUNK_MAX:  # 新しいカードで最後の束が大きくなったら割る
        g = groups[last_i]; starts.append(g[CHUNK]['id']); groups[last_i + 1] = g[CHUNK:]; groups[last_i] = g[:CHUNK]; last_i += 1
    json.dump(starts, open(ch_p, 'w', encoding='utf-8'))
    chunks = []
    for i in range(len(starts)):
        b = dump(groups.get(i, [])); chunks.append({'f': put(f'c/{i:03d}.{h8(b)}.json', b), 'n': len(groups.get(i, []))})
    # ノートの生の中身（検索用。[nid, mid, flds, sfld, csum, tags, mod]）。カードと同じく nid 順に分け、分け目は前回のものを使い回す
    notes_p = os.path.join(export_dir, 'notes.json'); note_files = []
    if os.path.exists(notes_p):
        notes = sorted(json.load(open(notes_p, encoding='utf-8')), key=lambda r: r[0])
        nc_p = os.path.join(ST, 'note_chunks.json')
        nstarts = json.load(open(nc_p, encoding='utf-8')) if os.path.exists(nc_p) else []
        if not nstarts and notes: nstarts = [notes[i][0] for i in range(0, len(notes), 4000)]; nstarts[0] = 0
        ng = collections.defaultdict(list)
        for r in notes: ng[bisect.bisect_right(nstarts, r[0]) - 1].append(r)
        li = len(nstarts) - 1
        while len(ng[li]) > 6000: g = ng[li]; nstarts.append(g[4000][0]); ng[li + 1] = g[4000:]; ng[li] = g[:4000]; li += 1
        json.dump(nstarts, open(nc_p, 'w', encoding='utf-8'))
        for i in range(len(nstarts)):
            b = dump(ng.get(i, [])); note_files.append(put(f'n/{i:03d}.{h8(b)}.json', b))
    # 画像・音声
    names = sorted({m['name'] for m in media})
    if fetch_media: ensure_media(names, log)
    os.makedirs(os.path.join(out, 'bundle', 'media'))
    present = []
    # 画像・音声は名前を変えずに中身を差し替えることがある（音声を切り直したときなど）ので、中身の指紋も配る。アプリはこれが変わったものだけ取り直す
    hp = os.path.join(ST, 'media_hash.json'); hc = json.load(open(hp, encoding='utf-8')) if os.path.exists(hp) else {}
    def mhash(n, p):
        st = os.stat(p); k = f'{st.st_size}:{int(st.st_mtime)}'
        if hc.get(n, [None])[0] != k: hc[n] = [k, hashlib.sha1(open(p, 'rb').read()).hexdigest()[:10]]
        return hc[n][1]
    for n in names:
        src = os.path.join(MEDIA, n)
        if not safe_name(n): continue   # フォルダをまたぐ名前は配らない
        if os.path.isfile(src): link_or_copy(src, os.path.join(out, 'bundle', 'media', n)); present.append([n, mhash(n, src)])
    json.dump(hc, open(hp, 'w', encoding='utf-8'))
    b = dump(present); files['media'] = put(f'media.{h8(b)}.json', b)
    # 本家に無い、このアプリ独自の機能（config.json の extras）。ここで入れたものだけがアプリに出る
    ex = (load_config().get('extras') or {})
    pen_design = str(ex.get('pen_design') or '').strip()
    if pen_design and not os.path.isfile(os.path.join(ROOT, 'app', 'designs', pen_design, 'design.mjs')):
        raise SetupError(f'書き込みのデザイン "{pen_design}" がありません（app/designs/{pen_design}/design.mjs）。config.json の extras.pen_design を直すか、空にしてください。')
    lang = build_i18n(out, load_config().get('language') or 'ja_JP', log)
    features = {'pen': pen_design, 'autoSync': bool(ex.get('auto_sync')), 'lang': lang}
    manifest = {'built': int(__import__('time').time()), 'features': features, 'meta': files['meta'], 'chunks': chunks, 'media': files['media'],
                'base': {'state': files['state'], 'revlog': files['revlog'], 'at': base['at'], 'add': files.get('add')}, 'cards': len(cards), 'askhist': files.get('askhist'), 'notes': note_files}
    put('manifest.json', dump(manifest))
    # 入れ替え
    site = os.path.join(HERE, 'site')
    if os.path.exists(site): shutil.rmtree(site)
    os.replace(out, site)
    log(f'site を組んだ: カード {len(cards)}（束 {len(chunks)}）・画像音声 {len(present)}/{len(names)}・独自の機能: 書き込み {features["pen"] or "なし"}／自動同期 {"あり" if features["autoSync"] else "なし"}')
    return manifest

def site_key():
    """上げた中身の指紋（manifest の built を除く・画像音声は名前と大きさ）。前回上げたものと同じなら上げ直さない"""
    site = os.path.join(HERE, 'site'); hs = hashlib.sha256()
    for root, dirs, fs in os.walk(site):
        dirs.sort()
        for f in sorted(fs):
            p = os.path.join(root, f); rel = os.path.relpath(p, site).replace(os.sep, '/')
            if rel.startswith('bundle/media/'): hs.update(f'{rel}:{os.path.getsize(p)}\n'.encode()); continue
            b = open(p, 'rb').read()
            if rel == 'bundle/manifest.json': m = json.loads(b); m.pop('built', None); b = dump(m)
            hs.update(rel.encode() + b'\0' + hashlib.sha256(b).digest())
    return hs.hexdigest()

def deploy(log=print):
    import subprocess
    cfg = load_config(required=('project_name',))
    if not os.path.exists(os.path.join(CLOUD, 'wrangler.toml')): raise SetupError('cloud/wrangler.toml がありません。先に python tools/setup_cloud.py を動かしてください。')
    r = wrangler(['pages', 'deploy', 'site', '--project-name', cfg['project_name'], '--branch', 'main', '--commit-dirty=true'], check=False)
    tail = [l for l in (r.stdout + r.stderr).strip().splitlines() if 'Deployment complete' in l or 'rror' in l] or (r.stdout + r.stderr).strip().splitlines()
    log('Pages に上げた' if r.returncode == 0 else 'Pages に上げられなかった', (tail[-1] if tail else '')[:200])
    if r.returncode == 0: open(os.path.join(ST, 'deployed_key.txt'), 'w', encoding='utf-8').write(site_key())
    return r.returncode == 0

def build_i18n(out, code, log=print):
    """画面の言語。Anki 本体の画面（統計など）の訳を site/i18n_anki.json に、アプリの文言の置き換え表を site/app/i18n/ui.json に書く。
    code は Anki の言語の番号（ja_JP・en_US・de_DE・zh_CN など）。日本語なら置き換え表は作らない"""
    import re as _re
    tag = code.replace('_', '-')
    try:
        from anki._backend import RustBackend
        res = json.loads(RustBackend(langs=[tag, 'en-US']).i18n_resources(modules=[]))
    except Exception as e:
        log(f'Anki の翻訳を作れなかった（{e}）。日本語のまま組む'); shutil.copy2(os.path.join(ROOT, 'ankiweb', 'i18n_ja.json'), os.path.join(out, 'i18n_anki.json')); return 'ja'
    with open(os.path.join(out, 'i18n_anki.json'), 'w', encoding='utf-8') as f: json.dump(res, f, ensure_ascii=False)
    if tag.startswith('ja'): return 'ja'
    def parse(text):
        d = {}
        for line in text.splitlines():
            m = _re.match(r'^([a-z0-9-]+) = (.+)$', line)
            if m and '{' not in m.group(2): d[m.group(1)] = m.group(2).strip()
        return d
    tgt = parse(res['resources'][0]); en = parse(res['resources'][-1])
    table = {}
    for e in json.load(open(os.path.join(ROOT, 'app', 'i18n', 'strings.json'), encoding='utf-8')):
        k = e.get('key'); v = tgt.get(k) if k else None
        if not v: v = e.get('en') or (en.get(k) if k else None)
        if v: table[e['ja']] = v
    # 答えのボタンの間隔の単位（Anki の scheduling-answer-button-time-*。{ $amount } のところに数が入る）
    units = {}
    for line in res['resources'][0].splitlines():
        m = _re.match(r'^scheduling-answer-button-time-(seconds|minutes|hours|days|months|years) = (.+)$', line)
        if m: units[{'seconds': 's', 'minutes': 'm', 'hours': 'h', 'days': 'd', 'months': 'mo', 'years': 'y'}[m.group(1)]] = _re.sub(r'\{ *\$amount *\}', '{}', m.group(2)).replace('\u2068', '').replace('\u2069', '').strip()
        m = _re.match(r'^scheduling-end = (.+)$', line)
        if m: units['end'] = m.group(1).strip()
    table['__ivl'] = units
    os.makedirs(os.path.join(out, 'app', 'i18n'), exist_ok=True)
    with open(os.path.join(out, 'app', 'i18n', 'ui.json'), 'w', encoding='utf-8') as f: json.dump(table, f, ensure_ascii=False)
    log(f'画面の言語: {code}（置き換え {len(table)} 件）')
    return tag

def safe_name(n):
    return bool(n) and '/' not in n and '\\' not in n and n not in ('.', '..') and not n.startswith('.') and '\0' not in n

def link_or_copy(src, dst):
    try: os.link(src, dst)
    except OSError: shutil.copy2(src, dst)   # 別のドライブ・ハードリンクできない場所ではふつうに写す

if __name__ == '__main__':
    try:
        args = [a for a in sys.argv[1:] if not a.startswith('--')]
        # ふだんは export_anki.py の書き出し（export_new）。書き戻し（mirror.py）のあとは export に移っているので、そちらを使う
        exp = args[0] if args else next((d for d in (os.path.join(ST, 'export_new'), os.path.join(ST, 'export')) if os.path.exists(os.path.join(d, 'meta.json'))), os.path.join(ST, 'export_new'))
        if not os.path.exists(os.path.join(exp, 'meta.json')): raise SetupError(f'書き出し {exp} がありません。先に python tools/export_anki.py を動かしてください。')
        build(exp, rebase='--rebase' in sys.argv, fetch_media='--nomedia' not in sys.argv)
        if '--deploy' in sys.argv and not deploy(): sys.exit(1)
    except SetupError as e: die(str(e))
