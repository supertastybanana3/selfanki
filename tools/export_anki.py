# Anki のコレクション（の写し）から、アプリに配るデータを書き出す。カードの表・裏は Anki 本体（Python の anki パッケージ）で描いたものをそのまま使う。
#   python tools/export_anki.py                 … config.json の anki_collection の写しを取って書き出す（書き出し先は cloud/state/export_new）
#   python tools/export_anki.py 写し.anki2 出力先 … 写しを自分で指定する（mirror.py が使う）
# 本物のコレクションには書かない（いつも写しを開く）。
import json, re, os, sys, time, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
try:
    from anki.collection import Collection
    from anki.sound import SoundOrVideoTag, TTSTag
except ImportError:
    die('Python の anki パッケージがありません。README の「手順 1」の pip install をしてください。')
from anki.buildinfo import version as ANKI_VERSION
if not ANKI_VERSION.startswith('25.09'):
    print(f'注意: anki パッケージの版が {ANKI_VERSION} です。確かめてあるのは 25.9.4 です（pip install anki==25.9.4）。', file=sys.stderr)
import html as _html
def html_to_text_line(h):
    # rslib text.rs の html_to_text_line と同じ: <br>・<div>・改行を空白に、[[type:]]・[sound:] を消し、コメント・style・script・タグを除いて文字参照を戻す
    h = re.sub(r'(?i)<br\s*/?>|<div>|\n', ' ', h)
    h = re.sub(r'\[\[type:[^\]]+\]\]', '', h); h = re.sub(r'\[sound:[^\]]+\]', '', h)
    h = re.sub(r'(?si)<!--.*?-->|<style.*?>.*?</style>|<script.*?>.*?</script>|<.*?>', '', h)
    return _html.unescape(h).strip()
def sort_text(note, m):
    try: return re.sub(r'\s+', ' ', html_to_text_line(note.fields[m['sortf']]))[:300]
    except Exception: return ''
cfg = load_config()
args = [a for a in sys.argv[1:] if not a.startswith('--')]
if args:
    SRC = args[0]
else:
    import snapshot
    try: SRC = snapshot.take(cfg, 'export')['path']
    except SetupError as e: die(str(e))
OUT = args[1] if len(args) > 1 else os.path.join(STATE, 'export_new')
os.makedirs(OUT, exist_ok=True)
# 移さない最上位デッキ（config.json の exclude_top_decks）。名前が「_」で始まるデッキを除くかは exclude_underscore_decks
EXCLUDE_TOP = set(cfg.get('exclude_top_decks') or [])
SKIP_UNDERSCORE = bool(cfg.get('exclude_underscore_decks', False))
SCRIPT = re.compile(r'<script\b.*?</script>', re.S | re.I)
ASK = re.compile(r'<!--ask:begin-->.*?<!--ask:end-->', re.S)
# カードの HTML から、属性の中のスクリプト（onerror= など）と javascript: の URL を除く（もらったデッキが端末の記録を読み出せないように）
ONATTR = re.compile(r'''(<[^>]*?)\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)''', re.I)
JSURL = re.compile(r'''(href|src|action|formaction)\s*=\s*(["']?)\s*javascript:''', re.I)
TYPE_PAT = re.compile(r'\[\[type:(.+?)\]\]')
def type_info(card, note, q):
    """入力して答える（{{type:…}}）の正しい答え。aqt reviewer.py の typeAnsQuestionFilter と同じ選び方（穴埋めは extract_cloze_for_typing）。
    exp が None＝フィールドが無い（注意書きを出す）、''＝中身が空（入力欄を出さない）"""
    m = TYPE_PAT.search(q)
    if not m: return None
    fld = m.group(1); cloze_idx = None; combining = True
    if fld.startswith('cloze:'): cloze_idx = card.ord + 1; fld = fld.split(':')[1]
    if fld.startswith('nc:'): combining = False; fld = fld.split(':')[1]
    exp = None; font = 'Arial'; size = 20
    for f in note.note_type()['flds']:
        if f['name'] == fld:
            exp = note[f['name']]
            if cloze_idx: exp = col.extract_cloze_for_typing(exp, cloze_idx) or None
            font, size = f['font'], f['size']
            break
    return {'exp': exp, 'nc': not combining, 'cloze': bool(cloze_idx), 'fld': fld, 'font': font, 'size': size}
def clean(h):
    for _ in range(20):
        h2 = ONATTR.sub(r'\1', h)
        if h2 == h: break
        h = h2
    return JSURL.sub(r'\1=\2about:blank#', h)
def home_state(ctype, queue, due, odid, odue, data, did):
    """フィルターデッキに入っているカードは、元のデッキでの queue・due（空にしたときの値。rslib remove_from_filtered_deck_restoring_queue）を
    状態に、フィルターデッキの中での due・queue を data.flt に入れる（アプリのフィルターデッキ。アドオンの anki_view と同じ形）"""
    d = json.loads(data) if data else {}
    if not odid: return queue, due, d
    hdue = odue if odue != 0 else due
    hq = queue
    if queue >= 0: hq = 0 if ctype == 0 else 2 if ctype == 2 else (1 if hdue > 1_000_000_000 else 3)
    d['flt'] = {'d': did, 'due': due, 'q': queue}
    return hq, hdue, d
