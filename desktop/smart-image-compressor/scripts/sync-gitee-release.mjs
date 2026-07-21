#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const apiBase = 'https://gitee.com/api/v5'
const config = {
  token: requiredEnv('GITEE_ACCESS_TOKEN'),
  owner: requiredEnv('GITEE_OWNER'),
  repo: requiredEnv('GITEE_REPO'),
  branch: process.env.GITEE_BRANCH || 'master',
  gitUsername: process.env.GITEE_GIT_USERNAME || process.env.GITEE_OWNER || 'masongzhi1',
  tag: requiredEnv('RELEASE_TAG'),
  releaseName: process.env.RELEASE_NAME || requiredEnv('RELEASE_TAG'),
  releaseBody: process.env.RELEASE_BODY || 'GitHub Actions 自动同步的桌面端安装包。',
  assetDir: process.env.RELEASE_ASSET_DIR || 'release-assets',
  latestJsonPath: process.env.LATEST_JSON_PATH || 'normalized-release-assets/latest.json',
}

const repository = await ensureRepository()
await ensureBranch(repository.default_branch || config.branch)
const releaseId = await ensureRelease()
await syncAssets(releaseId)
await upsertLatestJson()
console.log(`Gitee Release 已同步：${config.owner}/${config.repo} ${config.tag}`)

async function ensureRepository() {
  const existing = await getRepository()
  if (existing) return existing

  console.log(`正在创建 Gitee 镜像仓库 ${config.owner}/${config.repo}…`)
  const body = new URLSearchParams({
    name: config.repo,
    description: 'TinyPNG 压缩助手桌面端安装包镜像，由 GitHub Actions 自动维护。',
    private: 'false',
    has_issues: 'false',
    has_projects: 'false',
    has_wiki: 'false',
  })
  return giteeJson('/user/repos', { method: 'POST', body })
}

