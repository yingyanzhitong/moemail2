# Changelog

All notable changes to this project will be documented in this file.

## [1.14.15] - 2026-07-14

### Performance

- **列表优先显示**：图片导入阶段不再同步解码缩略图，只扫描路径、输出映射和文件大小；元数据准备完成后立即展示任务列表。
- **异步缩略图**：Rust 后台以最多 4 路并发生成 JPEG、PNG、WebP 缩略图，并通过 `thumbnail-ready` 事件逐项填充，避免大量高分辨率图片串行阻塞导入。
- **精确队列更新**：React 使用内存 Map 缓存可能早到的缩略图事件，每次只替换对应队列项，避免大列表无效重渲染。

### Tests

- **异步导入回归**：新增“扫描先返回、缩略图按需生成”测试；Rust 19 项、React 15 项、桌面授权后端 16 项测试通过，并完成 Next.js、Vite、TypeScript 与设计规范校验。

## [1.14.14] - 2026-07-14

### Bug Fixes

- **取消 20 张误限制**：单次“开始压缩”不再按 20 张形成多条使用报告，用户可一次选择任意数量图片，只受 Auth Link 当前周期的剩余额度约束。
- **执行级用量回传**：内部仍每 20 张保存中断保护检查点，但会按同一个执行 ID 聚合；整次任务完成后只向后端回传一条任务数与成功数汇总。
- **动态报告校验**：后端移除用量报告的 `1–20` 固定限制，改为根据对应 Auth Link 授权周期的实际总额度校验。

### Tests

- **不限张数回归**：新增 55 张执行报告聚合与幂等累计测试；Rust 18 项、React 15 项、桌面授权后端 16 项测试通过，并完成 Next.js、Vite 与设计规范校验。

## [1.14.13] - 2026-07-14

### Features

- **压缩用量回传**：桌面端每个最多 20 张的压缩批次完成后，将批次 ID、授权周期、任务数和成功数回传到对应 Auth Link 授权；图片、文件名和本地路径始终不会进入业务后端。
- **后台使用情况**：TinyPNG Pool 的桌面端授权列表改为展示服务端已收到的 `已压缩 / 套餐上限`，刷新后即可查看最新使用量。
- **升级凭证迁移**：从 `desktop 0.1.5` 升级时，客户端可通过设备 ID 与已绑定 Token 的归属校验自动恢复专用上报凭证，无需重新激活。

### Reliability

- **幂等批次结算**：每个本地批次使用稳定 UUID，服务端只对首次收到的批次累计成功数，网络重试不会重复扣减额度。
- **离线重试**：回传失败的记录继续加密保存在 Stronghold，并在应用启动、下次压缩及兑换续费前重试；工作台会明确提示待回传记录数量。
- **中断对账**：异常退出后恢复的保守计数也会生成对应使用记录，保持客户端本地额度与后台授权记录一致。

### Tests

- **完整回归**：Rust 17 项、React 15 项、桌面授权后端 16 项测试通过；覆盖中断恢复、待同步提示、幂等上报和公开路由，并通过 Next.js、Vite、TypeScript 与设计规范检查。

## [1.14.12] - 2026-07-14

### Changes

- **一次性激活边界**：Auth Link 仅用于领取动态 Token 数量、压缩总张数和有效期；激活后客户端不再刷新业务授权、预留服务端额度或申请应急 Token，图片始终由 Rust 直接请求 TinyPNG。
- **本地套餐状态**：成功压缩数、续费周期和到期状态改由 Stronghold 本地加密保存；每 20 张使用本地中断保护记录，完成后只累计成功写入的图片。
- **输出方式收敛**：仅保留“导出到新文件夹”和“覆盖原文件”两种方式；覆盖模式开始前必须二次确认，并使用同目录临时文件原子替换源图。
- **Token 回收边界**：未兑换授权停止后释放预留 Token；已激活设备拿到的 Token 无法远程撤销且永不回池，避免同一 Key 被再次分配给其他客户。

### Security