def fdeck_def(d):
    """Anki のフィルターデッキの定義（decks.rs の古い JSON の形: terms＝[検索, 上限, 並び]・resched・previewAgainSecs など）をアプリの形に"""
    terms = [{'search': t[0], 'limit': int(t[1]), 'order': int(t[2])} for t in (d.get('terms') or [])][:2] or [{'search': '', 'limit': 100, 'order': 1}]
    return {'id': d['id'], 'name': d['name'], 'terms': terms, 'second': len(terms) > 1, 'resched': bool(d.get('resched', True)),
            'previewAgain': int(d.get('previewAgainSecs', 60)), 'previewHard': int(d.get('previewHardSecs', 600)), 'previewGood': int(d.get('previewGoodSecs', 0)), 'mod': d.get('mod', 0)}
try: col = Collection(SRC)
except Exception as e:
    die(f'コレクションを開けませんでした（{e}）。Anki が新しい形で保存している場合は、先にバックアップを取り、パソコンの Anki で「ファイル」→「プロファイルを切り替え」→「Downgrade & Quit」をしてから、もう一度書き出してください。')
decks = {d['id']: d for d in col.decks.all()}
def top(did): return decks[did]['name'].split('::')[0]
keep_deck = {did for did, d in decks.items() if not d.get('dyn') and top(did) not in EXCLUDE_TOP and not (SKIP_UNDERSCORE and any(part.startswith('_') for part in d['name'].split('::')))}
cards = []; media = collections.Counter(); nt_used = set()
t0 = time.time()
rows = col.db.all("select id, nid, did, odid, ord, type, queue, due, odue, ivl, factor, reps, lapses, left, flags, mod, data from cards")
for (cid, nid, did, odid, ord_, ctype, queue, due, odue, ivl, factor, reps, lapses, left, flags, mod, data) in rows:
    home = odid or did
    if home not in keep_deck: continue
    card = col.get_card(cid)
    out = card.render_output(reload=True, browser=False)
    q = clean(ASK.sub('', SCRIPT.sub('', out.question_text))); a = clean(ASK.sub('', SCRIPT.sub('', out.answer_text)))
    def av(tags):
        res = []
        for t in tags:
            if isinstance(t, SoundOrVideoTag): res.append({'sound': t.filename}); media[t.filename] += 1
            elif isinstance(t, TTSTag): res.append({'tts': t.field_text, 'lang': t.lang, 'voices': t.voices, 'speed': t.speed})
        return res
    for m in re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', q + a): media[m] += 1
    note = card.note(); nt_used.add(note.mid)
    hq, hdue, cdata = home_state(ctype, queue, due, odid, odue, data, did)
    cards.append({'id': cid, 'nid': nid, 'did': home, 'mid': note.mid, 'ord': ord_,
                  'type': ctype, 'queue': hq, 'due': hdue, 'ivl': ivl, 'factor': factor, 'reps': reps,
                  'lapses': lapses, 'left': left, 'flags': flags, 'mod': mod, 'nmod': note.mod, 'data': cdata,
                  'tags': note.tags, 'q': q, 'a': a, 'qav': av(out.question_av_tags), 'aav': av(out.answer_av_tags),
                  'sfld': sort_text(note, note.note_type()), 'tname': (card.template() or {}).get('name', ''),
                  **({'typ': type_info(card, note, q)} if TYPE_PAT.search(q) else {})})
print('cards', len(cards), 'secs', round(time.time() - t0, 1))
if not cards: die('書き出すカードが0枚でした。exclude_top_decks で全部を除いていないか確かめてください。')
keep_cids = {c['id'] for c in cards}
revlog = [r for r in col.db.all("select id, cid, ease, ivl, lastIvl, factor, time, type from revlog") if r[1] in keep_cids]
# ノートタイプ（端末でノートを追加・編集するときに、テンプレートからカードを描くので、全部のノートタイプの中身も配る）
# x … アプリでは使わない Anki の値（.apkg・.colpkg に書き出すときに戻す）。フィールド・テンプレートの id は 64 ビットなので文字列にする（JavaScript で丸まらないように）
def extras(d, known):
    return {k: (str(v) if k in ('id', 'originalId') and isinstance(v, int) else v) for k, v in d.items() if k not in known}
