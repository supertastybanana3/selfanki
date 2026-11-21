# 最初の1回だけ: Cloudflare に置き場（Pages のプロジェクト＋D1 のデータベース）を作り、合言葉を作って入れる。
#   python tools/setup_cloud.py
# 何度動かしても壊れない（できているものは飛ばす）。合言葉は画面に出さない。
import json, os, re, secrets, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

def main():
    cfg = load_config(required=('project_name',))
    name = cfg['project_name']
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,56}[a-z0-9]', name):
        raise SetupError('"project_name" は英小文字・数字・ハイフンだけで、2〜58文字にしてください（例: myanki）。')
    # 1. Cloudflare にログインしているか
    r = wrangler(['whoami'], check=False)
    if r.returncode != 0 or 'not authenticated' in (r.stdout + r.stderr).lower():
        raise SetupError('Cloudflare にログインしていません。次を動かしてブラウザでログインしてから、もう一度これを動かしてください:\n  npx --yes wrangler@4.165.0 login')
    print('[1/6] Cloudflare にログイン済み')
    # 2. 合言葉
    tp = token_path(cfg)
    if not os.path.exists(tp):
        os.makedirs(os.path.dirname(tp), exist_ok=True)
        with open(tp, 'w', encoding='utf-8') as f: f.write(secrets.token_urlsafe(32))
        try: os.chmod(tp, 0o600)
        except OSError: pass
        print(f'[2/6] 合言葉を作って {tp} に保存した（中身は表示しない。このファイルは誰にも渡さない・git に入れない）')
    else: print(f'[2/6] 合言葉はもうある（{tp}）')
    tok = read_token(cfg)
    # 3. D1（答えの記録の置き場）
    dbs = json.loads(wrangler(['d1', 'list', '--json']).stdout)
    db = next((d for d in dbs if d.get('name') == name), None)
    if not db:
        wrangler(['d1', 'create', name] + (['--location', cfg['d1_location']] if cfg.get('d1_location') else []))
        dbs = json.loads(wrangler(['d1', 'list', '--json']).stdout); db = next((d for d in dbs if d.get('name') == name), None)
        if not db: raise SetupError('D1 のデータベースを作ったはずなのに見つかりません。少し待ってからもう一度動かしてください。')
        print(f'[3/6] D1 のデータベース {name} を作った')
    else: print(f'[3/6] D1 のデータベース {name} はもうある')
    # 4. wrangler.toml（Pages から D1 を使うための設定）を書き、表を作る
    with open(os.path.join(CLOUD, 'wrangler.toml'), 'w', encoding='utf-8') as f:
        f.write(f'# tools/setup_cloud.py が作ったファイル（手で直さない）\nname = "{name}"\npages_build_output_dir = "site"\n'
                f'compatibility_date = "2026-10-01"\n\n[[d1_databases]]\nbinding = "DB"\ndatabase_name = "{name}"\ndatabase_id = "{db["uuid"]}"\n')
    wrangler(['d1', 'execute', name, '--remote', '--file', 'schema.sql', '--yes'])
    print('[4/6] wrangler.toml を書いて、D1 に表を作った（schema.sql）')
    # 5. Pages のプロジェクト
    projects = json.loads(wrangler(['pages', 'project', 'list', '--json']).stdout)
    p = next((x for x in projects if x.get('Project Name') == name), None)
    if not p:
        wrangler(['pages', 'project', 'create', name, '--production-branch', 'main'])
        projects = json.loads(wrangler(['pages', 'project', 'list', '--json']).stdout); p = next((x for x in projects if x.get('Project Name') == name), None)
        print(f'[5/6] Pages のプロジェクト {name} を作った')
    else: print(f'[5/6] Pages のプロジェクト {name} はもうある')
    domain = (p or {}).get('Project Domains', '').split(',')[0].strip() or f'{name}.pages.dev'
    # 6. 合言葉を Pages の secret（SA_TOKEN）に入れる（標準入力で渡すので画面にもログにも出ない）
    wrangler(['pages', 'secret', 'put', 'SA_TOKEN', '--project-name', name], input_text=tok + '\n')
    print('[6/6] 合言葉を Pages の secret SA_TOKEN に入れた')
    url = f'https://{domain}'
    if cfg.get('site_url', '').rstrip('/') != url:
        cfg['site_url'] = url
        json.dump(cfg, open(CONFIG_PATH, 'w', encoding='utf-8'), ensure_ascii=False, indent=2)
        print(f'config.json の "site_url" を {url} にした')
    print(f'\nできました。あなたのサイトは {url} です（まだ中身は空。次は README の「手順 5」＝Anki から書き出して上げる）。')

if __name__ == '__main__':
    try: main()
    except SetupError as e: die(str(e))
