---
description: 标准发布的完整工作流 (Reference: skills/deploy/automated-release.md)
---

# 标准发布与部署流程

本工作流完整复刻 `skills/deploy/automated-release.md` 的规范。当需要发布新版本时，必须严格执行所有步骤。

## 1. 更新变更日志 (CHANGELOG.md)

根据本次改动内容，在 `CHANGELOG.md` 文件顶部（标题下方）添加新版本记录：

```markdown
## [x.x.x] - YYYY-MM-DD

### Features
- 新增的功能描述

### Bug Fixes
- 修复的问题描述

### Other
- 其他改动描述
```

## 2. 更新版本号 (package.json)

根据改动类型决定版本升级：

| 改动类型 | 版本升级 | 示例 |
|---------|---------|------|
| Bug 修复 (fix) | patch | 1.5.1 → 1.5.2 |
| 新功能 (feat) | minor | 1.5.1 → 1.6.0 |
| 破坏性变更 | major | 1.5.1 → 2.0.0 |

**操作**：修改 `package.json` 中的 `version` 字段，使其与 CHANGELOG 保持一致。

## 3. 提交更改 (Commit)

```bash
git add -A
git commit -m "chore(release): vX.X.X"
```
*(注意：Commit 信息必须严格匹配版本号)*

## 4. 创建标签 (Tag)

Tag 格式必须是 `v` + 版本号：

```bash
git tag -a vX.X.X -m "Release vX.X.X"
```

## 5. 推送到远程 (Push)

推送代码和标签到远程仓库（Github Actions 会监听 Tags 推送并自动部署）：

```bash
git push origin master
git push origin --tags
```

## 6. 执行部署 (可选兜底)

如果仅仅是推送到 Github 需要等待 Action，如果需要手动立即触发 Cloudflare 部署作为兜底：

```bash
pnpm run deploy
```

> **注意事项**
> 1. 严禁使用 `pnpm deploy:local` 进行生产环境发布。
> 2. 确保 `package.json` 版本、`CHANGELOG.md` 标题、Git Tag 和 Commit Message 中的版本号四者完全一致。
