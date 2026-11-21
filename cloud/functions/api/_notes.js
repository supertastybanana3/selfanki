// ノートの表（notes）。前の版の schema.sql で作った置き場には無いので、無ければ作る（1つの実行で1回だけ確かめる）
let ready = false;
export async function ensureNotes(DB) {
  if (ready) return;
  await DB.batch([
    DB.prepare('create table if not exists notes (id integer primary key, mid integer not null, flds text not null, tags text not null, did integer not null, cards text not null, rev integer not null, src text not null, del integer not null default 0, added integer not null default 0, seq integer not null)'),
    DB.prepare('create index if not exists notes_seq on notes(seq, id)'),
  ]);
  ready = true;
}
