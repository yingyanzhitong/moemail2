use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use reqwest::{Client, Response};
use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{
    models::{
        BootstrapView, CompleteResponse, CredentialBundle, KeyState, LicenseView,
        PendingReservation, RedeemResponse, ReservationResponse, TopUpResponse,
    },
    vault::CredentialVault,
};

#[derive(Debug, Deserialize)]
struct ApiErrorBody {
    error: Option<String>,
    code: Option<String>,
}

#[derive(Clone)]
pub struct LicenseApi {
    client: Client,
    base_url: String,
    vault: Arc<CredentialVault>,
}

impl LicenseApi {
    pub fn new(client: Client, vault: Arc<CredentialVault>) -> Self {
        let base_url = option_env!("SMART_COMPRESS_API_URL")
            .unwrap_or("https://snapmail.tinypng-token.site")
            .trim_end_matches('/')
            .to_string();
        Self {
            client,
            base_url,
            vault,
        }
    }

    async fn parse<T: DeserializeOwned>(response: Response) -> Result<T> {
        let status = response.status();
        if status.is_success() {
            return response.json::<T>().await.context("授权服务响应格式无效");
        }
        let body = response
            .json::<ApiErrorBody>()
            .await
            .unwrap_or(ApiErrorBody {
                error: None,
                code: None,
            });
        Err(anyhow!(
            "{}{}",
            body.error
                .unwrap_or_else(|| format!("授权服务返回 {}", status.as_u16())),
            body.code
                .map(|code| format!("（{code}）"))
                .unwrap_or_default(),
        ))
    }

    fn authenticated(
        &self,
        method: reqwest::Method,
        path: &str,
        bundle: &CredentialBundle,
    ) -> Result<reqwest::RequestBuilder> {
        let token = bundle.access_token.as_deref().context("尚未激活授权")?;
        if bundle.device_id.is_empty() {
            return Err(anyhow!("设备标识缺失"));
        }
        Ok(self
            .client
            .request(method, format!("{}{}", self.base_url, path))
            .bearer_auth(token)
            .header("X-Device-Id", &bundle.device_id))
    }

    pub async fn bootstrap(&self) -> Result<BootstrapView> {
        let bundle = self.vault.read()?;
        if bundle.access_token.is_none() {
            return Ok(BootstrapView {
                license: LicenseView::unlicensed(),
                reconciled_reservations: 0,
            });
        }

        let reconciled = match self.reconcile_pending().await {
            Ok(count) => count,
            Err(error) => {
                let mut cached = self
                    .vault
                    .read()?
                    .license
                    .unwrap_or_else(LicenseView::unlicensed);
                cached.status = "offline".into();
                cached.message = Some(format!("未完成额度对账：{error}"));
                return Ok(BootstrapView {
                    license: cached,
                    reconciled_reservations: 0,
                });
            }
        };

        match self.refresh().await {
            Ok(license) => Ok(BootstrapView {
                license,
                reconciled_reservations: reconciled,
            }),
            Err(error) => {
                let mut cached = self
                    .vault
                    .read()?
                    .license
                    .unwrap_or_else(LicenseView::unlicensed);
                cached.status = "offline".into();
                cached.message = Some(error.to_string());
                Ok(BootstrapView {
                    license: cached,
                    reconciled_reservations: reconciled,
                })
            }
        }
    }

    pub async fn reconcile_pending(&self) -> Result<usize> {
        let pending_reservations = self.vault.read()?.pending_reservations;
        let mut reconciled = 0;
        for pending in pending_reservations {
            self.complete(&pending.id, pending.success_count).await?;
            reconciled += 1;
        }
        Ok(reconciled)
    }

