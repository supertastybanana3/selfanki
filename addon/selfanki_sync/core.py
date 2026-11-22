# 暗記（自分の Cloudflare）と、いま開いている Anki のコレクションのあいだで、学習の状態と記録をやり取りする。
# カードの中身は送らない（Anki で変えた中身は export_anki.py → build_site.py で配る）。暗記の端末で追加・編集・削除したノートは Anki に書く。
# Anki の中（アドオン）からも、Python の anki パッケージからも呼べるように、画面の部品は使わない。
# 決まりは tools/mirror.py と同じ: カードごとに新しいほうを正にする。新しさは、暗記の側＝最後に答えた時刻、Anki の側＝カードの更新時刻と最後の記録の遅いほう
import hashlib, json, os, time, urllib.request, urllib.error, urllib.parse

STATE_KEYS = ['type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left', 'data']
UA = 'selfanki-anki-addon'


class SyncError(Exception):
    """止めて、利用者に知らせること"""


# ---------- サーバー ----------
class Server:
    def __init__(self, site_url, token):
        self.base = site_url.rstrip('/')
        self.token = token

    def _req(self, path, body=None):
        data = None if body is None else json.dumps(body).encode('utf-8')
        req = urllib.request.Request(self.base + path, data=data, method='GET' if body is None else 'POST',
                                     headers={'Authorization': f'Bearer {self.token}', 'Content-Type': 'application/json', 'User-Agent': UA})
        for i in range(4):
            try:
                with urllib.request.urlopen(req, timeout=120) as r: return r.read()
            except urllib.error.HTTPError as e:
                if e.code == 401: raise SyncError('暗記のサーバーに入れませんでした（合言葉が違う）。「ツール」→「暗記」→「つなぐ」で番号を入れ直してください。')
                if i == 3 or e.code < 500: raise SyncError(f'暗記のサーバーがエラーを返しました（{e.code} {path.split("?")[0]}）。')
            except OSError as e:
                if i == 3: raise SyncError(f'暗記のサーバーにつながりません（{e}）。ネットを確かめてください。')
            time.sleep(3 * (i + 1))

    def json(self, path, body=None):
        return json.loads(self._req(path, body))

    def push(self, ops):
        for i in range(0, len(ops), 500): self.json('/api/push', {'ops': ops[i:i + 500]})


def site_origin(site_url):
    """サイトの住所を「https://名前」の形にそろえる（pair_code.py が出す …/pair を貼っても通るように、後ろの道筋は捨てる）。
    http は手元の試験（127.0.0.1・localhost）だけ"""
    u = urllib.parse.urlsplit(site_url.strip())
    host = (u.hostname or '').lower()
    if u.scheme == 'https' and host: pass
    elif u.scheme == 'http' and host in ('127.0.0.1', 'localhost', '::1'): pass
    else: raise SyncError('暗記のサイトの住所は https:// から書いてください。')
    if u.username or u.password: raise SyncError('暗記のサイトの住所に、名前やパスワードは入れないでください。')
    return f'{u.scheme}://{u.netloc}'


