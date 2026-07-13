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

pub struct CredentialVault {
    stronghold: Mutex<Stronghold>,
}

impl CredentialVault {
    pub fn open(app: &AppHandle) -> Result<Self> {
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
        self.update(|bundle| {
            if bundle.device_private_key.is_empty() {
                let mut private_key = [0_u8; 32];
                OsRng.fill_bytes(&mut private_key);
                bundle.device_private_key = STANDARD_NO_PAD.encode(private_key);
                bundle.device_id = URL_SAFE_NO_PAD.encode(Sha256::digest(private_key));
            }
            Ok(bundle.device_id.clone())
        })
    }
}
