# Antigravity Pro 账号自动化销售系统 - 部署文档

## 系统概述

本系统基于 Cloudflare 生态构建，实现 Antigravity Pro 账号的自动化管理和销售，包括账号库存管理、状态监控、闲鱼自动发货等功能。

## 前置要求

### 1. Cloudflare 账号
- 注册 Cloudflare 账号: https://dash.cloudflare.com/sign-up
- 免费套餐即可使用

### 2. 开发工具
- Node.js 18+ 
- pnpm 或 npm
- Wrangler CLI: `npm install -g wrangler`

### 3. GitHub 账号
- 用于代码托管和自动部署

## 部署步骤

### 第一步: 克隆仓库

```bash
git clone https://github.com/masongzhi1/moemail2.git
cd moemail2
git checkout feature/antigravity-seller
```

### 第二步: 安装依赖

```bash
# 安装项目依赖
npm install

# 或使用 pnpm
pnpm install
```

### 第三步: 创建 Cloudflare D1 数据库

```bash
# 登录 Cloudflare
wrangler login

# 创建数据库
wrangler d1 create antigravity-db

# 记录输出的 database_id，后续配置需要使用
```

输出示例:
```
✅ Successfully created DB 'antigravity-db'!

[[d1_databases]]
binding = "DB"
database_name = "antigravity-db"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### 第四步: 初始化数据库

```bash
# 执行数据库 schema
wrangler d1 execute antigravity-db --file=./antigravity/database/schema.sql
```

### 第五步: 配置环境变量

复制配置文件模板:
```bash
cp wrangler.antigravity.json wrangler.antigravity.local.json
```

编辑 `wrangler.antigravity.local.json`，填入实际配置:

```json
{
  "name": "antigravity-seller-api",
  "main": "antigravity/api/index.ts",
  "compatibility_date": "2024-01-01",
  "node_compat": true,
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "antigravity-db",
      "database_id": "你的数据库ID"
    }
  ],
  "vars": {
    "ENVIRONMENT": "production"
  },
  "triggers": {
    "crons": ["0 * * * *"]
  }
}
```

### 第六步: 配置 Cloudflare Secrets

设置敏感信息（不会被提交到 Git）:

```bash
# JWT 密钥（用于 API 认证）
wrangler secret put JWT_SECRET
# 输入一个随机字符串，如: your-super-secret-jwt-key-here

# 加密密钥（用于加密账号密码）
wrangler secret put ENCRYPTION_KEY
# 输入一个 32 字符的随机字符串

# Telegram Bot Token（可选，用于通知）
wrangler secret put TELEGRAM_BOT_TOKEN
# 输入你的 Telegram Bot Token

# Telegram Chat ID（可选）
wrangler secret put TELEGRAM_CHAT_ID
# 输入你的 Telegram Chat ID

# 闲鱼发货 API 密钥（根据使用的第三方工具配置）
wrangler secret put XIANYU_API_KEY
# 输入第三方发货工具的 API Key
```

### 第七步: 部署 Worker API

```bash
# 部署到 Cloudflare Workers
wrangler deploy -c wrangler.antigravity.local.json

# 部署成功后会显示 Worker URL
# 例如: https://antigravity-seller-api.your-subdomain.workers.dev
```

### 第八步: 部署前端管理页面

#### 方式 A: 使用 Cloudflare Pages

```bash
# 创建 Pages 项目
wrangler pages project create antigravity-admin

# 部署前端文件
wrangler pages deploy antigravity/frontend --project-name=antigravity-admin

# 部署成功后会显示 Pages URL
# 例如: https://antigravity-admin.pages.dev
```

#### 方式 B: 使用 GitHub Pages

1. 将 `antigravity/frontend/admin.html` 推送到 GitHub 仓库
2. 在仓库设置中启用 GitHub Pages
3. 选择部署分支和目录

### 第九步: 配置自动部署（可选）

在 GitHub 仓库中创建 `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloudflare

on:
  push:
    branches:
      - feature/antigravity-seller

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm install
      
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy -c wrangler.antigravity.local.json
      
      - name: Deploy Pages
        run: |
          npx wrangler pages deploy antigravity/frontend --project-name=antigravity-admin
        env:
          CLOUDFLARE_API_TOKEN: \${{ secrets.CLOUDFLARE_API_TOKEN }}
