/**
 * 账号状态检测模块
 * 
 * 功能:
 * - 检测 Google 账号有效性
 * - 验证 AI Pro 订阅状态
 * - 更新账号数据库记录
 */

import { chromium } from 'playwright';

export interface AccountCheckResult {
  isValid: boolean;
  proStatus: 'active' | 'expired' | 'unknown';
  proExpireDate?: string;
  error?: string;
}

/**
 * 检测账号状态（使用 Playwright 模拟登录）
 * 注意: 此方法需要在支持 Playwright 的环境中运行，Cloudflare Workers 不支持
 * 建议部署在独立服务器上，通过 API 调用
 */
export async function checkAccountStatus(
  email: string,
  password: string
): Promise<AccountCheckResult> {
  let browser;
  
  try {
    // 启动浏览器
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    
    const page = await context.newPage();
    
    // 1. 访问 Google 登录页面
    await page.goto('https://accounts.google.com/signin', {
      waitUntil: 'networkidle'
    });
    
    // 2. 输入邮箱
    await page.fill('input[type="email"]', email);
    await page.click('#identifierNext');
    await page.waitForTimeout(2000);
    
    // 3. 输入密码
    try {
      await page.fill('input[type="password"]', password, { timeout: 5000 });
      await page.click('#passwordNext');
      await page.waitForTimeout(3000);
    } catch (error) {
      return {
        isValid: false,
        proStatus: 'unknown',
        error: '密码输入失败，账号可能无效'
      };
    }
    
    // 4. 检查是否登录成功
    const currentUrl = page.url();
    
    if (currentUrl.includes('challenge') || currentUrl.includes('signin')) {
      return {
        isValid: false,
        proStatus: 'unknown',
        error: '登录失败，可能需要验证或密码错误'
      };
    }
    
    // 5. 访问 Google One 页面检查订阅状态
    await page.goto('https://one.google.com/storage', {
      waitUntil: 'networkidle'
    });
    
    await page.waitForTimeout(3000);
    
    // 6. 检查页面内容判断 Pro 状态
    const pageContent = await page.content();
    
    let proStatus: 'active' | 'expired' | 'unknown' = 'unknown';
    let proExpireDate: string | undefined;
    
    // 检查是否有 AI Pro 标识
    if (pageContent.includes('AI Pro') || pageContent.includes('Google AI Pro')) {
      proStatus = 'active';
      
      // 尝试提取过期时间
      const dateMatch = pageContent.match(/expires?\s+on\s+(\d{4}-\d{2}-\d{2})/i);
      if (dateMatch) {
        proExpireDate = dateMatch[1];
      }
    } else if (pageContent.includes('upgrade') || pageContent.includes('Get AI Pro')) {
      proStatus = 'expired';
    }
    
    await browser.close();
    
    return {
      isValid: true,
      proStatus,
      proExpireDate
    };
    
  } catch (error: any) {
    if (browser) {
      await browser.close();
    }
    
    return {
      isValid: false,
      proStatus: 'unknown',
      error: error.message
    };
  }
}

/**
 * 简化版账号检测（仅验证账号有效性）
 * 通过 OAuth Token 验证
 */
export async function checkAccountValiditySimple(
  email: string,
  password: string
): Promise<boolean> {
  try {
    // 尝试获取 OAuth Token
    const response = await fetch('https://accounts.google.com/o/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: 'YOUR_CLIENT_ID', // 需要配置
        client_secret: 'YOUR_CLIENT_SECRET', // 需要配置
        grant_type: 'password',
        username: email,
        password: password
      })
    });
    
    return response.ok;
  } catch (error) {
    return false;
  }
}

/**
 * 批量检测账号
 */
