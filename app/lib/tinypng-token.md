# 通过临时邮箱获取 TinyPNG API Key

TinyPNG 账号注册必须由服务端发起。服务端会经由配置的 HTTP 代理建立 CONNECT 隧道后再请求 TinyPNG，代理令牌仅保存在运行时 Secret 中。

请使用站内 TinyPNG 生成接口完成流程，不要在浏览器、终端或第三方客户端直接调用 `https://tinify.com/web/api`，也不要把代理令牌放入前端请求或脚本。

流程如下：

1. 服务端创建临时邮箱。
2. 服务端经 HTTP 代理提交 TinyPNG 注册请求。
3. 服务端接收验证邮件并解析 Magic Link。
4. 服务端使用 Magic Link 获取 Token、创建并启用 API Key。