- **时间回拨防护**：在 Stronghold 中保存可信时间高水位，结合应用运行期间的单调时钟检测系统时间回拨；压缩时同步读取 TinyPNG HTTPS 响应时间，到期后拒绝写出结果。
- **本地篡改边界**：删除本地加密数据会同时删除 TinyPNG Token 和套餐信息，必须重新使用有效 Auth Link；高级用户修改应用二进制仍属于桌面直连方案无法完全消除的风险。

### Performance

- **移除服务端瀑布请求**：删除每批压缩前后的授权刷新、额度预留、结算和 Key 补发请求；本地状态由逐张持久化改为每批开始与结束各一次。
- **TinyPNG 直连优化**：确认官方没有 Rust SDK，继续使用官方 HTTP `POST /shrink → Location → GET` 流程，并复用连接池、15 秒连接超时和固定 4 路并发。

### Tests

- **完整回归**：Rust 17 项、React 14 项、桌面授权后端 15 项测试通过；覆盖时间回拨、续费额度切换、中断批次、服务器时间解析、原子覆盖、目标冲突和覆盖二次确认，并通过 Next.js、Vite 与 Rust 生产检查。

## [1.14.11] - 2026-07-14

### Bug Fixes

- **桌面激活卡顿**：修复授权已在服务端成功兑换，但桌面端长时间停留在“正在激活”的问题；根因是 Stronghold 对系统随机主密钥执行了不必要的高工作因子 scrypt。
- **凭证持久化性能**：Stronghold 主密钥由 48 字节系统随机数生成并保存在 Keychain/Credential Manager，按强随机密钥模式使用最小工作因子，避免激活和图片成功计数保存时持续占用 CPU。
- **设备身份写入**：设备 ID 已存在时不再重复写入 Stronghold，减少兑换前一次无变化的凭证库持久化。

### Tests

- **桌面端回归**：新增强随机密钥工作因子、设备身份仅生成一次测试；Rust 11 项、React 11 项、设计规范与前端生产构建全部通过。

## [1.14.10] - 2026-07-14

### Features

- **复制 Auth Link**：桌面授权操作栏新增“复制 Auth Link”按钮，可重新复制仍处于有效期且尚未兑换的授权链接。
- **旧链接兼容**：历史记录首次复制时原地轮换一次性授权码，旧链接立即失效，并保持原有失效时间不延长。

### Security

- **授权码加密存储**：新生成的一次性授权码使用服务端密钥加密保存；普通授权列表仅返回链接是否可复制，不返回 Auth Link 或授权码。
- **管理员按需读取**：Auth Link 只通过皇帝管理员专用接口按需返回，并禁用响应缓存；并发轮换使用原哈希条件更新避免链接错配。

### Tests

- **自动化验证**：新增授权码加解密、错误密钥拒绝、旧链接轮换不延长有效期、并发轮换保护和管理接口鉴权测试，并通过 Next.js 生产构建。

## [1.14.9] - 2026-07-14

### Bug Fixes

- **桌面激活预览**：将 `/api/tinypng/desktop/grants/preview` 加入无需网站 Cookie 的桌面公开接口，修复 Tauri 粘贴有效 Auth Link 后提示“未授权”的问题。

### Tests

- **鉴权策略验证**：新增桌面公开路径测试，确保激活预览、兑换和 Bearer Token 接口保持公开，同时管理员创建 Auth Link 与管理接口仍受网站登录保护。

## [1.14.8] - 2026-07-14

### Changes

- **停止授权释放 Token**：停止待激活或已激活的桌面授权时，统一解除全部 Token 绑定；`reserved` 和 `assigned` Token 恢复为 Pool 可用状态。
- **历史授权清理**：已停止但仍保留绑定 Token 的记录提供“释放 Token”操作，完成后授权 Key 数量归零。
- **并发保护**：应急 Token 补发写入前再次校验授权状态，避免停止授权与补发并发时重新产生绑定。

### Tests

- **自动化验证**：覆盖未激活授权释放预留 Token、已激活授权释放已分配 Token，并通过 Next.js 生产构建。

## [1.14.7] - 2026-07-13

