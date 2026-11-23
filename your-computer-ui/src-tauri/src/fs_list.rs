use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntryInfo {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub kind_label: String,
    pub opened_at: String,
    pub size: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}

struct DirListCache {
    fingerprint: u64,
    entries: Vec<DirEntryInfo>,
}

/// 按规范化路径缓存；指纹不变则跳过图标抽取
static DIR_LIST_CACHE: LazyLock<Mutex<HashMap<String, DirListCache>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

/// 列表格式版本；改返回结构时递增以失效旧缓存（v4：子项指纹 + 磁盘持久化）
const LIST_CACHE_VER: u64 = 4;

fn disk_key(cache_key: &str) -> String {
    format!("dir:{cache_key}")
}

fn remember(cache_key: &str, fingerprint: u64, entries: &[DirEntryInfo]) {
    if let Ok(mut guard) = DIR_LIST_CACHE.lock() {
        guard.insert(
            cache_key.to_string(),
            DirListCache {
                fingerprint,
                entries: entries.to_vec(),
            },
        );
        if guard.len() > 24 {
            let keep = guard.remove(cache_key);
            guard.clear();
            if let Some(v) = keep {
                guard.insert(cache_key.to_string(), v);
            }
        }
    }
    crate::disk_cache::save(&disk_key(cache_key), fingerprint, &entries.to_vec());
}

#[tauri::command]
pub fn list_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let root = PathBuf::from(&path);
    if !root.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    if !root.is_dir() {
        return Err(format!("不是目录: {path}"));
    }

    let cache_key = normalize_path_key(&root);
    let fingerprint = dir_fingerprint(&root);

    if let Ok(guard) = DIR_LIST_CACHE.lock() {
        if let Some(hit) = guard.get(&cache_key) {
            if hit.fingerprint == fingerprint {
                return Ok(hit.entries.clone());
            }
        }
    }

    if let Some(entries) =
        crate::disk_cache::load_if_match::<Vec<DirEntryInfo>>(&disk_key(&cache_key), fingerprint)
    {
        remember(&cache_key, fingerprint, &entries);
        return Ok(entries);
    }

    let entries = list_dir_uncached(&root)?;
    remember(&cache_key, fingerprint, &entries);
    Ok(entries)
}

/// 本地操作后主动失效，避免指纹偶发未变时仍看到旧列表
pub fn invalidate_dir_cache(path: &str) {
    let key = normalize_path_key(Path::new(path));
    if let Ok(mut guard) = DIR_LIST_CACHE.lock() {
        guard.remove(&key);
        crate::disk_cache::remove(&disk_key(&key));
        // 同时失效父目录（新建/删除发生在子项时父列表需刷新）
        if let Some(parent) = Path::new(path).parent() {
            let pk = normalize_path_key(parent);
            guard.remove(&pk);
            crate::disk_cache::remove(&disk_key(&pk));
        }
    }
}

fn normalize_path_key(path: &Path) -> String {
    let s = path.to_string_lossy();
    let trimmed = s.trim_end_matches(['\\', '/']);
    let mut out = trimmed.replace('/', "\\");
    // 盘符统一大写：c:\foo → C:\foo
    if out.len() >= 2 {
        let bytes = unsafe { out.as_bytes_mut() };
        if bytes[1] == b':' && bytes[0].is_ascii_alphabetic() {
            bytes[0] = bytes[0].to_ascii_uppercase();
        }
    }
    out
}

/// 目录指纹：子项名 + 数量 + 最大 mtime（Windows 桌面文件夹自身 mtime 常不随子项变化）
fn dir_fingerprint(root: &Path) -> u64 {
    let mut count: u64 = 0;
    let mut max_ms: u64 = 0;
    let mut name_hash: u64 = 0xcbf2_9ce4_8422_2325;

    if let Ok(meta) = fs::metadata(root) {
        if let Ok(modified) = meta.modified() {
            if let Ok(dur) = modified.duration_since(SystemTime::UNIX_EPOCH) {
                max_ms = max_ms.max(dur.as_millis() as u64);
            }
        }
    }

    if let Ok(read) = fs::read_dir(root) {
        for item in read.flatten() {
            count += 1;
            let name = item.file_name();
            let n = name.to_string_lossy();
            for b in n.as_bytes() {
                name_hash ^= u64::from(*b);
                name_hash = name_hash.wrapping_mul(0x1000_0000_01b3);
            }
            if let Ok(meta) = item.metadata() {
                if let Ok(modified) = meta.modified() {
                    if let Ok(dur) = modified.duration_since(SystemTime::UNIX_EPOCH) {
                        max_ms = max_ms.max(dur.as_millis() as u64);
                    }
                }
            }
        }
    }

    count
        .wrapping_mul(1_000_000_007)
        .wrapping_add(max_ms.wrapping_mul(1_000_003))
        .wrapping_add(name_hash)
        .wrapping_add(LIST_CACHE_VER.wrapping_mul(9_007_199))
}

