import path from 'node:path'

export function isReleaseBinaryAssetName(name) {
  return /\.(dmg|exe|app\.tar\.gz|sig)$/i.test(name)
}

export function missingReleaseAssetNames(files, assets) {
  const uploaded = new Set(assets.map((asset) => asset.name))
  return files
    .map((file) => path.basename(file))
    .filter((name) => !uploaded.has(name))
}

export async function syncMissingReleaseAssets({
  files,
  listAssets,
  uploadAsset,
  maxAttempts = 3,
  retryDelay = async () => {},
}) {
  const filesByName = new Map(files.map((file) => [path.basename(file), file]))
  if (filesByName.size !== files.length) {
    throw new Error('Gitee Release 资产文件名不能重复')
  }

  const failures = new Map()
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const missing = missingReleaseAssetNames(files, await listAssets())
    if (missing.length === 0) return

    for (const name of missing) {
      try {
        await uploadAsset(filesByName.get(name), name, attempt, maxAttempts)
        failures.delete(name)
      } catch (error) {
        failures.set(name, error)
      }
    }

    const remaining = missingReleaseAssetNames(files, await listAssets())
    if (remaining.length === 0) return
    if (attempt < maxAttempts) await retryDelay(attempt, remaining)
  }

  const remaining = missingReleaseAssetNames(files, await listAssets())
  const details = remaining
    .map((name) => {
      const message = failures.get(name)?.message?.split('\n')[0]
      return message ? `${name}（${message}）` : name
    })
    .join('、')
  throw new Error(`Gitee Release 缺少资产：${details}`)
}

export async function publishReleaseAssets({
  assetFiles,
  manifestFile,
  syncReleaseAssets,
  publishLatest,
}) {
  if (assetFiles.length === 0) throw new Error('未找到待同步的 Release 资产')

  await syncReleaseAssets(assetFiles)
  await syncReleaseAssets([manifestFile])
  await publishLatest()
}
