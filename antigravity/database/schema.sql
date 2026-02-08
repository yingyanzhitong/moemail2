-- Antigravity Pro 账号自动化销售系统数据库 Schema
-- 创建时间: 2026-02-08

-- ============================================
-- 1. 账号表 (accounts)
-- ============================================
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL, -- 加密存储
  recovery_email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'available', -- available, sold, invalid, checking, reserved
  pro_status TEXT NOT NULL DEFAULT 'unknown', -- active, expired, unknown
  pro_expire_date TEXT, -- ISO 8601 格式
  source TEXT, -- 账号来源说明
  cost REAL DEFAULT 0, -- 采购成本（元）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_checked_at TEXT, -- 最后检测时间
  check_count INTEGER DEFAULT 0, -- 检测次数
  notes TEXT -- 备注信息
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_accounts_status ON accounts(status);
CREATE INDEX IF NOT EXISTS idx_accounts_pro_status ON accounts(pro_status);
CREATE INDEX IF NOT EXISTS idx_accounts_email ON accounts(email);
CREATE INDEX IF NOT EXISTS idx_accounts_created_at ON accounts(created_at);

-- ============================================
-- 2. 订单表 (orders)
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL UNIQUE, -- 闲鱼订单号
  account_id INTEGER, -- 关联的账号 ID
  buyer_info TEXT, -- 买家信息（JSON 格式）
  amount REAL NOT NULL, -- 订单金额（元）
  status TEXT NOT NULL DEFAULT 'pending', -- pending, delivered, completed, refunded, cancelled
  delivery_status TEXT DEFAULT 'pending', -- pending, success, failed, retrying
  delivery_content TEXT, -- 发货内容
  delivery_time TEXT, -- 发货时间
  delivery_attempts INTEGER DEFAULT 0, -- 发货尝试次数
  refund_reason TEXT, -- 退款原因
  refund_time TEXT, -- 退款时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT, -- 完成时间
  notes TEXT, -- 备注
  FOREIGN KEY (account_id) REFERENCES accounts(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_account_id ON orders(account_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);

-- ============================================
-- 3. 日志表 (logs)
-- ============================================
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, -- account_check, order_process, delivery, error, system
  level TEXT NOT NULL, -- info, warning, error, critical
  message TEXT NOT NULL,
  data TEXT, -- JSON 格式的详细数据
  user_id TEXT, -- 操作用户（如果适用）
  ip_address TEXT, -- IP 地址
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_logs_type ON logs(type);
CREATE INDEX IF NOT EXISTS idx_logs_level ON logs(level);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);

-- ============================================
-- 4. 配置表 (settings)
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  type TEXT DEFAULT 'string', -- string, number, boolean, json
  description TEXT,
  is_sensitive BOOLEAN DEFAULT 0, -- 是否敏感信息
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT -- 更新者
);

-- 初始化默认配置
INSERT OR IGNORE INTO settings (key, value, type, description) VALUES
  ('system_name', 'Antigravity Pro 自动销售系统', 'string', '系统名称'),
  ('price_per_account', '39.9', 'number', '单个账号售价（元）'),
  ('auto_delivery_enabled', 'true', 'boolean', '是否启用自动发货'),
  ('low_stock_threshold', '10', 'number', '低库存预警阈值'),
  ('check_interval_hours', '1', 'number', '账号检测间隔（小时）'),
  ('telegram_bot_token', '', 'string', 'Telegram Bot Token'),
  ('telegram_chat_id', '', 'string', 'Telegram 通知接收者 Chat ID'),
  ('xianyu_api_endpoint', '', 'string', '闲鱼自动发货 API 端点'),
  ('xianyu_api_key', '', 'string', '闲鱼自动发货 API 密钥'),
  ('delivery_template', '【Antigravity Pro 账号信息】\n\n邮箱：{{email}}\n密码：{{password}}\n恢复邮箱：{{recovery_email}}\n\n使用说明：\n1. 下载 Antigravity 客户端\n2. 使用上述账号登录\n3. 享受 Pro 功能\n\n注意事项：\n- 请及时修改密码\n- 建议绑定自己的恢复邮箱\n- 账号为一年 Pro 权限\n- 无质保，账号失效不退款\n\n如有问题请联系客服', 'string', '发货内容模板');

