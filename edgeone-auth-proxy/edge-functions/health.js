export default function onRequest() {
  return new Response(
    JSON.stringify({
      service: 'moemail-auth-proxy',
      status: 'ok',
    }),
    {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
      },
    },
  )
}