async function getRepository() {
  const response = await giteeFetch(`/repos/${config.owner}/${config.repo}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`无法查询 Gitee 镜像仓库：${await safeText(response)}`)
  return response.json()
}

async function ensureBranch(defaultBranch) {
  const response = await giteeFetch(`/repos/${config.owner}/${config.repo}/branches/${encodeURIComponent(config.branch)}`)
  if (response.ok) return
  if (response.status !== 404) throw new Error(`无法查询 Gitee 分支：${await safeText(response)}`)

  if (defaultBranch !== config.branch) {
    const defaultResponse = await giteeFetch(`/repos/${config.owner}/${config.repo}/branches/${encodeURIComponent(defaultBranch)}`)
    if (defaultResponse.ok) {
      throw new Error(`Gitee 仓库默认分支为 ${defaultBranch}，请将 GITEE_BRANCH 配置为该分支`)
    }
  }

  const workdir = await mkdtemp(path.join(tmpdir(), 'tinypng-gitee-release-'))
  try {
    await runGit(['init', '--initial-branch', config.branch], workdir)
    await mkdir(path.join(workdir, 'release'), { recursive: true })
    await writeFile(path.join(workdir, 'README.md'), '# TinyPNG 压缩助手发布镜像\n\n此仓库由 GitHub Actions 自动同步桌面端预发布安装包。\n')
    await writeFile(path.join(workdir, 'release', 'latest.json'), await readFile(config.latestJsonPath, 'utf8'))
    await runGit(['add', 'README.md', 'release/latest.json'], workdir)
    await runGit(['-c', 'user.name=tinypng-release-bot', '-c', 'user.email=actions@github.com', 'commit', '-m', 'chore: initialize release mirror'], workdir)
    await runGit(['remote', 'add', 'origin', authenticatedRemoteUrl(config.gitUsername)], workdir)
    try {
      await runGit(['push', 'origin', `HEAD:${config.branch}`], workdir)
    } catch {
      await runGit(['remote', 'set-url', 'origin', authenticatedRemoteUrl('oauth2')], workdir)
      await runGit(['push', 'origin', `HEAD:${config.branch}`], workdir)
    }
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
}

async function ensureRelease() {
  const existing = await getReleaseByTag()
  if (existing) return existing.id
  const body = new URLSearchParams({
    tag_name: config.tag,
    name: config.releaseName,
    body: config.releaseBody,
    target_commitish: config.branch,
  })
  const release = await giteeJson(`/repos/${config.owner}/${config.repo}/releases`, { method: 'POST', body })
  if (!release.id) throw new Error('Gitee Release 响应缺少 ID')
  return release.id
}

async function getReleaseByTag() {
  const response = await giteeFetch(`/repos/${config.owner}/${config.repo}/releases/tags/${encodeURIComponent(config.tag)}`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`无法查询 Gitee Release：${await safeText(response)}`)
  return response.json()
}

async function syncAssets(releaseId) {
  const files = await findReleaseFiles(config.assetDir)
  if (files.length === 0) throw new Error('未找到待同步的 Release 资产')
  const existing = await listAssets(releaseId)
  for (const file of files) {
    const name = path.basename(file)
    const prior = existing.find((asset) => asset.name === name)
    if (prior) await deleteAsset(releaseId, prior.id)
    await uploadAsset(releaseId, file, name)
  }
  const uploaded = new Set((await listAssets(releaseId)).map((asset) => asset.name))
  const missing = files.map((file) => path.basename(file)).filter((name) => !uploaded.has(name))
  if (missing.length > 0) throw new Error(`Gitee Release 缺少资产：${missing.join(', ')}`)
}

async function findReleaseFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await findReleaseFiles(entryPath))
    } else if (entry.isFile() && entry.name !== 'latest.json' && /\.(dmg|exe|app\.tar\.gz|sig)$/i.test(entry.name)) {
      files.push(entryPath)
    }
  }
  return files.sort()
}

async function listAssets(releaseId) {
  const assets = await giteeJson(`/repos/${config.owner}/${config.repo}/releases/${releaseId}/attach_files?per_page=100`)
  return Array.isArray(assets) ? assets : []
}

async function deleteAsset(releaseId, assetId) {
  const response = await giteeFetch(`/repos/${config.owner}/${config.repo}/releases/${releaseId}/attach_files/${assetId}`, { method: 'DELETE' })
  if (response.status !== 204) throw new Error(`无法删除同名 Gitee Release 资产：${await safeText(response)}`)
}

async function uploadAsset(releaseId, file, name) {
  const url = apiUrl(`/repos/${config.owner}/${config.repo}/releases/${releaseId}/attach_files`).toString()
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    console.log(`上传 ${name}（${attempt}/3）…`)
    try {
      await execFileAsync('curl', [
        '--fail-with-body', '--silent', '--show-error', '--http1.1', '--connect-timeout', '30', '--max-time', '180',
        '--request', 'POST', '--header', 'Expect:', '--form', `file=@${file};filename=${name};type=application/octet-stream`, url,
      ], { maxBuffer: 10 * 1024 * 1024 })
      return
    } catch (error) {
      if (attempt === 3) throw sanitizeError(error)
      await sleep(attempt * 5_000)
    }
  }
}

async function upsertLatestJson() {
  let workdir = await mkdtemp(path.join(tmpdir(), 'tinypng-gitee-release-'))
  try {
    try {
      await cloneRepository(workdir, config.gitUsername)
    } catch {
      await rm(workdir, { recursive: true, force: true })
      workdir = await mkdtemp(path.join(tmpdir(), 'tinypng-gitee-release-'))
      await cloneRepository(workdir, 'oauth2')
    }
    await mkdir(path.join(workdir, 'release'), { recursive: true })
    await writeFile(path.join(workdir, 'release', 'latest.json'), await readFile(config.latestJsonPath, 'utf8'))
    const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--', 'release/latest.json'], { cwd: workdir })
    if (!stdout.trim()) return
    await runGit(['add', 'release/latest.json'], workdir)
    await runGit(['-c', 'user.name=tinypng-release-bot', '-c', 'user.email=actions@github.com', 'commit', '-m', `chore: update updater manifest for ${config.tag}`], workdir)
    await runGit(['push', 'origin', `HEAD:${config.branch}`], workdir)
  } finally {
    await rm(workdir, { recursive: true, force: true })
  }
}

async function cloneRepository(workdir, username) {
  await runGit(['clone', '--depth', '1', '--branch', config.branch, authenticatedRemoteUrl(username), workdir], process.cwd())
}

async function giteeJson(pathname, init = {}) {
  const response = await giteeFetch(pathname, init)
  if (!response.ok) throw new Error(`Gitee API 请求失败：${await safeText(response)}`)
  return response.status === 204 ? null : response.json()
}

async function giteeFetch(pathname, init = {}) {
  const headers = new Headers(init.headers)
  const args = [
    '--silent', '--show-error', '--location', '--retry', '4', '--retry-all-errors', '--retry-delay', '5',
    '--retry-max-time', '180', '--connect-timeout', '30', '--max-time', '90', '--request', init.method || 'GET',
  ]

  if (init.body instanceof URLSearchParams) {
    headers.set('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8')
    args.push('--data', init.body.toString())
  }
  for (const [name, value] of headers) args.push('--header', `${name}: ${value}`)
  args.push('--write-out', '\n__GITEE_STATUS__%{http_code}', apiUrl(pathname).toString())

  try {
    const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 })
    return curlResponse(stdout)
  } catch (error) {
    throw sanitizeError(error)
  }
}

function curlResponse(output) {
  const marker = '\n__GITEE_STATUS__'
  const markerIndex = output.lastIndexOf(marker)
  if (markerIndex === -1) throw new Error('Gitee API 响应缺少 HTTP 状态码')

  const body = output.slice(0, markerIndex)
  const status = Number(output.slice(markerIndex + marker.length))
  if (!Number.isInteger(status)) throw new Error('Gitee API 返回了无效的 HTTP 状态码')

  return {
    status,
    ok: status >= 200 && status < 300,
    async json() {
      if (!body.trim()) return null
      return JSON.parse(body)
    },
    async text() {
      return body
    },
  }
}

function apiUrl(pathname) {
  const url = new URL(`${apiBase}${pathname}`)
  url.searchParams.set('access_token', config.token)
  return url
}

function authenticatedRemoteUrl(username) {
  return `https://${encodeURIComponent(username)}:${encodeURIComponent(config.token)}@gitee.com/${config.owner}/${config.repo}.git`
}

async function runGit(args, cwd) {
  try {
    await execFileAsync('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 })
  } catch (error) {
    throw sanitizeError(error)
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function sanitizeError(error) {
  const message = [error?.message, error?.stdout, error?.stderr]
    .filter(Boolean)
    .join('\n')
    .replaceAll(config.token, '***')
  return new Error(message || '外部命令执行失败')
}

async function safeText(response) {
  return (await response.text()).slice(0, 600).replaceAll(config.token, '***')
}

function requiredEnv(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
