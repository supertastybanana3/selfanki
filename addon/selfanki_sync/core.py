# 暗記（自分の Cloudflare）と、いま開いている Anki のコレクションのあいだで、学習の状態と記録をやり取りする。
# カードの中身は送らない（Anki で変えた中身は export_anki.py → build_site.py で配る）。暗記の端末で追加・編集・削除したノートは Anki に書く。
# Anki の中（アドオン）からも、Python の anki パッケージからも呼べるように、画面の部品は使わない。
# 決まりは tools/mirror.py と同じ: カードごとに新しいほうを正にする。新しさは、暗記の側＝最後に答えた時刻、Anki の側＝カードの更新時刻と最後の記録の遅いほう
import json, time, urllib.request, urllib.error, urllib.parse

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
        for (id_, mid, flds, tags, did, ncards, rev, src, dl, added, seq) in j.get('notes', []):
            notes[id_] = {'id': id_, 'mid': mid, 'flds': json.loads(flds), 'tags': tags, 'did': did, 'cards': json.loads(ncards), 'rev': rev, 'src': src, 'del': dl, 'added': added}
            ns, ni = seq, id_
        conf = j.get('conf', [])
        if not j['more']: break
    return cards, revs, conf, notes


# ---------- Anki ----------
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
        st = {'type': ctype, 'queue': queue, 'due': odue if odid else due, 'ivl': ivl, 'factor': factor, 'reps': reps, 'lapses': lapses,
              'left': left, 'data': json.loads(data) if data else {}, 'flags': flags, 'mark': int('marked' in tl)}
        out[cid] = {'st': st, 'nid': nid, 'odid': odid, 'nmod': nmod, 'leech': 'leech' in tl, 'ver': max(mod * 1000, last.get(cid) or 0)}
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


def plan(scards, srevs, acards, anki_rev_ids, anki_revlog):
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
        al, sl = a_last.get(cid, 0), s_last.get(cid, 0)
        sm = note_mark.get(a['nid'])
        if sm is not None and int(sm['st']['mark']) != ast['mark']:
            if sm['rev'] > a['nmod'] * 1000: (mark_add if sm['st']['mark'] else mark_del).add(a['nid'])
            elif same(s['st'], ast): to_srv.append((cid, {**s['st'], 'mark': ast['mark']}, max(a['ver'], a['nmod'] * 1000, s['rev']), al)); continue
        if same(s['st'], ast): continue
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
    return c


# ---------- ノート（端末で追加・編集・削除したもの） ----------
def note_wire(rec, **kw):
    return {**{k: rec[k] for k in ('id', 'mid', 'flds', 'tags', 'did', 'cards', 'rev', 'del', 'added')}, **kw}


def _fix_cards(col, rec, before, log):
    """新しくできたカード（before に無いもの）の id を端末が決めた id に、新規の位置を端末の位置に付け替える（ord で対応させる）"""
    want = {o: (cid, due) for cid, o, _did, due in rec['cards']}
    for cid, ord_, ctype in col.db.all('select id, ord, type from cards where nid = ?', rec['id']):
        if cid in before or ord_ not in want: continue
        new_id, due = want[ord_]
        if new_id != cid:
            if col.db.scalar('select count() from cards where id = ?', new_id):
                log('カードの id が Anki のほかのカードと重なったので、付け替えなかった', new_id); continue
            col.db.execute('update cards set id = ? where id = ?', new_id, cid)
        if ctype == 0: col.db.execute('update cards set due = ? where id = ?', due, new_id)
    top = max((due for _c, _o, _d, due in rec['cards']), default=-1)
    if top >= (col.get_config('nextPos', 0) or 0): col.set_config('nextPos', top + 1)


def _add_note(col, rec, log):
    """端末で作ったノートを Anki に足し、ノートとカードの id を端末の id に付け替える（Anki は id を決めて足させてくれないので、足してから書き換える）"""
    m = col.models.get(rec['mid'])
    if not m: log('ノートタイプが Anki に無いので、足せなかった', rec['id']); return False
    if col.db.scalar('select count() from notes where id = ?', rec['id']) or any(col.db.scalar('select count() from cards where id = ?', c[0]) for c in rec['cards']):
        log('ノートかカードの id が Anki のほかのものと重なったので、足せなかった', rec['id']); return False
    note = col.new_note(m)
    for i in range(len(note.fields)): note.fields[i] = rec['flds'][i] if i < len(rec['flds']) else ''
    note.tags = rec['tags'].split()
    col.add_note(note, rec['did'])
    col.db.execute('update notes set id = ? where id = ?', rec['id'], note.id)
    col.db.execute('update cards set nid = ? where nid = ?', rec['id'], note.id)
    _fix_cards(col, rec, set(), log)
    return True


def _update_note(col, rec, log):
    note = col.get_note(rec['id'])
    if note.mid != rec['mid']: log('ノートタイプが変わっているので、書かなかった', rec['id']); return False
    before = set(col.db.list('select id from cards where nid = ?', rec['id']))
    for i in range(len(note.fields)): note.fields[i] = rec['flds'][i] if i < len(rec['flds']) else ''
    note.tags = rec['tags'].split()
    col.update_note(note, skip_undo_entry=True)
    _fix_cards(col, rec, before, log)
    return True


def _written(col, rec):
    """Anki に書いたあとの中身（Anki がそろえたタグなど）を、src='anki' で送り返す。rev は Anki のノートの mod 以上にする（配り直した束と同じ新しさ）"""
    note = col.get_note(rec['id'])
    return note_wire(rec, flds=list(note.fields), tags=' '.join(note.tags), rev=max(rec['rev'], note.mod * 1000), **{'del': 0})


