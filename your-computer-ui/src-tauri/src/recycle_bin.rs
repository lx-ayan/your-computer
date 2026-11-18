//! Windows 回收站：列举 / 还原 / 永久删除 / 清空
//! 列举与桌面/最近使用同理：指纹未变则直接返回缓存，不重扫。

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleEntry {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub kind_label: String,
    pub opened_at: String,
    pub size: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}

struct RecycleCache {
    fingerprint: u64,
    entries: Vec<RecycleEntry>,
}

static RECYCLE_CACHE: Mutex<Option<RecycleCache>> = Mutex::new(None);

/// 主动失效（移入/还原/删除/清空后调用）
pub fn invalidate_recycle_cache() {
    if let Ok(mut guard) = RECYCLE_CACHE.lock() {
        *guard = None;
    }
}

#[tauri::command]
pub fn list_recycle_bin() -> Result<Vec<RecycleEntry>, String> {
    #[cfg(windows)]
    {
        list_recycle_bin_cached()
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[tauri::command]
pub fn restore_recycle_bin_item(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        restore_recycle_item_fs(&path)?;
        invalidate_recycle_cache();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("仅 Windows 支持".into())
    }
}

#[tauri::command]
pub fn delete_recycle_bin_item(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        delete_recycle_item_fs(&path)?;
        invalidate_recycle_cache();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("仅 Windows 支持".into())
    }
}

#[tauri::command]
pub fn empty_recycle_bin() -> Result<(), String> {
    #[cfg(windows)]
    {
        empty_recycle_bin_windows()?;
        invalidate_recycle_cache();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        Err("仅 Windows 支持".into())
    }
}

/// 轻量指纹：各盘 $Recycle.Bin 下 SID 目录 mtime + $I 数量（不读内容、不抽图标）
#[cfg(windows)]
fn recycle_fingerprint() -> u64 {
    const VER: u64 = 2; // v2：列表不再内嵌外壳图标
    let mut count: u64 = 0;
    let mut max_ms: u64 = 0;
    let mut name_hash: u64 = 0xcbf2_9ce4_8422_2325;
    for root in recycle_roots() {
        if let Ok(meta) = fs::metadata(&root) {
            if let Ok(modified) = meta.modified() {
                if let Ok(dur) = modified.duration_since(UNIX_EPOCH) {
                    max_ms = max_ms.max(dur.as_millis() as u64);
                }
            }
        }
        let Ok(sids) = fs::read_dir(&root) else {
            continue;
        };
        for sid in sids.flatten() {
            let sid_path = sid.path();
            if !sid_path.is_dir() {
                continue;
            }
            if let Ok(meta) = fs::metadata(&sid_path) {
                if let Ok(modified) = meta.modified() {
                    if let Ok(dur) = modified.duration_since(UNIX_EPOCH) {
                        max_ms = max_ms.max(dur.as_millis() as u64);
                    }
                }
            }
            let Ok(files) = fs::read_dir(&sid_path) else {
                continue;
            };
            for item in files.flatten() {
                let name = item.file_name();
                let n = name.to_string_lossy();
                if !(n.starts_with("$I") || n.starts_with("$i")) {
                    continue;
                }
                count += 1;
                for b in n.as_bytes() {
                    name_hash ^= u64::from(*b);
                    name_hash = name_hash.wrapping_mul(0x1000_0000_01b3);
                }
            }
        }
    }
    count
        .wrapping_mul(1_000_000_007)
        .wrapping_add(max_ms.wrapping_mul(1_000_003))
        .wrapping_add(name_hash)
        .wrapping_add(VER * 9_007_199)
}

#[cfg(windows)]
fn list_recycle_bin_cached() -> Result<Vec<RecycleEntry>, String> {
    let fingerprint = recycle_fingerprint();
    if let Ok(guard) = RECYCLE_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.fingerprint == fingerprint {
                return Ok(cache.entries.clone());
            }
        }
    }

    let entries = list_recycle_bin_scan()?;
    if let Ok(mut guard) = RECYCLE_CACHE.lock() {
        *guard = Some(RecycleCache {
            fingerprint,
            entries: entries.clone(),
        });
    }
    Ok(entries)
}

