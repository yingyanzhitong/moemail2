# Antigravity Pro 账号自动化销售系统

> ⚠️ **重要声明**: 本项目仅供技术学习和研究使用。批量销售 Google 账号可能违反服务条款，使用者需自行承担法律风险。

## 项目简介

这是一个基于 Cloudflare 生态构建的 Antigravity Pro 账号自动化销售系统，实现了账号管理、状态监控、闲鱼自动发货等功能。

### 核心功能

- ✅ **账号管理**: 批量导入、状态追踪、库存统计
- ✅ **自动发货**: 对接闲鱼第三方工具，实现自动发货
- ✅ **状态监控**: 定时检测账号有效性和 Pro 状态
- ✅ **订单管理**: 订单追踪、发货记录、退款处理
- ✅ **数据统计**: 收入统计、库存预警、运营报表
- ✅ **通知推送**: Telegram 通知订单和库存状态
- ✅ **管理后台**: 可视化管理界面

### 技术栈

- **后端**: Cloudflare Workers + Hono
- **数据库**: Cloudflare D1 (SQLite)
- **前端**: Vue 3 + TailwindCSS
- **部署**: Cloudflare Pages + GitHub Actions
- **定时任务**: Cloudflare Cron Triggers

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                     用户层                               │
│  闲鱼买家  │  管理后台  │  Telegram Bot                 │
└──────┬──────────┬──────────────┬────────────────────────┘
       │          │              │
       ▼          ▼              ▼
┌─────────────────────────────────────────────────────────┐
│              Cloudflare Pages (前端)                     │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│             Cloudflare Workers (API)                     │
│  - 账号管理  - 订单处理  - 状态监控  - 发货集成          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               Cloudflare D1 (数据库)                     │
│  - accounts  - orders  - logs  - settings                │
└─────────────────────────────────────────────────────────┘
```

## 快速开始

### 前置要求

- Node.js 18+
- Cloudflare 账号
- GitHub 账号
- pnpm 或 npm

### 安装步骤

1. **克隆仓库**

```bash
git clone https://github.com/masongzhi1/moemail2.git
cd moemail2
git checkout feature/antigravity-seller
```

2. **安装依赖**

```bash
npm install
# 或
pnpm install
```

3. **创建数据库**

```bash
wrangler login
wrangler d1 create antigravity-db
wrangler d1 execute antigravity-db --file=./antigravity/database/schema.sql
```

4. **配置环境变量**

```bash
cp wrangler.antigravity.json wrangler.antigravity.local.json
# 编辑配置文件，填入 database_id
```

5. **设置 Secrets**

```bash
wrangler secret put JWT_SECRET
wrangler secret put ENCRYPTION_KEY
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put XIANYU_API_KEY
```

6. **部署**

```bash
# 部署 Worker
wrangler deploy -c wrangler.antigravity.local.json

# 部署前端
wrangler pages deploy antigravity/frontend --project-name=antigravity-admin
```

详细部署步骤请查看 [部署文档](./docs/DEPLOYMENT.md)

## 使用指南

### 1. 导入账号

在管理后台点击"导入账号"，输入 JSON 格式数据:

```json
[
  {
    "email": "example@gmail.com",
    "password": "password123",
    "recovery_email": "recovery@gmail.com",
    "source": "manual",
    "cost": 10
  }
]
```

### 2. 配置发货

在"系统设置"中配置:
- 启用自动发货
- 配置第三方发货工具 API
- 自定义发货内容模板

### 3. 监控运营

- 查看仪表板统计数据
- 监控库存预警
- 处理订单和退款
- 查看系统日志

## 账号获取渠道

根据调研，市场上存在以下账号获取渠道（仅供参考）:

### 1. 与真实学生合作
- 招募美国在校大学生
- 学生使用真实信息申请
- 支付学生一定费用
- **优点**: 账号真实有效
- **缺点**: 成本高，规模化困难

### 2. 账号交易平台
- 账号鸭 (zhanghaoya.com)
- 海外号批发网 (tuitehao.cc)
- **优点**: 快速获取，批量采购
- **缺点**: 来源不明，质量无保证，高封号风险

### 3. Telegram 群组
- 通过 Telegram 群组交易
- 可以定制需求
- **优点**: 价格可协商
- **缺点**: 风险极高，可能涉及非法交易

⚠️ **风险警告**: 
- 所有批量账号交易都存在法律风险
- 账号稳定性无法保证
- 可能违反 Google 服务条款
- 建议咨询专业律师评估风险

## 闲鱼自动发货方案

### 方案 A: 第三方工具

#### 闲管家
- 官网: https://xianguanjia.com
- 功能: 自动发货、订单监听
- 成本: 约 100-200 元/月

#### 阿奇索
- 官网: https://www.agiso.com
- 功能: 虚拟商品自动发货
- 成本: 按订单收费

### 方案 B: 自建脚本

使用 Puppeteer 监听闲鱼订单，自动发送消息:

```javascript
// 需要独立服务器运行
const puppeteer = require('puppeteer');

