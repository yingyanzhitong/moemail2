#!/usr/bin/env tsx
/**
 * 部署脚本
 * 
 * 功能：
 * 1. 根据最近的 commit 类型自动升级版本号
 *    - fix: -> 升级 patch 版本 (1.0.0 -> 1.0.1)
 *    - feat: -> 升级 minor 版本 (1.0.0 -> 1.1.0)
 *    - BREAKING CHANGE 或 !: -> 升级 major 版本 (1.0.0 -> 2.0.0)
 * 2. 更新 CHANGELOG.md
 * 3. 创建 git tag
 * 4. 推送到 origin
 * 5. 执行部署
 */

import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const ROOT_DIR = resolve(import.meta.dirname, '..')
const PACKAGE_JSON_PATH = resolve(ROOT_DIR, 'package.json')
const CHANGELOG_PATH = resolve(ROOT_DIR, 'CHANGELOG.md')

interface PackageJson {
  name: string
  version: string
  [key: string]: unknown
}

interface CommitInfo {
  hash: string
  type: string
  scope?: string
  subject: string
  isBreaking: boolean
}

/**
 * 执行命令并返回输出
 */
function exec(command: string, options?: { silent?: boolean }): string {
  try {
    const result = execSync(command, { 
      cwd: ROOT_DIR, 
      encoding: 'utf-8',
      stdio: options?.silent ? 'pipe' : 'inherit'
    })
    return typeof result === 'string' ? result.trim() : ''
  } catch (error) {
    if (options?.silent) {
      return ''
    }
    throw error
  }
}

/**
 * 获取最新 tag 之后的所有 commits
 */
