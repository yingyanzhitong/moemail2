import { NotFoundError } from "cloudflare";
import "dotenv/config";
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createDatabase,
  createKVNamespace,
  createPages,
  getDatabase,
  getKVNamespaceList,
  getPages,
} from "./cloudflare";

const PROJECT_NAME = process.env.PROJECT_NAME || "moemail";
const DATABASE_NAME = process.env.DATABASE_NAME || "moemail-db";
const KV_NAMESPACE_NAME = process.env.KV_NAMESPACE_NAME || "moemail-kv";
const CUSTOM_DOMAIN = process.env.CUSTOM_DOMAIN;
const KV_NAMESPACE_ID = process.env.KV_NAMESPACE_ID;
const WRANGLER_COMMAND = "pnpm exec wrangler";
const TINYPNG_REGISTRAR_CONFIGS = [
  { region: "apac", file: "wrangler.tinypng.registrar-apac.json" },
  { region: "americas", file: "wrangler.tinypng.registrar-americas.json" },
  { region: "europe", file: "wrangler.tinypng.registrar-europe.json" },
];

const getTinyPngRegistrarServiceName = (region: string) =>
  PROJECT_NAME === "moemail"
    ? `tinypng-pool-registrar-${region}`
    : `${PROJECT_NAME}-tinypng-pool-registrar-${region}`;

const getTinyPngServiceBindings = () => [
  { binding: "TINYPNG_REGISTRAR_APAC", service: getTinyPngRegistrarServiceName("apac") },
  { binding: "TINYPNG_REGISTRAR_AMERICAS", service: getTinyPngRegistrarServiceName("americas") },
  { binding: "TINYPNG_REGISTRAR_EUROPE", service: getTinyPngRegistrarServiceName("europe") },
];

/**
 * 验证必要的环境变量
 */
