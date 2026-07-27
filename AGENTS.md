# moemail 项目规则

## 提交与发布流程

本项目通过 GitHub Actions 自动部署 Cloudflare Workers，不需要在本地执行 `wrangler deploy`。

### 普通提交（默认）

普通提交不发布，不创建或推送 git tag：

1. 更新 `CHANGELOG.md`（记录变更内容和日期）
2. 递增 `package.json` 中的版本号
3. `git commit` 并 `git push origin master`

### 发布（仅在用户明确标记“发布”时）

只有用户明确说明“发布”后，才创建并推送对应 tag：

- 网页部署：`git tag vX.Y.Z && git push origin vX.Y.Z`
- 桌面端发布：`git tag desktop-vX.Y.Z && git push origin desktop-vX.Y.Z`

推送 `v*` tag 后，GitHub Actions 会自动触发 `.github/workflows/deploy.yml` 完成网页部署；推送 `desktop-v*` tag 后，GitHub Actions 会构建桌面端并同步 GitHub 与 Gitee Release。

## TinyPNG 桌面端产品约束

- 软件使用的 TinyPNG 压缩 API 以近似无损优化为主，**不需要将压缩倍率或压缩率作为功能决策、发布门槛或验收指标**。
- 可继续展示单张和批次压缩率作为结果信息，但不得据此拒绝任务、改变压缩策略或判断任务成败；优先保证压缩成功、原图保护和结果文件可用。
