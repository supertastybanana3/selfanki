- `after_anki_sync`: `true` にすると、Anki の「同期」（AnkiWeb）が終わったあとに、続けて暗記とも同期する。既定は `false`（「ツール」→「暗記」→「同期する」を押したときだけ）。
  Anki を閉じるときの自動同期のあとには続けない。暗記から Anki に入った分が AnkiWeb に上がるのは、次に Anki で同期したとき。

つなぐ先（暗記のサイトの住所と合言葉）はここではなく、「ツール」→「暗記」→「つなぐ」で6桁の番号を入れて、プロファイルごとに覚えさせる。

---

- `after_anki_sync`: `true` also syncs with selfanki right after Anki's own sync (AnkiWeb) finishes. Default `false` (sync only from Tools → selfanki → Sync).
  It does not run after the automatic sync when Anki closes. Reviews brought in from selfanki reach AnkiWeb on Anki's next sync.

The site address and passphrase are not set here. Use Tools → selfanki → Connect and enter the 6-digit code; it is remembered per profile.