fn list_dir_uncached(root: &Path) -> Result<Vec<DirEntryInfo>, String> {
    let mut entries = Vec::new();
    let read = fs::read_dir(root).map_err(|e| format!("无法读取目录: {e}"))?;

    for item in read {
        let item = match item {
            Ok(v) => v,
            Err(_) => continue,
        };
        let name = item.file_name().to_string_lossy().to_string();
        if name.is_empty() {
            continue;
        }

        let full = item.path();
        // 优先用 DirEntry.file_type（Windows 上常免二次系统调用）
        let is_dir = match item.file_type() {
            Ok(ft) => ft.is_dir(),
            Err(_) => match item.metadata() {
                Ok(m) => m.is_dir(),
                Err(_) => continue,
            },
        };
        let (kind, kind_label) = classify(&name, is_dir);
        let (size, opened_at) = if is_dir {
            ("--".to_string(), "--".to_string())
        } else {
            match item.metadata() {
                Ok(meta) => (
                    format_bytes(meta.len()),
                    meta.modified()
                        .ok()
                        .and_then(format_system_time)
                        .unwrap_or_else(|| "--".to_string()),
                ),
                Err(_) => ("--".to_string(), "--".to_string()),
            }
        };

        // 列表先不抽外壳图标（文件多时会卡死 UI）；前端可视区再懒加载
        entries.push(DirEntryInfo {
            id: full.to_string_lossy().to_string(),
            name,
            kind: kind.to_string(),
            kind_label: kind_label.to_string(),
            opened_at,
            size,
            path: full.to_string_lossy().to_string(),
            icon_data_url: None,
        });
    }

    entries.sort_by(|a, b| {
        let a_dir = a.kind == "folder";
        let b_dir = b.kind == "folder";
        match (a_dir, b_dir) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
        }
    });

    Ok(entries)
}

fn classify(name: &str, is_dir: bool) -> (&'static str, &'static str) {
    if is_dir {
        return ("folder", "文件夹");
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" => ("image", "JPEG 图像"),
        "png" => ("image", "PNG 图像"),
        "gif" => ("image", "GIF 图像"),
        "webp" => ("image", "WebP 图像"),
        "bmp" => ("image", "BMP 图像"),
        "ico" | "cur" => ("image", "图标"),
        "svg" => ("image", "SVG 图像"),
        "txt" | "md" | "rtf" => ("document", "文稿"),
        "pdf" => ("document", "PDF 文稿"),
        "doc" | "docx" => ("document", "Word 文稿"),
        "xls" | "xlsx" => ("document", "电子表格"),
        "ppt" | "pptx" => ("document", "演示文稿"),
        "dmg" | "iso" | "img" => ("disk", "磁盘映像"),
        _ => ("file", "文件"),
    }
}

pub(crate) fn format_bytes_pub(bytes: u64) -> String {
    format_bytes(bytes)
}

pub(crate) fn format_system_time_pub(time: SystemTime) -> Option<String> {
    format_system_time(time)
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 5] = ["字节", "KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} 字节");
    }
    let mut value = bytes as f64;
    let mut unit = 0usize;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if value >= 100.0 {
        format!("{value:.0} {}", UNITS[unit])
    } else if value >= 10.0 {
        format!("{value:.1} {}", UNITS[unit])
    } else {
        format!("{value:.2} {}", UNITS[unit])
    }
}

fn format_system_time(time: SystemTime) -> Option<String> {
    #[cfg(windows)]
    {
        format_windows_local(time)
    }
    #[cfg(not(windows))]
    {
        let _ = time;
        None
    }
}

#[cfg(windows)]
fn format_windows_local(time: SystemTime) -> Option<String> {
    use std::mem::MaybeUninit;

    #[repr(C)]
    struct FileTime {
        dw_low_date_time: u32,
        dw_high_date_time: u32,
    }

    #[repr(C)]
    struct SystemTimeWin {
        w_year: u16,
        w_month: u16,
        w_day_of_week: u16,
        w_day: u16,
        w_hour: u16,
        w_minute: u16,
        w_second: u16,
        w_milliseconds: u16,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn FileTimeToLocalFileTime(
            lp_file_time: *const FileTime,
            lp_local_file_time: *mut FileTime,
        ) -> i32;
        fn FileTimeToSystemTime(
            lp_file_time: *const FileTime,
            lp_system_time: *mut SystemTimeWin,
        ) -> i32;
    }

    let duration = time.duration_since(SystemTime::UNIX_EPOCH).ok()?;
    let unix_secs = duration.as_secs();
    let unix_nanos = duration.subsec_nanos() as u64;
    // FILETIME: 100ns intervals since 1601-01-01
    let intervals = (unix_secs + 11_644_473_600) * 10_000_000 + unix_nanos / 100;
    let ft = FileTime {
        dw_low_date_time: (intervals & 0xFFFF_FFFF) as u32,
        dw_high_date_time: (intervals >> 32) as u32,
    };

    let mut local = MaybeUninit::<FileTime>::uninit();
    let mut st = MaybeUninit::<SystemTimeWin>::uninit();
    unsafe {
        if FileTimeToLocalFileTime(&ft, local.as_mut_ptr()) == 0 {
            return None;
        }
        if FileTimeToSystemTime(local.as_ptr(), st.as_mut_ptr()) == 0 {
            return None;
        }
        let st = st.assume_init();
        Some(format!(
            "{}年{}月{}日 {:02}:{:02}",
            st.w_year, st.w_month, st.w_day, st.w_hour, st.w_minute
        ))
    }
}
