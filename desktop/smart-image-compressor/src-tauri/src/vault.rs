use std::{fs, io::Write, path::Path, sync::Mutex};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use anyhow::{Context, Result};
use base64::{
    engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD},
    Engine,
};
use keyring::Entry;
use rand::{rngs::OsRng, RngCore};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_stronghold::stronghold::Stronghold;

use crate::models::CredentialBundle;

const CLIENT_NAME: &[u8] = b"smart-image-compressor";
const RECORD_KEY: &[u8] = b"desktop-credentials-v1";
const KEYRING_SERVICE: &str = "site.tinypng-token.smartcompress";
const KEYRING_USER: &str = "stronghold-master-key";
const LOCAL_MASTER_KEY_FILE: &str = "master.key";
const SNAPSHOT_WORK_FACTOR: u8 = 0;

fn configure_snapshot_encryption() -> Result<()> {
    // 主密钥来自 48 字节系统随机数并保存在仅当前用户可读的本地文件中，不是低熵密码。
    // Stronghold 对强随机密钥建议使用最小工作因子，避免每次持久化重复执行昂贵的 scrypt。
    iota_stronghold::engine::snapshot::try_set_encrypt_work_factor(SNAPSHOT_WORK_FACTOR)
        .context("无法配置 Stronghold 凭证库")
}

fn ensure_identity(bundle: &mut CredentialBundle) -> bool {
    if !bundle.device_private_key.is_empty() && !bundle.device_id.is_empty() {
        return false;
    }
    let mut private_key = [0_u8; 32];
    OsRng.fill_bytes(&mut private_key);
    bundle.device_private_key = STANDARD_NO_PAD.encode(private_key);
    bundle.device_id = URL_SAFE_NO_PAD.encode(Sha256::digest(private_key));
    true
}

fn generate_master_key() -> String {
    let mut bytes = [0_u8; 48];
    OsRng.fill_bytes(&mut bytes);
    STANDARD_NO_PAD.encode(bytes)
}

fn validate_master_key(value: &str) -> Result<()> {
    let bytes = STANDARD_NO_PAD
        .decode(value)
        .context("本地主密钥格式无效")?;
    anyhow::ensure!(bytes.len() == 48, "本地主密钥长度无效");
    Ok(())
}

fn read_local_master_key(path: &Path) -> Result<String> {
    let value = fs::read_to_string(path)
        .with_context(|| format!("无法读取本地主密钥：{}", path.display()))?;
    let value = value.trim().to_string();
    validate_master_key(&value)?;
    Ok(value)
}

fn write_local_master_key(path: &Path, value: &str) -> Result<()> {
    validate_master_key(value)?;
    let parent = path.parent().context("本地主密钥路径无效")?;
    let mut temporary =
        tempfile::NamedTempFile::new_in(parent).context("无法创建主密钥临时文件")?;
    temporary
        .write_all(value.as_bytes())
        .context("无法写入本地主密钥")?;
    temporary
        .as_file()
        .sync_all()
        .context("无法同步本地主密钥")?;
    #[cfg(unix)]
    temporary
        .as_file()
        .set_permissions(fs::Permissions::from_mode(0o600))
        .context("无法限制本地主密钥权限")?;
    temporary
        .persist_noclobber(path)
        .map_err(|error| error.error)
        .context("无法保存本地主密钥")?;
    Ok(())
}

fn restrict_snapshot_permissions(snapshot_path: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        let parent = snapshot_path.parent().context("Stronghold 路径无效")?;
        let prefix = snapshot_path
            .file_name()
            .and_then(|value| value.to_str())
            .context("Stronghold 文件名无效")?;
        let backup_prefix = format!("{prefix}.");
        for entry in fs::read_dir(parent).context("无法检查 Stronghold 文件权限")? {
            let entry = entry.context("无法读取 Stronghold 文件")?;
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if entry
                .file_type()
                .context("无法读取 Stronghold 文件类型")?
                .is_file()
                && (name == prefix || name.starts_with(&backup_prefix))
            {
                fs::set_permissions(entry.path(), fs::Permissions::from_mode(0o600))
                    .context("无法限制 Stronghold 文件权限")?;
            }
        }
    }
    #[cfg(not(unix))]
    let _ = snapshot_path;
    Ok(())
}

fn load_or_create_master_key(
    key_path: &Path,
    snapshot_path: &Path,
    legacy_loader: impl FnOnce() -> Result<Option<String>>,
) -> Result<String> {
    if key_path.exists() {
        return read_local_master_key(key_path);
    }

    let value = if snapshot_path.exists() {
        legacy_loader()?.context("检测到旧凭证，但系统密钥库中缺少对应主密钥")?
    } else {
        generate_master_key()
    };
    write_local_master_key(key_path, &value)?;
    Ok(value)
}

pub struct CredentialVault {
    stronghold: Mutex<Stronghold>,
    snapshot_path: std::path::PathBuf,
}

impl CredentialVault {
    pub fn open(app: &AppHandle) -> Result<Self> {
        configure_snapshot_encryption()?;
        let app_data = app.path().app_data_dir().context("无法确定应用数据目录")?;
        fs::create_dir_all(&app_data).context("无法创建应用数据目录")?;
        let snapshot_path = app_data.join("credentials.hold");
        let master_key_path = app_data.join(LOCAL_MASTER_KEY_FILE);
        let password = load_or_create_master_key(&master_key_path, &snapshot_path, || {
            let entry =
                Entry::new(KEYRING_SERVICE, KEYRING_USER).context("无法访问旧系统密钥库")?;
            match entry.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(error).context("无法迁移旧系统密钥库"),
            }
        })?;

