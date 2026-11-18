//! 系统特殊目录、最近使用、开始菜单应用程序

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpecialEntry {
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

/// desktop | documents | downloads | recents
#[tauri::command]
pub fn get_special_folder(name: String) -> Result<String, String> {
    #[cfg(windows)]
    {
        let key = name.to_ascii_lowercase();
        let path = match key.as_str() {
            "desktop" => {
                known_folder_or_fallback(FOLDERID_DESKTOP, &["Desktop", "桌面"])?
            }
            "documents" => known_folder_or_fallback(
                FOLDERID_DOCUMENTS,
                &["Documents", "文档", "文稿"],
            )?,
            "downloads" => {
                known_folder_or_fallback(FOLDERID_DOWNLOADS, &["Downloads", "下载"])?
            }
            "recents" => recent_dir()?,
            other => return Err(format!("未知特殊目录: {other}")),
        };
        Ok(path)
    }
    #[cfg(not(windows))]
    {
        let _ = name;
        Err("仅 Windows 支持".into())
    }
}

#[tauri::command]
pub fn list_recents() -> Result<Vec<SpecialEntry>, String> {
    #[cfg(windows)]
    {
        list_recents_cached()
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[cfg(windows)]
struct RecentsCache {
    fingerprint: u64,
    entries: Vec<SpecialEntry>,
}

#[cfg(windows)]
static RECENTS_CACHE: std::sync::Mutex<Option<RecentsCache>> = std::sync::Mutex::new(None);

#[cfg(windows)]
fn recents_fingerprint(root: &Path) -> u64 {
    let Ok(read) = fs::read_dir(root) else {
        return 0;
    };
    let mut count: u64 = 0;
    let mut max_secs: u64 = 0;
    for item in read.flatten() {
        let name = item.file_name();
        let lower = name.to_string_lossy().to_ascii_lowercase();
        if !lower.ends_with(".lnk") {
            continue;
        }
        count += 1;
        if let Ok(meta) = item.metadata() {
            if let Ok(modified) = meta.modified() {
                if let Ok(dur) = modified.duration_since(SystemTime::UNIX_EPOCH) {
                    max_secs = max_secs.max(dur.as_secs());
                }
            }
        }
    }
    // ver=3: 40条 + PNG透明图标
    const VER: u64 = 3;
    count.wrapping_mul(1_000_000_007).wrapping_add(max_secs).wrapping_add(VER * 1_000_003)
}

#[cfg(windows)]
fn list_recents_cached() -> Result<Vec<SpecialEntry>, String> {
    let dir = recent_dir()?;
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Ok(Vec::new());
    }

    let fingerprint = recents_fingerprint(&root);
    if let Ok(guard) = RECENTS_CACHE.lock() {
        if let Some(cache) = guard.as_ref() {
            if cache.fingerprint == fingerprint {
                return Ok(cache.entries.clone());
            }
        }
    }

    let entries = list_recents_scan(&root)?;
    if let Ok(mut guard) = RECENTS_CACHE.lock() {
        *guard = Some(RecentsCache {
            fingerprint,
            entries: entries.clone(),
        });
    }
    Ok(entries)
}

#[cfg(windows)]
fn list_recents_scan(root: &Path) -> Result<Vec<SpecialEntry>, String> {
    struct Raw {
        lnk: PathBuf,
        name: String,
        modified: SystemTime,
        opened_at: String,
    }

    // 1) 轻量扫描：只收集 .lnk + mtime，不做解析/图标
    let mut raw = Vec::new();
    let read = fs::read_dir(root).map_err(|e| format!("无法读取最近使用: {e}"))?;
    for item in read.flatten() {
        let path = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        let lower = name.to_ascii_lowercase();
        if !lower.ends_with(".lnk") {
            continue;
        }
        let meta = item.metadata().ok();
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .unwrap_or(SystemTime::UNIX_EPOCH);
        let opened_at = format_time(modified).unwrap_or_else(|| "--".to_string());
        raw.push(Raw {
            lnk: path,
            name,
            modified,
            opened_at,
        });
    }

    raw.sort_by(|a, b| b.modified.cmp(&a.modified));
    // 多取一些以便按目标去重后仍够 40
    raw.truncate(80);

    // 2) 仅对候选解析；id 始终用 .lnk 路径保证唯一，避免前端 key 冲突「追加」
    let mut seen_targets = HashSet::new();
    let mut entries = Vec::new();
    for item in raw {
        let target = resolve_shortcut(&item.lnk).unwrap_or_else(|| item.lnk.clone());
        let target_key = target.to_string_lossy().to_ascii_lowercase();
        if !seen_targets.insert(target_key) {
            continue;
        }
        let display = strip_ext(&item.name, &[".lnk"]);
        let is_dir = target.is_dir();
        let (kind, kind_label) = if is_dir {
            ("folder", "文件夹")
        } else if is_app_file(&target) {
            ("file", "应用程序")
        } else {
            ("file", "文件")
        };
        let size = if is_dir {
            "--".to_string()
        } else {
            target
                .metadata()
                .map(|m| format_size(m.len()))
                .unwrap_or_else(|_| "--".to_string())
        };
        // 站内打开：目录用目标路径；文件仍打开 .lnk
        let open_path = if is_dir {
            target.clone()
        } else {
            item.lnk.clone()
        };
        let id = item.lnk.to_string_lossy().to_string();
        let open_str = open_path.to_string_lossy().to_string();
        // 文件夹用前端默认图标；其它取透明 PNG 外壳图标
        let icon = if is_dir {
            None
        } else {
            crate::icons::shell_icon_data_url(&item.lnk)
                .or_else(|| crate::icons::shell_icon_data_url(&target))
        };
        entries.push(SpecialEntry {
            id,
            name: display,
            kind: kind.into(),
            kind_label: kind_label.into(),
            opened_at: item.opened_at,
            size,
            path: open_str,
            icon_data_url: icon,
        });
        if entries.len() >= 40 {
            break;
        }
    }

    Ok(entries)
}

#[tauri::command]
pub fn list_applications() -> Result<Vec<SpecialEntry>, String> {
    #[cfg(windows)]
    {
        let mut roots = Vec::new();
        if let Ok(p) = known_folder_path(FOLDERID_COMMON_PROGRAMS) {
            roots.push(PathBuf::from(p));
        }
        if let Ok(p) = known_folder_path(FOLDERID_PROGRAMS) {
            roots.push(PathBuf::from(p));
        }
        if let Some(pd) = std::env::var_os("ProgramData") {
            roots.push(PathBuf::from(pd).join(r"Microsoft\Windows\Start Menu\Programs"));
        }
        if let Some(ad) = std::env::var_os("AppData") {
            roots.push(PathBuf::from(ad).join(r"Microsoft\Windows\Start Menu\Programs"));
        }

        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for root in roots {
            if root.is_dir() {
                collect_apps(&root, &mut seen, &mut out, 0);
            }
            if out.len() >= 300 {
                break;
            }
        }
        out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
        Ok(out)
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

fn strip_ext(name: &str, exts: &[&str]) -> String {
    let mut n = name.to_string();
    for e in exts {
        if n.to_ascii_lowercase().ends_with(&e.to_ascii_lowercase()) {
            n.truncate(n.len() - e.len());
            break;
        }
    }
    n
}

fn format_size(bytes: u64) -> String {
    crate::fs_list::format_bytes_pub(bytes)
}

fn format_time(time: SystemTime) -> Option<String> {
    crate::fs_list::format_system_time_pub(time)
}

#[cfg(windows)]
fn collect_apps(dir: &Path, seen: &mut HashSet<String>, out: &mut Vec<SpecialEntry>, depth: u8) {
    if depth > 6 || out.len() >= 300 {
        return;
    }
    let Ok(read) = fs::read_dir(dir) else {
        return;
    };
    for item in read.flatten() {
        if out.len() >= 300 {
            break;
        }
        let path = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_apps(&path, seen, out, depth + 1);
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if !(lower.ends_with(".lnk") || lower.ends_with(".exe")) {
            continue;
        }
        let display = strip_ext(&name, &[".lnk", ".exe"]);
        if !seen.insert(display.to_lowercase()) {
            continue;
        }
        let icon = crate::icons::shell_icon_data_url(&path);
        let size = path
            .metadata()
            .map(|m| format_size(m.len()))
            .unwrap_or_else(|_| "--".into());
        out.push(SpecialEntry {
            id: path.to_string_lossy().to_string(),
            name: display,
            kind: "file".into(),
            kind_label: "应用程序".into(),
            opened_at: "--".into(),
            size,
            path: path.to_string_lossy().to_string(),
            icon_data_url: icon,
        });
    }
}

#[cfg(windows)]
fn is_app_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            matches!(
                e.to_ascii_lowercase().as_str(),
                "exe" | "lnk" | "msi" | "bat" | "cmd"
            )
        })
        .unwrap_or(false)
}

#[cfg(windows)]
fn recent_dir() -> Result<String, String> {
    if let Ok(p) = known_folder_path(FOLDERID_RECENT) {
        return Ok(p);
    }
    let appdata = std::env::var("APPDATA").map_err(|_| "无 APPDATA".to_string())?;
    Ok(format!(r"{appdata}\Microsoft\Windows\Recent"))
}

#[cfg(windows)]
fn known_folder_or_fallback(id: GUID, names: &[&str]) -> Result<String, String> {
    if let Ok(p) = known_folder_path(id) {
        if Path::new(&p).is_dir() {
            return Ok(p);
        }
    }
    let home = std::env::var("USERPROFILE").map_err(|_| "无 USERPROFILE".to_string())?;
    for n in names {
        let p = PathBuf::from(&home).join(n);
        if p.is_dir() {
            return Ok(p.to_string_lossy().to_string());
        }
    }
    Ok(PathBuf::from(home)
        .join(names[0])
        .to_string_lossy()
        .to_string())
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
struct GUID {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

#[cfg(windows)]
const FOLDERID_DESKTOP: GUID = GUID {
    data1: 0xB4BFCC3A,
    data2: 0xDB2C,
    data3: 0x424C,
    data4: [0xB0, 0x29, 0x7F, 0xE9, 0x9A, 0x87, 0xC6, 0x41],
};
#[cfg(windows)]
const FOLDERID_DOCUMENTS: GUID = GUID {
    data1: 0xFDD39AD0,
    data2: 0x238F,
    data3: 0x46AF,
    data4: [0xAD, 0xB4, 0x6C, 0x85, 0x48, 0x03, 0x69, 0xC7],
};
#[cfg(windows)]
const FOLDERID_DOWNLOADS: GUID = GUID {
    data1: 0x374DE290,
    data2: 0x123F,
    data3: 0x4565,
    data4: [0x91, 0x64, 0x39, 0xC4, 0x92, 0x5E, 0x46, 0x7B],
};
#[cfg(windows)]
const FOLDERID_RECENT: GUID = GUID {
    data1: 0xAE50C081,
    data2: 0xEBD2,
    data3: 0x438A,
    data4: [0x86, 0x55, 0x8A, 0x09, 0x2E, 0x34, 0x98, 0x7A],
};
#[cfg(windows)]
const FOLDERID_PROGRAMS: GUID = GUID {
    data1: 0xA77F5D77,
    data2: 0x2E2B,
    data3: 0x44C3,
    data4: [0xA6, 0xA2, 0xAB, 0xA6, 0x01, 0x05, 0x4A, 0x51],
};
#[cfg(windows)]
const FOLDERID_COMMON_PROGRAMS: GUID = GUID {
    data1: 0x0139D44E,
    data2: 0x6AFE,
    data3: 0x49F2,
    data4: [0x86, 0x90, 0x3D, 0xAF, 0xCA, 0xE6, 0xFF, 0xB8],
};

#[cfg(windows)]
fn known_folder_path(id: GUID) -> Result<String, String> {
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn SHGetKnownFolderPath(
            rfid: *const GUID,
            dw_flags: u32,
            h_token: isize,
            ppsz_path: *mut *mut u16,
        ) -> i32;
    }
    #[link(name = "ole32")]
    unsafe extern "system" {
        fn CoTaskMemFree(pv: *mut core::ffi::c_void);
    }

    unsafe {
        let mut p: *mut u16 = core::ptr::null_mut();
        let hr = SHGetKnownFolderPath(&id, 0, 0, &mut p);
        if hr < 0 || p.is_null() {
            return Err(format!("SHGetKnownFolderPath failed: {hr:#x}"));
        }
        let mut len = 0usize;
        while *p.add(len) != 0 {
            len += 1;
        }
        let slice = std::slice::from_raw_parts(p, len);
        let s = String::from_utf16_lossy(slice);
        CoTaskMemFree(p as *mut _);
        Ok(s)
    }
}

/// 粗解析 .lnk：在文件尾部附近找绝对路径字符串（够用且无 COM）
#[cfg(windows)]
fn resolve_shortcut(lnk: &Path) -> Option<PathBuf> {
    let bytes = fs::read(lnk).ok()?;
    // 优先找盘符路径 ASCII / UTF-16LE
    if let Some(p) = find_drive_path_utf16(&bytes).or_else(|| find_drive_path_ascii(&bytes)) {
        let pb = PathBuf::from(&p);
        if pb.exists() {
            return Some(pb);
        }
    }
    None
}

#[cfg(windows)]
fn find_drive_path_ascii(bytes: &[u8]) -> Option<String> {
    for i in 0..bytes.len().saturating_sub(3) {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        let b2 = bytes[i + 2];
        if b0.is_ascii_alphabetic() && b1 == b':' && (b2 == b'\\' || b2 == b'/') {
            let mut end = i;
            while end < bytes.len() {
                let c = bytes[end];
                if c == 0 || c < 0x20 || c > 0x7E {
                    break;
                }
                end += 1;
            }
            let s = String::from_utf8_lossy(&bytes[i..end]).to_string();
            if s.len() >= 3 {
                return Some(s);
            }
        }
    }
    None
}

#[cfg(windows)]
fn find_drive_path_utf16(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 6 {
        return None;
    }
    let u16s: Vec<u16> = bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    for i in 0..u16s.len().saturating_sub(3) {
        let c0 = u16s[i];
        let c1 = u16s[i + 1];
        let c2 = u16s[i + 2];
        if (c0 >= b'A' as u16 && c0 <= b'Z' as u16 || c0 >= b'a' as u16 && c0 <= b'z' as u16)
            && c1 == b':' as u16
            && (c2 == b'\\' as u16 || c2 == b'/' as u16)
        {
            let mut end = i;
            while end < u16s.len() {
                let c = u16s[end];
                if c == 0 || c < 0x20 {
                    break;
                }
                end += 1;
            }
            if let Ok(s) = String::from_utf16(&u16s[i..end]) {
                if s.len() >= 3 {
                    return Some(s);
                }
            }
        }
    }
    None
}

/// 本机主要 IPv4（走 UDP 探测出口网卡，不实际发包）
#[tauri::command]
pub fn get_local_ip() -> Result<String, String> {
    use std::net::UdpSocket;
    let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| e.to_string())?;
    // 无需真正连通；系统会据此选择出站网卡
    socket
        .connect("8.8.8.8:80")
        .map_err(|e| e.to_string())?;
    let ip = socket
        .local_addr()
        .map_err(|e| e.to_string())?
        .ip();
    Ok(ip.to_string())
}