### Bug Fixes

- **数据库迁移**：同步动态桌面授权字段的 Drizzle 快照，避免部署时重复生成 `token_count` 等已存在字段的迁移。

## [1.14.6] - 2026-07-13

### Features

- **桌面授权记录**：Auth Link 生成后在 TinyPNG Pool 详情页展示对应授权、动态 Token 数量、逻辑额度、有效期和设备绑定状态。
- **授权续费与停止**：续费时可重新指定压缩张数和有效天数；停止未兑换授权会立即使链接失效并释放尚未下发的预留 Token。
- **真实 Key 管理**：皇帝管理员可按需打开 Token 列表弹窗，查看并复制单个或全部真实 TinyPNG Key；敏感 Key 不进入普通授权列表响应。

### Improvements

- **授权记录留存**：24 小时未兑换的 Auth Link 释放预留 Token 后保留失效记录，便于管理端继续审计。
- **Key 回收边界**：仅待激活且从未下发的预留 Token 可以释放；已绑定设备的 Token 在停止授权后仍永久保留。

### Tests

- **自动化验证**：新增停止待激活授权释放 Token、停止已激活授权保留 Key 的 SQL 测试，并通过 Next.js 生产构建。

## [1.14.5] - 2026-07-13

### Features

- **TinyPNG 定时计划**：Pool 卡片支持配置北京时间的五段 Linux Cron 表达式，统一驱动下一次计划展示和定时 Worker 实际执行。
- **TinyPNG 任务统计**：上次任务新增注册成功率，任务汇总同步记录成功账号数、失败数和成功率。
- **桌面授权方案**：管理端可为 Auth Link 自定义 Token 数量、压缩额度和有效天数，并在兑换前预览完整授权方案。
- **桌面首次激活**：未授权设备启动后进入独立激活页，激活成功后才开放图片压缩工作台。

### Improvements

- **TinyPNG 执行策略**：移除批次内账号之间固定等待 1 分钟的逻辑；Cloudflare Worker 每分钟检查动态 Cron，到期后才执行 Pool 任务。
- **桌面授权持久化**：授权和周期记录保存动态 Token、额度与天数，续费和应急 Token 上限按具体授权方案计算。

### Tests

- **自动化验证**：新增 Cron 语法、北京时间匹配、下一次执行时间、注册成功率、动态授权 SQL 和桌面首次激活流程测试。

## [1.14.4] - 2026-07-13

### Features

- **TinyPNG 缓冲池日志**：立即执行时以弹窗每 2 秒刷新任务日志；上次任务日志改为点击后在弹窗中查看。
- **TinyPNG Token 流程**：串联创建邮箱、注册、验证邮件、Magic Link、Token、Bearer Token 和 API Key 入池全链路日志，并对敏感值进行脱敏。

### Improvements

- **任务追踪**：Pool 记录关联任务 ID，邮件 Worker 的异步处理步骤会原子追加到对应任务日志。

## [1.14.3] - 2026-07-13

### Bug Fixes

- **Windows 发行**：为桌面工作区增加独立 PostCSS 配置，避免 Windows runner 向上加载根项目配置并在隔离依赖环境中找不到 Tailwind CSS。

## [1.14.2] - 2026-07-13

### Improvements

- **TinyPNG 缓冲池**：同一批次内的相邻账号注册间隔调整为 1 分钟，并在任务完整日志中记录每次等待。

## [1.14.1] - 2026-07-13

### Bug Fixes

- **桌面发行**：补充桌面工作区的 Node.js 类型依赖，修复干净 GitHub Actions runner 在 Tauri 打包阶段无法解析 `node:url` 与 `process` 的问题。

## [1.14.0] - 2026-07-13

### Features

