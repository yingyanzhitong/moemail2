# 智能压缩工具

Tauri v2 桌面端，支持 macOS Apple Silicon、macOS Intel 与 Windows x64。应用直接从 Rust 层向 TinyPNG 上传图片；业务后端只接收授权、设备标识和逻辑额度结算，不接收图片、文件名或本地路径。

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

- 设备私钥、访问令牌与 TinyPNG Key 仅保存在 Rust 管理的 Stronghold 快照中；快照主密钥由 macOS Keychain 或 Windows Credential Manager 保存。
- WebView 只接收脱敏授权视图、文件任务和进度事件，Tauri capability 未开放 Stronghold 或网络插件权限。
- 客户端必须在线校验并预留服务端逻辑额度后才能开始新批次。
- 已下发 Key 永不回收给其他授权。桌面端直连 TinyPNG 的方案不能防止高级用户逆向提取本机凭证。

## 测试版发布

推送 `desktop-v*` 标签会触发 GitHub Actions，分别生成 Apple Silicon DMG、Intel DMG 和 Windows x64 NSIS EXE，并发布为 GitHub Pre-release。v1 不包含自动更新、商店签名或正式代码签名。
