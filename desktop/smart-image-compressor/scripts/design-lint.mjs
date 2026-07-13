import { readFile } from 'node:fs/promises'
import { parse } from 'yaml'

const source = await readFile(new URL('../DESIGN.md', import.meta.url), 'utf8')
const match = source.match(/^---\n([\s\S]*?)\n---\n/)
if (!match) throw new Error('DESIGN.md 缺少 YAML front matter')

const document = parse(match[1])
const requiredColors = ['ink', 'canvas', 'panel', 'line', 'calibration-blue', 'success', 'danger']
for (const key of requiredColors) {
  const value = document?.tokens?.color?.[key]
  if (!/^#[0-9A-F]{6}$/.test(value ?? '')) throw new Error(`无效或缺失的颜色 token: ${key}`)
}
for (const section of ['# 设计方向', '# 布局', '# 排版', '# 颜色与质感', '# 交互与动效', '# 可访问性']) {
  if (!source.includes(section)) throw new Error(`DESIGN.md 缺少章节: ${section}`)
}
console.log('DESIGN.md 校验通过')