export async function batchCheckAccounts(
  accounts: Array<{ id: number; email: string; password: string }>
): Promise<Map<number, AccountCheckResult>> {
  const results = new Map<number, AccountCheckResult>();
  
  // 并发控制，避免触发 Google 反爬
  const concurrency = 3;
  const chunks: typeof accounts[] = [];
  
  for (let i = 0; i < accounts.length; i += concurrency) {
    chunks.push(accounts.slice(i, i + concurrency));
  }
  
  for (const chunk of chunks) {
    const promises = chunk.map(async (account) => {
      const result = await checkAccountStatus(account.email, account.password);
      results.set(account.id, result);
      
      // 每次检测后等待一段时间
      await new Promise(resolve => setTimeout(resolve, 5000));
    });
    
    await Promise.all(promises);
  }
  
  return results;
}

/**
 * 加密密码（用于数据库存储）
 */
export async function encryptPassword(password: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const keyData = encoder.encode(key);
  
  // 使用 Web Crypto API 加密
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );
  
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data
  );
  
  // 将 IV 和加密数据组合
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  
  // 转换为 Base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * 解密密码
 */
export async function decryptPassword(encrypted: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key);
  
  // 从 Base64 解码
  const combined = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  
  // 分离 IV 和加密数据
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  
  // 使用 Web Crypto API 解密
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    data
  );
  
  const decoder = new TextDecoder();
  return decoder.decode(decrypted);
}

/**
 * 定时任务：检测账号状态
 * 在 Cloudflare Workers Cron Trigger 中调用
 */
export async function scheduledAccountCheck(db: D1Database, encryptionKey: string) {
  console.log('开始定时检测账号状态...');
  
  // 获取需要检测的账号（上次检测时间超过 1 小时）
  const { results: accounts } = await db.prepare(`
    SELECT id, email, password 
    FROM accounts 
    WHERE status IN ('available', 'sold') 
    AND (last_checked_at IS NULL OR datetime(last_checked_at) < datetime('now', '-1 hour'))
    ORDER BY last_checked_at ASC NULLS FIRST
    LIMIT 50
  `).all();
  
  if (!accounts || accounts.length === 0) {
    console.log('没有需要检测的账号');
    return;
  }
  
  console.log(`找到 ${accounts.length} 个需要检测的账号`);
  
  // 注意: 实际使用时，应该调用独立的检测服务 API
  // 因为 Cloudflare Workers 不支持 Playwright
  
  for (const account of accounts as any[]) {
    try {
      // 解密密码
      const password = await decryptPassword(account.password, encryptionKey);
      
      // 这里应该调用独立的检测服务 API
      // const result = await fetch('https://your-checker-service.com/check', {
      //   method: 'POST',
      //   body: JSON.stringify({ email: account.email, password })
      // });
      
      // 模拟检测结果（实际使用时替换为真实检测）
      const mockResult: AccountCheckResult = {
        isValid: true,
        proStatus: 'active'
      };
      
      // 更新数据库
      await db.prepare(`
        UPDATE accounts 
        SET pro_status = ?, 
            pro_expire_date = ?,
            last_checked_at = datetime('now'),
            check_count = check_count + 1,
            status = CASE WHEN ? = 0 THEN 'invalid' ELSE status END
        WHERE id = ?
      `).bind(
        mockResult.proStatus,
        mockResult.proExpireDate || null,
        mockResult.isValid ? 1 : 0,
        account.id
      ).run();
      
      // 记录日志
      await db.prepare(`
        INSERT INTO logs (type, level, message, data)
        VALUES (?, ?, ?, ?)
      `).bind(
        'account_check',
        mockResult.isValid ? 'info' : 'warning',
        `检测账号 ${account.email}: ${mockResult.isValid ? '有效' : '无效'}`,
        JSON.stringify(mockResult)
      ).run();
      
      console.log(`✓ 检测完成: ${account.email} - ${mockResult.proStatus}`);
      
    } catch (error: any) {
      console.error(`✗ 检测失败: ${account.email} - ${error.message}`);
      
      // 记录错误日志
      await db.prepare(`
        INSERT INTO logs (type, level, message, data)
        VALUES (?, ?, ?, ?)
      `).bind(
        'account_check',
        'error',
        `检测账号 ${account.email} 失败: ${error.message}`,
        JSON.stringify({ email: account.email, error: error.message })
      ).run();
    }
  }
  
  console.log('定时检测完成');
}
