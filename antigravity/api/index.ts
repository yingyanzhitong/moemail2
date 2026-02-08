/**
 * Antigravity Pro 账号自动化销售系统 - Cloudflare Worker API
 * 
 * 功能模块:
 * - 账号管理 API
 * - 订单处理 API
 * - 状态监控 API
 * - 发货集成 API
 * - Webhook 接收
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { jwt } from 'hono/jwt';

// 类型定义
type Bindings = {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  XIANYU_API_KEY: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
};

type Variables = {
  user?: {
    id: string;
    role: string;
  };
};

// 创建 Hono 应用
const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// 中间件
app.use('*', logger());
app.use('*', prettyJSON());
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// JWT 认证中间件（除了 webhook 和公开接口）
app.use('/api/*', async (c, next) => {
  const path = c.req.path;
  
  // 公开接口，不需要认证
  if (path.includes('/webhook') || path.includes('/health')) {
    return next();
  }
  
  // 其他接口需要 JWT 认证
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET,
  });
  
  return jwtMiddleware(c, next);
});

// ============================================
// 健康检查
// ============================================
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

// ============================================
// 账号管理 API
// ============================================

// 获取账号列表
app.get('/api/accounts', async (c) => {
  const { status, pro_status, page = '1', limit = '20' } = c.req.query();
  
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  let query = 'SELECT * FROM accounts WHERE 1=1';
  const params: any[] = [];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  if (pro_status) {
    query += ' AND pro_status = ?';
    params.push(pro_status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);
  
  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  
  // 获取总数
  let countQuery = 'SELECT COUNT(*) as total FROM accounts WHERE 1=1';
  const countParams: any[] = [];
  
  if (status) {
    countQuery += ' AND status = ?';
    countParams.push(status);
  }
  
  if (pro_status) {
    countQuery += ' AND pro_status = ?';
    countParams.push(pro_status);
  }
  
  const { results: countResults } = await c.env.DB.prepare(countQuery).bind(...countParams).all();
  const total = (countResults[0] as any).total;
  
  return c.json({
    success: true,
    data: results,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / parseInt(limit)),
    },
  });
});

// 获取账号统计
app.get('/api/accounts/stats', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM v_account_stats').all();
  
  return c.json({
    success: true,
    data: results[0] || {},
  });
});

// 导入账号
app.post('/api/accounts/import', async (c) => {
  const { accounts } = await c.req.json();
  
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return c.json({ success: false, error: '无效的账号数据' }, 400);
  }
  
  const inserted: any[] = [];
  const errors: any[] = [];
  
  for (const account of accounts) {
    try {
      // 加密密码（这里简化处理，实际应使用加密库）
      const encryptedPassword = account.password; // TODO: 实现加密
      
      const result = await c.env.DB.prepare(`
        INSERT INTO accounts (email, password, recovery_email, phone, source, cost, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).bind(
        account.email,
        encryptedPassword,
        account.recovery_email || null,
        account.phone || null,
        account.source || 'manual_import',
        account.cost || 0,
        account.notes || null
      ).run();
      
      inserted.push({ email: account.email, id: result.meta.last_row_id });
    } catch (error: any) {
      errors.push({ email: account.email, error: error.message });
    }
  }
  
  // 记录日志
  await c.env.DB.prepare(`
    INSERT INTO logs (type, level, message, data)
    VALUES (?, ?, ?, ?)
  `).bind(
    'account_import',
    'info',
    `导入账号: 成功 ${inserted.length} 个, 失败 ${errors.length} 个`,
    JSON.stringify({ inserted, errors })
  ).run();
  
  return c.json({
    success: true,
    data: {
      inserted: inserted.length,
      errors: errors.length,
      details: { inserted, errors },
    },
  });
});

// 更新账号
app.put('/api/accounts/:id', async (c) => {
  const id = c.req.param('id');
  const updates = await c.req.json();
  
  const allowedFields = ['status', 'pro_status', 'pro_expire_date', 'notes'];
  const fields = Object.keys(updates).filter(k => allowedFields.includes(k));
  
  if (fields.length === 0) {
    return c.json({ success: false, error: '没有可更新的字段' }, 400);
  }
  
  const setClause = fields.map(f => `${f} = ?`).join(', ');
  const values = fields.map(f => updates[f]);
  
  await c.env.DB.prepare(`
    UPDATE accounts SET ${setClause} WHERE id = ?
  `).bind(...values, id).run();
  
  return c.json({
    success: true,
    message: '账号更新成功',
  });
});

// 删除账号
app.delete('/api/accounts/:id', async (c) => {
  const id = c.req.param('id');
  
  await c.env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
  
  return c.json({
    success: true,
    message: '账号删除成功',
  });
});

// ============================================
// 订单管理 API
// ============================================

// 获取订单列表
app.get('/api/orders', async (c) => {
  const { status, page = '1', limit = '20' } = c.req.query();
  
  const offset = (parseInt(page) - 1) * parseInt(limit);
  
  let query = 'SELECT * FROM orders WHERE 1=1';
  const params: any[] = [];
  
  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), offset);
  
  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  
  return c.json({
    success: true,
    data: results,
  });
});

// 获取订单统计
app.get('/api/orders/stats', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM v_order_stats').all();
  
  return c.json({
    success: true,
    data: results[0] || {},
  });
});

// 手动发货
app.post('/api/orders/:id/deliver', async (c) => {
  const id = c.req.param('id');
  const { account_id } = await c.req.json();
  
  // 获取订单信息
  const { results: orders } = await c.env.DB.prepare(
    'SELECT * FROM orders WHERE id = ?'
  ).bind(id).all();
  
  if (!orders || orders.length === 0) {
    return c.json({ success: false, error: '订单不存在' }, 404);
  }
  
  const order: any = orders[0];
  
  // 获取账号信息
  const { results: accounts } = await c.env.DB.prepare(
    'SELECT * FROM accounts WHERE id = ? AND status = "available"'
  ).bind(account_id).all();
  
  if (!accounts || accounts.length === 0) {
    return c.json({ success: false, error: '账号不可用' }, 400);
  }
  
  const account: any = accounts[0];
  
  // 生成发货内容
  const deliveryContent = await generateDeliveryContent(c.env.DB, account);
  
  // 调用发货 API
  const deliveryResult = await deliverToXianyu(
    c.env.XIANYU_API_KEY,
    order.order_id,
    deliveryContent
  );
  
  if (deliveryResult.success) {
    // 更新订单状态
    await c.env.DB.prepare(`
      UPDATE orders 
      SET account_id = ?, status = 'delivered', delivery_status = 'success',
          delivery_content = ?, delivery_time = datetime('now')
      WHERE id = ?
    `).bind(account_id, deliveryContent, id).run();
    
    // 更新账号状态
    await c.env.DB.prepare(`
      UPDATE accounts SET status = 'sold' WHERE id = ?
    `).bind(account_id).run();
    
    // 发送 Telegram 通知
    await sendTelegramNotification(
      c.env.TELEGRAM_BOT_TOKEN,
      c.env.TELEGRAM_CHAT_ID,
      `✅ 订单发货成功\n订单号: ${order.order_id}\n账号: ${account.email}`
    );
    
    return c.json({
      success: true,
      message: '发货成功',
    });
  } else {
    return c.json({
      success: false,
      error: '发货失败: ' + deliveryResult.error,
    }, 500);
  }
});

// ============================================
// Webhook 接收
// ============================================

// 闲鱼订单 Webhook
app.post('/api/webhook/xianyu', async (c) => {
  const payload = await c.req.json();
  
  // 记录 webhook 日志
  await c.env.DB.prepare(`
    INSERT INTO webhook_logs (source, event_type, payload, status)
    VALUES (?, ?, ?, ?)
  `).bind('xianyu', payload.event_type || 'unknown', JSON.stringify(payload), 'pending').run();
  
  try {
    // 处理订单创建事件
    if (payload.event_type === 'order_paid') {
      await handleOrderPaid(c.env, payload);
    }
    
    return c.json({ success: true });
  } catch (error: any) {
    console.error('Webhook 处理失败:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

// ============================================
// 定时任务（Cron Trigger）
// ============================================
export default {
  fetch: app.fetch,
  
  // 定时检测账号状态
  async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext) {
    console.log('开始定时检测账号状态...');
    
    // 获取需要检测的账号
    const { results: accounts } = await env.DB.prepare(`
      SELECT * FROM accounts 
      WHERE status IN ('available', 'sold') 
      AND (last_checked_at IS NULL OR datetime(last_checked_at) < datetime('now', '-1 hour'))
      LIMIT 50
    `).all();
    
    for (const account of accounts as any[]) {
      try {
        // TODO: 实现账号状态检测逻辑
        // const status = await checkAccountStatus(account);
        
        await env.DB.prepare(`
          UPDATE accounts 
          SET last_checked_at = datetime('now'), check_count = check_count + 1
          WHERE id = ?
        `).bind(account.id).run();
      } catch (error) {
        console.error(`检测账号 ${account.email} 失败:`, error);
      }
    }
    
    console.log(`完成检测 ${accounts.length} 个账号`);
  },
};

// ============================================
// 辅助函数
// ============================================

// 生成发货内容
async function generateDeliveryContent(db: D1Database, account: any): Promise<string> {
  const { results } = await db.prepare(
    'SELECT value FROM settings WHERE key = "delivery_template"'
  ).all();
  
  let template = (results[0] as any)?.value || '邮箱: {{email}}\n密码: {{password}}';
  
  template = template.replace('{{email}}', account.email);
  template = template.replace('{{password}}', account.password); // TODO: 解密
  template = template.replace('{{recovery_email}}', account.recovery_email || '无');
  
  return template;
}

// 调用闲鱼发货 API
async function deliverToXianyu(apiKey: string, orderId: string, content: string) {
  // TODO: 实现实际的闲鱼发货 API 调用
  // 这里需要根据使用的第三方工具的 API 文档实现
  
  console.log('发货到闲鱼:', orderId, content);
  
  return { success: true };
}

// 发送 Telegram 通知
async function sendTelegramNotification(botToken: string, chatId: string, message: string) {
  if (!botToken || !chatId) return;
  
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
  } catch (error) {
    console.error('发送 Telegram 通知失败:', error);
  }
}

// 处理订单支付事件
async function handleOrderPaid(env: Bindings, payload: any) {
  const { order_id, buyer_info, amount } = payload;
  
  // 创建订单记录
  await env.DB.prepare(`
    INSERT INTO orders (order_id, buyer_info, amount, status)
    VALUES (?, ?, ?, ?)
  `).bind(order_id, JSON.stringify(buyer_info), amount, 'pending').run();
  
  // 检查是否启用自动发货
  const { results } = await env.DB.prepare(
    'SELECT value FROM settings WHERE key = "auto_delivery_enabled"'
  ).all();
  
  const autoDeliveryEnabled = (results[0] as any)?.value === 'true';
  
  if (autoDeliveryEnabled) {
    // 自动分配账号并发货
    const { results: accounts } = await env.DB.prepare(`
      SELECT * FROM accounts 
      WHERE status = 'available' AND pro_status = 'active'
      ORDER BY created_at ASC
      LIMIT 1
    `).all();
    
    if (accounts && accounts.length > 0) {
      const account: any = accounts[0];
      
      // 生成发货内容
      const deliveryContent = await generateDeliveryContent(env.DB, account);
      
      // 发货
      const deliveryResult = await deliverToXianyu(env.XIANYU_API_KEY, order_id, deliveryContent);
      
      if (deliveryResult.success) {
        // 更新订单和账号状态
        await env.DB.prepare(`
          UPDATE orders 
          SET account_id = ?, status = 'delivered', delivery_status = 'success',
              delivery_content = ?, delivery_time = datetime('now')
          WHERE order_id = ?
        `).bind(account.id, deliveryContent, order_id).run();
        
        await env.DB.prepare(`
          UPDATE accounts SET status = 'sold' WHERE id = ?
        `).bind(account.id).run();
        
        // 发送通知
        await sendTelegramNotification(
          env.TELEGRAM_BOT_TOKEN,
          env.TELEGRAM_CHAT_ID,
          `✅ 自动发货成功\n订单号: ${order_id}\n账号: ${account.email}`
        );
      }
    } else {
      // 库存不足，发送预警
      await sendTelegramNotification(
        env.TELEGRAM_BOT_TOKEN,
        env.TELEGRAM_CHAT_ID,
        `⚠️ 库存不足！\n订单号: ${order_id}\n请及时补充账号`
      );
    }
  }
}
