use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledPeriod {
    pub starts_at: String,
    pub expires_at: String,
    #[serde(default)]
    pub limit: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LicenseView {
    pub id: Option<String>,
    pub status: String,
    pub used: u32,
    pub limit: u32,
    pub token_count: u32,
    pub starts_at: Option<String>,
    pub expires_at: Option<String>,
    #[serde(default)]
    pub scheduled_periods: Vec<ScheduledPeriod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl LicenseView {
    pub fn unlicensed() -> Self {
        Self {
            id: None,
            status: "unlicensed".into(),
            used: 0,
            limit: 0,
            token_count: 0,
            starts_at: None,
            expires_at: None,
            scheduled_periods: Vec::new(),
            message: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivationPlanPreview {
    pub kind: String,
    pub token_count: u32,
    pub compression_limit: u32,
    pub duration_days: u32,
    pub redeem_expires_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapView {
    pub license: LicenseView,
    pub reconciled_reservations: usize,
    pub pending_usage_reports: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageJobView {
    pub id: String,
    pub name: String,
    pub source_path: String,
    pub output_path: String,
    pub parent_label: String,
    pub original_size: u64,
    pub thumbnail_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailReady {
    pub id: String,
    pub thumbnail_data_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionProgress {
    pub id: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub compressed_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub savings_percent: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionSummary {
    pub completed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub cancelled: usize,
    pub license: LicenseView,
    pub pending_usage_reports: usize,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct KeyState {
    pub api_key: String,
    pub month: String,
    pub count: u32,
    pub invalid: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingReservation {
    pub id: String,
    #[serde(default)]
    pub report_id: Option<String>,
    #[serde(default)]
    pub requested_count: u32,
    pub success_count: u32,
    #[serde(default)]
    pub period_starts_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingUsageReport {
    pub report_id: String,
    pub requested_count: u32,
    pub success_count: u32,
    pub period_starts_at: String,
}

#[derive(Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CredentialBundle {
    pub device_private_key: String,
    pub device_id: String,
    pub access_token: Option<String>,
    #[serde(default)]
    pub keys: Vec<KeyState>,
    pub license: Option<LicenseView>,
    #[serde(default)]
    pub pending_reservations: Vec<PendingReservation>,
    #[serde(default)]
    pub pending_usage_reports: Vec<PendingUsageReport>,
    #[serde(default)]
    pub last_seen_at: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedeemResponse {
    pub access_token: String,
    pub license: LicenseView,
    pub api_keys: Vec<String>,
}
