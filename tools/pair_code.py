# スマホ・iPad・別のパソコンで暗記を使えるようにする: 使い捨ての6桁の番号を作る（15分・1回きり・5回まちがえると全部消える）
#   python tools/pair_code.py
# 表示された番号を、使いたい端末のブラウザ（か iOS の殻）で <site_url>/pair を開いて入れる。合言葉そのものは端末に打たなくてよい
import hashlib, os, secrets, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *
try:
    cfg = load_config(required=('project_name',))
    local = '--local' in sys.argv   # 手元の試験（wrangler pages dev）用
    code = f'{secrets.randbelow(10**6):06d}'
    h = hashlib.sha256(('pair:' + code).encode()).hexdigest(); now = int(time.time() * 1000); exp = now + 15 * 60 * 1000
    sql = f"create table if not exists pair (h text primary key, exp integer not null); delete from pair where exp < {now}; insert into pair(h, exp) values ('{h}', {exp});"
    wrangler(['d1', 'execute', cfg['project_name'], '--local' if local else '--remote', '--command', sql, '--yes'])
    url = 'http://127.0.0.1:8788' if local else site_url(cfg)
    print(L(f'番号: {code}（{time.strftime("%H:%M", time.localtime(exp / 1000))} まで有効）', f'Pairing code: {code} (valid until {time.strftime("%H:%M", time.localtime(exp / 1000))})'))
    print(L(f'端末で {url}/pair を開いて、この番号を入れてください。', f'On your device, open {url}/pair and enter this code.'))
except SetupError as e: die(str(e))
