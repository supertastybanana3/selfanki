// 自動バックアップ（AnkiMobile・Anki と同じく、画像・音声を含めない .colpkg を端末に置く）。
// 決まりは rslib 25.09.4 collection/backup.rs のとおり: 名前は backup-%Y-%m-%d-%H.%M.%S.colpkg（端末の時刻）、
// 前のバックアップから「自動バックアップの間隔（分）」たっていて、コレクションが変わっていれば作る（「バックアップを作成」は間隔を見ない）。
// 間引き（BackupFilter）: 新しい順に、今日と昨日のものは全部残す。そのあと各日の代表（その日の最後）を daily 個、
// 各週（月曜はじまり）の代表を weekly 個、各月の代表を monthly 個残し、ほかは消す。
export const BK_DEF = { mins: 30, daily: 12, weekly: 10, monthly: 9 };
const p2 = n => String(n).padStart(2, '0');
export const backupName = (d = new Date()) => `backup-${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}.colpkg`;
export function parseBackupName(n) {
  const m = /^backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})\.(\d{2})\.(\d{2})\.colpkg$/.exec(n); if (!m) return null;
  const d = new Date(2000, 0, 1); d.setFullYear(+m[1], +m[2] - 1, +m[3]); d.setHours(+m[4], +m[5], +m[6], 0); return d;
}
// chrono の num_days_from_ce（0001-01-01 が 1 日目。グレゴリオ暦を過去へ延ばしたもの）を、その土地の日付で
const CE1 = (() => { const d = new Date(Date.UTC(2000, 0, 1)); d.setUTCFullYear(1, 0, 1); return d.getTime(); })();
export const dayCE = d => { const t = new Date(Date.UTC(2000, 0, 1)); t.setUTCFullYear(d.getFullYear(), d.getMonth(), d.getDate()); return Math.round((t.getTime() - CE1) / 864e5) + 1; };
const week = d => Math.trunc((dayCE(d) - 1) / 7);   // 月曜はじまりの通し番号
const month = d => d.getFullYear() * 12 + d.getMonth() + 1;
// 消すバックアップ（backups: [{ name, date }]、today: Date、limits: { daily, weekly, monthly }）。並びは新しい順
export function obsoleteBackups(backups, today, limits) {
  const lim = { daily: limits.daily, weekly: limits.weekly, monthly: limits.monthly };
  const yesterday = dayCE(today) - 1; let lastDay = Infinity, lastWeek = Infinity, lastMonth = Infinity; const out = [];
  const fresh = (stage, b) => { lastDay = dayCE(b.date); lastWeek = week(b.date); lastMonth = month(b.date); if (stage) lim[stage]--; };
  const freshOr = (stage, b) => {
    const keep = stage === 'daily' ? dayCE(b.date) < lastDay : stage === 'weekly' ? week(b.date) < lastWeek : month(b.date) < lastMonth;
    if (keep) fresh(stage, b); else out.push(b);
  };
  for (const b of [...backups].sort((a, c) => c.date - a.date)) {
    if (dayCE(b.date) >= yesterday) fresh(null, b);
    else if (lim.daily > 0) freshOr('daily', b);
    else if (lim.weekly > 0) freshOr('weekly', b);
    else if (lim.monthly > 0) freshOr('monthly', b);
    else out.push(b);
  }
  return out;
}
