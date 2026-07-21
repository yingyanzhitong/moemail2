#!/usr/bin/env node

import { cp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const options = parseArgs(process.argv.slice(2))
const files = await walk(options.input)
const platforms = {}
const installers = {}

await mkdir(options.output, { recursive: true })

for (const { platform, label } of [
  { platform: 'darwin-aarch64', label: 'aarch64' },
  { platform: 'darwin-x86_64', label: 'x64' },
]) {
  const dmg = findOne(files, (file) => file.endsWith('.dmg') && includesArchitecture(file, platform), `macOS ${label} DMG`)
  const updater = findOne(files, (file) => file.endsWith('.app.tar.gz') && includesArchitecture(file, platform), `macOS ${label} 更新包`)
  const signature = findOne(files, (file) => file === `${updater}.sig`, `macOS ${label} 更新签名`)
  const dmgName = `${options.appName}_${options.version}_macOS_${label}.dmg`
  const updaterName = `${options.appName}_${options.version}_macOS_${label}-updater.app.tar.gz`

  await copyAsset(dmg, dmgName)
  await copyAsset(updater, updaterName)
  await copyAsset(signature, `${updaterName}.sig`)
  platforms[platform] = {
    signature: (await readFile(signature, 'utf8')).trim(),
    url: releaseUrl(updaterName),
  }
  installers[platform] = { kind: 'dmg', url: releaseUrl(dmgName) }
}

const windowsInstaller = findOne(files, (file) => file.endsWith('.exe'), 'Windows x64 EXE')
const windowsSignature = findOne(files, (file) => file === `${windowsInstaller}.sig`, 'Windows x64 更新签名')
const windowsName = `${options.appName}_${options.version}_Windows_x64-setup.exe`
await copyAsset(windowsInstaller, windowsName)
await copyAsset(windowsSignature, `${windowsName}.sig`)
platforms['windows-x86_64'] = {
  signature: (await readFile(windowsSignature, 'utf8')).trim(),
  url: releaseUrl(windowsName),
}
installers['windows-x86_64'] = { kind: 'nsis', url: releaseUrl(windowsName) }

const manifest = {
  version: options.version,
  notes: options.notes,
  pub_date: new Date().toISOString(),
  installers,
  platforms,
}
await writeFile(path.join(options.output, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`已准备 ${Object.keys(installers).length} 个安装包和 ${Object.keys(platforms).length} 个更新入口。`)

async function copyAsset(source, name) {
  await cp(source, path.join(options.output, name))
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walk(entryPath))
    else if (entry.isFile() && (await stat(entryPath)).isFile()) files.push(entryPath)
  }
  return files.sort()
}

function findOne(files, predicate, label) {
  const matches = files.filter(predicate)
  if (matches.length !== 1) throw new Error(`预期找到一个${label}，实际找到 ${matches.length} 个。`)
  return matches[0]
}

function includesArchitecture(file, platform) {
  const value = file.toLowerCase()
  return platform === 'darwin-aarch64'
    ? value.includes('aarch64') || value.includes('arm64')
    : value.includes('x86_64') || value.includes('x64')
}

function releaseUrl(fileName) {
  return `https://gitee.com/${options.owner}/${options.repo}/releases/download/${options.tag}/${encodeURIComponent(fileName)}`
}

function parseArgs(args) {
  const parsed = {
    input: 'release-assets',
    output: 'normalized-release-assets',
    owner: 'masongzhi1',
    repo: 'tinypng-image-compressor-releases',
    appName: 'tinypng-image-compressor',
    tag: '',
    version: '',
    notes: 'TinyPNG 压缩助手更新。',
  }
  for (let index = 0; index < args.length; index += 1) {
    const key = args[index]
    const value = args[index + 1]
    if (!key.startsWith('--') || value === undefined) throw new Error(`无效参数：${key}`)
    index += 1
    switch (key) {
      case '--input': parsed.input = value; break
      case '--output': parsed.output = value; break
      case '--owner': parsed.owner = value; break
      case '--repo': parsed.repo = value; break
      case '--app-name': parsed.appName = value; break
      case '--tag': parsed.tag = value; break
      case '--version': parsed.version = value; break
      case '--notes': parsed.notes = value; break
      default: throw new Error(`未知参数：${key}`)
    }
  }
  if (!parsed.tag || !parsed.version) throw new Error('必须提供 --tag 和 --version')
  return parsed
}
