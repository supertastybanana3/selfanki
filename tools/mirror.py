# 暗記（このアプリ）⇔ パソコンの Anki の書き戻し。毎晩などに決まった時刻で動かす（README の「手順 8」）。手で動かすときは
#   python tools/mirror.py            本番（Anki に書く・サーバーに送る・中身が変わっていれば Pages に上げ直す）
#   python tools/mirror.py --dry      何をするかだけ数える（Anki にもサーバーにも書かない）
# 前提: このパソコンで Anki が起動していて、アドオン AnkiConnect が入っている。動いている間は Anki で勉強・編集しない
# 流れ:
#   1. （ankiweb_sync が true なら）Anki を AnkiWeb と同期 → 端末で編集・削除したノートを Anki に書く → コレクションの写しを取る（書く前の控えを兼ねる。cloud/state/snap に20個まで）
#      端末で追加したノートと、カードが増える編集は書かない（AnkiConnect ではノート・カードの id を端末と合わせられないため。Anki のアドオン「暗記と同期」で入る）
#   2. 写しから自作アプリ用に書き出す（export_bundle.py）＝ Anki 側の今の状態
#   3. サーバー側の今の状態＝移行時点（state/base.json）＋ D1 の差分
#   4. カードごとに比べて、違っていれば新しいほうを正にする（新しさ: アプリ＝最後に答えた時刻、Anki＝カードの mod と最後の記録の遅いほう）
#        アプリが新しい → Anki に書く（setSpecificValueOfCard。記憶の値もそのまま）
#        Anki が新しい（AnkiMobile で解いた・Anki で直した・新しいカード）→ サーバーに送る
#      記録（revlog）は両方の和にする（アプリの記録は insertReviews で Anki へ、Anki の記録はサーバーへ）
#   5. （ankiweb_sync なら）Anki を同期 → もう一度写しを取って、書いたカードが狙いどおりか確かめる
#   6. カードの中身・デッキ・画像が変わっていれば site を組み直して Pages に上げる
import json, os, sys, time, subprocess, sqlite3, urllib.request, traceback, datetime, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import common
from common import *
import snapshot, build_site
import importlib.util
# どちらを正にするかの決まりは、アドオン（addon/selfanki_sync/core.py の plan）と同じものを使う
_spec = importlib.util.spec_from_file_location('selfanki_addon_core', os.path.join(ROOT, 'addon', 'selfanki_sync', 'core.py'))
acore = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(acore)
try:
    CFG = load_config(required=('project_name', 'anki_collection'))
    API = site_url(CFG) + '/api/'
    TOKEN = read_token(CFG)
except SetupError as e: die(str(e))
def ac(action, **params): return common.ac(CFG, action, **params)
class _Snap:
    @staticmethod
    def sync_anki():
        # 試し（--dry）では同期しない。ankiweb_sync は true/false（文字列の "false" などはまちがいとして止める）
        v = CFG.get('ankiweb_sync', False)
        if not isinstance(v, bool): raise SetupError('config.json の "ankiweb_sync" は true か false で書いてください（"" で囲まない）。')
        if v and not DRY: ac('sync'); time.sleep(5)
    @staticmethod
    def take(tag=''):
        info = snapshot.take(CFG, tag); info['local'] = info['dir'] = info['path']; return info
snap = _Snap
ST = STATE
os.makedirs(ST, exist_ok=True)
DRY = '--dry' in sys.argv
STATE_KEYS = ['type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left', 'data']
LOG = open(os.path.join(ST, 'mirror.log'), 'a', encoding='utf-8')
def log(*a):
    s = f"[{datetime.datetime.now():%m-%d %H:%M:%S}] " + ' '.join(str(x) for x in a)
    print(s, flush=True); LOG.write(s + '\n'); LOG.flush()

