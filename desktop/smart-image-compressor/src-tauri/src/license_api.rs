use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration as StdDuration, Instant},
};

use anyhow::{anyhow, Context, Result};
use chrono::{DateTime, Duration, Utc};
use reqwest::{Client, Response};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use tokio::sync::Mutex as AsyncMutex;
use uuid::Uuid;

use crate::{
    models::{
        ActivationPlanPreview, BootstrapView, CredentialBundle, KeyState, LicensePackageView,
        LicenseView, PendingReservation, PendingUsageReport, RedeemResponse, StoredLicense,
    },
    vault::CredentialVault,
};

const CLOCK_ROLLBACK_TOLERANCE_MINUTES: i64 = 5;
const STARTUP_LICENSE_CHECK_TIMEOUT: StdDuration = StdDuration::from_secs(5);
const DEFAULT_AUTH_API_URL: &str = "https://auth.xyyamsz.cn";

enum RemoteLicenseStatus {
    Available(LicenseView),
    Revoked,
}

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

#[derive(Clone)]
pub struct LocalReservation {
    pub id: String,
    pub license_id: String,
    pub license: LicenseView,
    pub requested_count: usize,
    pub keys: Vec<KeyState>,
}

#[derive(Clone)]
pub struct PackageKeys {
    pub license_id: String,
    pub package_index: usize,
    pub keys: Vec<KeyState>,
}

fn parse_time(value: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .context("授权时间格式无效")
}

fn ensure_packages(bundle: &mut CredentialBundle) {
    if !bundle.packages.is_empty() {
        return;
    }
    let Some(license) = bundle.license.take() else {
        return;
    };
    bundle.packages.push(StoredLicense {
        license,
        access_token: bundle.access_token.take(),
        keys: std::mem::take(&mut bundle.keys),
        pending_reservations: std::mem::take(&mut bundle.pending_reservations),
        pending_usage_reports: std::mem::take(&mut bundle.pending_usage_reports),
    });
}

fn reset_month(keys: &mut [KeyState]) {
    let month = Utc::now().format("%Y-%m").to_string();
    for key in keys {
        if key.month != month {
            key.month = month.clone();
            key.count = 0;
        }
    }
}

fn package_sort_key(package: &StoredLicense) -> String {
    package.license.starts_at.clone().unwrap_or_default()
}

fn package_indexes(packages: &[StoredLicense]) -> Vec<usize> {
    let mut indexes = (0..packages.len()).collect::<Vec<_>>();
    indexes.sort_by_key(|index| package_sort_key(&packages[*index]));
    indexes
}

