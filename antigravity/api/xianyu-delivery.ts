/**
 * 闲鱼自动发货集成模块
 * 
 * 支持多种发货方式:
 * 1. 第三方发货工具 API（闲管家、阿奇索等）
 * 2. 自建监听脚本
 * 3. Webhook 集成
 */

export interface DeliveryConfig {
  method: 'api' | 'webhook' | 'manual';
  apiEndpoint?: string;
  apiKey?: string;
  webhookSecret?: string;
}

export interface DeliveryResult {
  success: boolean;
  deliveryId?: string;
  error?: string;
  timestamp: string;
}

/**
 * 通用发货接口
 */
export async function deliverToXianyu(
  config: DeliveryConfig,
  orderId: string,
  content: string,
  buyerInfo?: any
): Promise<DeliveryResult> {
  const timestamp = new Date().toISOString();
  
  try {
    switch (config.method) {
      case 'api':
        return await deliverViaAPI(config, orderId, content, buyerInfo);
      
      case 'webhook':
        return await deliverViaWebhook(config, orderId, content, buyerInfo);
      
      case 'manual':
        return {
          success: true,
          timestamp,
          error: '手动发货模式，请人工处理'
        };
      
      default:
        return {
          success: false,
          timestamp,
          error: '不支持的发货方式'
        };
    }
  } catch (error: any) {
    return {
      success: false,
      timestamp,
      error: error.message
    };
  }
}

/**
 * 方式 1: 通过第三方 API 发货
 * 
 * 适用于:
 * - 闲管家 (xianguanjia)
 * - 阿奇索 (agiso)
 * - 其他第三方工具
 */
async function deliverViaAPI(
  config: DeliveryConfig,
  orderId: string,
  content: string,
  buyerInfo?: any
): Promise<DeliveryResult> {
  if (!config.apiEndpoint || !config.apiKey) {
    throw new Error('API 配置不完整');
  }
  
  // 示例: 闲管家 API 格式（需根据实际 API 文档调整）
  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'X-API-Key': config.apiKey
    },
    body: JSON.stringify({
      order_id: orderId,
      content: content,
      buyer_info: buyerInfo,
      delivery_type: 'virtual', // 虚拟商品
      timestamp: Date.now()
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API 调用失败: ${response.status} - ${error}`);
  }
  
  const result = await response.json();
  
  return {
    success: true,
    deliveryId: result.delivery_id || result.id,
    timestamp: new Date().toISOString()
  };
}

/**
 * 方式 2: 通过 Webhook 触发发货
 * 
 * 适用于:
 * - 自建发货脚本
 * - 第三方集成平台（如 Zapier、n8n）
 */
async function deliverViaWebhook(
  config: DeliveryConfig,
  orderId: string,
  content: string,
  buyerInfo?: any
): Promise<DeliveryResult> {
  if (!config.apiEndpoint) {
    throw new Error('Webhook 地址未配置');
  }
  
  const payload = {
    event: 'delivery_request',
    order_id: orderId,
    content: content,
    buyer_info: buyerInfo,
    timestamp: Date.now()
  };
  
  // 如果配置了签名密钥，生成签名
  let signature: string | undefined;
  if (config.webhookSecret) {
    signature = await generateWebhookSignature(
      JSON.stringify(payload),
      config.webhookSecret
    );
  }
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  
  if (signature) {
    headers['X-Webhook-Signature'] = signature;
  }
  
  const response = await fetch(config.apiEndpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    throw new Error(`Webhook 调用失败: ${response.status}`);
  }
  
  return {
    success: true,
    timestamp: new Date().toISOString()
  };
}

/**
 * 生成 Webhook 签名
 */
async function generateWebhookSignature(
  payload: string,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 验证 Webhook 签名
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  const expectedSignature = await generateWebhookSignature(payload, secret);
  return signature === expectedSignature;
}

/**
 * 闲管家 API 集成示例
 * 官网: https://xianguanjia.com
 */
export class XianGuanJiaAPI {
  private apiKey: string;
  private baseUrl: string;
  
  constructor(apiKey: string, baseUrl: string = 'https://api.xianguanjia.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }
  
  /**
   * 发送消息到闲鱼聊天窗口
   */
  async sendMessage(orderId: string, message: string): Promise<DeliveryResult> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/messages/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          order_id: orderId,
          message: message,
          type: 'text'
        })
      });
      
      if (!response.ok) {
        throw new Error(`API 错误: ${response.status}`);
      }
      
      const result = await response.json();
      
      return {
        success: true,
        deliveryId: result.message_id,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * 虚拟商品自动发货
   */
  async deliverVirtual(orderId: string, content: string): Promise<DeliveryResult> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/delivery/virtual`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          order_id: orderId,
          content: content,
          auto_confirm: true // 自动确认发货
        })
      });
      
      if (!response.ok) {
        throw new Error(`API 错误: ${response.status}`);
      }
      
      const result = await response.json();
      
      return {
        success: true,
        deliveryId: result.delivery_id,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * 查询订单状态
   */
  async getOrderStatus(orderId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/v1/orders/${orderId}`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`
      }
    });
    
    if (!response.ok) {
      throw new Error(`API 错误: ${response.status}`);
    }
    
    return await response.json();
  }
}

/**
 * 阿奇索 API 集成示例
 * 官网: https://www.agiso.com
 */
export class AgisoAPI {
  private apiKey: string;
  private baseUrl: string;
  