    pub async fn redeem(&self, code: &str) -> Result<LicenseView> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            code: &'a str,
            device_id: &'a str,
        }

        let device_id = self.vault.ensure_device_identity()?;
        let response = self
            .client
            .post(format!("{}/api/tinypng/desktop/redeem", self.base_url))
            .json(&Body {
                code,
                device_id: &device_id,
            })
            .send()
            .await
            .context("无法连接授权服务")?;
        let redeemed: RedeemResponse = Self::parse(response).await?;
        let month = Utc::now().format("%Y-%m").to_string();
        self.vault.update(|bundle| {
            bundle.access_token = Some(redeemed.access_token);
            bundle.license = Some(redeemed.license.clone());
            bundle.keys = redeemed
                .api_keys
                .into_iter()
                .map(|api_key| KeyState {
                    api_key,
                    month: month.clone(),
                    count: 0,
                    invalid: false,
                })
                .collect();
            bundle.pending_reservations.clear();
            Ok(())
        })?;
        Ok(redeemed.license)
    }

    pub async fn refresh(&self) -> Result<LicenseView> {
        let bundle = self.vault.read()?;
        let response = self
            .authenticated(
                reqwest::Method::GET,
                "/api/tinypng/desktop/license",
                &bundle,
            )?
            .send()
            .await
            .context("无法连接授权服务")?;
        let license: LicenseView = Self::parse(response).await?;
        self.vault.update(|bundle| {
            bundle.license = Some(license.clone());
            Ok(())
        })?;
        Ok(license)
    }

    pub async fn reserve(&self, count: usize) -> Result<String> {
        #[derive(Serialize)]
        struct Body {
            count: usize,
        }
        let bundle = self.vault.read()?;
        let response = self
            .authenticated(
                reqwest::Method::POST,
                "/api/tinypng/desktop/usage/reservations",
                &bundle,
            )?
            .json(&Body { count })
            .send()
            .await
            .context("无法连接授权服务")?;
        let reservation: ReservationResponse = Self::parse(response).await?;
        self.vault.update(|bundle| {
            bundle.pending_reservations.push(PendingReservation {
                id: reservation.id.clone(),
                success_count: 0,
            });
            Ok(())
        })?;
        Ok(reservation.id)
    }

    pub fn record_success(&self, reservation_id: &str, success_count: u32) -> Result<()> {
        self.vault.update(|bundle| {
            if let Some(pending) = bundle
                .pending_reservations
                .iter_mut()
                .find(|pending| pending.id == reservation_id)
            {
                pending.success_count = success_count;
            }
            Ok(())
        })
    }

    pub async fn complete(&self, reservation_id: &str, success_count: u32) -> Result<LicenseView> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body {
            success_count: u32,
        }
        let bundle = self.vault.read()?;
        let response = self
            .authenticated(
                reqwest::Method::POST,
                &format!("/api/tinypng/desktop/usage/reservations/{reservation_id}/complete"),
                &bundle,
            )?
            .json(&Body { success_count })
            .send()
            .await
            .context("无法连接授权服务")?;
        let completed: CompleteResponse = Self::parse(response).await?;
        self.vault.update(|bundle| {
            bundle
                .pending_reservations
                .retain(|pending| pending.id != reservation_id);
            bundle.license = Some(completed.license.clone());
            Ok(())
        })?;
        Ok(completed.license)
    }

    pub async fn top_up(&self) -> Result<Vec<KeyState>> {
        let bundle = self.vault.read()?;
        let response = self
            .authenticated(
                reqwest::Method::POST,
                "/api/tinypng/desktop/keys/top-up",
                &bundle,
            )?
            .send()
            .await
            .context("无法连接授权服务")?;
        let top_up: TopUpResponse = Self::parse(response).await?;
        let month = Utc::now().format("%Y-%m").to_string();
        let keys: Vec<KeyState> = top_up
            .api_keys
            .into_iter()
            .map(|api_key| KeyState {
                api_key,
                month: month.clone(),
                count: 0,
                invalid: false,
            })
            .collect();
        self.vault.update(|bundle| {
            bundle.keys.extend(keys.clone());
            Ok(())
        })?;
        Ok(keys)
    }

    pub fn key_states(&self) -> Result<Vec<KeyState>> {
        Ok(self.vault.read()?.keys)
    }

    pub fn save_key_states(&self, keys: Vec<KeyState>) -> Result<()> {
        self.vault.update(|bundle| {
            bundle.keys = keys;
            Ok(())
        })
    }
}
