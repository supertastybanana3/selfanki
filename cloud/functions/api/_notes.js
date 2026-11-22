// ノートの表（notes）と画像・音声の表（media）。前の版の schema.sql で作った置き場には無い・列が足りないので、無ければ作る（1つの実行で1回だけ確かめる）
let ready = false;
export async function ensureNotes(DB) {
  if (ready) return;
  await DB.batch([
    DB.prepare('create table if not exists notes (id integer primary key, mid integer not null, flds text not null, tags text not null, did integer not null, cards text not null, rev integer not null, src text not null, del integer not null default 0, added integer not null default 0, seq integer not null, guid text, imp integer not null default 0)'),
    DB.prepare('create index if not exists notes_seq on notes(seq, id)'),
    DB.prepare('create table if not exists media (name text primary key, size integer not null, sha1 text not null, parts integer not null, rev integer not null, src text not null, seq integer not null)'),
    DB.prepare('create table if not exists media_part (name text not null, i integer not null, data blob not null, primary key (name, i))'),
  ]);
  // 前の版の notes には guid・imp の列が無い
  const cols = new Set(((await DB.prepare('pragma table_info(notes)').all()).results || []).map(r => r.name));
  const add = [];
  if (!cols.has('guid')) add.push(DB.prepare('alter table notes add column guid text'));
  if (!cols.has('imp')) add.push(DB.prepare('alter table notes add column imp integer not null default 0'));
  if (add.length) await DB.batch(add);
  ready = true;
}
