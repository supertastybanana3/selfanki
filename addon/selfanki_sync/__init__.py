# 暗記と同期（Anki のアドオン）
# 「ツール」→「暗記」から、暗記（自分の Cloudflare に置いた selfanki）と学習の状態・記録をやり取りする。暗記の端末で追加・編集・削除したノートは Anki に書く。
# Anki 側のカードの中身は送らない（Anki でカードを足したり直したりしたら、パソコンで python tools/export_anki.py と python tools/build_site.py --deploy）。
# つなぐ先と合言葉はプロファイルごとに覚える（6桁の番号を入れてつなぐ。合言葉そのものは画面に出さない）。
from __future__ import annotations

import json
import os

from aqt import gui_hooks, mw
from aqt.operations import CollectionOp, QueryOp
from aqt.qt import QAction, QMenu
from aqt.utils import askUser, askUserDialog, getText, showInfo, showWarning, tooltip

from . import core

try:
    from anki.lang import current_lang
except ImportError:  # 古い Anki
    current_lang = 'en'

_JA = str(current_lang or '').startswith('ja')
_T = {
    'menu': ('暗記', 'selfanki'),
    'sync': ('同期する', 'Sync'),
    'dry': ('試す（数えるだけ・何も書かない）', 'Dry run (count only)'),
    'connect': ('つなぐ（番号を入れる）…', 'Connect (enter code)…'),
    'disconnect': ('つなぎを外す', 'Disconnect'),
    'syncing': ('暗記と同期しています…', 'Syncing with selfanki…'),
    'ask_url': ('暗記のサイトの住所（https://….pages.dev）', 'Address of your selfanki site (https://….pages.dev)'),
    'ask_code': ('パソコンで python tools/pair_code.py を動かして出た6桁の番号', '6-digit code from python tools/pair_code.py'),
    'connected': ('このプロファイル「{p}」を暗記につなぎました。', 'Connected this profile "{p}" to selfanki.'),
    'not_connected': ('このプロファイルはまだ暗記につないでいません。「ツール」→「暗記」→「つなぐ」で番号を入れてください。', 'This profile is not connected yet. Use Tools > selfanki > Connect.'),
    'disconnected': ('つなぎを外しました。', 'Disconnected.'),
    'confirm_disconnect': ('このプロファイルの、暗記へのつなぎを外しますか？', 'Disconnect this profile from selfanki?'),
    'done': ('暗記と同期しました。\n\nAnki に書いたカード {to_anki} 枚・記録 {rev_to_anki} 件\n暗記へ送ったカード {to_src} 枚・記録 {rev_to_srv} 件', 'Synced with selfanki.\n\nWritten to Anki: {to_anki} cards, {rev_to_anki} reviews\nSent to selfanki: {to_src} cards, {rev_to_srv} reviews'),
    'dry_done': ('試しました（何も書いていません）。\n\nAnki に書くカード {to_anki} 枚・記録 {rev_to_anki} 件\n暗記へ送るカード {to_src} 枚・記録 {rev_to_srv} 件', 'Dry run (nothing written).\n\nTo Anki: {to_anki} cards, {rev_to_anki} reviews\nTo selfanki: {to_src} cards, {rev_to_srv} reviews'),
    'nothing': ('暗記と同期しました（変わったものはありませんでした）', 'Synced with selfanki (nothing changed)'),
    'warn_ng': ('\n\n書いた値が違うカードが {n} 枚ありました。Anki の「ファイル」→「バックアップから復元」で戻せます。', '\n\n{n} cards did not match after writing. You can restore from the backup made just before.'),
    'warn_conf': ('\n\nデッキのオプションを書けませんでした: {e}', '\n\nCould not write deck options: {e}'),
    'extra': ('\nマーク {marks} 件・デッキのオプション {conf} 件', '\nMarks: {marks}, deck options: {conf}'),
    'notes': ('\n暗記で変えたノート: 追加 {added}・編集 {updated}・削除 {removed}（Anki で消してあった {gone_in_anki}・Anki のほうが新しかった {anki_newer}・書けなかった {skipped}）',
              '\nNotes changed in selfanki: added {added}, edited {updated}, deleted {removed} (already deleted in Anki {gone_in_anki}, newer in Anki {anki_newer}, not written {skipped})'),
    'warn_note': ('\n\nノートを書けませんでした: {e}', '\n\nCould not write notes: {e}'),
    'decks': ('\n暗記で変えたデッキ: 作成 {created}・名前の変更 {renamed}・削除 {removed}（消えたカード {cards_removed} 枚・Anki のほうが新しかった {anki_newer}）',
              '\nDecks changed in selfanki: created {created}, renamed {renamed}, deleted {removed} (cards deleted {cards_removed}, newer in Anki {anki_newer})'),
    'warn_deck': ('\n\nデッキを書けませんでした: {e}', '\n\nCould not write decks: {e}'),
    'busy': ('暗記との同期は、もう動いています。', 'A selfanki sync is already running.'),
    'schema_left': ('端末で変えたノートタイプ（フィールド・カードタイプの並びや数）と、ノートタイプを変えたノート {n} 件は、Anki に書きませんでした。書くには、もう一度「暗記と同期」をして、確認で「はい」を選んでください。',
                    '{n} note type change(s) made on the device (field/card type order or count, or notes moved to another note type) were not written to Anki. Sync with selfanki again and answer Yes to write them.'),
    'pairing': ('暗記につないでいます…', 'Connecting to selfanki…'),
    # 消す操作の確かめ（数を見せてから。自動の同期では聞かずに知らせるだけ）
    'pend_head': ('暗記の端末で消したものを、Anki にも反映しますか？（書く前に Anki のバックアップを取ってあります）\n',
                  'Apply deletions made on your selfanki devices to Anki as well? (An Anki backup was made before writing.)\n'),
    'pend_decks': ('\n・デッキ {n} 個（{names}）: 端末が知っていたカード {c} 枚を消します。端末が知らないカード（束を作ったあとに Anki で足したものなど）が残るデッキは、消さずに残します',
                   '\n- {n} deck(s) ({names}): delete the {c} card(s) the devices knew about. Decks that still hold cards unknown to the devices (e.g. added in Anki later) are kept'),
    'pend_notes': ('\n・ノート {n} 件を消します', '\n- Delete {n} note(s)'),
    'pend_gone': ('\n・Anki に無いノート {n} 件を、端末からも消します。Anki をバックアップから戻した直後などで、消したつもりが無いなら「Anki に入れ直す」を選んでください',
                  '\n- {n} note(s) missing in Anki will be deleted on the devices too. If you did not delete them (e.g. you just restored an Anki backup), choose "Re-add to Anki"'),
    'btn_delete': ('消す', 'Delete'), 'btn_readd': ('Anki に入れ直す', 'Re-add to Anki'), 'btn_later': ('いまはしない', 'Not now'),
    'pend_auto': ('暗記の端末で消したもの（{n} 件）の反映を待っています。「ツール」→「暗記」→「同期する」で確かめてください。',
                  'Deletions from your selfanki devices ({n}) are waiting. Use Tools → selfanki → Sync to review them.'),
    'schema_ask': ('暗記の端末で、ノートタイプの形（フィールド・カードの種類の並びや数）を変えました。Anki に書くと、次のようになります。\n\n{detail}\n\n{anki}\n\n書きますか？',
                   'Note type structure (fields / card types) was changed on your selfanki devices. Writing it to Anki will do the following:\n\n{detail}\n\n{anki}\n\nWrite it?'),
    'failed': ('暗記と同期できませんでした。\n\n{e}', 'Could not sync with selfanki.\n\n{e}'),
}