def api(path, body=None):
    req = urllib.request.Request(API + path, data=None if body is None else json.dumps(body).encode(), method='GET' if body is None else 'POST',
                                 headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json', 'User-Agent': 'selfanki-mirror'})
    for i in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r: return json.loads(r.read())
        except Exception as e:
            if i == 4: raise
            log('API やり直し', path[:40], e); time.sleep(5 * (i + 1))

# ---- サーバー側の今の状態 ----
def server_view():
    """D1 の差分を手元の写し（state/srv_cache.json）に足してから、移行時点の状態に重ねる"""
    cp = os.path.join(ST, 'srv_cache.json')
    base = json.load(open(os.path.join(ST, 'base.json'), encoding='utf-8'))
    cache = json.load(open(cp, encoding='utf-8')) if os.path.exists(cp) else {}
    if cache.get('base_at') != base['at']: cache = {'base_at': base['at'], 'cur': [0, 0, 0, 0], 'cards': {}, 'revlog': {}}
    cs, ci, rs, ri = cache['cur']
    while True:
        j = api(f'pull?cs={cs}&ci={ci}&rs={rs}&ri={ri}&ns={2 ** 53 - 1}&n=5000')   # ノートは server_notes で別に読む
        for (id_, st, rev, src, seq) in j['cards']: cache['cards'][str(id_)] = [json.loads(st), rev, src, seq]; cs, ci = seq, id_
        for row in j['revlog']: cache['revlog'][str(row[0])] = row; rs, ri = row[10], row[0]
        if not j['more']: break
    cache['cur'] = [cs, ci, rs, ri]; cache['seq'] = j['seq']
    json.dump(cache, open(cp + '.tmp', 'w', encoding='utf-8')); os.replace(cp + '.tmp', cp)
    cards = {}
    for row in base['state']:
        cards[row[0]] = {'st': dict(zip(STATE_KEYS, row[1:10])), 'rev': row[10], 'src': 'base'}
    for k, (st, rev, src, seq) in cache['cards'].items(): cards[int(k)] = {'st': st, 'rev': rev, 'src': src}
    revs = {r[0]: {'id': r[0], 'cid': r[1], 'ease': r[2], 'ivl': r[3], 'lastIvl': r[4], 'factor': r[5], 'time': r[6], 'type': r[7], 'src': 'base', 'del': 0} for r in base['revlog']}
    for k, r in cache['revlog'].items():
        revs[int(k)] = {'id': r[0], 'cid': r[1], 'ease': r[2], 'ivl': r[3], 'lastIvl': r[4], 'factor': r[5], 'time': r[6], 'type': r[7], 'src': r[8], 'del': r[9]}
    return cards, revs, cache['seq']

def same(a, b):
    """a＝サーバー側、b＝Anki 側。間隔・期日・記憶の値に加えて、サーバー側にフラグがあればフラグも比べる（マークは別に比べる）"""
    for k in ('type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left'):
        if a.get(k) != b.get(k): return False
    if 'flags' in a and (a['flags'] & 7) != (b.get('flags', 0) & 7): return False
    da, db = a.get('data') or {}, b.get('data') or {}
    for k, tol in (('s', 2e-4), ('d', 2e-3)):
        x, y = da.get(k), db.get(k)
        if (x is None) != (y is None): return False
        if x is not None and abs(x - y) > tol * max(1.0, abs(x)): return False
    return da.get('lrt') == db.get('lrt')

def anki_params(cid, st, odid):
    d = st.get('data') or {}
    keys = ['type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left']
    vals = [st[k] for k in keys]
    keys += ['memory_state', 'desired_retention', 'decay', 'last_review_time']
    vals += [{'stability': d['s'], 'difficulty': d['d']} if d.get('s') is not None and d.get('d') is not None else None, d.get('dr'), d.get('decay'), d.get('lrt')]
    if d.get('pos') is not None: keys.append('original_position'); vals.append(d['pos'])
    if 'flags' in st: keys.append('flags'); vals.append(st['flags'])
    if odid: keys += ['did', 'odid', 'odue']; vals += [st.get('did') or odid, 0, 0]  # フィルターデッキに入っていたら元のデッキに戻してから書く
    elif st.get('did'): keys.append('did'); vals.append(st['did'])   # 端末でデッキを変えたカード
    return {'card': cid, 'keys': keys, 'newValues': vals, 'warning_check': True}

# ---- 端末で追加・編集・削除したノート（サーバーの notes 表） ----
def server_notes():
    big = 2 ** 53 - 1; ns = ni = 0; out = {}
    while True:   # カードと記録の続きの位置は端に置いて、ノートだけを読む
        j = api(f'pull?cs={big}&ci={big}&rs={big}&ri={big}&ns={ns}&ni={ni}&n=5000')
        for (id_, mid, flds, tags, did, cards, rev, src, dl, added, seq) in j.get('notes', []):
            out[id_] = {'id': id_, 'mid': mid, 'flds': json.loads(flds), 'tags': tags, 'did': did, 'cards': json.loads(cards), 'rev': rev, 'src': src, 'del': dl, 'added': added}; ns, ni = seq, id_
        if not j.get('notes') or not j['more']: break
    return out

def apply_notes():
    """決まりはアドオン（core.apply_notes）と同じ「新しいほう」＝端末の記録の rev と Anki のノートの mod。編集（カードが増えないもの）と削除だけを書く"""
    recs = server_notes(); n = {'updated': 0, 'removed': 0, 'gone_in_anki': 0, 'anki_newer': 0, 'need_addon': 0}
    if not recs: return n
    ids = list(recs); info = []
    for i in range(0, len(ids), 200): info += ac('notesInfo', notes=ids[i:i + 200])
    push = []; now = int(time.time() * 1000)
    for rec, inf in zip(recs.values(), info):
        have = bool(inf and inf.get('noteId')); mod = (inf or {}).get('mod', 0) if have else None
        if rec['del']:
            if have and rec['rev'] > mod * 1000:
                if not DRY: ac('deleteNotes', notes=[rec['id']])
                n['removed'] += 1
            continue
        if not have:
            if rec['added'] and rec['src'] != 'anki': n['need_addon'] += 1; continue
            n['gone_in_anki'] += 1   # Anki で消してある → 端末でも消す
            push.append({'t': 'note', 'src': 'anki', 'n': {**{k: rec[k] for k in ('id', 'mid', 'flds', 'tags', 'did', 'cards', 'added')}, 'rev': max(now, rec['rev'] + 1), 'del': 1}})
            continue
        if rec['rev'] <= mod * 1000:
            if rec['src'] == 'app': n['anki_newer'] += 1
            continue
        names = sorted(inf['fields'], key=lambda k: inf['fields'][k]['order'])
        if set(c[0] for c in rec['cards']) - set(inf.get('cards') or []) or len(names) != len(rec['flds']):
            n['need_addon'] += 1; continue   # カードが増える編集・ノートタイプが変わっている
        if not DRY: ac('updateNote', note={'id': rec['id'], 'fields': dict(zip(names, rec['flds'])), 'tags': rec['tags'].split()})
        n['updated'] += 1
    if push and not DRY: api('push', {'ops': push})
    if n['need_addon']: log('端末で追加したノート・カードが増える編集', n['need_addon'], '件は、Anki のアドオン「暗記と同期」で入れる（ここでは書かない）')
    return n

def count_decks():
    """端末で作った・名前を変えた・消したデッキ（conf の dname:<id>）は、AnkiConnect ではデッキの id を端末と合わせられないので書かない。数えてログに出すだけ
    （Anki に入れるのはアドオン「暗記と同期」。手順 8-A）"""
    rows = api('pull?cs=999999999999&ci=0&rs=999999999999&ri=0&n=1').get('conf', [])
    n = sum(1 for k, v, rev, src, _ in rows if k.startswith('dname:') and src == 'app')
    if n: log(f'端末で作った・名前を変えた・消したデッキが {n} 件あります。Anki に入れるにはアドオン「暗記と同期」を使ってください（この書き戻しでは書きません）')
    return n


def apply_conf(exp):
    """アプリで変えたデッキのオプション（サーバーの conf 表、src='app'）を Anki に書く。
    プリセットの中身は saveDeckConfig、アプリで作ったプリセットは cloneDeckConfigId で作ってから、デッキへの割り当ては setDeckConfigId。
    デッキごとの上限（このデッキ／今日だけ）と全体の設定は AnkiConnect で書けないのでアプリの中だけ"""
    meta = json.load(open(os.path.join(exp, 'meta.json'), encoding='utf-8'))
    presets = {int(k): v for k, v in meta['presets'].items()}
    decks = {d['id']: d for d in meta['decks']}
    rows = api('pull?cs=999999999999&ci=0&rs=999999999999&ri=0&n=1').get('conf', [])
    now = int(time.time() * 1000); remap = {}; push = []; n = {'preset': 0, 'new': 0, 'removed': 0, 'deck': 0}
    for k, v, rev, src, _ in rows:
        if src != 'app' or not k.startswith('preset:'): continue
        pid = int(k[7:]); v = json.loads(v)
        if v.get('removed'):
            # プリセットの削除は Anki の次の同期を一方向にすることがあるので、自動ではしない（ログに出すだけ）
            if pid in presets and pid != 1 and rev > presets[pid].get('mod', 0) * 1000: log('アプリで消したプリセット（Anki では手で消す）:', presets[pid].get('name'), pid); n['removed'] += 1
            continue
        if pid in presets:
            if rev > presets[pid].get('mod', 0) * 1000:
                cfg = {**presets[pid], **v, 'id': pid}; cfg.pop('mod', None)
                if ac('saveDeckConfig', config=cfg): n['preset'] += 1
        else:
            nid = ac('cloneDeckConfigId', name=v.get('name') or 'プリセット', cloneFrom=1)
            if nid:
                cfg = {**v, 'id': nid}; cfg.pop('mod', None); ac('saveDeckConfig', config=cfg); remap[pid] = nid; n['new'] += 1
                push += [{'t': 'conf', 'src': 'anki', 'k': k, 'v': {'removed': True}, 'rev': now}, {'t': 'conf', 'src': 'anki', 'k': f'preset:{nid}', 'v': cfg, 'rev': now}]
    for k, v, rev, src, _ in rows:
        if not k.startswith('deck:'): continue
        did = int(k[5:]); v = json.loads(v); d = decks.get(did)
        if not d or 'conf' not in v: continue
        conf = remap.get(v['conf'], v['conf'])
        if conf != v['conf']: push.append({'t': 'conf', 'src': 'anki', 'k': k, 'v': {**v, 'conf': conf}, 'rev': now})
        if src == 'app' and d['conf'] != conf and rev > d.get('mod', 0) * 1000:
            if ac('setDeckConfigId', decks=[d['name']], configId=conf): n['deck'] += 1
    if push: api('push', {'ops': push})
    return n

def check_profile():
    """AnkiConnect が今開いている Anki のプロファイルが、config.json の anki_collection のプロファイルと同じかを確かめる（違えば止める）"""
    want = os.path.basename(os.path.dirname(expand(CFG['anki_collection'])))
    try: cur = ac('getActiveProfile')
    except RuntimeError: raise SetupError('AnkiConnect が古く、Anki で開いているプロファイルを確かめられません。Anki の「ツール」→「アドオン」で AnkiConnect を新しくしてください。')
    if cur != want:
        raise SetupError(f'Anki で開いているプロファイル「{cur}」が、config.json の anki_collection のプロファイル「{want}」と違います。Anki でプロファイルを切り替えてから、もう一度動かしてください。')

def lock(on):
    # config.json の lock_command（コマンドの配列）があれば、書き戻しの前後に「on」「off」を付けて呼ぶ（ほかの道具が同じ時刻に Anki を触らないようにするためのもの。無ければ何もしない）
    cmd = CFG.get('lock_command')
    if DRY or not cmd: return
    r = subprocess.run(list(cmd) + ['on' if on else 'off'], capture_output=True, text=True, timeout=300); log('lock', 'on' if on else 'off', (r.stdout + r.stderr).strip()[-200:])

def main():
    t0 = time.time(); summary = {'start': int(t0), 'dry': DRY}
    ac('version'); check_profile()   # 試しでも、AnkiConnect とプロファイルは確かめる（読むだけ）
    lock(True)
    try:
        # 0. 同期する前に、今のコレクションの控えを取る（同期や書き戻しで困ったときに戻せるように）
        if CFG.get('ankiweb_sync') is True and not DRY: b0 = snap.take('before_sync'); log('同期の前の控え', b0['path'])
        # 1. 同期 → 写し
        snap.sync_anki()
        try: nnote = apply_notes(); summary['notes'] = nnote; log('ノート', nnote)
        except Exception as e: log('ノートを書けなかった（続ける）', repr(e)); summary['note_fail'] = repr(e)[:200]
        try: summary['decks_need_addon'] = count_decks()
        except Exception as e: log('デッキの記録を読めなかった（続ける）', repr(e))
        info = snap.take('mirror'); log('写し', info['dir'], 'カード', info['cards'], '記録', info['revlog'])
        # 2. 書き出し
        exp = os.path.join(ST, 'export_new')
        r = subprocess.run([sys.executable, os.path.join(HERE, 'export_anki.py'), info['local'], exp], cwd=ROOT, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=1800)
        if r.returncode: raise RuntimeError('書き出し失敗: ' + r.stderr[-800:])
        log('書き出し', next((l for l in r.stdout.splitlines() if l.startswith('cards')), '?'))
        acards = {c['id']: c for c in json.load(open(os.path.join(exp, 'cards.json'), encoding='utf-8'))}
        arevlog = json.load(open(os.path.join(exp, 'revlog.json'), encoding='utf-8'))
        db = sqlite3.connect(info['local'])
        anki_rev_ids = {x for (x,) in db.execute('select id from revlog')}
        odid = dict(db.execute('select id, odid from cards where odid != 0'))
        db.close()
        last = {}
        for rr in arevlog: last[rr[1]] = max(last.get(rr[1], 0), rr[0])
        aver = {cid: max(c['mod'] * 1000, last.get(cid, 0)) for cid, c in acards.items()}
        # 3. サーバー側
        scards, srevs, seq0 = server_view(); log('サーバー', 'seq', seq0, '差分のカード', sum(1 for v in scards.values() if v['src'] != 'base'))
        # 4. 比べる（決まりはアドオンと同じ: 相手の知らない新しい答えがある側を正に。最後の答えが同じなら新しく変えたほう）
        to_srv, new_srv, view = [], 0, {}
        for cid, c in acards.items():
            tl = [t.lower() for t in c['tags']]
            ast = {k: c[k] for k in STATE_KEYS}; ast['flags'] = c['flags']; ast['mark'] = int('marked' in tl); ast['did'] = c['did']
            if cid not in scards: to_srv.append((cid, ast, aver[cid], last.get(cid, 0))); new_srv += 1; continue   # 移したあとに Anki で足したカード
            view[cid] = {'st': ast, 'nid': c['nid'], 'odid': odid.get(cid, 0), 'nmod': c.get('nmod', 0), 'leech': 'leech' in tl, 'ver': aver[cid]}
        p = acore.plan(scards, srevs, view, anki_rev_ids, [rr for rr in arevlog if rr[1] in view])
        to_anki, to_srv = p['to_anki'], p['to_srv'] + to_srv
        mark_add, mark_del, leech_nids, rev_to_anki = set(p['mark_add']), set(p['mark_del']), p['leech'], p['rev_to_anki']
        rev_to_srv = [{'id': rr[0], 'cid': rr[1], 'ease': rr[2], 'ivl': rr[3], 'lastIvl': rr[4], 'factor': rr[5], 'time': rr[6], 'type': rr[7]} for rr in arevlog if rr[0] not in srevs]
        summary.update(to_anki=len(to_anki), rev_to_anki=len(rev_to_anki), to_srv=len(to_srv), new_srv=new_srv, rev_to_srv=len(rev_to_srv), leech=len(leech_nids))
        log('比べた: Anki へ カード', len(to_anki), '記録', len(rev_to_anki), '／サーバーへ カード', len(to_srv), f'(うち新しいカード {new_srv})', '記録', len(rev_to_srv), '／リーチの印', len(leech_nids))
        if DRY:
            for cid, st, rev in to_anki[:5]: log('  例 Anki へ', cid, {k: st[k] for k in ('type', 'queue', 'due', 'ivl', 'reps')}, '←', {k: acards[cid][k] for k in ('type', 'queue', 'due', 'ivl', 'reps')})
            for cid, st, _, _ in to_srv[:5]: log('  例 サーバーへ', cid, {k: st[k] for k in ('type', 'queue', 'due', 'ivl', 'reps')})
            return summary
        # 5. Anki に書く（カード → 記録。記録を先に入れて途中で止まると、次の回で「Anki のほうが新しい」に見えてしまう）
        bad = []
        for i in range(0, len(to_anki), 100):
            part = to_anki[i:i + 100]
            res = ac('multi', actions=[{'action': 'setSpecificValueOfCard', 'params': anki_params(cid, st, odid.get(cid, 0))} for cid, st, _ in part])
            for (cid, _, _), x in zip(part, res):
                # multi の中身は版によって [True] のままか {'result': [True], 'error': None} で返る
                ok = x == [True] or (isinstance(x, dict) and not x.get('error') and x.get('result') == [True])
                if not ok: bad.append((cid, x))
        if bad: log('Anki に書けなかったカード', len(bad), bad[:3])
        if rev_to_anki:
            rows = [[r['id'], r['cid'], -1, r['ease'], r['ivl'], r['lastIvl'], r['factor'], r['time'], r['type']] for r in sorted(rev_to_anki, key=lambda r: r['id'])]
            for i in range(0, len(rows), 500): ac('insertReviews', reviews=rows[i:i + 500])
        if leech_nids: ac('addTags', notes=leech_nids, tags='leech')
        if mark_add: ac('addTags', notes=sorted(mark_add), tags='marked')
        if mark_del: ac('removeTags', notes=sorted(mark_del), tags='marked')
        summary.update(mark_add=len(mark_add), mark_del=len(mark_del))
        # 5b. デッキのオプション
        try: nconf = apply_conf(exp); summary['conf'] = nconf; log('オプション', nconf)
        except Exception as e: log('オプションを書けなかった（続ける）', repr(e)); summary['conf_fail'] = repr(e)[:200]
        summary['anki_write_fail'] = len(bad)
        # サーバーに送る（Anki 側のほうが新しかったもの）
        ops = [{'t': 'state', 'src': 'anki', 'c': {'id': cid, 'st': st, 'rev': rev}, 'base': base} for cid, st, rev, base in to_srv]
        ops += [{'t': 'rev', 'src': 'anki', 'r': r} for r in rev_to_srv]
        for i in range(0, len(ops), 500): api('push', {'ops': ops[i:i + 500]})
        if to_anki or rev_to_anki or mark_add or mark_del or any((summary.get('conf') or {}).values()):
            snap.sync_anki()
            # 確かめる: もう一度写しを取って、書いたカードの値と記録を読む
            info2 = snap.take('after'); db = sqlite3.connect(info2['local'])
            ng = 0
            for cid, st, _ in to_anki:
                row = db.execute('select type, queue, due, ivl, factor, reps, lapses, left, data, odid, odue, flags from cards where id = ?', (cid,)).fetchone()
                got = dict(zip(['type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left'], row[:8])); got['data'] = json.loads(row[8] or '{}'); got['flags'] = row[11]
                if not same(st, got): ng += 1; ng <= 3 and log('  書いた値が違う', cid, st, got)
            ids = {x for (x,) in db.execute('select id from revlog')}
            miss = sum(1 for r in rev_to_anki if r['id'] not in ids)
            db.close()
            summary.update(verify_card_ng=ng, verify_rev_missing=miss)
            log('確かめた: 値が違うカード', ng, '入っていない記録', miss)
        # 6. 中身（カード・デッキ・画像）やアプリ本体が変わっていれば site を組み直して上げる
        cur = os.path.join(ST, 'export')
        if os.path.exists(cur):
            prev = os.path.join(ST, 'export.prev')
            if os.path.exists(prev): shutil.rmtree(prev)
            os.replace(cur, prev)
        os.replace(exp, cur)
        build_site.build(cur, log=log)
        k = build_site.site_key(); kp = os.path.join(ST, 'deployed_key.txt')
        if not os.path.exists(kp) or open(kp, encoding='utf-8').read() != k:
            ok = build_site.deploy(log)
            if ok: open(kp, 'w', encoding='utf-8').write(k)
            summary['deployed'] = ok
        summary['ok'] = not bad and not summary.get('verify_card_ng') and not summary.get('verify_rev_missing') and summary.get('deployed', True) is not False and not summary.get('conf_fail') and not summary.get('note_fail')
        return summary
    finally:
        lock(False)
        summary['secs'] = round(time.time() - t0)
        if not DRY: json.dump(summary, open(os.path.join(ST, 'last_mirror.json'), 'w', encoding='utf-8'), ensure_ascii=False)

if __name__ == '__main__':
    try:
        res = main(); log('終わり', json.dumps(res, ensure_ascii=False))
        if not res.get('dry') and not res.get('ok'): sys.exit(1)   # どこかがうまくいかなかった（ログの「失敗」「違う」「上げられなかった」の行を見る）
    except SystemExit: raise
    except SetupError as e:
        log('止まった', str(e))
        json.dump({'ok': False, 'error': str(e), 'at': int(time.time())}, open(os.path.join(ST, 'last_mirror.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        die(str(e))
    except Exception as e:
        log('失敗', repr(e), traceback.format_exc()[-1500:])
        json.dump({'ok': False, 'error': repr(e), 'at': int(time.time())}, open(os.path.join(ST, 'last_mirror.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        sys.exit(1)
