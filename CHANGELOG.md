# Changelog

All notable changes to this project will be documented in this file.
## [1.11.18] - 2026-02-02

### Bug Fixes

- 修复从 TinyPNG Pool 获取 Key 后邮箱未归属到新用户的问题

### Features

- 新增首页 Footer：包含链接、法律条款、联系方式（GitHub/Telegram）
- 品牌重命名：MoeMail → SnapMail

### i18n

- 新增 Footer 多语言支持（中文简繁、英语、日语、韩语）

## [1.11.17] - 2026-02-02

### Bug Fixes

- 修复 TinyPNG Pool "Used" 统计始终为 0 的问题：从 Pool 获取 Key 后更新状态为 `used` 而非删除记录

### Improvements

- 优化 TinyPNG Pool Worker 定时任务频率：从每 5 分钟改为每 30 分钟，减少请求频率
- 优化清理逻辑：`registration_failed` 状态记录在下个周期直接删除，`pending` 状态记录超过 30 分钟后删除

## [1.11.16] - 2026-02-02

### Improvements

- 优化 TinyPNG Pool Worker: 自动清理超过10分钟且状态为 REGISTRATION_FAILED 的记录
- 优化 TinyPNG Pool 列表页：使用 Tooltip 展示完整错误信息

## [1.11.15] - 2026-02-02

### Other

- 添加标准发布流程工作流 (.agent/workflows/deploy.md)

## [1.11.14] - 2026-02-02

### Improvements

- 优化 TinyPNG Pool 列表页：支持无限滚动加载 (IntersectionObserver)，优化排序 (Active 优先)，支持列表刷新
- 优化 TinyPNG Pool Worker: 自动清理超过10分钟的 stale tasks
- 优化 TinyPNG Pool Worker: 记录注册失败原因 (registration_failed) 并入库，不再卡在 pending 状态
- 数据库: `tinypng_key_pool` 表新增 `status` 状态 `registration_failed` 和 `errorMessage` 字段

## [1.11.13] - 2026-02-02

### Bug Fixes

- 修复 GitHub Actions 部署流程中的 action 引用错误 (x-actions/website-check not found)

## [1.11.12] - 2026-02-02

### Bug Fixes

- 修复未使用的导入 (unused imports) 和 React Key 报错

## [1.11.11] - 2026-02-02

### Improvements

- 移除手动批量获取 TinyPNG Key 的功能，精简界面
- 自动批量获取增加邮箱有效期选项（1小时 - 30天），默认 1 小时

## [1.11.10] - 2026-02-02

### Improvements

- SEO 增强：增加 `robots.txt` 和 `sitemap.xml` 自动生成 (app/robots.ts, app/sitemap.ts)
- SEO 关键词优化：在中英文 Metadata 中突出 "免费 (Free)", "TinyPNG Token", "批量生成" 等关键词

## [1.11.9] - 2026-02-02

### Improvements

- 优化 TinyPNG Pool 状态机：支持 `pending` (临时邮箱已创建) -> `registered` (已注册) -> `link_received` (收到邮件) -> `active` (账号激活)
- 优化 Pool 逻辑：任务失败的 `pending` 记录将保留，并在后续周期中重试注册，解决 IP 速率限制问题
- SEO 优化：页面标题增加“临时邮箱”、“批量生成 TinyPNG Token”等关键词

## [1.11.8] - 2026-02-02

### Improvements

- 调整 TinyPNG Pool 邮箱有效期逻辑：池中未分配的邮箱有效期延长至 1 年（视为永久），分配后自动调整为 1 小时过期

## [1.11.7] - 2026-02-02

### Improvements

- 优化 TinyPNG 批量生成接口: 优先从缓冲池 `active` 状态的账号中获取，不足部分再新注册

## [1.11.6] - 2026-02-02

### Bug Fixes

- 优化 TinyPNG Pool Worker: 每次执行前自动清理 Pending 状态的记录，防止任务堆积

## [1.11.5] - 2026-02-02

### Bug Fixes

- 修复 TinyPNG Pool Worker 注册请求逻辑，统一使用 `tinify.com/web/api`
- 修复 Email Receiver Worker 中的 Key 提取逻辑，从 HTML 解析改为使用 Bearer Token 调用 API (与前端生成逻辑一致)

## [1.11.4] - 2026-02-02

### Bug Fixes

- 修复 TinyPNG 账号激活一直处于 Pending 的问题 (优化邮件接收和 Cookie 处理逻辑)
- 修复 API Key 删除时的确认弹窗逻辑

## [1.11.3] - 2026-02-02

### Other

- 重新触发部署流程 (CI/CD)

## [1.11.2] - 2026-02-02

### Bug Fixes

- 修复个人中心 TinyPNG Keys 和 API Key 面板的无限循环请求问题 (useCallback 优化)

## [1.11.1] - 2026-02-02

### Bug Fixes

- 修复部署脚本中的 Eslint 错误和 React Hook 依赖警告
- 更新 TinyPNG Pool Worker 默认域名为 `tinypng-token.site`

## [1.11.0] - 2026-02-02

### Features

- TinyPNG: 新增后台自动缓冲池 (Pool) 功能，每5分钟自动申请 Key (上限500个)
- TinyPNG: 用户申请 Key 时优先从缓冲池获取，秒级响应
- TinyPNG: 缓冲池 Key 将在分发给用户时自动延长关联邮箱有效期至1小时，并从缓冲池中移除
- 个人中心: 皇帝角色增加缓冲池数据监控看板 (Total/Active/Pending/Used) 及详细列表页
- 后台: 邮件接收 Worker 自动识别 TinyPNG 激活邮件，提取 Key 并存入缓冲池
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

