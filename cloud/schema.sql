-- 自作暗記アプリの同期の置き場所（D1）。カードの中身と、移行した時点の状態は静的ファイル（site/bundle）にあり、
-- ここにはそれ以降の「変わった分」だけを積む。seq は書き込みごとに 1 ずつ増える通し番号（端末はこれで差分を取る）
create table if not exists cards (
  id  integer primary key,      -- Anki のカード id
  st  text    not null,         -- 状態の JSON {type,queue,due,ivl,factor,reps,lapses,left,data,...}
  rev integer not null,         -- この状態の新しさ（ミリ秒）。答え＝その記録の id、Anki 側＝max(カードの mod, 最後の記録)
  src text    not null,         -- 'app'＝自作アプリ／'anki'＝Anki（AnkiMobile など）から
  seq integer not null
);
create index if not exists cards_seq on cards(seq, id);
create table if not exists revlog (
  id integer primary key, cid integer not null, ease integer, ivl integer, lastIvl integer, factor integer, time integer, type integer,
  src text not null, del integer not null default 0, seq integer not null
);
create index if not exists revlog_seq on revlog(seq, id);
create index if not exists revlog_cid on revlog(cid);
create table if not exists kv (k text primary key, v integer not null);
insert or ignore into kv(k, v) values ('seq', 0);
-- デッキのオプション（プリセット・デッキの割り当てと上限・全体の設定）。k＝'preset:<id>'・'deck:<did>'・'global'、v＝JSON
create table if not exists conf (k text primary key, v text not null, rev integer not null, src text not null, seq integer not null);
-- 端末で追加・編集・削除したノート（束の上に重ねる）。flds＝フィールドの JSON 配列、tags＝空白区切り、cards＝JSON [[カードの id, ord, デッキ, 新規の位置], …]、
-- rev＝新しさ（ミリ秒）、src＝'app'（端末で変えた）／'anki'（アドオンが Anki に書いた・Anki で消えていた）、del＝1 なら消した、added＝1 なら端末で作ったノート
create table if not exists notes (id integer primary key, mid integer not null, flds text not null, tags text not null, did integer not null, cards text not null,
  rev integer not null, src text not null, del integer not null default 0, added integer not null default 0, seq integer not null);
create index if not exists notes_seq on notes(seq, id);
-- 別の端末を足すときの使い捨ての番号（h＝'pair:'+番号 の SHA-256、exp＝期限のミリ秒）。pair_code.py が入れ、/pair が使ったら消す
create table if not exists pair (h text primary key, exp integer not null);