#[cfg(windows)]
fn list_recycle_bin_scan() -> Result<Vec<RecycleEntry>, String> {
    let mut entries = Vec::new();
    for root in recycle_roots() {
        let Ok(sids) = fs::read_dir(&root) else {
            continue;
        };
        for sid in sids.flatten() {
            let sid_path = sid.path();
            if !sid_path.is_dir() {
                continue;
            }
            let Ok(files) = fs::read_dir(&sid_path) else {
                continue;
            };
            for item in files.flatten() {
                let name = item.file_name().to_string_lossy().to_string();
                if !name.starts_with("$I") && !name.starts_with("$i") {
                    continue;
                }
                let info_path = item.path();
                let Ok(bytes) = fs::read(&info_path) else {
                    continue;
                };
                let Some(meta) = parse_i_file(&bytes) else {
                    continue;
                };
                // $I… → $R…
                let r_name = if name.len() >= 2 {
                    format!("$R{}", &name[2..])
                } else {
                    continue;
                };
                let r_path = sid_path.join(&r_name);
                if !r_path.exists() {
                    continue;
                }
                let is_dir = r_path.is_dir();
                let display = Path::new(&meta.original_path)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| meta.original_path.clone());
                let (kind, kind_label) = if is_dir {
                    ("folder", "文件夹")
                } else {
                    classify_file(&display)
                };
                let size = if is_dir {
                    "--".to_string()
                } else if meta.file_size > 0 {
                    crate::fs_list::format_bytes_pub(meta.file_size)
                } else {
                    r_path
                        .metadata()
                        .map(|m| crate::fs_list::format_bytes_pub(m.len()))
                        .unwrap_or_else(|_| "--".into())
                };
                let opened_at = meta
                    .deleted_at
                    .and_then(crate::fs_list::format_system_time_pub)
                    .unwrap_or_else(|| "--".into());
                let open_str = r_path.to_string_lossy().to_string();
                // 与 list_dir 一致：列表不抽外壳图标，避免纸篓一大就卡
                entries.push(RecycleEntry {
                    id: open_str.clone(),
                    name: display,
                    kind: kind.into(),
                    kind_label: kind_label.into(),
                    opened_at,
                    size,
                    path: open_str,
                    original_path: Some(meta.original_path),
                    icon_data_url: None,
                });
            }
        }
    }

    entries.sort_by(|a, b| b.opened_at.cmp(&a.opened_at));
    // 限制数量，避免超大回收站卡顿
    entries.truncate(200);
    Ok(entries)
}

#[cfg(windows)]
struct RecycleMeta {
    file_size: u64,
    deleted_at: Option<SystemTime>,
    original_path: String,
}

#[cfg(windows)]
fn parse_i_file(bytes: &[u8]) -> Option<RecycleMeta> {
    if bytes.len() < 32 {
        return None;
    }
    let version = u64::from_le_bytes(bytes[0..8].try_into().ok()?);
    let file_size = u64::from_le_bytes(bytes[8..16].try_into().ok()?);
    let ft = u64::from_le_bytes(bytes[16..24].try_into().ok()?);
    let deleted_at = filetime_to_system_time(ft);

    let original_path = if version >= 2 {
        if bytes.len() < 28 {
            return None;
        }
        let chars = u32::from_le_bytes(bytes[24..28].try_into().ok()?) as usize;
        let byte_len = chars.saturating_mul(2);
        if bytes.len() < 28 + byte_len {
            return None;
        }
        let raw = &bytes[28..28 + byte_len];
        utf16_le_to_string(raw)
    } else {
        // version 1：固定 MAX_PATH UTF-16
        if bytes.len() < 24 + 520 {
            return None;
        }
        utf16_le_to_string(&bytes[24..24 + 520])
    };

    let original_path = original_path.trim_end_matches('\0').trim().to_string();
    if original_path.is_empty() {
        return None;
    }
    Some(RecycleMeta {
        file_size,
        deleted_at,
        original_path,
    })
}

#[cfg(windows)]
fn utf16_le_to_string(raw: &[u8]) -> String {
    let u16s: Vec<u16> = raw
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .take_while(|&c| c != 0)
        .collect();
    String::from_utf16_lossy(&u16s)
}

#[cfg(windows)]
fn filetime_to_system_time(ft: u64) -> Option<SystemTime> {
    // FILETIME: 100ns since 1601-01-01
    if ft == 0 {
        return None;
    }
    let unix_100ns = ft.saturating_sub(116_444_736_000_000_000);
    let secs = unix_100ns / 10_000_000;
    let nanos = ((unix_100ns % 10_000_000) * 100) as u32;
    Some(UNIX_EPOCH + Duration::new(secs, nanos))
}

#[cfg(windows)]
fn recycle_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for letter in b'A'..=b'Z' {
        let p = PathBuf::from(format!(r"{}:\$Recycle.Bin", letter as char));
        if p.is_dir() {
            roots.push(p);
        }
    }
    roots
}

