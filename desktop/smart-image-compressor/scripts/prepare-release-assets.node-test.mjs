import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const script = new URL('./prepare-release-assets.mjs', import.meta.url)

test('生成固定 latest 安装包名称，同时保持版本化更新清单', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'tinypng-release-assets-'))
  const input = path.join(root, 'input')
  const output = path.join(root, 'output')
  const latestOutput = path.join(root, 'latest')
  try {
    await mkdir(input, { recursive: true })
    await writeFixture(input, 'tinypng_aarch64-apple-darwin.dmg', 'apple-dmg')
    await writeFixture(input, 'tinypng_aarch64-apple-darwin.app.tar.gz', 'apple-updater')
    await writeFixture(input, 'tinypng_aarch64-apple-darwin.app.tar.gz.sig', 'apple-signature')
    await writeFixture(input, 'tinypng_x86_64-apple-darwin.dmg', 'intel-dmg')
    await writeFixture(input, 'tinypng_x86_64-apple-darwin.app.tar.gz', 'intel-updater')
    await writeFixture(input, 'tinypng_x86_64-apple-darwin.app.tar.gz.sig', 'intel-signature')
    await writeFixture(input, 'tinypng_x86_64-pc-windows-msvc-setup.exe', 'windows-installer')
    await writeFixture(input, 'tinypng_x86_64-pc-windows-msvc-setup.exe.sig', 'windows-signature')

    await execFileAsync('node', [script.pathname,
      '--input', input,
      '--output', output,
      '--latest-output', latestOutput,
      '--owner', 'masongzhi1',
      '--repo', 'tinypng-image-compressor-releases',
      '--app-name', 'tinypng-image-compressor',
      '--tag', 'desktop-v9.9.9',
      '--version', '9.9.9',
    ])

    assert.deepEqual((await readdir(latestOutput)).sort(), [
      'tinypng-image-compressor_latest_Windows_x64-setup.exe',
      'tinypng-image-compressor_latest_macOS_Apple-Silicon.dmg',
      'tinypng-image-compressor_latest_macOS_Intel.dmg',
    ])
    assert.equal(
      await readFile(path.join(latestOutput, 'tinypng-image-compressor_latest_macOS_Apple-Silicon.dmg'), 'utf8'),
      'apple-dmg',
    )
    const manifest = JSON.parse(await readFile(path.join(output, 'latest.json'), 'utf8'))
    assert.equal(
      manifest.installers['windows-x86_64'].url,
      'https://gitee.com/masongzhi1/tinypng-image-compressor-releases/releases/download/desktop-v9.9.9/tinypng-image-compressor_9.9.9_Windows_x64-setup.exe',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function writeFixture(directory, name, contents) {
  await writeFile(path.join(directory, name), contents, { encoding: 'utf8', flag: 'w' })
}
