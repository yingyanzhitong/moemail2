# Changelog

All notable changes to this project will be documented in this file.

## [1.10.2] - 2026-02-01

### Features

- TinyPNG: 自动批量注册模式增加速率限制（2个/秒），防止触发 TinyPNG API 频率限制

## [1.10.1] - 2026-02-01

### Features

- TinyPNG: 手动注册模式支持批量生成，与自动模式共享每日/单次限额
- TinyPNG: 优化手动模式 UI，错误信息独立显示，避免与自动模式混淆
- TinyPNG: 新增 "Copy All cURL" 功能，方便一键复制所有注册脚本

## [1.10.0] - 2026-02-01

### Features

- TinyPNG: 新增手动注册模式 ("Manual Mode")，支持生成 cURL/Python/Node.js 注册脚本，解决服务器 IP 受限问题
- TinyPNG: 弹窗支持多语言 (i18n)

## [1.9.1] - 2026-01-30

### Database

- 提交 `api_usage_stats` 表的数据库迁移文件 (0021_clear_mindworm.sql)

## [1.9.0] - 2026-01-30

### Features

- 皇帝角色个人中心增加用户统计看板（总用户、今日新增）
- 新增用户列表页面，展示注册时间、邮箱数、TinyPNG Token 数
- 实现 API 调用次数统计与展示
- 优化角色管理面板 UI

### Database

- 新增 `api_usage_stats` 表用于记录 API 调用统计

## [1.8.0] - 2026-01-29

### Features

- 新增修改密码功能 (个人中心)
- 优化修改密码入口为高亮按钮


## [1.7.0] - 2026-01-29

### Features

- 添加 skills 技能文件系统，沉淀开发经验
- TinyPNG 邮箱列表显示官方 favicon 图标
- 点击邮箱自动选择最新一封邮件

### Bug Fixes

- 优化 send-permission 请求缓存，5分钟内不重复请求
- 点击已选中邮箱不再重复加载消息

## [1.6.0] - 2026-01-29

### Features

- 添加自动化发布脚本，支持版本升级、changelog、tag和推送 (ccdeb45)
- [master]修改图标，优化邮件选择 (54d28ca)
- [master]修复批量请求 (bec4c1e)
- [master]1.修复按钮展示，2.修复tinypng的apikey生成 (3d62f78)

### Bug Fixes

- 优化邮箱选择逻辑和send-permission请求缓存 (1a6509d)

