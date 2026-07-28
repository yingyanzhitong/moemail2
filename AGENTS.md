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

### 桌面端发布后的飞书下载链接同步

每次 `desktop-v*` 发布工作流成功、且 Gitee Release 的安装包已可匿名下载后，必须更新飞书文档《TinyPNG 压缩助手：安装与使用指南》：

- 文档地址：`https://my.feishu.cn/docx/Jb3fdvkTYoR5HdxaBejcYDW0nRg`
- 更新文档中的版本号、统一 Gitee 发行页链接，以及 Windows x64、macOS Apple 芯片（aarch64）和 macOS Intel（x64）三项安装包直达下载链接。
- 仅指向 `.exe` 或 `.dmg` 安装包；不得把 Source code、`.sig` 或 `updater.app.tar.gz` 写为人工下载入口。
- 更新完成后，使用匿名请求验证三个直达链接均可访问，再汇报发布完成。

## TinyPNG 桌面端产品约束

- 软件使用的 TinyPNG 压缩 API 以近似无损优化为主，**不需要将压缩倍率或压缩率作为功能决策、发布门槛或验收指标**。
- 可继续展示单张和批次压缩率作为结果信息，但不得据此拒绝任务、改变压缩策略或判断任务成败；优先保证压缩成功、原图保护和结果文件可用。
