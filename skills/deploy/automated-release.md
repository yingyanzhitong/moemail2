---
description: AI 完成代码改动后的发布工作流，自动使用该skill
---

# 要使用pnpm deploy，不要用pnpm deploy:local

# AI 发布工作流

当 AI 完成代码改动后，需要按照以下流程进行发布。

## 发布流程

### 1. 更新 CHANGELOG.md

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

### 2. 更新 package.json 版本号

根据改动类型决定版本升级：

| 改动类型 | 版本升级 | 示例 |
|---------|---------|------|
| Bug 修复 (fix) | patch | 1.5.1 → 1.5.2 |
| 新功能 (feat) | minor | 1.5.1 → 1.6.0 |
| 破坏性变更 | major | 1.5.1 → 2.0.0 |

修改 `package.json` 中的 `version` 字段。

### 3. 提交更改

```bash
git add -A
git commit -m "chore(release): vX.X.X"
```

### 4. 创建 Tag

Tag 格式：`v` + 版本号

```bash
git tag -a vX.X.X -m "Release vX.X.X"
```

### 5. 推送到远程

```bash
git push origin master
git push origin --tags
```

### 6. 执行部署（可选）

```bash
pnpm run deploy
```

## 完整命令示例

假设新版本为 `1.7.0`：

```bash
# 1. 先手动更新 CHANGELOG.md 和 package.json

# 2. 提交
git add -A
git commit -m "chore(release): v1.7.0"

# 3. 创建 tag
git tag -a v1.7.0 -m "Release v1.7.0"

# 4. 推送
git push origin master
git push origin --tags

# 5. 部署
pnpm run deploy
```

## CHANGELOG 格式示例

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [1.7.0] - 2024-01-29

### Features

- 添加 TinyPNG API Key 查看功能
- 邮箱列表中显示 TinyPNG 标识

### Bug Fixes

- 优化 send-permission 请求缓存
- 点击已选中邮箱不再重复加载

## [1.6.0] - 2024-01-28

### Features

- 添加自动化发布脚本
```

## 注意事项

1. **先更新文件，再提交**：确保 CHANGELOG.md 和 package.json 都已更新
2. **版本号一致**：package.json 版本、commit 消息、tag 名称要一致
3. **Tag 格式**：必须是 `v` + 版本号（如 `v1.7.0`）
4. **推送顺序**：先推送分支，再推送 tags