function getCommitsSinceLastTag(): CommitInfo[] {
  const lastTag = exec('git describe --tags --abbrev=0 2>/dev/null || echo ""', { silent: true })
  
  let logCommand = 'git log --oneline --format="%H|%s"'
  if (lastTag) {
    logCommand += ` ${lastTag}..HEAD`
  }
  
  const output = exec(logCommand, { silent: true })
  if (!output) return []
  
  const commits: CommitInfo[] = []
  const lines = output.split('\n').filter(Boolean)
  
  for (const line of lines) {
    const [hash, ...subjectParts] = line.split('|')
    const subject = subjectParts.join('|')
    
    // 解析 conventional commit 格式: type(scope): subject
    const match = subject.match(/^(\w+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/)
    
    if (match) {
      commits.push({
        hash: hash.substring(0, 7),
        type: match[1],
        scope: match[2],
        subject: match[4],
        isBreaking: !!match[3] || subject.includes('BREAKING CHANGE')
      })
    } else {
      // 非标准格式的 commit
      commits.push({
        hash: hash.substring(0, 7),
        type: 'other',
        subject: subject,
        isBreaking: false
      })
    }
  }
  
  return commits
}

/**
 * 根据 commits 决定版本升级类型
 */
function determineVersionBump(commits: CommitInfo[]): 'major' | 'minor' | 'patch' {
  let hasBreaking = false
  let hasFeature = false
  let hasFix = false
  
  for (const commit of commits) {
    if (commit.isBreaking) {
      hasBreaking = true
    }
    if (commit.type === 'feat') {
      hasFeature = true
    }
    if (commit.type === 'fix') {
      hasFix = true
    }
  }
  
  if (hasBreaking) return 'major'
  if (hasFeature) return 'minor'
  if (hasFix) return 'patch'
  
  // 默认升级 patch
  return 'patch'
}

/**
 * 升级版本号
 */
function bumpVersion(currentVersion: string, bumpType: 'major' | 'minor' | 'patch'): string {
  const parts = currentVersion.split('.').map(Number)
  
  switch (bumpType) {
    case 'major':
      return `${parts[0] + 1}.0.0`
    case 'minor':
      return `${parts[0]}.${parts[1] + 1}.0`
    case 'patch':
      return `${parts[0]}.${parts[1]}.${parts[2] + 1}`
  }
}

/**
 * 生成 changelog 内容
 */
function generateChangelog(version: string, commits: CommitInfo[]): string {
  const date = new Date().toISOString().split('T')[0]
  
  const sections: Record<string, CommitInfo[]> = {
    'Breaking Changes': [],
    'Features': [],
    'Bug Fixes': [],
    'Other': []
  }
  
  for (const commit of commits) {
    if (commit.isBreaking) {
      sections['Breaking Changes'].push(commit)
    } else if (commit.type === 'feat') {
      sections['Features'].push(commit)
    } else if (commit.type === 'fix') {
      sections['Bug Fixes'].push(commit)
    } else {
      sections['Other'].push(commit)
    }
  }
  
  let content = `## [${version}] - ${date}\n\n`
  
  for (const [title, sectionCommits] of Object.entries(sections)) {
    if (sectionCommits.length > 0) {
      content += `### ${title}\n\n`
      for (const commit of sectionCommits) {
        const scope = commit.scope ? `**${commit.scope}:** ` : ''
        content += `- ${scope}${commit.subject} (${commit.hash})\n`
      }
      content += '\n'
    }
  }
  
  return content
}

/**
 * 更新 CHANGELOG.md
 */
function updateChangelog(newContent: string): void {
  let existingContent = ''
  
  if (existsSync(CHANGELOG_PATH)) {
    existingContent = readFileSync(CHANGELOG_PATH, 'utf-8')
  } else {
    existingContent = '# Changelog\n\nAll notable changes to this project will be documented in this file.\n\n'
  }
  
  // 在标题后插入新内容
  const headerEnd = existingContent.indexOf('\n\n## ')
  if (headerEnd !== -1) {
    // 已有版本记录，在第一个版本前插入
    const header = existingContent.substring(0, headerEnd + 2)
    const rest = existingContent.substring(headerEnd + 2)
    existingContent = header + newContent + rest
  } else {
    // 没有版本记录，直接追加
    existingContent += newContent
  }
  
  writeFileSync(CHANGELOG_PATH, existingContent)
}

/**
 * 主函数
 */
async function main() {
  console.log('🚀 开始部署流程...\n')
  
  // 1. 检查是否有未提交的更改
  const status = exec('git status --porcelain', { silent: true })
  if (status) {
    console.error('❌ 存在未提交的更改，请先提交或 stash')
    console.log(status)
    process.exit(1)
  }
  
  // 2. 获取最近的 commits
  const commits = getCommitsSinceLastTag()
  if (commits.length === 0) {
    console.log('📝 没有新的 commits，跳过版本升级')
    console.log('🔧 执行部署...')
    exec('pnpm dlx tsx ./scripts/deploy/index.ts')
    return
  }
  
  console.log(`📝 发现 ${commits.length} 个新 commits:`)
  for (const commit of commits.slice(0, 5)) {
    console.log(`   - ${commit.type}: ${commit.subject}`)
  }
  if (commits.length > 5) {
    console.log(`   ... 还有 ${commits.length - 5} 个`)
  }
  console.log()
  
  // 3. 读取 package.json
  const packageJson: PackageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8'))
  const currentVersion = packageJson.version
  
  // 4. 决定版本升级类型
  const bumpType = determineVersionBump(commits)
  const newVersion = bumpVersion(currentVersion, bumpType)
  
  console.log(`📦 版本升级: ${currentVersion} -> ${newVersion} (${bumpType})`)
  
  // 5. 更新 package.json
  packageJson.version = newVersion
  writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(packageJson, null, 2) + '\n')
  console.log('✅ 已更新 package.json')
  
  // 6. 生成并更新 CHANGELOG
  const changelogContent = generateChangelog(newVersion, commits)
  updateChangelog(changelogContent)
  console.log('✅ 已更新 CHANGELOG.md')
  
  // 7. 提交更改
  exec('git add package.json CHANGELOG.md')
  exec(`git commit -m "chore(release): v${newVersion}"`)
  console.log('✅ 已提交版本更新')
  
  // 8. 创建 tag
  const tagName = `v${newVersion}`
  exec(`git tag -a ${tagName} -m "Release ${tagName}"`)
  console.log(`✅ 已创建 tag: ${tagName}`)
  
  // 9. 推送到 origin
  console.log('📤 推送到 origin...')
  exec('git push origin master')
  exec('git push origin --tags')
  console.log('✅ 已推送到 origin')
  
  // 10. 执行部署
  console.log('\n🔧 执行部署...')
  exec('pnpm dlx tsx ./scripts/deploy/index.ts')
  
  console.log(`\n🎉 部署完成! 版本: ${tagName}`)
}

main().catch((error) => {
  console.error('❌ 部署失败:', error)
  process.exit(1)
})