def t(k, **kw):
    s = _T[k][0 if _JA else 1]
    return s.format(**kw) if kw else s


def _cfg():
    return mw.addonManager.getConfig(__name__) or {}


# ---------- つなぐ先（プロファイルごと。アドオンの user_files に置くので、アドオンを更新しても消えない） ----------
def _links_path():
    d = os.path.join(mw.addonManager.addonsFolder(mw.addonManager.addonFromModule(__name__)), 'user_files')
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, 'links.json')


def _links():
    try:
        with open(_links_path(), encoding='utf-8') as f: return json.load(f)
    except (OSError, ValueError): return {}


def _save_links(d):
    p = _links_path()
    with open(p + '.tmp', 'w', encoding='utf-8') as f: json.dump(d, f, ensure_ascii=False)
    os.replace(p + '.tmp', p)
    try: os.chmod(p, 0o600)
    except OSError: pass


def connect():
    url, ok = getText(t('ask_url'), parent=mw, default=(_links().get(mw.pm.name) or {}).get('site_url', 'https://'))
    if not ok or not url.strip(): return
    try: url = core.site_origin(url)   # …/pair を貼っても、サイトの住所だけにする
    except core.SyncError as e: showWarning(str(e), parent=mw); return
    code, ok = getText(t('ask_code'), parent=mw)
    if not ok or not code.strip(): return
    profile = mw.pm.name

    def done(token):
        links = _links(); links[profile] = {'site_url': url, 'token': token}; _save_links(links)
        showInfo(t('connected', p=profile), parent=mw)

    def failed(e):
        showWarning(str(e) if isinstance(e, core.SyncError) else repr(e), parent=mw)
    # 通信は裏で（つながらないときに Anki の画面が止まらないように）
    QueryOp(parent=mw, op=lambda _col: core.pair(url, code), success=done).failure(failed).with_progress(t('pairing')).run_in_background()