fn normalize_license(license: &mut LicenseView, now: DateTime<Utc>) -> Result<()> {
    if license.status == "revoked" {
        return Ok(());
    }
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

fn reconcile_package(package: &mut StoredLicense) -> usize {
    let pending = std::mem::take(&mut package.pending_reservations);
    let count = pending.len();
    for reservation in pending {
        let consumed = if reservation.requested_count > 0 {
            reservation.requested_count
        } else {
            reservation.success_count
        };
        package.license.used = package
            .license
            .used
            .saturating_add(consumed)
            .min(package.license.limit);
        if let Some(period_starts_at) = reservation
            .period_starts_at
            .or_else(|| package.license.starts_at.clone())
        {
            append_usage_report(
                &mut package.pending_usage_reports,
                reservation.report_id.unwrap_or(reservation.id),
                reservation.requested_count.max(consumed),
                consumed,
                period_starts_at,
            );
        }
    }
    count
}

fn package_view(package: &StoredLicense) -> LicensePackageView {
    LicensePackageView {
        id: package.license.id.clone().unwrap_or_default(),
        status: package.license.status.clone(),
        used: package.license.used,
        limit: package.license.limit,
        starts_at: package.license.starts_at.clone(),
        expires_at: package.license.expires_at.clone(),
        scheduled_periods: package.license.scheduled_periods.clone(),
        message: package.license.message.clone(),
    }
}

fn workspace_view(bundle: &CredentialBundle, clock_invalid: bool) -> LicenseView {
    let indexes = package_indexes(&bundle.packages);
    let selected = indexes
        .iter()
        .map(|index| &bundle.packages[*index])
        .find(|package| package.license.status == "active")
        .or_else(|| {
            indexes
                .iter()
                .map(|index| &bundle.packages[*index])
                .find(|package| package.license.status == "pending")
        })
        .or_else(|| indexes.first().map(|index| &bundle.packages[*index]));
    let Some(selected) = selected else {
        return LicenseView::unlicensed();
    };
    let mut view = selected.license.clone();
    view.packages = indexes
        .into_iter()
        .map(|index| package_view(&bundle.packages[index]))
        .collect();
    if clock_invalid {
        view.status = "clock_invalid".into();
        view.message = Some("检测到系统时间回拨。请恢复正确时间后重新启动应用。".into());
    }
    view
}

fn apply_observed_time(
    bundle: &mut CredentialBundle,
    observed_at: DateTime<Utc>,
    reconcile_interrupted: bool,
) -> Result<(LicenseView, usize)> {
    ensure_packages(bundle);
    let previous = bundle.last_seen_at.as_deref().map(parse_time).transpose()?;
    let rollback = previous.is_some_and(|last_seen| {
        observed_at + Duration::minutes(CLOCK_ROLLBACK_TOLERANCE_MINUTES) < last_seen
    });
    let effective_now = previous
        .filter(|last_seen| *last_seen > observed_at)
        .unwrap_or(observed_at);

    let mut reconciled = 0;
    for package in &mut bundle.packages {
        if reconcile_interrupted {
            reconciled += reconcile_package(package);
        }
        normalize_license(&mut package.license, effective_now)?;
    }
    if !rollback {
        bundle.last_seen_at = Some(effective_now.to_rfc3339());
    }
    Ok((workspace_view(bundle, rollback), reconciled))
}

fn merge_redeemed_license(
    existing: Option<&LicenseView>,
    mut redeemed: LicenseView,
) -> LicenseView {
    redeemed.packages.clear();
    if let Some(existing) = existing.filter(|existing| {
        existing.id == redeemed.id
            && existing.starts_at == redeemed.starts_at
            && existing.expires_at == redeemed.expires_at
    }) {
        redeemed.used = existing.used;
    }
    redeemed
}

fn merge_remote_license(existing: &LicenseView, mut remote: LicenseView) -> LicenseView {
    remote.packages.clear();
    if existing.id == remote.id
        && existing.starts_at == remote.starts_at
        && existing.expires_at == remote.expires_at
    {
        remote.used = remote.used.max(existing.used);
    }
    remote
}

fn revoke_local_package(bundle: &mut CredentialBundle, license_id: &str) {
    ensure_packages(bundle);
    let Some(package) = bundle
        .packages
        .iter_mut()
        .find(|package| package.license.id.as_deref() == Some(license_id))
    else {
        return;
    };
    package.keys.clear();
    package.access_token = None;
    package.pending_reservations.clear();
    package.pending_usage_reports.clear();
    package.license.status = "revoked".into();
    package.license.message = Some("该套餐已在管理端停止，本地 TinyPNG Token 已删除。".into());
}

impl LicenseApi {
    pub fn new(client: Client, vault: Arc<CredentialVault>) -> Self {
        let base_url = option_env!("SMART_COMPRESS_API_URL")
            .unwrap_or(DEFAULT_AUTH_API_URL)
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
        let elapsed = Duration::from_std(self.boot_instant.elapsed()).unwrap_or_default();
        Utc::now().max(self.boot_wall_clock + elapsed)
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
        let usage_sync = self.clone();
        tokio::spawn(async move {
            let _ = usage_sync.sync_pending_usage_reports().await;
        });
        let _ = self.sync_remote_license_statuses().await;
        Ok(BootstrapView {
            license: self.refresh()?,
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
        let redeemed_id = redeemed.license.id.clone().context("授权标识缺失")?;
        let month = Utc::now().format("%Y-%m").to_string();
        let now = self.now();
        self.vault.update(|bundle| {
            ensure_packages(bundle);
            if let Some(package) = bundle
                .packages
                .iter_mut()
                .find(|package| package.license.id.as_deref() == Some(redeemed_id.as_str()))
            {
                let mut existing_keys = std::mem::take(&mut package.keys)
                    .into_iter()
                    .map(|key| (key.api_key.clone(), key))
                    .collect::<HashMap<_, _>>();
                package.license = merge_redeemed_license(Some(&package.license), redeemed.license);
                package.access_token = Some(redeemed.access_token);
                package.keys = redeemed
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
            } else {
                bundle.packages.push(StoredLicense {
                    license: merge_redeemed_license(None, redeemed.license),
                    access_token: Some(redeemed.access_token),
                    keys: redeemed
                        .api_keys
                        .into_iter()
                        .map(|api_key| KeyState {
                            api_key,
                            month: month.clone(),
                            count: 0,
                            invalid: false,
                        })
                        .collect(),
                    pending_reservations: Vec::new(),
                    pending_usage_reports: Vec::new(),
                });
            }
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
        self.vault
            .update(|bundle| Ok(apply_observed_time(bundle, now, false)?.0))
    }

    pub fn delete_revoked_package(&self, license_id: &str) -> Result<LicenseView> {
        let now = self.now();
        self.vault.update(|bundle| {
            ensure_packages(bundle);
            let index = bundle
                .packages
                .iter()
                .position(|package| package.license.id.as_deref() == Some(license_id))
                .context("套餐记录不存在")?;
            if bundle.packages[index].license.status != "revoked" {
                return Err(anyhow!("仅可删除已失效套餐"));
            }
            bundle.packages.remove(index);
            Ok(apply_observed_time(bundle, now, false)?.0)
        })
    }

    pub async fn refresh_online(&self) -> Result<LicenseView> {
        let _ = self.sync_remote_license_statuses().await;
        self.refresh()
    }

    async fn remote_license_status(
        &self,
        license_id: &str,
        access_token: &str,
        device_id: &str,
    ) -> Result<RemoteLicenseStatus> {
        let response = self
            .client
            .get(format!("{}/api/tinypng/desktop/license", self.base_url))
            .bearer_auth(access_token)
            .header("x-device-id", device_id)
            .header("x-license-id", license_id)
            .send()
            .await
            .context("无法连接授权服务")?;
        if response.status().is_success() {
            return Ok(RemoteLicenseStatus::Available(Self::parse(response).await?));
        }
        let status = response.status();
        let error = response
            .json::<ApiErrorBody>()
            .await
            .unwrap_or(ApiErrorBody {
                error: None,
                code: None,
            });
        if error.code.as_deref() == Some("LICENSE_REVOKED") || status.as_u16() == 401 {
            return Ok(RemoteLicenseStatus::Revoked);
        }
        Err(anyhow!(
            "无法校验套餐 {license_id}：{}{}",
            error
                .error
                .unwrap_or_else(|| format!("授权服务返回 {}", status.as_u16())),
            error
                .code
                .map(|code| format!("（{code}）"))
                .unwrap_or_default(),
        ))
    }

    async fn collect_remote_license_statuses(&self) -> Result<Vec<(String, RemoteLicenseStatus)>> {
        let mut bundle = self.vault.read()?;
        ensure_packages(&mut bundle);
        let device_id = bundle.device_id.clone();
        let packages = bundle
            .packages
            .iter()
            .filter_map(|package| {
                Some((
                    package.license.id.clone()?,
                    package.access_token.clone()?,
                    package.license.status.clone(),
                ))
            })
            .collect::<Vec<_>>();
        if device_id.is_empty() {
            return Ok(Vec::new());
        }

        let mut updates = Vec::new();
        let mut last_error = None;
        for (license_id, access_token, local_status) in packages {
            if local_status == "revoked" {
                continue;
            }
            let status = match self
                .remote_license_status(&license_id, &access_token, &device_id)
                .await
            {
                Ok(status) => status,
                Err(error) => {
                    last_error = Some(error);
                    continue;
                }
            };
            match status {
                RemoteLicenseStatus::Available(remote) => {
                    updates.push((license_id, RemoteLicenseStatus::Available(remote)));
                }
                RemoteLicenseStatus::Revoked => {
                    updates.push((license_id, RemoteLicenseStatus::Revoked));
                }
            }
        }
        if updates.is_empty() {
            if let Some(error) = last_error {
                return Err(error);
            }
        }
        Ok(updates)
    }

    async fn sync_remote_license_statuses(&self) -> Result<usize> {
        // 远程状态只在全部请求于五秒内返回后才落盘；超时或不可达时保留本地套餐状态。
        let updates = tokio::time::timeout(
            STARTUP_LICENSE_CHECK_TIMEOUT,
            self.collect_remote_license_statuses(),
        )
        .await
        .map_err(|_| anyhow!("启动授权校验超时，已保留本地套餐状态"))??;
        self.vault.update(|bundle| {
            ensure_packages(bundle);
            let mut revoked = 0;
            for (license_id, status) in updates {
                match status {
                    RemoteLicenseStatus::Available(remote) => {
                        if let Some(package) = bundle.packages.iter_mut().find(|package| {
                            package.license.id.as_deref() == Some(license_id.as_str())
                        }) {
                            package.license = merge_remote_license(&package.license, remote);
                        }
                    }
                    RemoteLicenseStatus::Revoked => {
                        revoke_local_package(bundle, &license_id);
                        revoked += 1;
                    }
                }
            }
            Ok(revoked)
        })
    }

    pub fn available_local_capacity(&self) -> Result<u32> {
        let now = self.now();
        self.vault.update(|bundle| {
            apply_observed_time(bundle, now, false)?;
            let total = bundle
                .packages
                .iter_mut()
                .filter(|package| package.license.status == "active")
                .map(|package| {
                    reset_month(&mut package.keys);
                    let pending = package
                        .pending_reservations
                        .iter()
                        .map(|item| item.requested_count)
                        .sum::<u32>();
                    let keys_available = package
                        .keys
                        .iter()
                        .any(|key| !key.invalid && key.count < 500);
                    keys_available
                        .then(|| {
                            package
                                .license
                                .limit
                                .saturating_sub(package.license.used.saturating_add(pending))
                        })
                        .unwrap_or(0)
                })
                .sum();
            Ok(total)
        })
    }

    pub fn reserve_next_local(
        &self,
        max_count: usize,
        report_id: &str,
    ) -> Result<LocalReservation> {
        let requested_limit = u32::try_from(max_count).context("批次图片数量过大")?;
        let now = self.now();
        self.vault.update(|bundle| {
            apply_observed_time(bundle, now, false)?;
            let indexes = package_indexes(&bundle.packages);
            for index in indexes {
                let package = &mut bundle.packages[index];
                reset_month(&mut package.keys);
                if package.license.status != "active"
                    || !package
                        .keys
                        .iter()
                        .any(|key| !key.invalid && key.count < 500)
                {
                    continue;
                }
                let pending = package
                    .pending_reservations
                    .iter()
                    .map(|item| item.requested_count)
                    .sum::<u32>();
                let remaining = package
                    .license
                    .limit
                    .saturating_sub(package.license.used.saturating_add(pending));
                if remaining == 0 {
                    continue;
                }
                let requested_count = remaining.min(requested_limit);
                let id = Uuid::new_v4().to_string();
                package.pending_reservations.push(PendingReservation {
                    id: id.clone(),
                    report_id: Some(report_id.to_string()),
                    requested_count,
                    success_count: 0,
                    period_starts_at: package.license.starts_at.clone(),
                });
                return Ok(LocalReservation {
                    id,
                    license_id: package.license.id.clone().context("授权标识缺失")?,
                    license: package.license.clone(),
                    requested_count: requested_count as usize,
                    keys: package.keys.clone(),
                });
            }
            Err(anyhow!("当前没有可用套餐或 TinyPNG Token 容量"))
        })
    }

    pub fn complete_local(
        &self,
        license_id: &str,
        reservation_id: &str,
        success_count: u32,
        keys: Vec<KeyState>,
        observed_at: Option<DateTime<Utc>>,
    ) -> Result<LicenseView> {
        let observed_at = observed_at.map_or_else(|| self.now(), |value| value.max(self.now()));
        self.vault.update(|bundle| {
            ensure_packages(bundle);
            let package = bundle
                .packages
                .iter_mut()
                .find(|package| package.license.id.as_deref() == Some(license_id))
                .context("套餐记录不存在")?;
            let index = package
                .pending_reservations
                .iter()
                .position(|reservation| reservation.id == reservation_id)
                .context("本地批次记录不存在")?;
            let reservation = package.pending_reservations.remove(index);
            if success_count > reservation.requested_count {
                return Err(anyhow!("本地批次成功数无效"));
            }
            package.license.used = package
                .license
                .used
                .saturating_add(success_count)
                .min(package.license.limit);
            if let Some(period_starts_at) = reservation
                .period_starts_at
                .or_else(|| package.license.starts_at.clone())
            {
                append_usage_report(
                    &mut package.pending_usage_reports,
                    reservation.report_id.unwrap_or(reservation.id),
                    reservation.requested_count,
                    success_count,
                    period_starts_at,
                );
            }
            package.keys = keys;
            Ok(apply_observed_time(bundle, observed_at, false)?.0)
        })
    }

    pub fn package_keys(&self, license_id: Option<&str>) -> Result<Vec<PackageKeys>> {
        self.vault.update(|bundle| {
            ensure_packages(bundle);
            let indexes = package_indexes(&bundle.packages);
            Ok(indexes
                .into_iter()
                .enumerate()
                .filter_map(|(package_index, index)| {
                    let package = &bundle.packages[index];
                    let id = package.license.id.clone()?;
                    (license_id.is_none_or(|wanted| wanted == id)).then(|| PackageKeys {
                        license_id: id,
                        package_index: package_index + 1,
                        keys: package.keys.clone(),
                    })
                })
                .collect())
        })
    }

    pub fn replace_package_keys(&self, updates: HashMap<String, Vec<KeyState>>) -> Result<()> {
        self.vault.update(|bundle| {
            ensure_packages(bundle);
            for package in &mut bundle.packages {
                if let Some(id) = package.license.id.as_ref() {
                    if let Some(keys) = updates.get(id) {
                        package.keys = keys.clone();
                    }
                }
            }
            Ok(())
        })
    }

    pub fn pending_usage_report_count(&self) -> Result<usize> {
        let bundle = self.vault.read()?;
        if bundle.packages.is_empty() {
            return Ok(bundle.pending_usage_reports.len());
        }
        Ok(bundle
            .packages
            .iter()
            .map(|package| package.pending_usage_reports.len())
            .sum())
    }

    pub async fn sync_pending_usage_reports(&self) -> Result<usize> {
        let _guard = self.report_lock.lock().await;
        let mut synced = 0;
        loop {
            let mut bundle = self.vault.read()?;
            ensure_packages(&mut bundle);
            let Some(package) = bundle
                .packages
                .iter()
                .find(|package| !package.pending_usage_reports.is_empty())
                .cloned()
            else {
                return Ok(synced);
            };
            let license_id = package.license.id.clone().context("授权标识缺失")?;
            let report = package.pending_usage_reports[0].clone();
            let access_token = if let Some(token) = package.access_token {
                token
            } else {
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
                let api_key = package.keys.first().context("授权 Token 缺失")?;
                let response = self
                    .client
                    .post(format!(
                        "{}/api/tinypng/desktop/usage/session",
                        self.base_url
                    ))
                    .json(&SessionBody {
                        license_id: &license_id,
                        device_id: &bundle.device_id,
                        api_key: &api_key.api_key,
                    })
                    .send()
                    .await
                    .context("无法更新用量回传凭证")?;
                let session: SessionResponse = Self::parse(response).await?;
                let token = session.access_token;
                self.vault.update(|stored| {
                    ensure_packages(stored);
                    if let Some(item) = stored
                        .packages
                        .iter_mut()
                        .find(|item| item.license.id.as_deref() == Some(license_id.as_str()))
                    {
                        item.access_token = Some(token.clone());
                    }
                    Ok(())
                })?;
                token
            };
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
            self.vault.update(|stored| {
                ensure_packages(stored);
                if let Some(item) = stored
                    .packages
                    .iter_mut()
                    .find(|item| item.license.id.as_deref() == Some(license_id.as_str()))
                {
                    item.pending_usage_reports
                        .retain(|pending| pending.report_id != report.report_id);
                }
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
        apply_observed_time, ensure_packages, revoke_local_package, DEFAULT_AUTH_API_URL,
    };
    use crate::models::{CredentialBundle, KeyState, LicenseView, StoredLicense};

    fn active_license(id: &str, now: chrono::DateTime<Utc>, used: u32, limit: u32) -> LicenseView {
        LicenseView {
            id: Some(id.into()),
            status: "active".into(),
            used,
            limit,
            token_count: 1,
            starts_at: Some((now - Duration::days(1)).to_rfc3339()),
            expires_at: Some((now + Duration::days(1)).to_rfc3339()),
            scheduled_periods: Vec::new(),
            packages: Vec::new(),
            message: None,
        }
    }

    #[test]
    fn default_auth_api_uses_edgeone_domain() {
        assert_eq!(DEFAULT_AUTH_API_URL, "https://auth.xyyamsz.cn");
    }

    #[test]
    fn legacy_credentials_migrate_to_one_package() {
        let now = Utc::now();
        let mut bundle = CredentialBundle {
            license: Some(active_license("old", now, 3, 10)),
            keys: vec![KeyState {
                api_key: "key".into(),
                month: now.format("%Y-%m").to_string(),
                count: 0,
                invalid: false,
            }],
            ..CredentialBundle::default()
        };
        ensure_packages(&mut bundle);
        assert_eq!(bundle.packages.len(), 1);
        assert!(bundle.license.is_none());
        assert_eq!(bundle.packages[0].keys.len(), 1);
    }

    #[test]
    fn oldest_active_package_has_priority_in_workspace_view() {
        let now = Utc::now();
        let mut older = active_license("older", now, 2, 10);
        older.starts_at = Some((now - Duration::days(10)).to_rfc3339());
        let newer = active_license("newer", now, 0, 10);
        let mut bundle = CredentialBundle {
            packages: vec![
                StoredLicense {
                    license: newer,
                    access_token: None,
                    keys: Vec::new(),
                    pending_reservations: Vec::new(),
                    pending_usage_reports: Vec::new(),
                },
                StoredLicense {
                    license: older,
                    access_token: None,
                    keys: Vec::new(),
                    pending_reservations: Vec::new(),
                    pending_usage_reports: Vec::new(),
                },
            ],
            ..CredentialBundle::default()
        };
        let (view, _) = apply_observed_time(&mut bundle, now, false).unwrap();
        assert_eq!(view.id.as_deref(), Some("older"));
        assert_eq!(view.packages.len(), 2);
        assert_eq!(view.packages[0].id, "older");
    }

    #[test]
    fn exhausted_old_package_allows_new_package_to_become_active() {
        let now = Utc::now();
        let older = active_license("older", now, 10, 10);
        let newer = active_license("newer", now, 0, 10);
        let mut bundle = CredentialBundle {
            packages: vec![
                StoredLicense {
                    license: older,
                    access_token: None,
                    keys: Vec::new(),
                    pending_reservations: Vec::new(),
                    pending_usage_reports: Vec::new(),
                },
                StoredLicense {
                    license: newer,
                    access_token: None,
                    keys: Vec::new(),
                    pending_reservations: Vec::new(),
                    pending_usage_reports: Vec::new(),
                },
            ],
            ..CredentialBundle::default()
        };
        let (view, _) = apply_observed_time(&mut bundle, now, false).unwrap();
        assert_eq!(view.id.as_deref(), Some("newer"));
        assert_eq!(view.status, "active");
    }

    #[test]
    fn revoked_package_purges_local_tokens_but_keeps_an_invalid_package_view() {
        let now = Utc::now();
        let mut bundle = CredentialBundle {
            packages: vec![StoredLicense {
                license: active_license("stopped", now, 3, 10),
                access_token: Some("access-token".into()),
                keys: vec![KeyState {
                    api_key: "tinypng-token".into(),
                    month: now.format("%Y-%m").to_string(),
                    count: 3,
                    invalid: false,
                }],
                pending_reservations: Vec::new(),
                pending_usage_reports: Vec::new(),
            }],
            ..CredentialBundle::default()
        };

        revoke_local_package(&mut bundle, "stopped");
        let (view, _) = apply_observed_time(&mut bundle, now, false).unwrap();

        assert_eq!(view.status, "revoked");
        assert_eq!(view.packages[0].status, "revoked");
        assert!(bundle.packages[0].keys.is_empty());
        assert!(bundle.packages[0].access_token.is_none());
        assert!(bundle.packages[0].pending_reservations.is_empty());
        assert!(bundle.packages[0].pending_usage_reports.is_empty());
    }
}