```

在 GitHub 仓库设置中添加 Secret:
- `CLOUDFLARE_API_TOKEN`: 在 Cloudflare Dashboard 创建 API Token

## 配置第三方服务

### 1. Telegram Bot（可选）

用于接收系统通知（订单、库存预警等）。

1. 与 @BotFather 对话创建 Bot
2. 获取 Bot Token
3. 获取你的 Chat ID（可以通过 @userinfobot）
4. 配置到 Cloudflare Secrets（见第六步）

### 2. 闲鱼自动发货工具

#### 选项 A: 闲管家

1. 访问 https://xianguanjia.com 注册账号
2. 购买自动发货服务
3. 获取 API Key
4. 配置 API 端点和密钥

#### 选项 B: 阿奇索

1. 访问 https://www.agiso.com 注册账号
2. 订购闲鱼自动发货服务
3. 获取 API 凭证
4. 配置到系统中

#### 选项 C: 自建脚本

如果不想使用第三方工具，可以自建监听脚本（需要独立服务器）:

1. 准备一台 VPS 服务器
2. 安装 Node.js 和 Puppeteer
3. 部署自建监听脚本（参考 `xianyu-delivery.ts` 中的示例）
4. 配置 Webhook 回调到你的 Worker API

## 使用说明

### 1. 访问管理后台

打开部署的前端页面，例如: https://antigravity-admin.pages.dev

### 2. 导入账号

1. 点击"账号管理"
2. 点击"导入账号"
3. 输入 JSON 格式的账号数据:

```json
[
  {
    "email": "example1@gmail.com",
    "password": "password123",
    "recovery_email": "recovery1@gmail.com",
    "source": "manual_import",
    "cost": 10,
    "notes": "批次 A"
  },
  {
    "email": "example2@gmail.com",
    "password": "password456",
    "recovery_email": "recovery2@gmail.com",
    "source": "manual_import",
    "cost": 10,
    "notes": "批次 A"
  }
]
```

4. 点击"导入"

### 3. 配置系统设置

1. 点击"系统设置"
2. 配置以下参数:
   - 单个账号售价
   - 是否启用自动发货
   - 低库存预警阈值
   - Telegram 通知配置
   - 发货内容模板

3. 点击"保存设置"

### 4. 配置闲鱼商品

1. 在闲鱼 App 中发布商品
2. 商品标题: "Antigravity Pro 账号 一年使用权"
3. 价格: 39.9 元
4. 商品描述:
```
【Antigravity Pro 账号】
✅ 一年使用权限
✅ 自动发货，秒发
✅ 账号独享，可修改密码
✅ 支持所有 Antigravity 功能

⚠️ 重要提示:
- 虚拟商品，无质保
- 账号失效不退款
- 请及时修改密码
- 发货后不支持退款

购买即视为同意以上条款
```

5. 在第三方发货工具中绑定商品

### 5. 测试发货流程

1. 使用小号在闲鱼下单测试
2. 检查是否自动发货
3. 查看管理后台订单状态
4. 验证 Telegram 通知

## 监控和维护

### 1. 查看日志

```bash
# 查看 Worker 日志
wrangler tail

# 查看数据库日志
wrangler d1 execute antigravity-db --command="SELECT * FROM logs ORDER BY created_at DESC LIMIT 50"
```

### 2. 检查账号状态

定时任务会每小时自动检测账号状态，也可以手动触发:

```bash
# 手动触发 Cron 任务
wrangler dev --test-scheduled
```

### 3. 数据库备份

```bash
# 导出数据库
wrangler d1 export antigravity-db --output=backup.sql

# 定期备份（建议每天）
```

### 4. 库存监控

- 在管理后台查看库存统计
- 设置低库存预警（默认 10 个）
- 收到 Telegram 通知后及时补充账号

## 故障排查

### 问题 1: Worker 部署失败

**解决方案**:
- 检查 wrangler.toml 配置是否正确
- 确认 database_id 是否填写
- 查看错误日志: `wrangler tail`

### 问题 2: 数据库连接失败

**解决方案**:
- 确认数据库已创建
- 检查 binding 名称是否为 "DB"
- 重新部署 Worker

### 问题 3: 自动发货不工作

**解决方案**:
- 检查第三方发货工具 API 配置
- 查看订单日志确认是否收到 Webhook
- 测试 API 连接是否正常
- 确认自动发货开关已启用

### 问题 4: 账号检测失败

**解决方案**:
- 账号检测需要独立服务器运行 Playwright
- 可以暂时使用人工抽查
- 或使用简化版检测（仅验证有效性）

## 安全建议

### 1. API 安全
- 使用强 JWT 密钥
- 定期轮换密钥
- 限制 API 访问来源

### 2. 数据安全
- 账号密码加密存储
- 定期备份数据库
- 不要在日志中记录敏感信息

### 3. 业务安全
- 做好风险提示
- 记录所有操作日志
- 准备应急预案

## 成本估算

### Cloudflare 免费套餐
- Workers: 100,000 请求/天
- Pages: 无限请求
- D1: 100,000 行读取/天
- Cron Triggers: 免费

### 第三方服务
- 闲鱼自动发货工具: 50-200 元/月
- VPS 服务器（如需）: 50 元/月
- Telegram Bot: 免费

### 预计月运营成本
- 小规模（<100 单/月）: 100-300 元
- 中等规模（100-500 单/月）: 300-800 元

## 法律声明

⚠️ **重要提示**:

1. 本系统仅供技术学习和研究使用
2. 批量销售 Google 账号可能违反 Google 服务条款
3. 请确保账号来源合法
4. 使用本系统产生的任何法律后果由使用者自行承担
5. 建议咨询专业律师评估法律风险

## 技术支持

如有问题，请:
1. 查看本文档的故障排查部分
2. 查看系统日志
3. 在 GitHub 仓库提交 Issue

## 更新日志

### v1.0.0 (2026-02-08)
- 初始版本发布
- 支持账号管理
- 支持自动发货
- 支持状态监控
- 支持 Telegram 通知
