use std::{collections::HashMap, sync::Arc, time::Instant};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, Utc};
use reqwest::{Client, Response};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::{
    models::{
        ActivationPlanPreview, BootstrapView, CredentialBundle, KeyState, LicenseView,
        PendingReservation, PendingUsageReport, RedeemResponse,
    },
    vault::CredentialVault,
};

const CLOCK_ROLLBACK_TOLERANCE_MINUTES: i64 = 5;

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
    boot_wall_clock: DateTime<Utc>,
    boot_instant: Instant,
    report_lock: Arc<AsyncMutex<()>>,
}

fn parse_time(value: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .context("授权时间格式无效")
}

fn normalize_license(license: &mut LicenseView, now: DateTime<Utc>) -> Result<()> {
    let Some(starts_at) = license.starts_at.as_deref() else {
        license.status = "unlicensed".into();
        return Ok(());
    };
    let Some(expires_at) = license.expires_at.as_deref() else {
        license.status = "unlicensed".into();
        return Ok(());
    };
    let mut starts_at = parse_time(starts_at)?;
    let mut expires_at = parse_time(expires_at)?;

    if now >= expires_at {
        license
            .scheduled_periods
            .sort_by(|left, right| left.starts_at.cmp(&right.starts_at));
        while !license.scheduled_periods.is_empty() {
            let next = license.scheduled_periods.remove(0);
            let next_starts_at = parse_time(&next.starts_at)?;
            let next_expires_at = parse_time(&next.expires_at)?;
            if next_expires_at <= now {
                continue;
            }
            starts_at = next_starts_at;
            expires_at = next_expires_at;
            license.starts_at = Some(next.starts_at);
            license.expires_at = Some(next.expires_at);
            if next.limit > 0 {
                license.limit = next.limit;
            }
            license.used = 0;
            break;
        }
    }

    license.message = None;
    license.status = if now < starts_at {
        "pending".into()
    } else if now >= expires_at {
        "expired".into()
    } else if license.used >= license.limit {
        "exhausted".into()
    } else {
        "active".into()
    };
    Ok(())
}

fn append_usage_report(
    reports: &mut Vec<PendingUsageReport>,
    report_id: String,
    requested_count: u32,
    success_count: u32,
    period_starts_at: String,
) {
    if let Some(report) = reports
        .iter_mut()
        .find(|report| report.report_id == report_id && report.period_starts_at == period_starts_at)
    {
        report.requested_count = report.requested_count.saturating_add(requested_count);
        report.success_count = report.success_count.saturating_add(success_count);
        return;
    }
    reports.push(PendingUsageReport {
        report_id,
        requested_count,
        success_count,
        period_starts_at,
    });
}

fn apply_observed_time(
    bundle: &mut CredentialBundle,
    observed_at: DateTime<Utc>,
    reconcile_interrupted: bool,
) -> Result<(LicenseView, usize)> {
    let previous = bundle.last_seen_at.as_deref().map(parse_time).transpose()?;
    let rollback = previous.is_some_and(|last_seen| {
        observed_at + Duration::minutes(CLOCK_ROLLBACK_TOLERANCE_MINUTES) < last_seen
    });
    let effective_now = previous
        .filter(|last_seen| *last_seen > observed_at)
        .unwrap_or(observed_at);

    let reconciled = if reconcile_interrupted {
        let pending = std::mem::take(&mut bundle.pending_reservations);
        let count = pending.len();
        if let Some(license) = bundle.license.as_mut() {
            for reservation in pending {
                let consumed = if reservation.requested_count > 0 {
                    reservation.requested_count
                } else {
                    reservation.success_count
                };
                license.used = license.used.saturating_add(consumed).min(license.limit);
                if let Some(period_starts_at) = reservation
                    .period_starts_at
                    .or_else(|| license.starts_at.clone())
                {
                    append_usage_report(
                        &mut bundle.pending_usage_reports,
                        reservation.report_id.unwrap_or(reservation.id),
                        reservation.requested_count.max(consumed),
                        consumed,
                        period_starts_at,
                    );
                }
            }
        }
        count
    } else {
        0
    };

    let Some(license) = bundle.license.as_mut() else {
        bundle.last_seen_at = Some(effective_now.to_rfc3339());
        return Ok((LicenseView::unlicensed(), reconciled));
    };
    normalize_license(license, effective_now)?;
    if rollback {
        license.status = "clock_invalid".into();
        license.message = Some("检测到系统时间回拨。请恢复正确时间后重新启动应用。".into());
    } else {
        bundle.last_seen_at = Some(effective_now.to_rfc3339());
    }
    Ok((license.clone(), reconciled))
}