  constructor(apiKey: string, baseUrl: string = 'https://api.agiso.com') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
  }
  
  /**
   * 自动发货
   */
  async autoDeliver(orderId: string, cardData: string): Promise<DeliveryResult> {
    try {
      const response = await fetch(`${this.baseUrl}/api/delivery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': this.apiKey
        },
        body: JSON.stringify({
          order_no: orderId,
          card_data: cardData,
          delivery_mode: 'auto'
        })
      });
      
      if (!response.ok) {
        throw new Error(`API 错误: ${response.status}`);
      }
      
      const result = await response.json();
      
      return {
        success: result.success,
        deliveryId: result.data?.delivery_id,
        timestamp: new Date().toISOString()
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
}

/**
 * 自建监听脚本方案
 * 
 * 原理:
 * 1. 在服务器上运行 Puppeteer 脚本
 * 2. 监听闲鱼 App/网页的新订单
 * 3. 自动发送消息到聊天窗口
 * 
 * 注意: 需要独立服务器，不能在 Cloudflare Workers 运行
 */
export const selfHostedScriptExample = `
// 自建监听脚本示例（Node.js + Puppeteer）

const puppeteer = require('puppeteer');
const axios = require('axios');

class XianyuAutoDelivery {
  constructor(apiEndpoint) {
    this.apiEndpoint = apiEndpoint; // 你的 Cloudflare Worker API
    this.browser = null;
    this.page = null;
  }
  
  async init() {
    this.browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox']
    });
    
    this.page = await this.browser.newPage();
    
    // 登录闲鱼（需要手动扫码或输入验证码）
    await this.login();
  }
  
  async login() {
    await this.page.goto('https://2.taobao.com/');
    // 等待用户扫码登录
    console.log('请扫码登录闲鱼...');
    await this.page.waitForNavigation({ timeout: 60000 });
    console.log('登录成功！');
  }
  
  async monitorOrders() {
    console.log('开始监听订单...');
    
    while (true) {
      try {
        // 访问订单页面
        await this.page.goto('https://2.taobao.com/order/list.htm');
        
        // 检查是否有新订单
        const orders = await this.page.evaluate(() => {
          const orderElements = document.querySelectorAll('.order-item');
          return Array.from(orderElements).map(el => ({
            orderId: el.getAttribute('data-order-id'),
            status: el.querySelector('.order-status')?.textContent,
            buyerName: el.querySelector('.buyer-name')?.textContent
          }));
        });
        
        // 处理待发货订单
        for (const order of orders) {
          if (order.status === '待发货') {
            await this.processOrder(order);
          }
        }
        
        // 等待 30 秒后再次检查
        await new Promise(resolve => setTimeout(resolve, 30000));
        
      } catch (error) {
        console.error('监听订单出错:', error);
        await new Promise(resolve => setTimeout(resolve, 60000));
      }
    }
  }
  
  async processOrder(order) {
    console.log('处理订单:', order.orderId);
    
    try {
      // 调用你的 API 获取账号信息
      const response = await axios.post(\`\${this.apiEndpoint}/api/orders/process\`, {
        order_id: order.orderId,
        buyer_name: order.buyerName
      });
      
      if (response.data.success) {
        const { content } = response.data.data;
        
        // 发送消息到聊天窗口
        await this.sendMessage(order.orderId, content);
        
        console.log('发货成功:', order.orderId);
      }
    } catch (error) {
      console.error('处理订单失败:', error);
    }
  }
  
  async sendMessage(orderId, content) {
    // 打开聊天窗口
    await this.page.goto(\`https://2.taobao.com/chat.htm?order_id=\${orderId}\`);
    
    // 输入消息
    await this.page.type('.chat-input', content);
    
    // 发送
    await this.page.click('.send-button');
    
    await this.page.waitForTimeout(2000);
  }
  
  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }
}

// 使用示例
const delivery = new XianyuAutoDelivery('https://your-worker.workers.dev');
delivery.init().then(() => {
  delivery.monitorOrders();
});
`;

/**
 * 发货重试机制
 */
export async function deliverWithRetry(
  config: DeliveryConfig,
  orderId: string,
  content: string,
  maxRetries: number = 3,
  retryDelay: number = 5000
): Promise<DeliveryResult> {
  let lastError: string = '';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`发货尝试 ${attempt}/${maxRetries}: ${orderId}`);
    
    const result = await deliverToXianyu(config, orderId, content);
    
    if (result.success) {
      return result;
    }
    
    lastError = result.error || '未知错误';
    console.error(`发货失败 (尝试 ${attempt}):`, lastError);
    
    if (attempt < maxRetries) {
      // 等待后重试
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  
  return {
    success: false,
    error: `发货失败，已重试 ${maxRetries} 次。最后错误: ${lastError}`,
    timestamp: new Date().toISOString()
  };
}

/**
 * 发货状态回调处理
 */
export async function handleDeliveryCallback(
  db: D1Database,
  orderId: string,
  status: 'success' | 'failed',
  error?: string
) {
  const updateQuery = status === 'success'
    ? `UPDATE orders SET delivery_status = 'success', status = 'delivered', delivery_time = datetime('now') WHERE order_id = ?`
    : `UPDATE orders SET delivery_status = 'failed', delivery_attempts = delivery_attempts + 1 WHERE order_id = ?`;
  
  await db.prepare(updateQuery).bind(orderId).run();
  
  // 记录日志
  await db.prepare(`
    INSERT INTO logs (type, level, message, data)
    VALUES (?, ?, ?, ?)
  `).bind(
    'delivery',
    status === 'success' ? 'info' : 'error',
    `订单 ${orderId} 发货${status === 'success' ? '成功' : '失败'}`,
    JSON.stringify({ orderId, status, error })
  ).run();
}
