import assert from 'node:assert/strict'
import test from 'node:test'

// 使用 Node 原生测试运行器，避免发布脚本测试依赖浏览器环境。
import {
  isReleaseBinaryAssetName,
  missingReleaseAssetNames,
  publishReleaseAssets,
  syncMissingReleaseAssets,
} from './sync-gitee-release-core.mjs'

test('仅选择 GitHub Release 中需要同步的二进制和签名文件', () => {
  assert.equal(isReleaseBinaryAssetName('app.dmg'), true)
  assert.equal(isReleaseBinaryAssetName('app.exe'), true)
  assert.equal(isReleaseBinaryAssetName('app.app.tar.gz'), true)
  assert.equal(isReleaseBinaryAssetName('app.app.tar.gz.sig'), true)
  assert.equal(isReleaseBinaryAssetName('latest.json'), false)
  assert.equal(isReleaseBinaryAssetName('Source code.zip'), false)
  assert.equal(isReleaseBinaryAssetName('Source code.tar.gz'), false)
})

test('逐文件同步会跳过已有资产并继续重试失败文件', async () => {
  const uploaded = new Set(['windows.exe'])
  const attempts = []

  await syncMissingReleaseAssets({
    files: ['/tmp/windows.exe', '/tmp/macos.dmg', '/tmp/macos.app.tar.gz'],
    listAssets: async () => [...uploaded].map((name) => ({ name })),
    uploadAsset: async (_file, name, attempt) => {
      attempts.push(`${name}:${attempt}`)
      if (name === 'macos.dmg' && attempt === 1) throw new Error('temporary timeout')
      uploaded.add(name)
    },
    maxAttempts: 2,
  })

  assert.deepEqual(attempts, [
    'macos.dmg:1',
    'macos.app.tar.gz:1',
    'macos.dmg:2',
  ])
  assert.deepEqual(missingReleaseAssetNames(
    ['/tmp/windows.exe', '/tmp/macos.dmg', '/tmp/macos.app.tar.gz'],
    [...uploaded].map((name) => ({ name })),
  ), [])
})

test('资产不完整时同步失败而不是降级为成功', async () => {
  await assert.rejects(
    syncMissingReleaseAssets({
      files: ['/tmp/macos.dmg'],
      listAssets: async () => [],
      uploadAsset: async () => {
        throw new Error('upload failed')
      },
      maxAttempts: 2,
    }),
    /Gitee Release 缺少资产：macos\.dmg/,
  )
})

test('latest.json 只写入仓库且在所有安装资产同步完成后发布', async () => {
  const calls = []
  await publishReleaseAssets({
    assetFiles: ['/tmp/app.dmg', '/tmp/app.exe'],
    syncReleaseAssets: async (files) => {
      calls.push(`sync:${files.map((file) => file.split('/').pop()).join(',')}`)
    },
    publishLatest: async () => {
      calls.push('publish:latest')
    },
  })

  assert.deepEqual(calls, [
    'sync:app.dmg,app.exe',
    'publish:latest',
  ])
})

test('安装资产同步失败时不会发布 latest.json', async () => {
  let latestPublished = false
  await assert.rejects(
    publishReleaseAssets({
      assetFiles: ['/tmp/app.dmg'],
      syncReleaseAssets: async () => {
        throw new Error('incomplete release')
      },
      publishLatest: async () => {
        latestPublished = true
      },
    }),
    /incomplete release/,
  )
  assert.equal(latestPublished, false)
})