- **智能压缩工具**：新增 Tauri v2 桌面端，支持 macOS Intel、Apple Silicon 与 Windows x64，提供文件/文件夹扫描、固定四并发压缩、任务取消、原子输出和压缩结果展示。
- **桌面授权**：新增 30 天 10,000 张逻辑额度、设备绑定、一次性新授权/续费/换机凭证、批次额度预留与幂等结算。
- **TinyPNG Key 池**：新授权原子绑定 40 个 Key，并在服务端核验自然月真实用量后按需补发最多 20 个应急 Key；已下发 Key 永不回收复用。
- **管理与激活**：新增 HTTPS 激活中转页和授权管理界面，支持创建授权、排期续费、撤销与换机。

### Security

- **敏感凭证隔离**：TinyPNG Key、设备凭证和访问令牌只在 Rust 层通过 Stronghold 加密保存，不进入 WebView 状态或日志。
- **旧接口下线**：旧 Electron Base64 授权接口统一返回 `410 Gone`，桌面接口改用一次性 code 哈希、设备校验和访问令牌摘要。

### Tests

- **自动化验证**：新增授权域与 D1 原子性测试、桌面授权状态 UI 测试、TinyPNG Mock HTTP 测试、`DESIGN.md` lint 和三平台未签名预发布流水线。

## [1.13.17] - 2026-07-13

### Features

- **TinyPNG 缓冲池**：将 Pool 邮箱域名选择迁移至皇帝专用的 TinyPNG Pool 卡片，并仅允许使用网站已配置的邮箱域名。
- **TinyPNG 任务诊断**：持久化每个注册请求的完整执行日志，展示 HTTP 状态与服务端返回内容；历史任务兼容回填已保存的失败原因。

## [1.13.16] - 2026-07-13

### Features

- **TinyPNG 缓冲池**：将手动执行入口、上次任务结果与下次执行计划归入皇帝专用 Pool 卡片。
- **TinyPNG 缓冲池**：网站配置新增 Pool 邮箱域名选择，只允许使用已配置的邮箱域名，并供定时与手动任务统一读取。

### Improvements

- **部署配置**：TinyPNG Pool Worker 增加 `SITE_CONFIG` KV 绑定，支持读取动态网站配置。

## [1.13.15] - 2026-07-13

### Features

- **TinyPNG 缓冲池**：个人中心新增“立即执行”按钮，仅皇帝可手动运行账号池补充任务。
- **TinyPNG 任务执行**：定时任务与手动任务复用同一执行逻辑，统一记录任务结果。

## [1.13.14] - 2026-07-13

### Features

- **TinyPNG 任务状态**：API Key 卡片展示上次任务的执行结果、执行时间、耗时、成功账号数与下次计划时间
- **TinyPNG 缓冲池**：定时 Worker 持久化任务执行结果，方便追踪成功、跳过和失败状态

### Improvements

- **TinyPNG 缓冲池**：账号数量上限从 10,000 提升至 100,000

## [1.13.13] - 2026-06-05

### Features

- **网站配置**：新增各角色单次 TinyPNG Token 批量生成数量配置，并让弹窗展示与生成接口校验读取同一份后台配置

## [1.13.12] - 2026-06-05

### Bug Fixes

- **部署流程**：部署脚本改为使用项目锁定的本地 Wrangler，避免 GitHub Actions 临时拉取新版 Wrangler 导致 Node.js 版本不兼容

## [1.13.11] - 2026-06-05

### Features

- **网站配置**：新增公爵、骑士、平民每日 TinyPNG Token 生成数量配置，生成接口改为读取后台配置并兼容默认限额

## [1.13.10] - 2026-03-20

### Bug Fixes

- **批量删除**：修复按创建时间批量删除邮箱时错误过滤已过期账号的问题，改为直接从数据库全量查找并删除符合条件的邮箱

## [1.13.9] - 2026-03-20

### Features

- **邮箱列表**：新增批量删除入口，支持快捷删除 30 天前、3 个月前创建的邮箱，并支持自定义天数

### Improvements

- **邮箱接口**：新增按创建时间批量删除邮箱能力，并统一返回时间戳字段供前端筛选使用

## [1.13.8] - 2026-03-12

### Improvements

- **性能优化**：`/home` 页面改为只渲染当前视口对应的邮箱布局，避免桌面端与移动端同时挂载造成重复请求
- **数据请求**：`config` 获取提升到父层共享，进入 `/home` 时将 `config` 收敛为 1 次请求、`emails` 收敛为 1 次首屏请求