-- ============================================
-- 5. 统计表 (statistics)
-- ============================================
CREATE TABLE IF NOT EXISTS statistics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE, -- YYYY-MM-DD 格式
  total_accounts INTEGER DEFAULT 0, -- 总账号数
  available_accounts INTEGER DEFAULT 0, -- 可用账号数
  sold_accounts INTEGER DEFAULT 0, -- 已售账号数
  invalid_accounts INTEGER DEFAULT 0, -- 无效账号数
  total_orders INTEGER DEFAULT 0, -- 总订单数
  completed_orders INTEGER DEFAULT 0, -- 完成订单数
  refunded_orders INTEGER DEFAULT 0, -- 退款订单数
  revenue REAL DEFAULT 0, -- 收入（元）
  cost REAL DEFAULT 0, -- 成本（元）
  profit REAL DEFAULT 0, -- 利润（元）
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_statistics_date ON statistics(date);

-- ============================================
-- 6. Webhook 日志表 (webhook_logs)
-- ============================================
CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, -- xianyu, telegram, custom
  event_type TEXT NOT NULL, -- order_created, order_paid, order_refunded, etc.
  payload TEXT NOT NULL, -- JSON 格式的原始数据
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processed, failed
  error_message TEXT, -- 错误信息
  processed_at TEXT, -- 处理时间
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_webhook_logs_source ON webhook_logs(source);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_status ON webhook_logs(status);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created_at ON webhook_logs(created_at);

-- ============================================
-- 7. 触发器：自动更新 updated_at
-- ============================================
CREATE TRIGGER IF NOT EXISTS update_accounts_timestamp 
AFTER UPDATE ON accounts
BEGIN
  UPDATE accounts SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_orders_timestamp 
AFTER UPDATE ON orders
BEGIN
  UPDATE orders SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS update_settings_timestamp 
AFTER UPDATE ON settings
BEGIN
  UPDATE settings SET updated_at = datetime('now') WHERE key = NEW.key;
END;

-- ============================================
-- 8. 视图：账号统计
-- ============================================
CREATE VIEW IF NOT EXISTS v_account_stats AS
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) as available,
  SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END) as sold,
  SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) as invalid,
  SUM(CASE WHEN status = 'checking' THEN 1 ELSE 0 END) as checking,
  SUM(CASE WHEN pro_status = 'active' THEN 1 ELSE 0 END) as pro_active,
  SUM(CASE WHEN pro_status = 'expired' THEN 1 ELSE 0 END) as pro_expired,
  SUM(cost) as total_cost
FROM accounts;

-- ============================================
-- 9. 视图：订单统计
-- ============================================
CREATE VIEW IF NOT EXISTS v_order_stats AS
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
  SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered,
  SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
  SUM(CASE WHEN status = 'refunded' THEN 1 ELSE 0 END) as refunded,
  SUM(amount) as total_amount,
  SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END) as completed_amount,
  SUM(CASE WHEN status = 'refunded' THEN amount ELSE 0 END) as refunded_amount
FROM orders;

-- ============================================
-- 10. 视图：今日统计
-- ============================================
CREATE VIEW IF NOT EXISTS v_today_stats AS
SELECT 
  (SELECT COUNT(*) FROM orders WHERE date(created_at) = date('now')) as today_orders,
  (SELECT SUM(amount) FROM orders WHERE date(created_at) = date('now') AND status = 'completed') as today_revenue,
  (SELECT COUNT(*) FROM accounts WHERE date(created_at) = date('now')) as today_new_accounts,
  (SELECT COUNT(*) FROM accounts WHERE status = 'available' AND pro_status = 'active') as available_pro_accounts;