def pair(site_url, code):
    """6桁の番号を /pair に送り、返ってきたクッキーから合言葉を受け取る（合言葉を人が見たり貼ったりしなくてよい）"""
    site_url = site_origin(site_url)
    body = urllib.parse.urlencode({'c': code.strip()}).encode()
    req = urllib.request.Request(site_url + '/pair', data=body, method='POST', headers={'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA})

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    try:
        r = urllib.request.build_opener(NoRedirect).open(req, timeout=60); headers = r.headers; status = r.status
    except urllib.error.HTTPError as e:
        headers, status = e.headers, e.code
    except OSError as e:
        raise SyncError(f'暗記のサイトにつながりません（{e}）。')
    for v in headers.get_all('Set-Cookie') or []:
        part = v.split(';', 1)[0]
        if part.startswith('sa='): return part[3:]
    if status == 403: raise SyncError('番号が違うか、期限が切れています。パソコンで python tools/pair_code.py を動かして出し直してください。')
    raise SyncError(f'つなげませんでした（{status}）。住所が正しいか確かめてください。')


def server_view(srv):
    """サーバー側の今の状態＝配った移行時点の状態（と、あとから足したカードの分）＋ D1 の差分"""
    man = srv.json('/bundle/manifest.json')
    cards, revs = {}, {}
    for row in srv.json('/bundle/' + man['base']['state']):
        cards[row[0]] = {'st': dict(zip(STATE_KEYS, row[1:10])), 'rev': row[10], 'src': 'base'}
    for r in srv.json('/bundle/' + man['base']['revlog']):
        revs[r[0]] = {'id': r[0], 'cid': r[1], 'ease': r[2], 'ivl': r[3], 'lastIvl': r[4], 'factor': r[5], 'time': r[6], 'type': r[7], 'src': 'base', 'del': 0}
    if man['base'].get('add'):
        add = srv.json('/bundle/' + man['base']['add'])
        for row in add['state']:
            cards.setdefault(row[0], {'st': dict(zip(STATE_KEYS, row[1:10])), 'rev': row[10], 'src': 'base'})
        for r in add['revlog']:
            revs.setdefault(r[0], {'id': r[0], 'cid': r[1], 'ease': r[2], 'ivl': r[3], 'lastIvl': r[4], 'factor': r[5], 'time': r[6], 'type': r[7], 'src': 'base', 'del': 0})
    cs = ci = rs = ri = ns = ni = 0; conf = []; notes = {}
    while True:
        j = srv.json(f'/api/pull?cs={cs}&ci={ci}&rs={rs}&ri={ri}&ns={ns}&ni={ni}&n=5000')
        for (id_, st, rev, src, seq) in j['cards']: cards[id_] = {'st': json.loads(st), 'rev': rev, 'src': src}; cs, ci = seq, id_
        for r in j['revlog']:
            revs[r[0]] = {'id': r[0], 'cid': r[1], 'ease': r[2], 'ivl': r[3], 'lastIvl': r[4], 'factor': r[5], 'time': r[6], 'type': r[7], 'src': r[8], 'del': r[9]}
            rs, ri = r[10], r[0]
        # 端末で追加・編集・削除したノート（cards は [[カードの id, ord, デッキ, 新規の位置], …]）
        # guid（端末で作ったノートの guid）・imp（.apkg から読み込んだノート）は、あとから足した列（古いサーバーは返さない）
        for row in j.get('notes', []):
            (id_, mid, flds, tags, did, ncards, rev, src, dl, added, seq) = row[:11]
            notes[id_] = {'id': id_, 'mid': mid, 'flds': json.loads(flds), 'tags': tags, 'did': did, 'cards': json.loads(ncards), 'rev': rev, 'src': src, 'del': dl, 'added': added,
                          'guid': row[11] if len(row) > 11 else None, 'imp': row[12] if len(row) > 12 else 0}
            ns, ni = seq, id_
        conf = j.get('conf', [])
        if not j['more']: break
    return cards, revs, conf, notes


# ---------- Anki ----------
def home_state(ctype, queue, due, odid, odue, data, did):
    """フィルターデッキに入っているカードは、元のデッキでの queue・due（空にしたときの値）を状態に、フィルターデッキの中での
    due・queue を data.flt に入れる（tools/export_anki.py の home_state と同じ。アプリはこの印でフィルターデッキに出す）"""
    d = json.loads(data) if data else {}
    if not odid: return queue, due, d
    hdue = odue if odue != 0 else due
    hq = queue
    if queue >= 0: hq = 0 if ctype == 0 else 2 if ctype == 2 else (1 if hdue > 1_000_000_000 else 3)
    d['flt'] = {'d': did, 'due': due, 'q': queue}
    return hq, hdue, d


def anki_view(col, ids):
    """Anki 側の今の状態（サーバーが知っているカードだけ）。フィルターデッキに入っているカードは元のデッキの期日で見る"""
    notes = {nid: (tags, mod) for nid, tags, mod in col.db.all('select id, tags, mod from notes')}
    last = dict(col.db.all('select cid, max(id) from revlog group by cid'))
    out = {}
    for (cid, nid, did, odid, ctype, queue, due, odue, ivl, factor, reps, lapses, left, flags, mod, data) in col.db.all(
            'select id, nid, did, odid, type, queue, due, odue, ivl, factor, reps, lapses, "left", flags, mod, data from cards'):
        if cid not in ids: continue
        tags, nmod = notes.get(nid, ('', 0))
        tl = [t.lower() for t in tags.split()]
        hq, hdue, d = home_state(ctype, queue, due, odid, odue, data, did)
        st = {'type': ctype, 'queue': hq, 'due': hdue, 'ivl': ivl, 'factor': factor, 'reps': reps, 'lapses': lapses,
              'left': left, 'data': d, 'flags': flags, 'mark': int('marked' in tl)}
        out[cid] = {'st': st, 'nid': nid, 'odid': odid, 'nmod': nmod, 'leech': 'leech' in tl, 'ver': max(mod * 1000, last.get(cid) or 0), 'home': odid or did}
    return out


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


# 「答え」として数える記録の種類: 学習・復習・再学習・早めの復習と、手で決めた期日（Forget・Set Due Date）。
# 5（オプションを変えて計算し直した）は答えではないので数えない
DECISIVE = (0, 1, 2, 3, 4)


def plan(scards, srevs, acards, anki_rev_ids, anki_revlog, fresh=()):
    """カードごとに、どちらを正にするか決める。
    1. 相手の知らない新しい答えがある側を正にする（非表示・休止などの変更や、オプションの計算し直しで、答えた期日を上書きしないように）
    2. 最後の答えが同じなら、新しく変えたほうを正にする（同じ時刻なら暗記）
    to_srv は (カード, 状態, 送る新しさ, その状態が知っている最後の答え)"""
    s_last, a_last = {}, {}
    for r in srevs.values():   # サーバーが知っている答え（端末で元に戻して消した印のものも、知っているものとして数える）
        if r['type'] in DECISIVE and r['id'] > s_last.get(r['cid'], 0): s_last[r['cid']] = r['id']
    for r in anki_revlog:
        if r[7] in DECISIVE and r[0] > a_last.get(r[1], 0): a_last[r[1]] = r[0]
    # マークはノートごと。サーバー側は、そのノートのカードのうちいちばん新しい状態のマークを見る
    note_mark = {}
    for cid, a in acards.items():
        s = scards.get(cid)
        if s is not None and 'mark' in s['st'] and s['rev'] > note_mark.get(a['nid'], {'rev': -1})['rev']: note_mark[a['nid']] = s
    to_anki, to_srv, mark_add, mark_del = [], [], set(), set()
    for cid, a in acards.items():
        ast = a['st']; s = scards.get(cid)
        if s is None: continue
        if cid in fresh:   # この同期で Anki に作ったばかりのカード（端末で足した・.apkg から読み込んだ）は、端末の状態を正にする
            if not same(s['st'], ast) or (s['st'].get('did') is not None and (s['st']['did'] != a['home'] or (a['odid'] and 'flt' not in (s['st'].get('data') or {})))): to_anki.append((cid, s['st'], s['rev']))
            continue
        al, sl = a_last.get(cid, 0), s_last.get(cid, 0)
        sm = note_mark.get(a['nid'])
        if sm is not None and int(sm['st']['mark']) != ast['mark']:
            if sm['rev'] > a['nmod'] * 1000: (mark_add if sm['st']['mark'] else mark_del).add(a['nid'])
            elif same(s['st'], ast): to_srv.append((cid, {**s['st'], 'mark': ast['mark']}, max(a['ver'], a['nmod'] * 1000, s['rev']), al)); continue
        # 端末でコレクションを置き換えたときだけ、状態に移る先のデッキ（did）が入る。フィルターデッキの外にいるはずのカードも、ここで元のデッキへ戻す
        moved = s['st'].get('did') is not None and (s['st']['did'] != a['home'] or (a['odid'] and 'flt' not in (s['st'].get('data') or {})))
        if same(s['st'], ast) and not moved: continue
        if al > sl: to_srv.append((cid, ast, max(a['ver'], s['rev'] + 1), al))
        elif sl > al or s['rev'] >= a['ver']: to_anki.append((cid, s['st'], s['rev']))
        else: to_srv.append((cid, ast, a['ver'], al))
    rev_to_anki = [r for r in srevs.values() if not r['del'] and r['src'] == 'app' and r['id'] not in anki_rev_ids and r['cid'] in acards]
    rev_to_srv = [{'id': r[0], 'cid': r[1], 'ease': r[2], 'ivl': r[3], 'lastIvl': r[4], 'factor': r[5], 'time': r[6], 'type': r[7]}
                  for r in anki_revlog if r[0] not in srevs]
    leech_nids = sorted({acards[cid]['nid'] for cid, st, _ in to_anki if st.get('leech') and not acards[cid]['leech']})
    return {'to_anki': to_anki, 'to_srv': to_srv, 'rev_to_anki': rev_to_anki, 'rev_to_srv': rev_to_srv,
            'mark_add': sorted(mark_add), 'mark_del': sorted(mark_del), 'leech': leech_nids}


def write_card(col, cid, st):
    """暗記で答えた状態をカードに書く（記憶の値もそのまま。フィルターデッキに入っていたら元のデッキに戻す）"""
    from anki.cards import FSRSMemoryState
    c = col.get_card(cid)
    for k in ('type', 'queue', 'due', 'ivl', 'factor', 'reps', 'lapses', 'left'): setattr(c, k, st[k])
    if c.odid: c.did, c.odid, c.odue = c.odid, 0, 0
    d = st.get('data') or {}
    c.memory_state = FSRSMemoryState(stability=d['s'], difficulty=d['d']) if d.get('s') is not None and d.get('d') is not None else None
    c.desired_retention = d.get('dr'); c.decay = d.get('decay'); c.last_review_time = d.get('lrt')
    if d.get('pos') is not None: c.original_position = d['pos']
    if 'flags' in st: c.flags = st['flags']
    if st.get('did') is not None and st['did'] != c.did and col.decks.get(st['did'], default=False) and not col.decks.get(st['did']).get('dyn'): c.did = st['did']   # コレクションの置き換え
    return c


# ---------- ノート（端末で追加・編集・削除したもの） ----------
# ---------- デッキの作成・名前変更・削除（端末の conf の dname:<id>。app/decks.mjs） ----------
TMP = 'selfanki-tmp-'   # 名前を入れ替えるとき（A と B を取り替えたなど）だけ、いったん付ける名前


def deck_recs(conf_rows):
    """dname:<id> の行 → {デッキの id: {v, rev, src}}"""
    out = {}
    for k, v, rev, src, _ in conf_rows:
        if k.startswith('dname:'): out[int(k[6:])] = {'v': json.loads(v), 'rev': rev, 'src': src}
    return out


def _no(cid, did): return False


def gone_cards(recs):
    """端末で消したデッキのカードか（そこに端末で足したカードは、Anki にも作らない＝消したのと同じ）。既定のデッキ（id 1）は、消したときに入っていた（id < cleared）カード"""
    dids = {did for did, r in recs.items() if r['v'].get('removed')}
    cl = (recs.get(1) or {}).get('v', {}).get('cleared') or 0
    if not dids and not cl: return _no
    return lambda cid, did: did in dids or (did == 1 and cid < cl)


def _depth(name): return name.count('::')


def _ensure_parents(col, name):
    """足りない親を Anki の id で作る（端末で作った親は、先に端末の id で作ってある）"""
    parts = name.split('::')
    for i in range(1, len(parts)):
        p = '::'.join(parts[:i])
        if not col.decks.id_for_name(p): col.decks.id(p)


def apply_decks(col, srv, recs, log, dry=False, mods0=None):
    """暗記の端末で作った・名前を変えた・消したデッキを Anki に書く。決まりは「新しいほう」＝端末の記録の rev と Anki のデッキの mod（秒）。
      消した   … Anki のデッキより新しければ col.decks.remove（子のデッキ・カード・カードが無くなったノートも消える。Anki の「デッキを削除」と同じ）
                  既定のデッキ（id 1）は消えずに、そのとき入っていたカード（id < cleared）が消え、名前が「デフォルト」に戻る（rslib remove_single_deck）
      作った   … Anki に無ければ、端末の id のまま作る（端末で足したカードの did がそのまま使える）
      名前     … Anki のデッキより新しければ col.decks.rename（子のデッキの名前も変わる）
    Anki の名前が端末の記録と違って終わったとき（Anki のほうが新しい・名前が重なって「+」が付いた）は、Anki の名前を端末へ返す。
    Anki で消したデッキの名前変更は何もしない（束を配り直すと端末からも消える）"""
    n = {'created': 0, 'renamed': 0, 'removed': 0, 'cards_removed': 0, 'anki_newer': 0, 'gone_in_anki': 0}
    recs = {did: r for did, r in recs.items() if r['src'] != 'anki'}   # アドオンが返したものは、もう Anki の姿
    if not recs: return n
    anki = {d['id']: d for d in col.decks.all()}
    mods0 = mods0 or {did: d.get('mod', 0) for did, d in anki.items()}
    newer = lambda did, r: r['rev'] > mods0.get(did, 0) * 1000
    push = {}; now = int(time.time() * 1000)

    def back(did, r, name):
        v = {kk: vv for kk, vv in r['v'].items() if kk in ('created', 'cleared')}; v['name'] = name
        push[did] = {'t': 'conf', 'src': 'anki', 'k': f'dname:{did}', 'v': v, 'rev': max(now, r['rev'] + 1)}

    # 1. 消す（先に消して名前を空ける。端末で同じ名前のデッキを作り直した・別のデッキをその名前にした、に備える）
    rm = []
    for did, r in recs.items():
        v = r['v']; d = anki.get(did)
        if did == 1 and v.get('cleared'):
            cids = col.db.list('select id from cards where (did = 1 or odid = 1) and id < ?', v['cleared'])
            if cids:
                n['cards_removed'] += len(cids)
                if not dry: col.remove_cards_and_orphaned_notes(cids)
            if d is not None: back(did, r, d['name'])   # 一度だけ（src='anki' にして、あとで既定のデッキに移したカードを消さない）。名前を変えたら下で返し直す
        if not v.get('removed') or d is None or did == 1: continue
        if newer(did, r): rm.append(did)
        else: n['anki_newer'] += 1; back(did, r, d['name'])
    if rm:
        if dry: n['removed'] += len(rm)
        else:
            alive = [x for x in rm if col.decks.get(x, default=False)]
            if alive: n['cards_removed'] += col.decks.remove(alive).count
            n['removed'] += len(rm)
    if not dry: anki = {d['id']: d for d in col.decks.all()}

    # 2. 作る・名前を変える（親から順に。行き先の名前を、これから名前を変えるデッキが使っていたら、そちらを先に）
    todo = []
    for did, r in recs.items():
        v = r['v']
        if v.get('removed'): continue
        d = anki.get(did)
        want = v['name']
        if did == 1 and v.get('cleared') and r['rev'] == v['cleared']: want = col.tr.deck_config_default_name()   # 消したあと名前を変えていない
        if d is None:
            if v.get('created'): todo.append((did, want, r, 'create'))
            else: n['gone_in_anki'] += 1
            continue
        if d['name'] == want: continue
        if newer(did, r) or d['name'].startswith(TMP): todo.append((did, want, r, 'rename'))
        else: n['anki_newer'] += 1; back(did, r, d['name'])
    todo.sort(key=lambda t: (_depth(t[1]), t[2]['rev']))
    if dry:
        n['created'] += sum(1 for t in todo if t[3] == 'create'); n['renamed'] += sum(1 for t in todo if t[3] == 'rename')
        return n
    fold = lambda x: x.casefold()
    while todo:
        done_any = False
        for t in list(todo):
            did, want, r, kind = t
            others = [u for u in todo if u is not t]
            cur = {x.id: x.name for x in col.decks.all_names_and_ids()}
            occ = col.decks.id_for_name(want)
            if kind == 'rename' and cur.get(did) == want: todo.remove(t); done_any = True; continue   # 親の名前を変えたときに一緒に変わった
            if occ and occ != did and any(u[0] == occ and u[3] == 'rename' for u in others): continue   # その名前のデッキが、これから名前を変える
            if any(fold(want).startswith(fold(u[1]) + '::') for u in others): continue                    # 親になるデッキがまだ
            _ensure_parents(col, want)
            if kind == 'create':
                dk = col.decks.new_deck_legacy(False)
                dk.update({'id': did, 'name': want, 'mod': r['rev'] // 1000, 'usn': -1})
                col.decks.update(dk, preserve_usn=True); n['created'] += 1
            else:
                col.decks.rename(did, want); n['renamed'] += 1
            got = col.decks.get(did)['name']
            if got != r['v']['name']: back(did, r, got)
            todo.remove(t); done_any = True
        if todo and not done_any:   # 取り替え（A→B と B→A）: 1つをいったん仮の名前にする
            t = next((u for u in todo if u[3] == 'rename'), todo[0])
            if t[3] == 'rename': col.decks.rename(t[0], f'{TMP}{t[0]}')
            else: break
    for did in list(push):   # 返すのは書き終えたあとの Anki の名前。消したデッキの子だったなどで、もう無いデッキへは返さない
        d = col.decks.get(did, default=False)
        if d: push[did]['v']['name'] = d['name']
        else: push.pop(did)
    if n['created'] or n['renamed'] or n['removed'] or n['cards_removed']: col.db.execute('update col set mod = ?', now)   # AnkiWeb との同期で上がるように
    if push: srv.push(list(push.values()))
    if any(n.values()): log('デッキ', n)
    return n


# ---------- 端末で .apkg から読み込んだノートタイプ（conf の nt:<id>＝schema 11。64 ビットの id は文字列）と画像・音声（サーバーの media） ----------
def nt_from_wire(v):
    m = json.loads(json.dumps(v))
    for f in (m.get('flds') or []) + (m.get('tmpls') or []):
        if isinstance(f.get('id'), str) and f['id'].lstrip('-').isdigit(): f['id'] = int(f['id'])
    if isinstance(m.get('originalId'), str) and m['originalId'].lstrip('-').isdigit(): m['originalId'] = int(m['originalId'])
    return m


def apply_notetypes(col, srv, conf_rows, log, dry=False):
    """端末で読み込んだノートタイプを Anki に書く（ノートより先に）。Anki に無ければ端末と同じ id で作る（Anki は id を決めて足させてくれないので、足してから書き換える）。
    あれば、端末のほうが新しく、フィールドとテンプレートの並び（名前）が同じときだけ、テンプレート・CSS などを書く（並びが変わる更新は端末ではしない）"""
    n = {'added': 0, 'updated': 0, 'skipped': 0}
    for k, v, rev, src, _ in conf_rows:
        if not k.startswith('nt:') or src == 'anki': continue
        ntid = int(k[3:]); m = nt_from_wire(json.loads(v)); cur = col.models.get(ntid)
        if cur is None:
            if dry: n['added'] += 1; continue
            m['id'] = 0; m['usn'] = -1
            got = col.models.add_dict(m).id
            if got != ntid:
                if col.db.scalar('select count() from notetypes where id = ?', ntid):
                    log('ノートタイプの id が Anki のほかのものと重なったので、付け替えなかった', ntid); n['skipped'] += 1; continue
                col.db.execute('update notetypes set id = ? where id = ?', ntid, got)
                col.db.execute('update fields set ntid = ? where ntid = ?', ntid, got)
                col.db.execute('update templates set ntid = ? where ntid = ?', ntid, got)
                if col.get_config('curModel', None) == got: col.set_config('curModel', ntid)
                col.models._clear_cache()
            n['added'] += 1
        elif rev > (cur.get('mod') or 0) * 1000:
            if [f['name'] for f in cur['flds']] != [f['name'] for f in m.get('flds', [])] or [t['name'] for t in cur['tmpls']] != [t['name'] for t in m.get('tmpls', [])]:
                n['skipped'] += 1; continue
            if dry: n['updated'] += 1; continue
            new = dict(cur)
            for key in ('name', 'css', 'latexPre', 'latexPost', 'latexsvg', 'sortf'):
                if key in m: new[key] = m[key]
            new['tmpls'] = [{**t0, **{kk: t1[kk] for kk in ('qfmt', 'afmt', 'bqfmt', 'bafmt', 'bfont', 'bsize', 'did') if kk in t1}} for t0, t1 in zip(cur['tmpls'], m['tmpls'])]
            new['flds'] = [{**f0, **{kk: f1[kk] for kk in ('sticky', 'rtl', 'font', 'size', 'description', 'plainText', 'collapsed', 'excludeFromSearch') if kk in f1}} for f0, f1 in zip(cur['flds'], m['flds'])]
            col.models.update_dict(new); n['updated'] += 1
    if not dry and (n['added'] or n['updated']): col.db.execute('update col set mod = ?', int(time.time() * 1000))
    if any(n.values()): log('ノートタイプ', n)
    return n


def _safe_media(name):
    return isinstance(name, str) and name and '/' not in name and '\\' not in name and name not in ('.', '..') and not name.startswith('.') and '\0' not in name


def download_media(col, srv, log, dry=False):
    """端末で読み込んだ画像・音声（サーバーの media）のうち、Anki の collection.media に無いものを取ってくる。同じ名前で中身が違うものは、Anki のほうを残す"""
    lst = srv.json('/api/media')
    mdir = col.media.dir(); n = {'got': 0, 'have': 0, 'differ': 0}
    for name, size, sha1, _seq in lst:
        if not _safe_media(name): continue
        p = os.path.join(mdir, name)
        if os.path.exists(p):
            with open(p, 'rb') as f: same_file = hashlib.sha1(f.read()).hexdigest() == sha1
            n['have' if same_file else 'differ'] += 1
            if not same_file: log('同じ名前で中身の違う画像・音声が Anki にあるので、取らなかった', name)
            continue
        if dry: n['got'] += 1; continue
        data = srv._req('/bundle/media/' + urllib.parse.quote(name))
        if hashlib.sha1(data).hexdigest() != sha1: log('取ってきた画像・音声の中身が一覧と違う', name); continue
        tmp = p + '.selfanki-tmp'
        with open(tmp, 'wb') as f: f.write(data)
        os.replace(tmp, p); n['got'] += 1
    if n['got'] or n['differ']: log('画像・音声', n)
    return n


def check_profile(col, scards, notes):
    """取り違えの見張り（何も書く前に）: サーバーが知っているカードの大半がこのコレクションに無ければ、別のプロファイル・別のコレクション。
    このコレクションで消したカード（graves。デッキやノートを消した）と、端末で足してまだ Anki に無いカードは数えない"""
    ids = set(scards)
    for rec in notes.values():
        if rec['added']: ids -= {c[0] for c in rec['cards']}
    if not ids: return
    ids -= set(col.db.list('select oid from graves where type = 0'))
    have = set(col.db.list('select id from cards'))
    if ids and len(ids & have) < 0.5 * len(ids):
        raise SyncError(f'このプロファイルには、暗記のカード {len(ids)} 枚のうち {len(ids & have)} 枚しかありません。別のプロファイルか、別の暗記につないでいるようです。止めました。')


def note_wire(rec, **kw):
    out = {k: rec[k] for k in ('id', 'mid', 'flds', 'tags', 'did', 'cards', 'rev', 'del', 'added')}
    if rec.get('guid'): out['guid'] = rec['guid']
    if rec.get('imp'): out['imp'] = 1
    return {**out, **kw}


def _fix_cards(col, rec, before, log, fresh=None):
    """新しくできたカード（before に無いもの）の id を端末が決めた id に、新規の位置を端末の位置に付け替える（ord で対応させる）。
    端末が足したのに Anki が作らなかったカード（.apkg から読み込んだカードは、テンプレートから作らずにそのまま入れる。rslib の読み込みと同じ）は、ここで作る。
    imp（.apkg から読み込んだノート）なら、端末に無いのに Anki が作ったカードは消す。作ったカードの id は fresh に入れる（状態はサーバーのものを正にする）"""
    want = {o: (cid, did, due) for cid, o, did, due in rec['cards']}
    have = set()
    for cid, ord_, ctype in col.db.all('select id, ord, type from cards where nid = ?', rec['id']):
        if cid in before: have.add(ord_); continue
        if ord_ not in want:
            if rec.get('imp'): col.db.execute('delete from cards where id = ?', cid)
            continue
        new_id, _did, due = want[ord_]
        if new_id != cid:
            if col.db.scalar('select count() from cards where id = ?', new_id):
                log('カードの id が Anki のほかのカードと重なったので、付け替えなかった', new_id); have.add(ord_); continue
            col.db.execute('update cards set id = ? where id = ?', new_id, cid)
        if ctype == 0: col.db.execute('update cards set due = ? where id = ?', due, new_id)
        have.add(ord_)
        if fresh is not None: fresh.add(new_id)
    now = int(time.time())
    for ord_, (cid, did, due) in want.items():
        if ord_ in have or col.db.scalar('select count() from cards where id = ?', cid): continue
        col.db.execute("insert into cards (id, nid, did, ord, mod, usn, type, queue, due, ivl, factor, reps, lapses, left, odue, odid, flags, data) values (?, ?, ?, ?, ?, -1, 0, 0, ?, 0, 0, 0, 0, 0, 0, 0, 0, '')",
                       cid, rec['id'], did if col.decks.get(did, default=False) else 1, ord_, now, due)
        if fresh is not None: fresh.add(cid)
    top = max((due for _c, _o, _d, due in rec['cards']), default=-1)
    if top >= (col.get_config('nextPos', 0) or 0): col.set_config('nextPos', top + 1)


def _add_note(col, rec, log, gone=_no, fresh=None):
    """端末で作ったノートを Anki に足し、ノートとカードの id を端末の id に付け替える（Anki は id を決めて足させてくれないので、足してから書き換える）。
    guid があれば使う（.apkg から読み込んだノートは、元の guid のまま。もう一度読み込んだとき・書き出したときに同じノートだと分かるように）"""
    m = col.models.get(rec['mid'])
    if not m: log('ノートタイプが Anki に無いので、足せなかった', rec['id']); return False
    if col.db.scalar('select count() from notes where id = ?', rec['id']) or any(col.db.scalar('select count() from cards where id = ?', c[0]) for c in rec['cards']):
        log('ノートかカードの id が Anki のほかのものと重なったので、足せなかった', rec['id']); return False
    note = col.new_note(m)
    for i in range(len(note.fields)): note.fields[i] = rec['flds'][i] if i < len(rec['flds']) else ''
    note.tags = rec['tags'].split()
    if rec.get('guid'): note.guid = rec['guid']
    col.add_note(note, rec['did'] if col.decks.get(rec['did'], default=False) else 1)
    col.db.execute('update notes set id = ? where id = ?', rec['id'], note.id)
    col.db.execute('update cards set nid = ? where nid = ?', rec['id'], note.id)
    _fix_cards(col, rec, set(), log, fresh)
    if gone is not _no:   # 端末で消したデッキに入るカード（テンプレートのデッキ指定で、ほかのカードと別のデッキ）は消す
        drop = [c[0] for c in rec['cards'] if gone(c[0], c[2]) and col.db.scalar('select count() from cards where id = ?', c[0])]
        if drop: col.remove_cards_and_orphaned_notes(drop)
    return True


def _update_note(col, rec, log, fresh=None):
    note = col.get_note(rec['id'])
    if note.mid != rec['mid']: log('ノートタイプが変わっているので、書かなかった', rec['id']); return False
    before = set(col.db.list('select id from cards where nid = ?', rec['id']))
    for i in range(len(note.fields)): note.fields[i] = rec['flds'][i] if i < len(rec['flds']) else ''
    note.tags = rec['tags'].split()
    col.update_note(note, skip_undo_entry=True)
    _fix_cards(col, rec, before, log, fresh)
    return True


def _written(col, rec):
    """Anki に書いたあとの中身（Anki がそろえたタグなど）を、src='anki' で送り返す。rev は Anki のノートの mod 以上にする（配り直した束と同じ新しさ）"""
    note = col.get_note(rec['id'])
    return note_wire(rec, flds=list(note.fields), tags=' '.join(note.tags), rev=max(rec['rev'], note.mod * 1000), **{'del': 0})


def apply_notes(col, srv, notes, log, dry=False, gone=_no, fresh=None):
    """暗記の端末で追加・編集・削除したノート（サーバーの notes）を Anki に書く。決まりは「新しいほう」＝端末の記録の rev と Anki のノートの mod（秒）。
      消した   … Anki のノートより新しければ消す
      Anki に無い … 端末で作ったノートなら足す（id を合わせる）。Anki に入れたことがある・前から Anki にあったノートなら、Anki で消したので端末でも消す
      Anki にある … 端末の記録のほうが新しければ、フィールドとタグを書く（増えるカードの id を合わせる）。Anki のほうが新しければ書かない
    カードの状態を比べる前に呼ぶ（端末で作ったカードを先に Anki に入れておくため）"""
    n = {'added': 0, 'updated': 0, 'removed': 0, 'gone_in_anki': 0, 'anki_newer': 0, 'skipped': 0, 'in_removed_deck': 0}
    if not notes: return n
    ids = list(notes); amod = {}
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        amod.update(dict(col.db.all('select id, mod from notes where id in (%s)' % ','.join(str(int(x)) for x in part))))
    push = []; now = int(time.time() * 1000)
    for rec in sorted(notes.values(), key=lambda r: r['rev']):
        nid = rec['id']; mod = amod.get(nid)
        if rec['del']:
            if mod is not None and rec['rev'] > mod * 1000:
                if not dry: col.remove_notes([nid])
                n['removed'] += 1
            continue
        if mod is None:
            if rec['added'] and rec['src'] != 'anki' and rec['cards'] and all(gone(c[0], c[2]) for c in rec['cards']):
                n['in_removed_deck'] += 1; continue   # 端末で足したあと、そのデッキを消した（Anki のデッキの削除と同じく、カードが無くなったノートは消える）
            if rec['added'] and rec['src'] != 'anki':
                if dry: n['added'] += 1
                elif _add_note(col, rec, log, gone, fresh): n['added'] += 1; push.append(_written(col, rec))
                else: n['skipped'] += 1
            else:
                n['gone_in_anki'] += 1
                if not dry: push.append(note_wire(rec, rev=max(now, rec['rev'] + 1), **{'del': 1}))
            continue
        if rec['rev'] > mod * 1000:
            if dry: n['updated'] += 1
            elif _update_note(col, rec, log, fresh): n['updated'] += 1; push.append(_written(col, rec))
            else: n['skipped'] += 1
        elif rec['src'] == 'app': n['anki_newer'] += 1
    if not dry and (n['added'] or n['updated'] or n['removed']): col.db.execute('update col set mod = ?', now)   # AnkiWeb との同期で上がるように
    if push and not dry: srv.push([{'t': 'note', 'src': 'anki', 'n': p} for p in push])
    if any(n.values()): log('ノート', n)
    return n


def apply_conf(col, srv, conf_rows, log, dry=False, mods0=None):
    """暗記で変えたデッキのオプション（サーバーの conf、src='app'）を Anki に書く。プリセットの削除はしない（Anki の次の同期が一方向になることがあるため）"""
    presets = {c['id']: c for c in col.decks.all_config()}
    now = int(time.time() * 1000); remap = {}; push = []; n = {'preset': 0, 'new': 0, 'removed_skipped': 0, 'deck': 0}
    for k, v, rev, src, _ in conf_rows:
        if src != 'app' or not k.startswith('preset:'): continue
        pid = int(k[7:]); v = json.loads(v)
        if v.get('removed'):
            if pid in presets and pid != 1: log(f'暗記で消したプリセット「{presets[pid].get("name")}」は、Anki では消していない（必要なら手で消す）'); n['removed_skipped'] += 1
            continue
        if pid in presets:
            if rev > presets[pid].get('mod', 0) * 1000:
                cfg = {**presets[pid], **{kk: vv for kk, vv in v.items() if kk not in ('id', 'mod')}}
                if not dry: col.decks.update_config(cfg)
                n['preset'] += 1
        else:
            body = {kk: vv for kk, vv in v.items() if kk not in ('id', 'mod', 'usn')}
            # 前の同期で Anki に作ったが、サーバーへの知らせが届かなかったもの（名前と中身が同じ）は作り直さずに使う
            twin = next((c for c in presets.values() if all(c.get(kk) == vv for kk, vv in body.items())), None)
            if dry: n['new'] += 0 if twin else 1; continue
            if twin: new = twin
            else:
                new = col.decks.add_config(v.get('name') or 'プリセット', clone_from=col.decks.get_config(1))
                new = {**new, **body, 'id': new['id']}; col.decks.update_config(new); n['new'] += 1
            remap[pid] = new['id']
            push += [{'t': 'conf', 'src': 'anki', 'k': k, 'v': {'removed': True}, 'rev': now}, {'t': 'conf', 'src': 'anki', 'k': f'preset:{new["id"]}', 'v': new, 'rev': now}]
    for k, v, rev, src, _ in conf_rows:
        if not k.startswith('deck:'): continue
        did = int(k[5:]); v = json.loads(v); d = col.decks.get(did, default=False)
        if not d or d.get('dyn'): continue
        newer = src == 'app' and rev > (mods0 or {}).get(did, d.get('mod', 0)) * 1000
        # デッキの説明（.apkg から読み込んだデッキ。rslib update_normal_with_other と同じく、空でなければ）
        if newer and v.get('desc') and (d.get('desc', '') != v['desc'] or bool(d.get('md')) != bool(v.get('md'))):
            if not dry:
                d['desc'] = v['desc']
                if v.get('md'): d['md'] = True
                else: d.pop('md', None)
                col.decks.save(d); d = col.decks.get(did)
            n['desc'] = n.get('desc', 0) + 1
        if 'conf' not in v: continue
        conf = remap.get(v['conf'], v['conf'])
        if conf != v['conf']: push.append({'t': 'conf', 'src': 'anki', 'k': k, 'v': {**v, 'conf': conf}, 'rev': now})
        if newer and d.get('conf') != conf and (conf in presets or conf in remap.values() or dry):
            if not dry: d['conf'] = conf; col.decks.save(d)
            n['deck'] += 1
    if push and not dry: srv.push(push)
    return n


def run(col, site_url, token, dry=False, log=print):
    """同期を1回する。dry なら数えるだけ（何も書かない）。結果の数を返す"""
    t0 = time.time()
    srv = Server(site_url, token)
    scards, srevs, conf_rows, snotes = server_view(srv)
    check_profile(col, scards, snotes)   # 何も書く前に、別のプロファイルにつないでいないか
    # デッキ → ノートの順に書く（端末で作ったデッキに端末で足したノートを入れられるように。消したデッキに足したノートは足さない）
    drecs = deck_recs(conf_rows); mods0 = {d['id']: d.get('mod', 0) for d in col.decks.all()}
    try: ndeck = apply_decks(col, srv, drecs, log, dry=dry, mods0=mods0)
    except SyncError: raise
    except Exception as e: ndeck = None; log('デッキを書けなかった', repr(e)); deck_fail = repr(e)[:200]
    else: deck_fail = None
    # 端末で読み込んだノートタイプ（ノートより先に）
    try: nnt = apply_notetypes(col, srv, conf_rows, log, dry=dry)
    except SyncError: raise
    except Exception as e: nnt = None; log('ノートタイプを書けなかった', repr(e)); nt_fail = repr(e)[:200]
    else: nt_fail = None
    # 端末で追加・編集・削除したノートを先に書く（端末で作ったカードを、カードの状態を比べる前に Anki に入れておく）
    fresh = set()   # この同期で Anki に作ったカード（端末の状態を正にする）
    try: nnote = apply_notes(col, srv, snotes, log, dry=dry, gone=gone_cards(drecs), fresh=fresh)
    except SyncError: raise
    except Exception as e: nnote = None; log('ノートを書けなかった', repr(e)); note_fail = repr(e)[:200]
    else: note_fail = None
    acards = anki_view(col, set(scards))
    ids = set(acards)
    anki_rev_ids = set(col.db.list('select id from revlog'))
    anki_revlog = [r for r in col.db.all('select id, cid, ease, ivl, lastIvl, factor, time, type from revlog') if r[1] in ids]
    p = plan(scards, srevs, acards, anki_rev_ids, anki_revlog, fresh)
    summary = {k: len(v) for k, v in p.items()}; summary['dry'] = dry; summary['notes'] = nnote; summary['decks'] = ndeck; summary['notetypes'] = nnt
    if nt_fail: summary['nt_fail'] = nt_fail
    if note_fail: summary['note_fail'] = note_fail
    if deck_fail: summary['deck_fail'] = deck_fail
    log('比べた: Anki へ カード {to_anki} 記録 {rev_to_anki} ／暗記へ カード {to_srv} 記録 {rev_to_srv}'.format(**summary))
    if dry:
        try: summary['conf'] = apply_conf(col, srv, conf_rows, log, dry=True, mods0=mods0)
        except Exception as e: summary['conf_fail'] = repr(e)[:200]
        summary['secs'] = round(time.time() - t0, 1); return summary
    # Anki に書く: カード → 記録 → タグ → オプション（記録を先に入れて途中で止まると、次の同期で「Anki のほうが新しい」に見えてしまう）
    cards = [write_card(col, cid, st) for cid, st, _ in p['to_anki']]
    for i in range(0, len(cards), 500): col.update_cards(cards[i:i + 500], skip_undo_entry=True)   # 取り消しの記録は作らない（書く前にバックアップを取る）
    for r in sorted(p['rev_to_anki'], key=lambda r: r['id']):
        col.db.execute('insert or ignore into revlog (id, cid, usn, ease, ivl, lastIvl, factor, time, type) values (?, ?, -1, ?, ?, ?, ?, ?, ?)',
                       r['id'], r['cid'], r['ease'], r['ivl'], r['lastIvl'], r['factor'], r['time'], r['type'])
    if p['rev_to_anki']: col.db.execute('update col set mod = ?', int(time.time() * 1000))   # 記録だけを足したときも、AnkiWeb との同期で上がるように
    if p['leech']: col.tags.bulk_add(p['leech'], 'leech')
    if p['mark_add']: col.tags.bulk_add(p['mark_add'], 'marked')
    if p['mark_del']: col.tags.bulk_remove(p['mark_del'], 'marked')
    try: summary['conf'] = apply_conf(col, srv, conf_rows, log, mods0=mods0)
    except Exception as e: summary['conf_fail'] = repr(e)[:200]; log('オプションを書けなかった', repr(e))
    # 暗記へ送る（Anki 側のほうが新しかったもの）
    # base＝その状態が知っている最後の答え。サーバーは、それより新しい答えが端末から届いていたら、この状態を捨てる
    ops = [{'t': 'state', 'src': 'anki', 'c': {'id': cid, 'st': st, 'rev': rev}, 'base': base} for cid, st, rev, base in p['to_srv']]
    ops += [{'t': 'rev', 'src': 'anki', 'r': r} for r in p['rev_to_srv']]
    srv.push(ops)
    # 確かめる: 書いたカードを読み直して、狙いどおりか
    after = anki_view(col, {cid for cid, _, _ in p['to_anki']})
    ng = [cid for cid, st, _ in p['to_anki'] if not same(st, after[cid]['st']) or (st.get('did') is not None and col.decks.get(st['did'], default=False) and st['did'] != after[cid]['home'])]
    summary['verify_ng'] = len(ng)
    if ng: log('書いた値が違うカード', len(ng), ng[:3])
    # 端末で読み込んだ画像・音声を Anki に取ってくる
    try: summary['media'] = download_media(col, srv, log)
    except SyncError: raise
    except Exception as e: summary['media_fail'] = repr(e)[:200]; log('画像・音声を取れなかった', repr(e))
    summary['ok'] = not ng and not summary.get('conf_fail') and not summary.get('note_fail') and not summary.get('deck_fail') and not summary.get('nt_fail') and not summary.get('media_fail')
    summary['secs'] = round(time.time() - t0, 1)
    return summary