def disconnect():
    links = _links()
    if mw.pm.name in links and askUser(t('confirm_disconnect'), parent=mw):
        del links[mw.pm.name]; _save_links(links); tooltip(t('disconnected'))


# ---------- 同期 ----------
def _message(s, dry):
    s = {**s, 'to_src': s.get('to_srv', 0)}
    marks = s.get('mark_add', 0) + s.get('mark_del', 0); conf = sum((s.get('conf') or {}).get(k, 0) for k in ('preset', 'new', 'deck'))
    nn = s.get('notes') or {}; nsum = sum(nn.get(k, 0) for k in ('added', 'updated', 'removed', 'gone_in_anki', 'skipped'))
    dd = s.get('decks') or {}; dsum = sum(dd.get(k, 0) for k in ('created', 'renamed', 'removed', 'cards_removed', 'anki_newer'))
    if not dry and not any(s.get(k) for k in ('to_anki', 'rev_to_anki', 'to_srv', 'rev_to_srv', 'verify_ng', 'conf_fail', 'note_fail', 'deck_fail')) and not marks and not conf and not nsum and not dsum and not s.get('pending'): return None
    m = t('dry_done' if dry else 'done', **s)
    if marks or conf: m += t('extra', marks=marks, conf=conf)
    if dsum: m += t('decks', **{k: dd.get(k, 0) for k in ('created', 'renamed', 'removed', 'cards_removed', 'anki_newer')})
    if s.get('deck_fail'): m += t('warn_deck', e=s['deck_fail'])
    if nsum: m += t('notes', **{k: nn.get(k, 0) for k in ('added', 'updated', 'removed', 'gone_in_anki', 'anki_newer', 'skipped')})
    if s.get('note_fail'): m += t('warn_note', e=s['note_fail'])
    if s.get('verify_ng'): m += t('warn_ng', n=s['verify_ng'])
    if s.get('conf_fail'): m += t('warn_conf', e=s['conf_fail'])
    pend = s.get('pending')
    if pend and dry:   # 試すとき: 同期すると確かめる消す操作の数
        if pend['decks'] or pend['deck_cards']: m += t('pend_decks', n=pend['decks'], names='、'.join(pend['deck_names']) or '-', c=pend['deck_cards'])
        if pend['notes_removed']: m += t('pend_notes', n=pend['notes_removed'])
        if pend['gone_in_anki']: m += t('pend_gone', n=pend['gone_in_anki'])
    return m