#[cfg(windows)]
fn classify_file(name: &str) -> (&'static str, &'static str) {
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "ico" | "cur" | "svg" => ("image", "图像"),
        "txt" | "md" | "rtf" | "pdf" | "doc" | "docx" => ("document", "文稿"),
        "dmg" | "iso" | "img" => ("disk", "磁盘映像"),
        "exe" | "lnk" | "msi" => ("file", "应用程序"),
        _ => ("file", "文件"),
    }
}

/// 由 $R 路径找到同目录 $I 元数据文件
#[cfg(windows)]
fn pair_i_path(r_path: &Path) -> Option<PathBuf> {
    let name = r_path.file_name()?.to_string_lossy();
    if name.len() < 2 || !name.starts_with("$R") && !name.starts_with("$r") {
        return None;
    }
    let i_name = format!("$I{}", &name[2..]);
    let i_path = r_path.parent()?.join(i_name);
    if i_path.is_file() {
        Some(i_path)
    } else {
        None
    }
}

#[cfg(windows)]
fn restore_recycle_item_fs(r_path_str: &str) -> Result<(), String> {
    let r_path = PathBuf::from(r_path_str);
    if !r_path.exists() {
        return Err("回收站中未找到该项目".into());
    }
    let i_path = pair_i_path(&r_path).ok_or_else(|| "无法定位回收站元数据".to_string())?;
    let bytes = fs::read(&i_path).map_err(|e| format!("读取回收站元数据失败: {e}"))?;
    let meta = parse_i_file(&bytes).ok_or_else(|| "解析回收站元数据失败".to_string())?;
    let dest = PathBuf::from(&meta.original_path);

    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建还原目录: {e}"))?;
        }
    }

    // 目标已存在则加后缀避免覆盖
    let dest = unique_dest(&dest);

    if r_path.is_dir() {
        move_dir(&r_path, &dest)?;
    } else {
        fs::rename(&r_path, &dest)
            .or_else(|_| {
                fs::copy(&r_path, &dest)
                    .map(|_| ())
                    .and_then(|_| fs::remove_file(&r_path))
            })
            .map_err(|e| format!("还原失败: {e}"))?;
    }
    let _ = fs::remove_file(&i_path);
    Ok(())
}

#[cfg(windows)]
fn delete_recycle_item_fs(r_path_str: &str) -> Result<(), String> {
    let r_path = PathBuf::from(r_path_str);
    let i_path = pair_i_path(&r_path);
    if r_path.is_dir() {
        fs::remove_dir_all(&r_path).map_err(|e| format!("删除失败: {e}"))?;
    } else if r_path.is_file() {
        fs::remove_file(&r_path).map_err(|e| format!("删除失败: {e}"))?;
    } else if i_path.is_none() {
        return Err("回收站中未找到该项目".into());
    }
    if let Some(i) = i_path {
        let _ = fs::remove_file(i);
    }
    Ok(())
}

#[cfg(windows)]
fn unique_dest(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "restored".into());
    let ext = path
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy()))
        .unwrap_or_default();
    for i in 1..1000 {
        let candidate = parent.join(format!("{stem} 还原{i}{ext}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    parent.join(format!("{stem} 还原{ext}"))
}

#[cfg(windows)]
fn move_dir(src: &Path, dest: &Path) -> Result<(), String> {
    match fs::rename(src, dest) {
        Ok(()) => Ok(()),
        Err(_) => {
            copy_dir_recursive(src, dest)?;
            fs::remove_dir_all(src).map_err(|e| format!("还原后清理失败: {e}"))?;
            Ok(())
        }
    }
}

#[cfg(windows)]
fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("创建目录失败: {e}"))?;
    for item in fs::read_dir(src).map_err(|e| format!("读取目录失败: {e}"))? {
        let item = item.map_err(|e| format!("读取目录失败: {e}"))?;
        let from = item.path();
        let to = dest.join(item.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("复制失败: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(windows)]
fn empty_recycle_bin_windows() -> Result<(), String> {
    const SHERB_NOCONFIRMATION: u32 = 0x00000001;
    const SHERB_NOPROGRESSUI: u32 = 0x00000002;
    const SHERB_NOSOUND: u32 = 0x00000004;

    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHEmptyRecycleBinW(
            hwnd: isize,
            psz_root_path: *const u16,
            dw_flags: u32,
        ) -> i32;
    }

    unsafe {
        let hr = SHEmptyRecycleBinW(
            0,
            std::ptr::null(),
            SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI | SHERB_NOSOUND,
        );
        // S_OK=0, ERROR_NOT_FOUND / empty often 0x80070002 — 视为成功
        if hr == 0 || hr == -2147024894 {
            Ok(())
        } else {
            Err(format!("清空回收站失败: {hr:#x}"))
        }
    }
}
