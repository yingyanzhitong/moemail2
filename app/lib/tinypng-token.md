# 通过临时邮箱获取 TinyPNG API Key

TinyPNG 账号注册必须由服务端发起。服务端优先经由配置的 HTTP 中转请求 TinyPNG，代理令牌仅保存在运行时 Secret 中；中转不可用时才会降级为服务端直连。

请使用站内 TinyPNG 生成接口完成流程，不要在浏览器、终端或第三方客户端直接调用 `https://tinify.com/web/api`，也不要把代理令牌放入前端请求或脚本。

流程如下：

1. 服务端创建临时邮箱。
2. 服务端优先经 HTTP 中转提交 TinyPNG 注册请求；中转连接或响应超过 10 秒、或中转返回 HTTP 502 时自动改为直连，并记录降级原因。
3. 服务端接收验证邮件并解析 Magic Link。
4. 服务端使用 Magic Link 获取 Token、创建并启用 API Key。