## [1.13.7] - 2026-03-11

### Features

- **网站配置**：`/profile` 页面支持分别配置公爵、骑士、平民的最大邮箱数量

### Improvements

- **邮箱配额**：邮箱创建与邮箱列表上限展示改为优先读取后台角色配额配置，并兼容旧版 `MAX_EMAILS` 数据

## [1.13.6] - 2026-03-11

### Features

- **邮箱列表**：在「我的邮箱」标题右侧新增邮箱地址搜索框，支持按关键字筛选并兼容分页加载

### Improvements

- **角色配额**：邮箱创建上限改为公爵 1000 个、骑士 100 个，皇帝继续保持无限制
- **邮箱界面**：列表计数改为按当前角色显示对应上限，搜索无结果时显示专用提示

## [1.13.5] - 2026-02-26

### Improvements

- **Config**: TinyPNG Token 池上限从 500 提升至 10000
- **DX**: 添加 tinypng worker 的 dev/deploy 脚本

## [1.13.4] - 2026-02-09

### Improvements

- **UX**: 个人中心 TinyPNG API Keys 默认明文显示，移除脱敏遮罩，方便直接复制
- **SEO**: 优化网站标题和描述，提高 "批量生成 TinyPNG Token" 等关键词的搜索引擎排名

## [1.13.3] - 2026-02-09

### Improvements

- **UX**: 优化个人中心 API Key 展示，支持明文查看与复制

### Bug Fixes

- **API**: 修复 `/api/api-keys` 接口的类型安全问题 (Unauthorized check)

## [1.13.2] - 2026-02-09

### Improvements

- **Mobile UX**: 优化 TinyPNG 弹窗在移动端的显示，支持响应式布局
- **Mobile UX**: 修复移动端列表页在隐藏桌面组件时意外触发自动选择邮件的问题
- **Security**: 个人中心 API Key 默认脱敏显示，支持点击查看明文
- **Security**: 个人中心 TinyPNG API Key 列表默认脱敏显示，支持点击查看明文

## [1.13.1-hotfix] - 2026-02-04

### Bug Fixes

- **Electron App**: 修复 preload 脚本路径错误 (index.js -> index.mjs)
- **Electron App**: 修复 API 调用地址为正确的 snapmail.tinypng-token.site
- **API**: 允许 `/api/tinypng/electron-auth/redeem` 公开访问，修复 Electron app 兑换授权时的未授权错误

### Features

- **Electron App**: 皇帝个人页面新增「Generate Auth Link」按钮，可直接生成 Electron 应用授权链接
- **API**: 授权链接生成接口 (`/api/tinypng/electron-auth/generate`) 支持 API Key 认证

### Improvements

- **Electron App**: 移除授权页底部的帮助描述文字

## [1.12.1] - 2026-02-03

### Bug Fixes

- 修复构建错误：排除 Electron 目录以解决类型冲突，修复 ESLint 依赖警告
- 修复 Electron 授权接口导入路径错误 (`@/lib/auth` -> `@/lib/permissions`)
- 修复 UI 组件的可访问性问题 (Button type, Iframe title)

## [1.12.0] - 2026-02-03

### Features

- **Electron App**: 发布 TinyPNG 桌面端应用 (v1.0.0)，支持拖拽压缩、本地 MD5 去重、API Key 管理
- **API**: 新增 Electron 应用授权接口 (`/api/tinypng/electron-auth/*`)

### Improvements

- **TinyPNG Pool Worker**: 优化定时任务频率为每小时一次，每批次申请 5 个 Key，降低被封禁风险
- **Workflow**: 部署工作流增加中文语言要求说明


### Improvements

- TinyPNG 按钮在未登录时也展示，点击后引导到登录页面

## [1.11.20] - 2026-02-02

### Other

- 移除获取网站源代码浮动按钮

## [1.11.19] - 2026-02-02

### Other

- 移除首页 Footer

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
