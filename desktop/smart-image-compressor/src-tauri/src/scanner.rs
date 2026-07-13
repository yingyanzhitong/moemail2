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

fn thumbnail(path: &Path) -> Option<String> {
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
        thumbnail_data_url: thumbnail(&source),
    })
}

fn scan_directory(root: &Path) -> Result<Vec<ImageJob>> {
    let folder_name = root
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("目录");
    let output_root = root
        .parent()
        .unwrap_or(root)
        .join(format!("{folder_name}-压缩结果"));
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_map(|entry| entry.ok())
        .filter(|entry| entry.file_type().is_file() && is_supported(entry.path()))
        .map(|entry| {
            let source = entry.into_path();
            let relative = source.strip_prefix(root).context("无法计算目录结构")?;
            build_job(source.clone(), output_root.join(relative))
        })
        .collect()
}

pub fn scan_paths(paths: Vec<PathBuf>) -> Result<Vec<ImageJob>> {
    let mut seen = HashSet::new();
    let mut jobs = Vec::new();
    for path in paths {
        if path.is_dir() {
            for job in scan_directory(&path)? {
                let key = job
                    .source
                    .canonicalize()
                    .unwrap_or_else(|_| job.source.clone());
                if seen.insert(key) {
                    jobs.push(job);
                }
            }
        } else if path.is_file() && is_supported(&path) {
            let key = path.canonicalize().unwrap_or_else(|_| path.clone());
            if seen.insert(key) {
                let output = path
                    .parent()
                    .unwrap_or_else(|| Path::new("."))
                    .join("压缩结果")
                    .join(path.file_name().unwrap_or_default());
                jobs.push(build_job(path, output)?);
            }
        }
    }
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
}