const validateEnvironment = () => {
  const requiredEnvVars = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"];
  const missing = requiredEnvVars.filter((varName) => !process.env[varName]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
};

/**
 * 处理JSON配置文件
 */
const setupConfigFile = (examplePath: string, targetPath: string) => {
  try {
    // 如果目标文件已存在，则跳过
    if (existsSync(targetPath)) {
      console.log(`✨ Configuration ${targetPath} already exists.`);
      return;
    }

    if (!existsSync(examplePath)) {
      console.log(`⚠️ Example file ${examplePath} does not exist, skipping...`);
      return;
    }

    const configContent = readFileSync(examplePath, "utf-8");
    const json = JSON.parse(configContent);

    // 处理自定义项目名称
    if (PROJECT_NAME !== "moemail") {
      const wranglerFileName = targetPath.split("/").at(-1);

      switch (wranglerFileName) {
        case "wrangler.json":
          json.name = PROJECT_NAME;
          break;
        case "wrangler.email.json":
          json.name = `${PROJECT_NAME}-email-receiver-worker`;
          break;
        case "wrangler.cleanup.json":
          json.name = `${PROJECT_NAME}-cleanup-worker`;
          break;
        case "wrangler.tinypng.json":
          json.name = `${PROJECT_NAME}-tinypng-pool-worker`;
          break;
        case "wrangler.tinypng.registrar-apac.json":
          json.name = getTinyPngRegistrarServiceName("apac");
          break;
        case "wrangler.tinypng.registrar-americas.json":
          json.name = getTinyPngRegistrarServiceName("americas");
          break;
        case "wrangler.tinypng.registrar-europe.json":
          json.name = getTinyPngRegistrarServiceName("europe");
          break;
        default:
          break;
      }
    }

    // 处理数据库配置
    if (json.d1_databases && json.d1_databases.length > 0) {
      json.d1_databases[0].database_name = DATABASE_NAME;
    }

    // 写入配置文件
    writeFileSync(targetPath, JSON.stringify(json, null, 2));
    console.log(`✅ Configuration ${targetPath} setup successfully.`);
  } catch (error) {
    console.error(`❌ Failed to setup ${targetPath}:`, error);
    throw error;
  }
};

/**
 * 设置所有Wrangler配置文件
 */
const setupWranglerConfigs = () => {
  console.log("🔧 Setting up Wrangler configuration files...");

  const configs = [
    { example: "wrangler.example.json", target: "wrangler.json" },
    { example: "wrangler.email.example.json", target: "wrangler.email.json" },
    { example: "wrangler.cleanup.example.json", target: "wrangler.cleanup.json" },
    { example: "wrangler.tinypng.example.json", target: "wrangler.tinypng.json" },
    { example: "wrangler.tinypng.registrar-apac.example.json", target: "wrangler.tinypng.registrar-apac.json" },
    { example: "wrangler.tinypng.registrar-americas.example.json", target: "wrangler.tinypng.registrar-americas.json" },
    { example: "wrangler.tinypng.registrar-europe.example.json", target: "wrangler.tinypng.registrar-europe.json" },
  ];

  // 处理每个配置文件
  for (const config of configs) {
    setupConfigFile(
      resolve(config.example),
      resolve(config.target)
    );
  }

  for (const filename of ["wrangler.json", "wrangler.tinypng.json"]) {
    const configPath = resolve(filename);
    if (!existsSync(configPath)) continue;

    const json = JSON.parse(readFileSync(configPath, "utf-8"));
    json.services = getTinyPngServiceBindings();
    writeFileSync(configPath, JSON.stringify(json, null, 2));
    console.log(`✅ Updated TinyPNG service bindings in ${filename}`);
  }
};

/**
 * 更新数据库ID到所有配置文件
 */
const updateDatabaseConfig = (dbId: string) => {
  console.log(`📝 Updating database ID (${dbId}) in configurations...`);

  // 更新所有配置文件
  const configFiles = [
    "wrangler.json",
    "wrangler.email.json",
    "wrangler.cleanup.json",
    "wrangler.tinypng.json",
    ...TINYPNG_REGISTRAR_CONFIGS.map(({ file }) => file),
  ];

  for (const filename of configFiles) {
    const configPath = resolve(filename);
    if (!existsSync(configPath)) continue;

    try {
      const json = JSON.parse(readFileSync(configPath, "utf-8"));
      if (json.d1_databases && json.d1_databases.length > 0) {
        json.d1_databases[0].database_id = dbId;
      }
      writeFileSync(configPath, JSON.stringify(json, null, 2));
      console.log(`✅ Updated database ID in ${filename}`);
    } catch (error) {
      console.error(`❌ Failed to update ${filename}:`, error);
    }
  }
};

/**
 * 更新KV命名空间ID到所有配置文件
 */
const updateKVConfig = (namespaceId: string) => {
  console.log(`📝 Updating KV namespace ID (${namespaceId}) in configurations...`);

  const configFiles = [
    "wrangler.json",
    "wrangler.tinypng.json",
  ];

  for (const filename of configFiles) {
    const wranglerPath = resolve(filename);
    if (!existsSync(wranglerPath)) continue;

    try {
      const json = JSON.parse(readFileSync(wranglerPath, "utf-8"));
      if (json.kv_namespaces && json.kv_namespaces.length > 0) {
        json.kv_namespaces[0].id = namespaceId;
      }
      writeFileSync(wranglerPath, JSON.stringify(json, null, 2));
      console.log(`✅ Updated KV namespace ID in ${filename}`);
    } catch (error) {
      console.error(`❌ Failed to update ${filename}:`, error);
    }
  }
};

/**
 * 检查并创建数据库
 */
const checkAndCreateDatabase = async () => {
  console.log(`🔍 Checking if database "${DATABASE_NAME}" exists...`);

  try {
    const database = await getDatabase();

    if (!database || !database.uuid) {
      throw new Error('Database object is missing a valid UUID');
    }

    updateDatabaseConfig(database.uuid);
    console.log(`✅ Database "${DATABASE_NAME}" already exists (ID: ${database.uuid})`);
  } catch (error) {
    if (error instanceof NotFoundError) {
      console.log(`⚠️ Database not found, creating new database...`);
      try {
        const database = await createDatabase();

        if (!database || !database.uuid) {
          throw new Error('Database object is missing a valid UUID');
        }

        updateDatabaseConfig(database.uuid);
        console.log(`✅ Database "${DATABASE_NAME}" created successfully (ID: ${database.uuid})`);
      } catch (createError) {
        console.error(`❌ Failed to create database:`, createError);
        throw createError;
      }
    } else {
      console.error(`❌ An error occurred while checking the database:`, error);
      throw error;
    }
  }
};

/**
 * 迁移数据库
 */
const migrateDatabase = () => {
  console.log("📝 Migrating remote database...");
  try {
    execSync("pnpm run db:migrate-remote", { stdio: "inherit" });
    console.log("✅ Database migration completed successfully");
  } catch (error) {
    console.error("❌ Database migration failed:", error);
    throw error;
  }
};

/**
 * 检查并创建KV命名空间
 */
const checkAndCreateKVNamespace = async () => {
  console.log(`🔍 Checking if KV namespace "${KV_NAMESPACE_NAME}" exists...`);

  if (KV_NAMESPACE_ID) {
    updateKVConfig(KV_NAMESPACE_ID);
    console.log(`✅ User specified KV namespace (ID: ${KV_NAMESPACE_ID})`);
    return;
  }

  try {
    let namespace;

    const namespaceList = await getKVNamespaceList();
    namespace = namespaceList.find(ns => ns.title === KV_NAMESPACE_NAME);

    if (namespace && namespace.id) {
      updateKVConfig(namespace.id);
      console.log(`✅ KV namespace "${KV_NAMESPACE_NAME}" found by name (ID: ${namespace.id})`);
    } else {
      console.log("⚠️ KV namespace not found by name, creating new KV namespace...");
      namespace = await createKVNamespace();
      updateKVConfig(namespace.id);
      console.log(`✅ KV namespace "${KV_NAMESPACE_NAME}" created successfully (ID: ${namespace.id})`);
    }
  } catch (error) {
    console.error(`❌ An error occurred while checking the KV namespace:`, error);
    throw error;
  }
};

/**
 * 检查并创建Pages项目
 */
const checkAndCreatePages = async () => {
  console.log(`🔍 Checking if project "${PROJECT_NAME}" exists...`);

  try {
    await getPages();
    console.log("✅ Project already exists, proceeding with update...");
  } catch (error) {
    if (error instanceof NotFoundError) {
      console.log("⚠️ Project not found, creating new project...");
      const pages = await createPages();

      if (!CUSTOM_DOMAIN && pages.subdomain) {
        console.log("⚠️ CUSTOM_DOMAIN is empty, using pages default domain...");
        console.log("📝 Updating environment variables...");

        // 更新环境变量为默认的Pages域名
        const appUrl = `https://${pages.subdomain}`;
        updateEnvVar("CUSTOM_DOMAIN", appUrl);
      }
    } else {
      console.error(`❌ An error occurred while checking the project:`, error);
      throw error;
    }
  }
};

/**
 * 推送Pages密钥
 */
const pushPagesSecret = () => {
  console.log("🔐 Pushing environment secrets to Pages...");

  // 定义运行时所需的环境变量列表
  const runtimeEnvVars = [
    'AUTH_GITHUB_ID', 
    'AUTH_GITHUB_SECRET', 
    'AUTH_GOOGLE_ID', 
    'AUTH_GOOGLE_SECRET', 
    'AUTH_SECRET',
    'TINYPNG_PROXY_TOKEN'
  ];

  try {
    // 确保.env文件存在
    if (!existsSync(resolve('.env'))) {
      setupEnvFile();
    }

    // 读取.env文件内容
    const envContent = readFileSync(resolve('.env'), 'utf-8');
    
    // 解析环境变量为对象
    const secrets: Record<string, string> = {};
    
    envContent.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      
      // 跳过注释和空行
      if (!trimmedLine || trimmedLine.startsWith('#')) {
        return;
      }
      
      // 解析键值对
      const equalIndex = trimmedLine.indexOf('=');
      if (equalIndex === -1) {
        return;
      }
      
      const key = trimmedLine.substring(0, equalIndex).trim();
      let value = trimmedLine.substring(equalIndex + 1).trim();
      
      // 移除引号
      value = value.replace(/^["']|["']$/g, '');
      
      // 只保留运行时所需的环境变量，且值不为空
      if (runtimeEnvVars.includes(key) && value.length > 0) {
        secrets[key] = value;
      }
    });

    // GitHub Actions 等部署环境通过进程环境变量注入密钥，应优先于仓库中的 .env 模板。
    for (const key of runtimeEnvVars) {
      const value = process.env[key];
      if (value) {
        secrets[key] = value;
      }
    }

    // 检查是否有需要推送的secrets
    if (Object.keys(secrets).length === 0) {
      console.log("⚠️ No runtime secrets found to push");
      return;
    }

    // 创建JSON格式的临时文件
    const runtimeEnvFile = resolve('.env.runtime.json');
    writeFileSync(runtimeEnvFile, JSON.stringify(secrets, null, 2));

    console.log(`📝 Found ${Object.keys(secrets).length} secrets to push:`, Object.keys(secrets).join(', '));

    // 使用临时文件推送secrets
    execSync(`${WRANGLER_COMMAND} pages secret bulk "${runtimeEnvFile}"`, {
      stdio: "inherit" 
    });

    // 清理临时文件
    if (existsSync(runtimeEnvFile)) {
      execSync(`rm ${runtimeEnvFile}`, { stdio: "inherit" });
    }

    console.log("✅ Secrets pushed successfully");
  } catch (error) {
    console.error("❌ Failed to push secrets:", error);
    
    // 确保清理临时文件
    const runtimeEnvFile = resolve('.env.runtime.json');
    if (existsSync(runtimeEnvFile)) {
      try {
        execSync(`rm ${runtimeEnvFile}`, { stdio: "inherit" });
      } catch (cleanupError) {
        console.error("⚠️ Failed to cleanup temporary file:", cleanupError);
      }
    }
    
    throw error;
  }
};

/**
 * 部署Pages应用
 */
const deployPages = () => {
  console.log("🚧 Deploying to Cloudflare Pages...");
  try {
    execSync("pnpm run deploy:pages", { stdio: "inherit" });
    console.log("✅ Pages deployment completed successfully");
  } catch (error) {
    console.error("❌ Pages deployment failed:", error);
    throw error;
  }
};

/**
 * 部署Email Worker
 */
const deployEmailWorker = () => {
  console.log("🚧 Deploying Email Worker...");
  try {
    execSync(`${WRANGLER_COMMAND} deploy --config wrangler.email.json`, { stdio: "inherit" });
    console.log("✅ Email Worker deployed successfully");
  } catch (error) {
    console.error("❌ Email Worker deployment failed:", error);
    // 继续执行而不中断
  }
};

/**
 * 部署Cleanup Worker
 */
const deployCleanupWorker = () => {
  console.log("🚧 Deploying Cleanup Worker...");
  try {
    execSync(`${WRANGLER_COMMAND} deploy --config wrangler.cleanup.json`, { stdio: "inherit" });
    console.log("✅ Cleanup Worker deployed successfully");
  } catch (error) {
    console.error("❌ Cleanup Worker deployment failed:", error);
    // 继续执行而不中断
  }
};

/**
 * 部署TinyPNG Pool Worker
 */
const deployTinyPngWorker = () => {
  console.log("🚧 Deploying TinyPNG Pool Worker...");
  try {
    execSync(`${WRANGLER_COMMAND} deploy --config wrangler.tinypng.json`, { stdio: "inherit" });
    console.log("✅ TinyPNG Pool Worker deployed successfully");
  } catch (error) {
    console.error("❌ TinyPNG Pool Worker deployment failed:", error);
    throw error;
  }
};

/**
 * 部署区域 TinyPNG 注册 Worker
 */
const deployTinyPngRegistrarWorkers = () => {
  console.log("🚧 Deploying regional TinyPNG registrar Workers...");

  for (const { region, file } of TINYPNG_REGISTRAR_CONFIGS) {
    try {
      execSync(`${WRANGLER_COMMAND} deploy --config ${file}`, { stdio: "inherit" });
      console.log(`✅ TinyPNG registrar Worker deployed: ${region}`);
    } catch (error) {
      console.error(`❌ TinyPNG registrar Worker deployment failed: ${region}`, error);
      throw error;
    }
  }
};

/**
 * 将 TinyPNG 注册代理令牌写入三个区域注册 Worker，避免将凭据写进 Wrangler 配置或源码。
 */
const pushTinyPngRegistrarProxySecret = () => {
  const proxyToken = process.env.TINYPNG_PROXY_TOKEN;
  if (!proxyToken) {
    throw new Error('Missing required environment variable: TINYPNG_PROXY_TOKEN');
  }

  for (const { file } of TINYPNG_REGISTRAR_CONFIGS) {
    execSync(`${WRANGLER_COMMAND} secret put TINYPNG_PROXY_TOKEN --config ${file}`, {
      input: proxyToken,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
  }
};

/**
 * 创建或更新环境变量文件
 */
const setupEnvFile = () => {
  console.log("📄 Setting up environment file...");
  const envFilePath = resolve(".env");
  const envExamplePath = resolve(".env.example");

  // 如果.env文件不存在，则从.env.example复制创建
  if (!existsSync(envFilePath) && existsSync(envExamplePath)) {
    console.log("⚠️ .env file does not exist, creating from example...");

    // 从示例文件复制
    let envContent = readFileSync(envExamplePath, "utf-8");

    // 填充当前的环境变量
    const envVarMatches = envContent.match(/^([A-Z_]+)\s*=\s*".*?"/gm);
    if (envVarMatches) {
      for (const match of envVarMatches) {
        const varName = match.split("=")[0].trim();
        if (process.env[varName]) {
          const regex = new RegExp(`${varName}\\s*=\\s*".*?"`, "g");
          envContent = envContent.replace(regex, `${varName} = "${process.env[varName]}"`);
        }
      }
    }

    writeFileSync(envFilePath, envContent);
    console.log("✅ .env file created from example");
  } else if (existsSync(envFilePath)) {
    console.log("✨ .env file already exists");
  } else {
    console.error("❌ .env.example file not found!");
    throw new Error(".env.example file not found");
  }
};

/**
 * 更新环境变量
 */
const updateEnvVar = (name: string, value: string) => {
  // 首先更新进程环境变量
  process.env[name] = value;

  // 然后尝试更新.env文件
  const envFilePath = resolve(".env");
  if (!existsSync(envFilePath)) {
    setupEnvFile();
  }

  let envContent = readFileSync(envFilePath, "utf-8");
  const regex = new RegExp(`^${name}\\s*=\\s*".*?"`, "m");

  if (envContent.match(regex)) {
    envContent = envContent.replace(regex, `${name} = "${value}"`);
  } else {
    envContent += `\n${name} = "${value}"`;
  }

  writeFileSync(envFilePath, envContent);
  console.log(`✅ Updated ${name} in .env file`);
};

/**
 * 主函数
 */
const main = async () => {
  try {
    console.log("🚀 Starting deployment process...");

    validateEnvironment();
    setupEnvFile();
    setupWranglerConfigs();
    await checkAndCreateDatabase();
    migrateDatabase();
    await checkAndCreateKVNamespace();
    await checkAndCreatePages();
    pushPagesSecret();
    deployTinyPngRegistrarWorkers();
    pushTinyPngRegistrarProxySecret();
    deployPages();
    deployEmailWorker();
    deployCleanupWorker();
    deployTinyPngWorker();

    console.log("🎉 Deployment completed successfully");
  } catch (error) {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  }
};

main();
