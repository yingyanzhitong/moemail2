use std::{
    collections::HashSet,
    io::Cursor,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, ImageReader};
use uuid::Uuid;
use walkdir::WalkDir;

use crate::models::ImageJobView;

pub const IMPORT_BATCH_SIZE: usize = 24;

#[derive(Debug, Clone)]
pub struct ImageJob {
    pub id: String,
    pub name: String,
    pub source: PathBuf,
    pub output: PathBuf,
    pub parent_label: String,
    pub original_size: u64,
    pub thumbnail_data_url: Option<String>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct ScanReport {
    pub discovered: usize,
    pub skipped: usize,
}

impl ImageJob {
    pub fn view(&self) -> ImageJobView {
        ImageJobView {
            id: self.id.clone(),
            name: self.name.clone(),
            source_path: self.source.to_string_lossy().into_owned(),
            output_path: self.output.to_string_lossy().into_owned(),
            parent_label: self.parent_label.clone(),
            original_size: self.original_size,
            thumbnail_data_url: self.thumbnail_data_url.clone(),
        }
    }
}

pub fn is_supported(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref(),
        Some("avif" | "webp" | "jpg" | "jpeg" | "png")
    )
}

pub fn generate_thumbnail(path: &Path) -> Option<String> {
    if path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("avif"))
    {
        return None;
    }
    let image = ImageReader::open(path)
        .ok()?
        .with_guessed_format()
        .ok()?
        .decode()
        .ok()?;
    let image = image.thumbnail(96, 96);
    let mut buffer = Cursor::new(Vec::new());
    image.write_to(&mut buffer, ImageFormat::Png).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        STANDARD.encode(buffer.into_inner())
    ))
}

fn build_job(source: PathBuf, output: PathBuf) -> Result<ImageJob> {
    let metadata = source
        .metadata()
        .with_context(|| format!("无法读取 {}", source.display()))?;
    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("未命名图片")
        .to_string();
    let parent_label = source
        .parent()
        .map(|path| path.to_string_lossy().into_owned())
        .unwrap_or_default();
    Ok(ImageJob {
        id: Uuid::new_v4().to_string(),
        name,
        source: source.clone(),
        output,
        parent_label,
        original_size: metadata.len(),
        thumbnail_data_url: None,
    })
}

fn push_candidate<F>(
    source: PathBuf,
    output: PathBuf,
    seen: &mut HashSet<PathBuf>,
    batch: &mut Vec<ImageJob>,
    report: &mut ScanReport,
    on_batch: &mut F,
) where
    F: FnMut(Vec<ImageJob>),
{
    if !is_supported(&source) {
        report.skipped += 1;
        return;
    }
    let key = source.canonicalize().unwrap_or_else(|_| source.clone());
    if !seen.insert(key) {
        report.skipped += 1;
        return;
    }
    match build_job(source, output) {
        Ok(job) => {
            report.discovered += 1;
            batch.push(job);
            if batch.len() >= IMPORT_BATCH_SIZE {
                on_batch(std::mem::take(batch));
            }
        }
        Err(_) => report.skipped += 1,
    }
}

/// 在后台扫描时持续交付小批任务。扫描和缩略图彻底分离，调用方可立即让列表开始渲染。
pub fn scan_paths_in_batches<F>(paths: Vec<PathBuf>, mut on_batch: F) -> ScanReport
where
    F: FnMut(Vec<ImageJob>),
{
    let mut seen = HashSet::new();
    let mut batch = Vec::with_capacity(IMPORT_BATCH_SIZE);
    let mut report = ScanReport::default();

    for path in paths {
        if path.is_dir() {
            let folder_name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("目录");
            let output_root = path
                .parent()
                .unwrap_or(&path)
                .join(format!("{folder_name}-压缩结果"));
            for entry in WalkDir::new(&path).follow_links(false) {
                let Ok(entry) = entry else {
                    report.skipped += 1;
                    continue;
                };
                if !entry.file_type().is_file() {
                    continue;
                }
                let source = entry.into_path();
                let relative = match source.strip_prefix(&path) {
                    Ok(relative) => relative,
                    Err(_) => {
                        report.skipped += 1;
                        continue;
                    }
                };
                let output = output_root.join(relative);
                push_candidate(
                    source,
                    output,
                    &mut seen,
                    &mut batch,
                    &mut report,
                    &mut on_batch,
                );
            }
        } else if path.is_file() {
            let output = path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("压缩结果")
                .join(path.file_name().unwrap_or_default());
            push_candidate(
                path,
                output,
                &mut seen,
                &mut batch,
                &mut report,
                &mut on_batch,
            );
        } else {
            report.skipped += 1;
        }
    }

    if !batch.is_empty() {
        on_batch(batch);
    }
    report
}

#[cfg(test)]
pub fn scan_paths(paths: Vec<PathBuf>) -> Result<Vec<ImageJob>> {
    let mut jobs = Vec::new();
    scan_paths_in_batches(paths, |batch| jobs.extend(batch));
    jobs.sort_by(|left, right| left.source.cmp(&right.source));
    Ok(jobs)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn maps_directory_to_sibling_result_folder_and_preserves_structure() {
        let temp = tempdir().unwrap();
        let root = temp.path().join("相册");
        let nested = root.join("旅行");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("a.png"), b"not-an-image").unwrap();

        let jobs = scan_paths(vec![root]).unwrap();
        assert_eq!(jobs.len(), 1);
        assert_eq!(jobs[0].output, temp.path().join("相册-压缩结果/旅行/a.png"));
    }

    #[test]
    fn maps_individual_file_to_result_subfolder() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("a.webp");
        fs::write(&file, b"not-an-image").unwrap();
        let jobs = scan_paths(vec![file]).unwrap();
        assert_eq!(jobs[0].output, temp.path().join("压缩结果/a.webp"));
    }

    #[test]
    fn scan_batches_before_a_large_folder_has_finished() {
        let temp = tempdir().unwrap();
        for index in 0..(IMPORT_BATCH_SIZE + 2) {
            fs::write(temp.path().join(format!("{index}.png")), b"image").unwrap();
        }
        let mut batches = Vec::new();
        let report = scan_paths_in_batches(vec![temp.path().to_path_buf()], |batch| {
            batches.push(batch.len())
        });

        assert_eq!(report.discovered, IMPORT_BATCH_SIZE + 2);
        assert_eq!(batches, vec![IMPORT_BATCH_SIZE, 2]);
    }

    #[test]
    fn scan_returns_before_thumbnail_is_generated() {
        let temp = tempdir().unwrap();
        let file = temp.path().join("photo.png");
        image::RgbaImage::new(4, 4).save(&file).unwrap();

        let jobs = scan_paths(vec![file.clone()]).unwrap();
        assert!(jobs[0].thumbnail_data_url.is_none());
        assert!(generate_thumbnail(&file)
            .is_some_and(|thumbnail| thumbnail.starts_with("data:image/png;base64,")));
    }
}