class XianyuAutoDelivery {
  async monitorOrders() {
    // 监听订单
    // 自动发货
  }
}
```

详见 `antigravity/api/xianyu-delivery.ts`

## 项目结构

```
antigravity/
├── api/                    # Worker API
│   ├── index.ts           # 主入口
│   ├── account-checker.ts # 账号检测
│   └── xianyu-delivery.ts # 发货集成
├── database/              # 数据库
│   └── schema.sql         # 数据库结构
├── frontend/              # 前端页面
│   └── admin.html         # 管理后台
└── docs/                  # 文档
    ├── DEPLOYMENT.md      # 部署文档
    └── API.md             # API 文档
```

## API 文档

### 账号管理

```bash
# 获取账号列表
GET /api/accounts?status=available&page=1&limit=20

# 导入账号
POST /api/accounts/import
{
  "accounts": [...]
}

# 更新账号
PUT /api/accounts/:id
{
  "status": "sold",
  "notes": "已售出"
}

# 删除账号
DELETE /api/accounts/:id
```

### 订单管理

```bash
# 获取订单列表
GET /api/orders?status=pending

# 手动发货
POST /api/orders/:id/deliver
{
  "account_id": 123
}

# 接收 Webhook
POST /api/webhook/xianyu
{
  "event_type": "order_paid",
  "order_id": "xxx",
  "amount": 39.9
}
```

## 监控和维护

### 查看日志

```bash
# 实时日志
wrangler tail

# 数据库日志
wrangler d1 execute antigravity-db --command="SELECT * FROM logs LIMIT 50"
```

### 数据库备份

```bash
# 导出备份
wrangler d1 export antigravity-db --output=backup.sql

# 建议每天自动备份
```

### 库存监控

- 设置低库存预警阈值（默认 10 个）
- 收到 Telegram 通知后及时补充
- 定期检查账号有效性

## 成本估算

### Cloudflare 费用
- **免费套餐**: 适合小规模运营（<100 单/月）
- **付费套餐**: 大规模运营需升级

### 第三方服务
- 闲鱼自动发货工具: 50-200 元/月
- VPS 服务器（如需）: 50 元/月
- 账号采购成本: 根据渠道而定

### 预计月运营成本
- 小规模: 100-300 元
- 中等规模: 300-800 元
- 大规模: 需要评估

## 风险提示

### 法律风险
- ❌ 批量销售 Google 账号可能违反服务条款
- ❌ 使用他人身份信息可能违法
- ❌ 账号交易可能涉及欺诈

### 商业风险
- ⚠️ 账号稳定性差，退款率可能较高
- ⚠️ 闲鱼可能封禁虚拟商品店铺
- ⚠️ 第三方发货工具稳定性问题

### 技术风险
- ⚠️ 账号失效率高，需要充足库存
- ⚠️ Google 可能加强反欺诈检测
- ⚠️ API 可能随时变更

## 建议

1. **小规模测试**: 先用少量账号测试整个流程
2. **做好风险提示**: 在商品描述中明确说明无质保
3. **准备应急预案**: 账号失效时的处理流程
4. **考虑合法性**: 咨询律师评估法律风险
5. **关注政策变化**: Google 和闲鱼的政策随时可能调整

## 替代方案

如果不想承担法律风险，可以考虑:

1. **代理申请服务**: 帮助真实学生申请（需授权）
2. **教育培训**: 教学生如何申请学生优惠
3. **其他虚拟产品**: 选择更合规的虚拟产品销售

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License

## 免责声明

本项目仅供技术学习和研究使用。使用本项目产生的任何法律后果由使用者自行承担。作者不对使用本项目造成的任何损失负责。

## 联系方式

- GitHub: https://github.com/masongzhi1/moemail2
- Issues: https://github.com/masongzhi1/moemail2/issues

---

**再次提醒**: 请务必评估法律风险，谨慎使用本系统！