_running = False


def sync(dry=False, auto=False, allow_schema=False, allow_destructive=False, readd_missing=False):
    global _running
    link = _links().get(mw.pm.name)
    if not link:
        if not auto: showInfo(t('not_connected'), parent=mw)
        return
    if _running:   # 同期の途中でもう一度押した・Anki の同期のあとに続けたものと重なった
        if not auto: tooltip(t('busy'))
        return
    _running = True
    result = {}; profile = mw.pm.name

    def work(col):
        if mw.pm.name != profile: raise core.SyncError('プロファイルが切り替わったので止めました。')
        if not dry:
            # 書く前にバックアップを取る（Anki の「ファイル」→「バックアップから復元」で戻せる）
            col.create_backup(backup_folder=mw.pm.backupFolder(), force=True, wait_for_completion=True)
        result['s'] = core.run(col, link['site_url'], link['token'], dry=dry, log=lambda *a: print('[暗記と同期]', *a), allow_schema=allow_schema,
                               allow_destructive=allow_destructive, readd_missing=readd_missing)

    def done(*_):
        global _running
        _running = False
        s = result.get('s') or {}
        # 端末で変えたノートタイプの並び・数、ノートタイプの変更は、Anki ではスキーマの変更（次の AnkiWeb 同期が一方向）。何が変わるか（消えるフィールド・カードの数）を
        # 見せて、Anki の確認の文言も添えて、いつも聞く（Anki の confirm_schema_modification は、もうスキーマを変えてあると聞かずに通すため）。自動の同期では聞かない書く
        if s.get('schema_pending') and not dry and not allow_schema:
            if not auto:
                detail = '\n'.join('・' + x for x in (s.get('schema_detail') or [])) or '・' + t('schema_left', n=s['schema_pending'])
                anki_msg = mw.col.tr.qt_misc_the_requested_change_will_require_a() if not mw.col.schema_changed() else ''
                if askUser(t('schema_ask', detail=detail, anki=anki_msg), parent=mw, defaultno=True):
                    sync(auto=auto, allow_schema=True, allow_destructive=allow_destructive, readd_missing=readd_missing); return
            showInfo(t('schema_left', n=s['schema_pending']), parent=mw) if not auto else None
        # 消す操作: 数を見せて聞く（自動の同期では聞かずに知らせる）。「消す」「Anki に入れ直す」で、もう一度同期する
        pend = s.get('pending')
        if pend and not dry and not allow_destructive and not readd_missing:
            total = pend['deck_cards'] + pend['decks'] + pend['notes_removed'] + pend['gone_in_anki']
            if auto: tooltip(t('pend_auto', n=total), period=8000)
            else:
                msg = t('pend_head')
                if pend['decks'] or pend['deck_cards']: msg += t('pend_decks', n=pend['decks'], names='、'.join(pend['deck_names']) or '-', c=pend['deck_cards'])
                if pend['notes_removed']: msg += t('pend_notes', n=pend['notes_removed'])
                if pend['gone_in_anki']: msg += t('pend_gone', n=pend['gone_in_anki'])
                buttons = [t('btn_delete')] + ([t('btn_readd')] if pend['gone_in_anki'] else []) + [t('btn_later')]
                got = askUserDialog(msg, buttons, parent=mw).run()
                if got == t('btn_delete'): sync(allow_schema=allow_schema, allow_destructive=True); return
                if got == t('btn_readd'): sync(allow_schema=allow_schema, readd_missing=True); return
        m = _message(s, dry)
        if m is None: tooltip(t('nothing'))
        elif auto and not s.get('verify_ng') and not s.get('conf_fail') and not s.get('note_fail') and not s.get('deck_fail'): tooltip(m.replace('\n\n', '\n'), period=6000)
        else: showInfo(m, parent=mw)

    def failed(e):
        global _running
        _running = False
        showWarning(t('failed', e=e if isinstance(e, core.SyncError) else repr(e)), parent=mw)

    if dry:
        QueryOp(parent=mw, op=work, success=done).failure(failed).with_progress(t('syncing')).run_in_background()
    else:
        from anki.collection import OpChanges

        def op(col):
            work(col)
            # 画面（デッキ一覧・出題・ブラウザ）を読み直させる
            return OpChanges(card=True, note=True, deck=True, tag=True, deck_config=True, browser_table=True, study_queues=True)
        CollectionOp(parent=mw, op=op).success(done).failure(failed).run_in_background()