NT_KNOWN = {'id', 'name', 'css', 'type', 'sortf', 'flds', 'tmpls'}
FLD_KNOWN = {'name', 'ord', 'excludeFromSearch', 'font', 'size', 'sticky', 'rtl', 'plainText', 'description'}
TMPL_KNOWN = {'name', 'ord', 'qfmt', 'afmt', 'did'}
notetypes = {}
for m in col.models.all():
    css = m['css']
    notetypes[m['id']] = {'name': m['name'], 'css': css, 'type': m['type'], 'sortf': m.get('sortf', 0),
                          'fields': [{'name': f['name'], 'ord': f['ord'], 'excludeFromSearch': bool(f.get('excludeFromSearch')), 'font': f.get('font', 'Arial'), 'size': f.get('size', 20),
                                      'sticky': bool(f.get('sticky')), 'rtl': bool(f.get('rtl')), 'plainText': bool(f.get('plainText')), 'description': f.get('description', ''), 'x': extras(f, FLD_KNOWN)} for f in m['flds']],
                          'templates': [{'name': t['name'], 'ord': t['ord'], 'qfmt': t['qfmt'], 'afmt': t['afmt'], 'did': t.get('did'), 'x': extras(t, TMPL_KNOWN)} for t in m['tmpls']],
                          'used': m['id'] in nt_used, 'x': extras(m, NT_KNOWN)}
    if m['id'] in nt_used:
        for u in re.findall(r'url\(["\']?([^"\')]+)["\']?\)', m['css']): media[u] += 1
used_conf = {decks[did].get('conf') for did in keep_deck}
presets = {c['id']: c for c in col.decks.all_config() if c['id'] in used_conf}
conf_keys = ['savedFilters', 'flagLabels', 'rollover', 'collapseTime', 'newCardsIgnoreReviewLimit', 'dayLearnFirst', 'newSpread', 'applyAllParentLimits', 'creationOffset', 'localOffset', 'fsrs',
             'loadBalancerEnabled', 'fsrsShortTermWithStepsEnabled', 'sched2021', 'nextPos', 'ignoreAccentsInSearch', 'normalize_note_text', 'curDeck', 'restorePositionReviewer', 'resetCountsReviewer', 'randomOrderReposition', 'shiftPositionOfExistingCards', 'setDueReviewer', 'curModel',
             'lastFsrsOptimize', 'fsrsHealthCheck', 'fsrsLegacyEvaluate']
conf_keys += [f'_nt_{m["id"]}_lastDeck' for m in col.models.all()]   # ノートタイプごとに最後に足したデッキ（端末でノートタイプを変えたときに、新しいカードを入れるデッキ。rslib の get_last_deck_added_to_for_notetype）
meta = {'exported_at': int(time.time()), 'source': os.path.basename(SRC), 'crt': col.crt, 'config': {k: col.get_config(k, None) for k in conf_keys},
        'decks': [decks[d] for d in sorted(keep_deck, key=lambda d: decks[d]['name'])], 'presets': presets, 'notetypes': notetypes,
        # Anki のフィルターデッキ（中のカードが移すデッキにあるものだけ。中のカードの印は cards の data.flt）
        'fdecks': [fdeck_def(decks[did]) for did in sorted({c['data']['flt']['d'] for c in cards if 'flt' in c['data']})],
        # 負荷分散（rslib load_balancer.rs）は同じプリセットの全カードを数えるので、移していないデッキのカードの期日も送る（[期日, プリセット, ノート]）
        'lbExtra': [[due, decks[did].get('conf'), nid] for (cid, nid, did, due) in col.db.all("select id, nid, did, due from cards")
                    if did in decks and not decks[did].get('dyn') and did not in keep_deck and decks[did].get('conf') in used_conf
                    and col.sched.today <= due < col.sched.today + 130]}
mdir = expand(cfg.get('anki_media_dir') or '') or col.media.dir()   # 写しの横の collection.media は空なので、本物の場所で大きさを見る
mlist = []
for f in sorted(media):
    p = os.path.join(mdir, f)
    mlist.append({'name': f, 'refs': media[f], 'size': os.path.getsize(p) if os.path.exists(p) else None})
keep_nids = {c['nid'] for c in cards}
# [id, mid, flds, sfld, csum, tags, mod, guid]（guid は .apkg に書き出したとき、Anki が同じノートだと分かるように）
notes = [list(r) for r in col.db.all('select id, mid, flds, sfld, csum, tags, mod, guid from notes') if r[0] in keep_nids]
json.dump(notes, open(f'{OUT}/notes.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(meta, open(f'{OUT}/meta.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(cards, open(f'{OUT}/cards.json', 'w', encoding='utf-8'), ensure_ascii=False)
json.dump(revlog, open(f'{OUT}/revlog.json', 'w', encoding='utf-8'))
json.dump(mlist, open(f'{OUT}/media.json', 'w', encoding='utf-8'), ensure_ascii=False)
tops = collections.Counter(top(c['did']) for c in cards)
print('decks', len(keep_deck), 'presets', len(presets), 'notetypes', len(notetypes), 'revlog', len(revlog), 'media', len(mlist), 'missing(コピーに無い)', sum(1 for m in mlist if m['size'] is None))
print('最上位デッキごと', tops.most_common())
col.close()
