# TinyPNG 压缩助手

非官方的 Tauri v2 桌面端，支持 macOS Apple Silicon、macOS Intel 与 Windows x64。Auth Link 仅用于一次性领取套餐参数和 TinyPNG Token；激活后由 Rust 层直接请求 TinyPNG。每个压缩批次结束后只向业务后端回传批次 ID、授权周期、任务数和成功数，不接收图片、文件名或本地路径。

## 本地开发

```bash
pnpm install
pnpm tauri dev
```

默认业务后端为 `https://snapmail.tinypng-token.site`。如需连接本地或测试环境，在编译 Rust 前设置：

```bash
SMART_COMPRESS_API_URL=http://localhost:3000 pnpm tauri dev
```

## 校验

```bash
pnpm design:lint
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
```

## 安全边界

- 设备私钥、本地套餐、时间高水位与 TinyPNG Key 仅保存在 Rust 管理的 Stronghold 快照中；48 字节随机主密钥保存在应用数据目录的受限权限文件中，macOS/Linux 固定为 `0600`，Windows 继承当前用户的 AppData ACL。
- 从旧版升级且已存在 Stronghold 快照时，只读取一次旧系统密钥库完成主密钥迁移；迁移完成后以及所有新安装都不再访问 Keychain，避免未签名测试版反复弹出授权框。
- WebView 只接收脱敏授权视图、文件任务和进度事件，Tauri capability 未开放 Stronghold 或网络插件权限。
- 成功压缩数和有效期由客户端本地计算；系统时间回拨会锁定新批次，TinyPNG HTTPS 响应时间会在压缩时更新本地可信时间高水位。
- 单次压缩不设固定张数上限，只受当前 Auth Link 套餐的剩余额度约束；Rust 始终保持 4 路并发。
- 内部每 20 张写入一次中断保护检查点，整次“开始压缩”聚合为一个稳定执行 ID；完成后只回传一条汇总使用记录，网络重试不会重复计数。
- 从 `0.1.5` 升级且缺少上报凭证时，客户端使用设备 ID 和一个已绑定 Token 完成一次归属校验并自动恢复专用上报凭证。
- 已下发 Key 永不回收给其他授权。桌面端直连 TinyPNG 的方案不能防止高级用户逆向提取本机凭证。

## 输出方式

- “导出到新文件夹”保留原图，文件夹任务生成同级“原目录名-压缩结果”，零散文件生成“压缩结果”目录。
- “覆盖原文件”在开始前必须二次确认，成功后使用同目录临时文件原子替换源图片；失败文件不会修改。

## 导入与缩略图

- 导入阶段只递归扫描支持的文件并读取元数据，列表会在缩略图解码前先显示。
- 列表出现后由 Rust 以最多 4 路并发在后台生成缩略图，并通过 `thumbnail-ready` 事件逐项填充；AVIF 暂时使用格式图标占位。
- 开始压缩后，尚未开始的缩略图任务会暂停，避免与图片上传争抢 CPU 和磁盘；压缩结束后自动继续。
- React 缓存早于列表提交到达的缩略图事件，并只更新对应图片条目，避免大队列整体重复渲染。

## 压缩进度

- 每张图片会依次显示“读取、上传并等待 TinyPNG、下载、写入”，写入完成后立即更新该条目，不等待同一组其他图片。
- 历史待回传记录在后台同步，不阻塞首张图片开始；本次执行结束时仍会等待使用情况回传并提示同步结果。
- 图片读取后使用引用计数字节缓冲完成上传重试与结果落盘，避免重试时复制整张原图和下载后再次复制结果。
- Rust 回归测试使用 16MB 输入与 8MB Mock TinyPNG 输出，扣除模拟 TinyPNG 等待后，客户端读取、HTTP 搬运与原子落盘的额外耗时必须小于 5 秒。

## 测试版发布

推送 `desktop-v*` 标签会触发 GitHub Actions，分别生成 Apple Silicon DMG、Intel DMG 和 Windows x64 NSIS EXE，并发布为 GitHub Pre-release。三个构建全部成功后，工作流会将同一标签的安装包同步到 [Gitee 发布镜像](https://gitee.com/masongzhi1/tinypng-image-compressor-releases)。v1 不包含自动更新、商店签名或正式代码签名。
