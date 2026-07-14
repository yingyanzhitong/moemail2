use std::{fs, sync::Mutex};

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
const SNAPSHOT_WORK_FACTOR: u8 = 0;

fn configure_snapshot_encryption() -> Result<()> {
    // 主密钥来自 48 字节系统随机数并保存在系统 Keychain，不是低熵密码。
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

pub struct CredentialVault {
    stronghold: Mutex<Stronghold>,
}

impl CredentialVault {
    pub fn open(app: &AppHandle) -> Result<Self> {
        configure_snapshot_encryption()?;
        let app_data = app.path().app_data_dir().context("无法确定应用数据目录")?;
        fs::create_dir_all(&app_data).context("无法创建应用数据目录")?;
        let snapshot_path = app_data.join("credentials.hold");
        let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER).context("无法访问系统密钥库")?;
        let password = match entry.get_password() {
            Ok(value) => value,
            Err(keyring::Error::NoEntry) => {
                let mut bytes = [0_u8; 48];
                OsRng.fill_bytes(&mut bytes);
                let value = STANDARD_NO_PAD.encode(bytes);
                entry.set_password(&value).context("无法写入系统密钥库")?;
                value
            }
            Err(error) => return Err(error).context("无法读取系统密钥库"),
        };

        let key = Sha256::digest(password.as_bytes()).to_vec();
        let stronghold =
            Stronghold::new(snapshot_path, key).context("无法打开 Stronghold 凭证库")?;
        if stronghold.load_client(CLIENT_NAME).is_err() {
            stronghold
                .create_client(CLIENT_NAME)
                .context("无法创建 Stronghold 客户端")?;
            stronghold.save().context("无法保存 Stronghold 凭证库")?;
        }

        Ok(Self {
            stronghold: Mutex::new(stronghold),
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
        stronghold.save().context("无法持久化凭证")
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
    use super::{configure_snapshot_encryption, ensure_identity, CredentialBundle};

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
