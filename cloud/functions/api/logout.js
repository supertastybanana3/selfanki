// 設定＞同期の「ログアウト」: この端末の合言葉のクッキー（sa）を消す。もう一度使うには、パソコンで出した番号を /pair で入れ直す
export const onRequestPost = () => new Response(JSON.stringify({ ok: true }), {
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'set-cookie': 'sa=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax' },
});
