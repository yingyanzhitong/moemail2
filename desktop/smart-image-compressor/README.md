# 智能压缩工具

Tauri v2 桌面端，支持 macOS Apple Silicon、macOS Intel 与 Windows x64。Auth Link 仅用于一次性领取套餐参数和 TinyPNG Token；激活后由 Rust 层直接请求 TinyPNG，业务后端不再参与压缩、额度统计，也不接收图片、文件名或本地路径。

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

- 设备私钥、本地套餐、时间高水位与 TinyPNG Key 仅保存在 Rust 管理的 Stronghold 快照中；快照主密钥由 macOS Keychain 或 Windows Credential Manager 保存。
- WebView 只接收脱敏授权视图、文件任务和进度事件，Tauri capability 未开放 Stronghold 或网络插件权限。
- 成功压缩数和有效期由客户端本地计算；系统时间回拨会锁定新批次，TinyPNG HTTPS 响应时间会在压缩时更新本地可信时间高水位。
- 每 20 张先写入一次本地中断保护记录，完成后仅结算成功写入的图片；异常退出时按预留数保守计入额度，避免删除进程绕过计数。
- 已下发 Key 永不回收给其他授权。桌面端直连 TinyPNG 的方案不能防止高级用户逆向提取本机凭证。

## 输出方式

- “导出到新文件夹”保留原图，文件夹任务生成同级“原目录名-压缩结果”，零散文件生成“压缩结果”目录。
- “覆盖原文件”在开始前必须二次确认，成功后使用同目录临时文件原子替换源图片；失败文件不会修改。

## 测试版发布

推送 `desktop-v*` 标签会触发 GitHub Actions，分别生成 Apple Silicon DMG、Intel DMG 和 Windows x64 NSIS EXE，并发布为 GitHub Pre-release。v1 不包含自动更新、商店签名或正式代码签名。