def apply_notes(col, srv, notes, log, dry=False):
    """暗記の端末で追加・編集・削除したノート（サーバーの notes）を Anki に書く。決まりは「新しいほう」＝端末の記録の rev と Anki のノートの mod（秒）。
      消した   … Anki のノートより新しければ消す
      Anki に無い … 端末で作ったノートなら足す（id を合わせる）。Anki に入れたことがある・前から Anki にあったノートなら、Anki で消したので端末でも消す
      Anki にある … 端末の記録のほうが新しければ、フィールドとタグを書く（増えるカードの id を合わせる）。Anki のほうが新しければ書かない
    カードの状態を比べる前に呼ぶ（端末で作ったカードを先に Anki に入れておくため）"""
    n = {'added': 0, 'updated': 0, 'removed': 0, 'gone_in_anki': 0, 'anki_newer': 0, 'skipped': 0}
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
            if rec['added'] and rec['src'] != 'anki':
                if dry: n['added'] += 1
                elif _add_note(col, rec, log): n['added'] += 1; push.append(_written(col, rec))
                else: n['skipped'] += 1
            else:
                n['gone_in_anki'] += 1
                if not dry: push.append(note_wire(rec, rev=max(now, rec['rev'] + 1), **{'del': 1}))
            continue
        if rec['rev'] > mod * 1000:
            if dry: n['updated'] += 1
            elif _update_note(col, rec, log): n['updated'] += 1; push.append(_written(col, rec))
            else: n['skipped'] += 1
        elif rec['src'] == 'app': n['anki_newer'] += 1
    if not dry and (n['added'] or n['updated'] or n['removed']): col.db.execute('update col set mod = ?', now)   # AnkiWeb との同期で上がるように
    if push and not dry: srv.push([{'t': 'note', 'src': 'anki', 'n': p} for p in push])
    if any(n.values()): log('ノート', n)
    return n


def apply_conf(col, srv, conf_rows, log, dry=False):
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
        if not d or d.get('dyn') or 'conf' not in v: continue
        conf = remap.get(v['conf'], v['conf'])
        if conf != v['conf']: push.append({'t': 'conf', 'src': 'anki', 'k': k, 'v': {**v, 'conf': conf}, 'rev': now})
        if src == 'app' and d.get('conf') != conf and rev > d.get('mod', 0) * 1000 and (conf in presets or conf in remap.values() or dry):
            if not dry: d['conf'] = conf; col.decks.save(d)
            n['deck'] += 1
    if push and not dry: srv.push(push)
    return n


def run(col, site_url, token, dry=False, log=print):
    """同期を1回する。dry なら数えるだけ（何も書かない）。結果の数を返す"""
    t0 = time.time()
    srv = Server(site_url, token)
    scards, srevs, conf_rows, snotes = server_view(srv)
    # 端末で追加・編集・削除したノートを先に書く（端末で作ったカードを、カードの状態を比べる前に Anki に入れておく）
    try: nnote = apply_notes(col, srv, snotes, log, dry=dry)
    except SyncError: raise
    except Exception as e: nnote = None; log('ノートを書けなかった', repr(e)); note_fail = repr(e)[:200]
    else: note_fail = None
    acards = anki_view(col, set(scards))
    # 取り違えの見張り: サーバーが知っているカードの大半がこのコレクションに無ければ、別のプロファイル・別のコレクション
    if scards and len(acards) < 0.5 * len(scards):
        raise SyncError(f'このプロファイルには、暗記のカード {len(scards)} 枚のうち {len(acards)} 枚しかありません。別のプロファイルか、別の暗記につないでいるようです。止めました。')
    ids = set(acards)
    anki_rev_ids = set(col.db.list('select id from revlog'))
    anki_revlog = [r for r in col.db.all('select id, cid, ease, ivl, lastIvl, factor, time, type from revlog') if r[1] in ids]
    p = plan(scards, srevs, acards, anki_rev_ids, anki_revlog)
    summary = {k: len(v) for k, v in p.items()}; summary['dry'] = dry; summary['notes'] = nnote
    if note_fail: summary['note_fail'] = note_fail
    log('比べた: Anki へ カード {to_anki} 記録 {rev_to_anki} ／暗記へ カード {to_srv} 記録 {rev_to_srv}'.format(**summary))
    if dry:
        try: summary['conf'] = apply_conf(col, srv, conf_rows, log, dry=True)
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
    try: summary['conf'] = apply_conf(col, srv, conf_rows, log)
    except Exception as e: summary['conf_fail'] = repr(e)[:200]; log('オプションを書けなかった', repr(e))
    # 暗記へ送る（Anki 側のほうが新しかったもの）
    # base＝その状態が知っている最後の答え。サーバーは、それより新しい答えが端末から届いていたら、この状態を捨てる
    ops = [{'t': 'state', 'src': 'anki', 'c': {'id': cid, 'st': st, 'rev': rev}, 'base': base} for cid, st, rev, base in p['to_srv']]
    ops += [{'t': 'rev', 'src': 'anki', 'r': r} for r in p['rev_to_srv']]
    srv.push(ops)
    # 確かめる: 書いたカードを読み直して、狙いどおりか
    after = anki_view(col, {cid for cid, _, _ in p['to_anki']})
    ng = [cid for cid, st, _ in p['to_anki'] if not same(st, after[cid]['st'])]
    summary['verify_ng'] = len(ng)
    if ng: log('書いた値が違うカード', len(ng), ng[:3])
    summary['ok'] = not ng and not summary.get('conf_fail') and not summary.get('note_fail')
    summary['secs'] = round(time.time() - t0, 1)
    return summary
