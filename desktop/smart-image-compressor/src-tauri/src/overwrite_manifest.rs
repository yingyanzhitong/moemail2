use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Arc,
};

use anyhow::{Context, Result};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs,
    io::{AsyncReadExt, BufReader},
    sync::Mutex,
};
use uuid::Uuid;

/// 每个成功压缩文件所在的文件夹都会保存本地记录；点号前缀使其在 macOS 中默认隐藏。
pub const MANIFEST_FILE_NAME: &str = ".smartcompress.json";

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverwriteManifest {
    #[serde(default = "manifest_version")]
    version: u8,
    #[serde(default)]
    entries: BTreeMap<String, CompressionRecord>,
}

fn manifest_version() -> u8 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CompressionRecord {
    file_name: String,
    compressed_at: String,
    original_size: u64,
    compressed_size: u64,
}

#[derive(Clone, Default)]
pub struct OverwriteManifestStore {
    manifests: Arc<Mutex<BTreeMap<PathBuf, OverwriteManifest>>>,
}

fn parent_folder(source: &Path) -> Result<PathBuf> {
    source
        .parent()
        .map(Path::to_path_buf)
        .context("图片缺少所在文件夹")
}

async fn read_manifest(folder: &Path) -> Result<OverwriteManifest> {
    let path = folder.join(MANIFEST_FILE_NAME);
    match fs::read_to_string(&path).await {
        Ok(contents) => serde_json::from_str(&contents)
            .with_context(|| format!("无法读取隐藏压缩记录 {}", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(OverwriteManifest {
            version: manifest_version(),
            entries: BTreeMap::new(),
        }),
        Err(error) => {
            Err(error).with_context(|| format!("无法读取隐藏压缩记录 {}", path.display()))
        }
    }
}

async fn write_manifest(folder: &Path, manifest: &OverwriteManifest) -> Result<()> {
    let destination = folder.join(MANIFEST_FILE_NAME);
    let temporary = folder.join(format!(".{MANIFEST_FILE_NAME}.{}.tmp", Uuid::new_v4()));
    let contents = serde_json::to_vec_pretty(manifest).context("无法序列化隐藏压缩记录")?;
    fs::write(&temporary, contents)
        .await
        .with_context(|| format!("无法写入隐藏压缩记录 {}", temporary.display()))?;
    if let Err(error) = fs::rename(&temporary, &destination).await {
        let _ = fs::remove_file(&temporary).await;
        return Err(error)
            .with_context(|| format!("无法提交隐藏压缩记录 {}", destination.display()));
    }
    Ok(())
}

async fn file_hash(path: &Path) -> Result<String> {
    let file = fs::File::open(path)
        .await
        .with_context(|| format!("无法读取 {} 的文件指纹", path.display()))?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut buffer = [0_u8; 64 * 1024];
    let mut hasher = Sha256::new();
    loop {
        let read = reader.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

impl OverwriteManifestStore {
    async fn cached_manifest(&self, folder: &Path) -> Result<OverwriteManifest> {
        let mut manifests = self.manifests.lock().await;
        if let Some(manifest) = manifests.get(folder) {
            return Ok(manifest.clone());
        }
        let manifest = read_manifest(folder).await?;
        manifests.insert(folder.to_path_buf(), manifest.clone());
        Ok(manifest)
    }

    /// 仅当文件夹已有成功记录时才读取图片计算 SHA-256，首次导入不会额外遍历图片。
    pub async fn was_compressed(&self, source: &Path) -> Result<bool> {
        let folder = parent_folder(source)?;
        let manifest = self.cached_manifest(&folder).await?;
        if manifest.entries.is_empty() {
            return Ok(false);
        }
        let hash = file_hash(source).await?;
        Ok(manifest.entries.contains_key(&hash))
    }

    /// 文件成功写入后记录最终压缩结果的 SHA-256；下次导入同一文件夹时可避免重复压缩。
    pub async fn record_completed(
        &self,
        source: &Path,
        original_size: u64,
        compressed_size: u64,
    ) -> Result<()> {
        let folder = parent_folder(source)?;
        let hash = file_hash(source).await?;
        let record = CompressionRecord {
            file_name: source
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("未命名图片")
                .to_string(),
            compressed_at: Utc::now().to_rfc3339(),
            original_size,
            compressed_size,
        };

        let mut manifests = self.manifests.lock().await;
        let manifest = match manifests.get_mut(&folder) {
            Some(manifest) => manifest,
            None => {
                let loaded = read_manifest(&folder).await?;
                manifests.insert(folder.clone(), loaded);
                manifests
                    .get_mut(&folder)
                    .expect("刚插入的隐藏压缩记录必须存在")
            }
        };
        manifest.version = manifest_version();
        manifest.entries.insert(hash, record);
        write_manifest(&folder, manifest).await
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;

    #[tokio::test]
    async fn records_result_hash_and_skips_the_same_compressed_file() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("photo.png");
        fs::write(&image, b"original-image").await.unwrap();
        let store = OverwriteManifestStore::default();

        assert!(!store.was_compressed(&image).await.unwrap());
        fs::write(&image, b"compressed-image").await.unwrap();
        store.record_completed(&image, 14, 9).await.unwrap();

        assert!(directory.path().join(MANIFEST_FILE_NAME).is_file());
        assert!(OverwriteManifestStore::default()
            .was_compressed(&image)
            .await
            .unwrap());

        fs::write(&image, b"another-compressed-image")
            .await
            .unwrap();
        store.record_completed(&image, 18, 12).await.unwrap();
        let manifest = fs::read_to_string(directory.path().join(MANIFEST_FILE_NAME))
            .await
            .unwrap();
        assert!(
            serde_json::from_str::<OverwriteManifest>(&manifest)
                .unwrap()
                .entries
                .len()
                >= 2
        );
    }

    #[tokio::test]
    async fn skips_a_file_reimported_from_a_new_output_folder() {
        let directory = tempdir().unwrap();
        let original_folder = directory.path().join("原图");
        let output_folder = directory.path().join("原图-压缩结果");
        fs::create_dir_all(&original_folder).await.unwrap();
        fs::create_dir_all(&output_folder).await.unwrap();
        let original = original_folder.join("photo.png");
        let compressed = output_folder.join("photo.png");
        fs::write(&original, b"original-image").await.unwrap();
        fs::write(&compressed, b"compressed-image").await.unwrap();

        let store = OverwriteManifestStore::default();
        assert!(!store.was_compressed(&original).await.unwrap());
        store.record_completed(&compressed, 14, 9).await.unwrap();

        assert!(output_folder.join(MANIFEST_FILE_NAME).is_file());
        assert!(OverwriteManifestStore::default()
            .was_compressed(&compressed)
            .await
            .unwrap());
    }

    #[tokio::test]
    async fn a_malformed_manifest_is_reported_without_overwriting_the_image() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("photo.png");
        fs::write(&image, b"original-image").await.unwrap();
        fs::write(directory.path().join(MANIFEST_FILE_NAME), b"not json")
            .await
            .unwrap();

        let error = OverwriteManifestStore::default()
            .was_compressed(&image)
            .await
            .unwrap_err();
        assert!(error.to_string().contains("无法读取隐藏压缩记录"));
        assert_eq!(fs::read(&image).await.unwrap(), b"original-image");
    }
}