        let key = Sha256::digest(password.as_bytes()).to_vec();
        let stronghold =
            Stronghold::new(&snapshot_path, key).context("无法打开 Stronghold 凭证库")?;
        if stronghold.load_client(CLIENT_NAME).is_err() {
            stronghold
                .create_client(CLIENT_NAME)
                .context("无法创建 Stronghold 客户端")?;
            stronghold.save().context("无法保存 Stronghold 凭证库")?;
        }
        restrict_snapshot_permissions(&snapshot_path)?;

        Ok(Self {
            stronghold: Mutex::new(stronghold),
            snapshot_path,
        })
    }

    pub fn read(&self) -> Result<CredentialBundle> {
        let stronghold = self
            .stronghold
            .lock()
            .map_err(|_| anyhow::anyhow!("Stronghold 锁已损坏"))?;
        let client = stronghold
            .get_client(CLIENT_NAME)
            .context("无法读取 Stronghold 客户端")?;
        let Some(bytes) = client.store().get(RECORD_KEY).context("无法读取凭证")? else {
            return Ok(CredentialBundle::default());
        };
        serde_json::from_slice(&bytes).context("凭证数据格式无效")
    }

    pub fn write(&self, bundle: &CredentialBundle) -> Result<()> {
        let bytes = serde_json::to_vec(bundle).context("无法序列化凭证")?;
        let stronghold = self
            .stronghold
            .lock()
            .map_err(|_| anyhow::anyhow!("Stronghold 锁已损坏"))?;
        let client = stronghold
            .get_client(CLIENT_NAME)
            .context("无法读取 Stronghold 客户端")?;
        client
            .store()
            .insert(RECORD_KEY.to_vec(), bytes, None)
            .context("无法写入凭证")?;
        stronghold.save().context("无法持久化凭证")?;
        restrict_snapshot_permissions(&self.snapshot_path)
    }

    pub fn update<T>(&self, update: impl FnOnce(&mut CredentialBundle) -> Result<T>) -> Result<T> {
        let mut bundle = self.read()?;
        let result = update(&mut bundle)?;
        self.write(&bundle)?;
        Ok(result)
    }

    pub fn ensure_device_identity(&self) -> Result<String> {
        let mut bundle = self.read()?;
        if ensure_identity(&mut bundle) {
            self.write(&bundle)?;
        }
        Ok(bundle.device_id)
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use tempfile::tempdir;

    use super::{
        configure_snapshot_encryption, ensure_identity, generate_master_key,
        load_or_create_master_key, read_local_master_key, restrict_snapshot_permissions,
        CredentialBundle,
    };

    #[test]
    fn new_install_creates_local_key_without_accessing_keychain() {
        let temp = tempdir().unwrap();
        let key_path = temp.path().join("master.key");
        let snapshot_path = temp.path().join("credentials.hold");

        let value = load_or_create_master_key(&key_path, &snapshot_path, || {
            panic!("新安装不应访问系统 Keychain")
        })
        .unwrap();

        assert_eq!(value, read_local_master_key(&key_path).unwrap());
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(key_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn existing_snapshot_migrates_keychain_only_once() {
        let temp = tempdir().unwrap();
        let key_path = temp.path().join("master.key");
        let snapshot_path = temp.path().join("credentials.hold");
        fs::write(&snapshot_path, b"legacy snapshot").unwrap();
        let legacy = generate_master_key();

        let migrated =
            load_or_create_master_key(&key_path, &snapshot_path, || Ok(Some(legacy.clone())))
                .unwrap();
        let reopened = load_or_create_master_key(&key_path, &snapshot_path, || {
            panic!("迁移完成后不应再次访问系统 Keychain")
        })
        .unwrap();

        assert_eq!(migrated, legacy);
        assert_eq!(reopened, legacy);
    }

    #[cfg(unix)]
    #[test]
    fn snapshot_and_backup_files_are_user_only() {
        let temp = tempdir().unwrap();
        let snapshot = temp.path().join("credentials.hold");
        let backup = temp.path().join("credentials.hold.backup");
        fs::write(&snapshot, b"snapshot").unwrap();
        fs::write(&backup, b"backup").unwrap();
        fs::set_permissions(&snapshot, fs::Permissions::from_mode(0o644)).unwrap();
        fs::set_permissions(&backup, fs::Permissions::from_mode(0o644)).unwrap();

        restrict_snapshot_permissions(&snapshot).unwrap();

        assert_eq!(
            fs::metadata(snapshot).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(backup).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn existing_device_identity_does_not_change() {
        let mut bundle = CredentialBundle {
            device_private_key: "private".into(),
            device_id: "device".into(),
            ..CredentialBundle::default()
        };

        assert!(!ensure_identity(&mut bundle));
        assert_eq!(bundle.device_private_key, "private");
        assert_eq!(bundle.device_id, "device");
    }

    #[test]
    fn missing_device_identity_is_generated_once() {
        let mut bundle = CredentialBundle::default();

        assert!(ensure_identity(&mut bundle));
        assert!(!bundle.device_private_key.is_empty());
        assert!(!bundle.device_id.is_empty());
        assert!(!ensure_identity(&mut bundle));
    }

    #[test]
    fn random_key_snapshot_uses_minimum_work_factor() {
        configure_snapshot_encryption().expect("work factor should be configurable");
        assert_eq!(
            iota_stronghold::engine::snapshot::get_encrypt_work_factor(),
            0
        );
    }
}
