# moemail 项目规则

## 部署流程

本项目通过 GitHub Actions 自动部署 Cloudflare Workers，不需要在本地执行 `wrangler deploy`。

部署步骤：
1. 更新 `CHANGELOG.md`（记录变更内容和日期）
2. 递增 `package.json` 中的版本号
3. `git commit` 并 `git push origin master`
4. 创建 git tag 并推送：`git tag vX.Y.Z && git push origin vX.Y.Z`

推送 `v*` tag 后，GitHub Actions 会自动触发 `.github/workflows/deploy.yml` 完成部署。
