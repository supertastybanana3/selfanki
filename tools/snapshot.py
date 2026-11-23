# Anki のコレクション（collection.anki2）の写しを cloud/state/snap/ に取る。本物のファイルには書かない。
#   python tools/snapshot.py         → 写しの場所を表示
# Anki を開いたままでも取れるが、勉強中（書き込み中）に取ると壊れた写しになることがあるので、写しが壊れていないか確かめる。
import glob, os, shutil, sqlite3, sys, time, datetime, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
KEEP = 20

def take(cfg, tag=''):
    src = expand(cfg.get('anki_collection') or '')
    if not src or not os.path.isfile(src):
        raise SetupError(L(f'Anki のコレクションが見つかりません: "{src}"。config.json の "anki_collection" に collection.anki2 の場所を書いてください（README の「手順 2」）。',
                           f'Anki collection not found: "{src}". Put the path of collection.anki2 in "anki_collection" in config.json (README "Step 2").'))
    base = os.path.join(STATE, 'snap'); os.makedirs(base, exist_ok=True)
    for attempt in range(3):
        out = os.path.join(base, datetime.datetime.now().strftime('%Y%m%d_%H%M%S') + (('_' + tag) if tag else ''))
        os.makedirs(out, exist_ok=True)
        for suffix in ('', '-wal'):
            if os.path.exists(src + suffix): shutil.copy2(src + suffix, os.path.join(out, 'collection.anki2' + suffix))
        db = os.path.join(out, 'collection.anki2')
        try:
            c = sqlite3.connect(db)
            # Anki の表は独自の並び順 unicase を使うので、同じ名前で（大文字小文字を区別しない）並び順を登録してから確かめる
            c.create_collation('unicase', lambda a, b: (a.casefold() > b.casefold()) - (a.casefold() < b.casefold()))
            ok = c.execute('pragma quick_check').fetchone()[0] == 'ok'
            if ok: c.execute('pragma wal_checkpoint(TRUNCATE)'); c.execute('pragma journal_mode = delete')
            info = {'path': db, 'cards': c.execute('select count(*) from cards').fetchone()[0], 'revlog': c.execute('select count(*) from revlog').fetchone()[0]} if ok else None
            c.close()
        except sqlite3.DatabaseError: ok = False
        if ok: break
        shutil.rmtree(out, ignore_errors=True); time.sleep(5)
    else: raise SetupError(L('コレクションの写しが3回とも壊れていました。Anki で勉強や編集をしていないときに、もう一度動かしてください。',
                             'The copy of the collection was corrupted all 3 times. Run this again while you are not studying or editing in Anki.'))
    for d in sorted(glob.glob(os.path.join(base, '2*')))[:-KEEP]: shutil.rmtree(d, ignore_errors=True)
    return info

if __name__ == '__main__':
    try: print(json.dumps(take(load_config(), sys.argv[1] if len(sys.argv) > 1 else ''), ensure_ascii=False))
    except SetupError as e: die(str(e))