fn merge_redeemed_license(
    existing: Option<&LicenseView>,
    mut redeemed: LicenseView,
) -> LicenseView {
    if let Some(existing) = existing.filter(|existing| {
        existing.id == redeemed.id
            && existing.starts_at == redeemed.starts_at
            && existing.expires_at == redeemed.expires_at
    }) {
        redeemed.used = existing.used;
    }
    redeemed
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
            boot_wall_clock: Utc::now(),
            boot_instant: Instant::now(),
            report_lock: Arc::new(AsyncMutex::new(())),
        }
    }

    fn now(&self) -> DateTime<Utc> {
        let monotonic_elapsed = Duration::from_std(self.boot_instant.elapsed()).unwrap_or_default();
        let monotonic_now = self.boot_wall_clock + monotonic_elapsed;
        Utc::now().max(monotonic_now)
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

    pub async fn bootstrap(&self) -> Result<BootstrapView> {
        let now = self.now();
        let view = self.vault.update(|bundle| {
            let (license, reconciled_reservations) = apply_observed_time(bundle, now, true)?;
            Ok(BootstrapView {
                license,
                reconciled_reservations,
                pending_usage_reports: 0,
            })
        })?;
        let _ = self.sync_pending_usage_reports().await;
        Ok(BootstrapView {
            pending_usage_reports: self.pending_usage_report_count()?,
            ..view
        })
    }

    pub async fn redeem(&self, code: &str) -> Result<LicenseView> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct Body<'a> {
            code: &'a str,
            device_id: &'a str,
        }

        self.sync_pending_usage_reports().await?;
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
        let now = self.now();
        self.vault.update(|bundle| {
            let license = merge_redeemed_license(bundle.license.as_ref(), redeemed.license);
            let mut existing_keys = std::mem::take(&mut bundle.keys)
                .into_iter()
                .map(|key| (key.api_key.clone(), key))
                .collect::<HashMap<_, _>>();
            bundle.access_token = Some(redeemed.access_token);
            bundle.license = Some(license);
            bundle.keys = redeemed
                .api_keys
                .into_iter()
                .map(|api_key| {
                    existing_keys.remove(&api_key).unwrap_or(KeyState {
                        api_key,
                        month: month.clone(),
                        count: 0,
                        invalid: false,
                    })
                })
                .collect();
            bundle.pending_reservations.clear();
            bundle.last_seen_at = Some(now.to_rfc3339());
            let (license, _) = apply_observed_time(bundle, now, false)?;
            Ok(license)
        })
    }

    pub async fn preview(&self, code: &str) -> Result<ActivationPlanPreview> {
        #[derive(Serialize)]
        struct Body<'a> {
            code: &'a str,
        }

        let response = self
            .client
            .post(format!(
                "{}/api/tinypng/desktop/grants/preview",
                self.base_url
            ))
            .json(&Body { code })
            .send()
            .await
            .context("无法连接授权服务")?;
        Self::parse(response).await
    }

    pub fn refresh(&self) -> Result<LicenseView> {
        let now = self.now();
        self.vault.update(|bundle| {
            let (license, _) = apply_observed_time(bundle, now, false)?;
            Ok(license)
        })
    }

    pub fn reserve_local(&self, count: usize, report_id: &str) -> Result<(String, LicenseView)> {
        let requested_count = u32::try_from(count).context("批次图片数量过大")?;
        let now = self.now();
        self.vault.update(|bundle| {
            let (license, _) = apply_observed_time(bundle, now, false)?;
            if license.status != "active" {
                return Err(anyhow!("授权已到期、额度已用尽或系统时间无效"));
            }
            let pending_count = bundle
                .pending_reservations
                .iter()
                .map(|reservation| reservation.requested_count)
                .sum::<u32>();
            if license
                .used
                .saturating_add(pending_count)
                .saturating_add(requested_count)
                > license.limit
            {
                return Err(anyhow!("本地授权剩余额度不足"));
            }
            let id = Uuid::new_v4().to_string();
            bundle.pending_reservations.push(PendingReservation {
                id: id.clone(),
                report_id: Some(report_id.to_string()),
                requested_count,
                success_count: 0,
                period_starts_at: license.starts_at.clone(),
            });
            Ok((id, license))
        })
    }

    pub fn complete_local(
        &self,
        reservation_id: &str,
        success_count: u32,
        keys: Vec<KeyState>,
        observed_at: Option<DateTime<Utc>>,
    ) -> Result<LicenseView> {
        let observed_at = observed_at.map_or_else(|| self.now(), |value| value.max(self.now()));
        self.vault.update(|bundle| {
            let index = bundle
                .pending_reservations
                .iter()
                .position(|reservation| reservation.id == reservation_id)
                .context("本地批次记录不存在")?;
            let reservation = bundle.pending_reservations.remove(index);
            if success_count > reservation.requested_count {
                return Err(anyhow!("本地批次成功数无效"));
            }
            let license = bundle.license.as_mut().context("尚未激活授权")?;
            license.used = license
                .used
                .saturating_add(success_count)
                .min(license.limit);
            if let Some(period_starts_at) = reservation
                .period_starts_at
                .or_else(|| license.starts_at.clone())
            {
                append_usage_report(
                    &mut bundle.pending_usage_reports,
                    reservation.report_id.unwrap_or(reservation.id),
                    reservation.requested_count,
                    success_count,
                    period_starts_at,
                );
            }
            bundle.keys = keys;
            let (license, _) = apply_observed_time(bundle, observed_at, false)?;
            Ok(license)
        })
    }

    pub fn key_states(&self) -> Result<Vec<KeyState>> {
        Ok(self.vault.read()?.keys)
    }

    pub fn replace_key_states(&self, keys: Vec<KeyState>) -> Result<()> {
        self.vault.update(|bundle| {
            bundle.keys = keys;
            Ok(())
        })
    }

    pub fn pending_usage_report_count(&self) -> Result<usize> {
        Ok(self.vault.read()?.pending_usage_reports.len())
    }

    pub async fn sync_pending_usage_reports(&self) -> Result<usize> {
        let _guard = self.report_lock.lock().await;
        let mut synced = 0;
        loop {
            let mut bundle = self.vault.read()?;
            let Some(report) = bundle.pending_usage_reports.first().cloned() else {
                return Ok(synced);
            };
            if bundle.access_token.is_none() {
                #[derive(Serialize)]
                #[serde(rename_all = "camelCase")]
                struct SessionBody<'a> {
                    license_id: &'a str,
                    device_id: &'a str,
                    api_key: &'a str,
                }
                #[derive(Deserialize)]
                #[serde(rename_all = "camelCase")]
                struct SessionResponse {
                    access_token: String,
                }

                let license_id = bundle
                    .license
                    .as_ref()
                    .and_then(|license| license.id.as_deref())
                    .context("授权标识缺失")?;
                let api_key = bundle.keys.first().context("授权 Token 缺失")?;
                let response = self
                    .client
                    .post(format!(
                        "{}/api/tinypng/desktop/usage/session",
                        self.base_url
                    ))
                    .json(&SessionBody {
                        license_id,
                        device_id: &bundle.device_id,
                        api_key: &api_key.api_key,
                    })
                    .send()
                    .await
                    .context("无法更新用量回传凭证")?;
                let session: SessionResponse = Self::parse(response).await?;
                bundle.access_token = Some(session.access_token);
                self.vault.write(&bundle)?;
            }
            let access_token = bundle
                .access_token
                .as_deref()
                .context("授权缺少用量回传凭证")?;
            let response = self
                .client
                .post(format!(
                    "{}/api/tinypng/desktop/usage/reports",
                    self.base_url
                ))
                .bearer_auth(access_token)
                .header("x-device-id", &bundle.device_id)
                .json(&report)
                .send()
                .await
                .context("无法回传授权使用情况")?;
            Self::parse::<serde_json::Value>(response).await?;
            self.vault.update(|bundle| {
                bundle
                    .pending_usage_reports
                    .retain(|pending| pending.report_id != report.report_id);
                Ok(())
            })?;
            synced += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, Utc};

    use super::{
        append_usage_report, apply_observed_time, merge_redeemed_license, normalize_license,
    };
    use crate::models::{CredentialBundle, LicenseView, PendingReservation, ScheduledPeriod};

    fn active_license(now: chrono::DateTime<Utc>) -> LicenseView {
        LicenseView {
            id: Some("license".into()),
            status: "active".into(),
            used: 3,
            limit: 10,
            token_count: 1,
            starts_at: Some((now - Duration::days(1)).to_rfc3339()),
            expires_at: Some((now + Duration::days(1)).to_rfc3339()),
            scheduled_periods: Vec::new(),
            message: None,
        }
    }

    #[test]
    fn detects_clock_rollback_from_encrypted_high_water_mark() {
        let now = Utc::now();
        let mut bundle = CredentialBundle {
            license: Some(active_license(now)),
            last_seen_at: Some((now + Duration::hours(1)).to_rfc3339()),
            ..CredentialBundle::default()
        };

        let (license, _) = apply_observed_time(&mut bundle, now, false).unwrap();
        assert_eq!(license.status, "clock_invalid");
    }

    #[test]
    fn interrupted_local_batch_is_conservatively_counted() {
        let now = Utc::now();
        let mut bundle = CredentialBundle {
            license: Some(active_license(now)),
            pending_reservations: vec![PendingReservation {
                id: "pending".into(),
                report_id: Some("execution".into()),
                requested_count: 4,
                success_count: 0,
                period_starts_at: Some((now - Duration::days(1)).to_rfc3339()),
            }],
            ..CredentialBundle::default()
        };

        let (license, reconciled) = apply_observed_time(&mut bundle, now, true).unwrap();
        assert_eq!(reconciled, 1);
        assert_eq!(license.used, 7);
        assert!(bundle.pending_reservations.is_empty());
        assert_eq!(bundle.pending_usage_reports.len(), 1);
        assert_eq!(bundle.pending_usage_reports[0].success_count, 4);
    }

    #[test]
    fn internal_checkpoints_are_aggregated_into_one_execution_report() {
        let mut reports = Vec::new();
        append_usage_report(&mut reports, "execution".into(), 20, 18, "period".into());
        append_usage_report(&mut reports, "execution".into(), 35, 34, "period".into());

        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].requested_count, 55);
        assert_eq!(reports[0].success_count, 52);
    }

    #[test]
    fn renewal_does_not_reset_current_local_usage() {
        let now = Utc::now();
        let existing = active_license(now);
        let mut redeemed = existing.clone();
        redeemed.used = 0;

        assert_eq!(merge_redeemed_license(Some(&existing), redeemed).used, 3);
    }

    #[test]
    fn scheduled_period_uses_limit_from_renewal_auth_link() {
        let now = Utc::now();
        let mut license = active_license(now);
        license.expires_at = Some((now - Duration::minutes(1)).to_rfc3339());
        license.scheduled_periods = vec![ScheduledPeriod {
            starts_at: (now - Duration::minutes(1)).to_rfc3339(),
            expires_at: (now + Duration::days(45)).to_rfc3339(),
            limit: 3_456,
        }];

        normalize_license(&mut license, now).unwrap();
        assert_eq!(license.status, "active");
        assert_eq!(license.used, 0);
        assert_eq!(license.limit, 3_456);
    }
}
