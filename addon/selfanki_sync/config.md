- `after_anki_sync`: `true` にすると、Anki の「同期」（AnkiWeb）が終わったあとに、続けて暗記とも同期する。既定は `false`（「ツール」→「暗記」→「同期する」を押したときだけ）。
  Anki を閉じるときの自動同期のあとには続けない。暗記から Anki に入った分が AnkiWeb に上がるのは、次に Anki で同期したとき。
  `true`: also sync with selfanki after Anki's own sync finishes. Default `false` (sync only from Tools > selfanki > Sync).
  Not run after the automatic sync when Anki closes. Reviews brought in from selfanki reach AnkiWeb on Anki's next sync.

つなぐ先（暗記のサイトの住所と合言葉）はここではなく、「ツール」→「暗記」→「つなぐ」で6桁の番号を入れて、プロファイルごとに覚えさせる。