def _after_anki_sync():
    # Anki を閉じるとき（プロファイルを切り替えるときも）の自動同期のあとには続けない。閉じる流れはそのまま進んでコレクションを閉じるので、
    # 続けると暗記との同期が途中で止まる。閉じる途中の Anki は、同期の前に画面を使えなくしている（aqt main.py unloadCollection）
    if not mw.isEnabled() or mw.col is None or not _cfg().get('after_anki_sync'): return
    sync(auto=True)


def _setup_menu():
    m = QMenu(t('menu'), mw)
    for label, fn in (('sync', lambda: sync()), ('dry', lambda: sync(dry=True)), (None, None), ('connect', connect), ('disconnect', disconnect)):
        if label is None: m.addSeparator(); continue
        a = QAction(t(label), mw); a.triggered.connect(fn); m.addAction(a)
    mw.form.menuTools.addMenu(m)


_setup_menu()
gui_hooks.sync_did_finish.append(_after_anki_sync)

# 試験用: 環境変数 SELFANKI_ADDON_SELFTEST に結果を書くファイルの場所を入れると、プロファイルを開いたあと
# メニューの「同期する」と同じ流れ（バックアップ→同期→結果の表示）を通し、表示の代わりにファイルへ書いて Anki を閉じる
if os.environ.get('SELFANKI_ADDON_SELFTEST'):
    def _selftest():
        out = os.environ['SELFANKI_ADDON_SELFTEST']
        def record(msg, *a, **k):
            with open(out, 'w', encoding='utf-8') as f: f.write(str(msg))
            mw.progress.timer(800, mw.close, False)
        g = globals(); g['showInfo'] = g['showWarning'] = g['tooltip'] = record
        # 確かめの小窓にも自動で答える（聞いた文面は結果のファイルの後ろに残す）。SELFANKI_ADDON_PENDING＝delete・readd・later、SELFANKI_ADDON_SCHEMA＝1・0
        asked = out + '.asked'
        def note_ask(msg):
            with open(asked, 'a', encoding='utf-8') as f: f.write(str(msg) + '\n----\n')
        def ask_user(msg, *a, **k): note_ask(msg); return os.environ.get('SELFANKI_ADDON_SCHEMA', '1') == '1'
        class _Dlg:
            def __init__(self, msg, buttons, **k): self.msg, self.buttons = msg, buttons
            def run(self):
                note_ask(self.msg); want = {'delete': t('btn_delete'), 'readd': t('btn_readd'), 'later': t('btn_later')}.get(os.environ.get('SELFANKI_ADDON_PENDING', 'delete'))
                return want if want in self.buttons else self.buttons[-1]
        g['askUser'] = ask_user; g['askUserDialog'] = _Dlg
        sync(dry=os.environ.get('SELFANKI_ADDON_DRY') == '1')
    gui_hooks.profile_did_open.append(lambda: mw.progress.timer(1500, _selftest, False))
