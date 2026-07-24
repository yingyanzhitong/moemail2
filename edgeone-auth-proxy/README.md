# Moemail EdgeOne API Relay

该 EdgeOne Makers 项目用于把客户端的授权请求转发至 Moemail 服务，生产域名为
`https://auth.xyyamsz.cn`。

允许的接口：

- `POST /api/emails/generate`
- `POST /api/tinypng/desktop/grants/preview`
- `GET /api/tinypng/desktop/license`
- `POST /api/tinypng/desktop/redeem`
- `POST /api/tinypng/desktop/usage/reports`
- `POST /api/tinypng/desktop/usage/session`

其他路径会返回 `404`，允许路径使用错误方法会返回 `405`。所有响应均设置
`Cache-Control: no-store`，避免授权信息被边缘缓存。

```bash
npm test
edgeone makers deploy -n moemail-auth-relay -a overseas
```

`xyyamsz.cn` 暂未完成中国大陆 ICP 备案，因此项目使用 EdgeOne
“全球（不含中国大陆）”区域。域名完成备案后，可将项目迁移至包含中国大陆节点的区域。
