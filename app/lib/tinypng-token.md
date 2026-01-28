# 通过临时邮箱获取 TinyPNG API Key

1.通过moemail openapi生成临时邮箱
curl -X POST https://moemail.tinypng-token.site/api/emails/generate \
  -H "X-API-Key: mk_XK1IQ0TC-OYvsIsRA2m7TrldUV1a31DK" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test",
    "expiryTime": 3600000,
    "domain": "tinypng-token.site"
  }'
2.请求tinypng的注册接口，生成tinypng账号
curl 'https://tinify.com/web/api' \
  -H 'accept: application/json, text/plain, */*' \
  -H 'accept-language: zh-CN,zh;q=0.9' \
  -H 'cache-control: no-cache' \
  -H 'content-type: application/json' \
  -H 'origin: https://tinify.com' \
  -H 'pragma: no-cache' \
  -H 'priority: u=1, i' \
  -H 'referer: https://tinify.com/developers' \
  -H 'sec-ch-ua: "Google Chrome";v="143", "Chromium";v="143", "Not A(Brand";v="24"' \
  -H 'sec-ch-ua-mobile: ?0' \
  -H 'sec-ch-ua-platform: "macOS"' \
  -H 'sec-fetch-dest: empty' \
  -H 'sec-fetch-mode: cors' \
  -H 'sec-fetch-site: same-origin' \
  -H 'user-agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36' \
  --data-raw '{"fullName":"${生成的临时邮箱}","mail":"${生成的临时邮箱}"}'

3.通过moemail openapi获取临时邮箱的邮件，解析出magic link
4.通过magic link获取token
5.通过token获取api key
6.把获取的api key启用，并输出