use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInfo {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub kind: String,
    pub kind_label: String,
    pub size_bytes: u64,
    pub size_on_disk_bytes: u64,
    pub size_label: String,
    pub item_count: Option<u64>,
    pub location: String,
    pub created_at: String,
    pub modified_at: String,
    pub accessed_at: String,
    pub readonly: bool,
    pub hidden: bool,
}

#[tauri::command]
pub fn get_item_info(path: String) -> Result<ItemInfo, String> {
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    let meta = fs::metadata(&p).map_err(|e| format!("无法读取属性: {e}"))?;
    let is_dir = meta.is_dir();
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    let (size_bytes, size_on_disk_bytes, item_count) = if is_dir {
        let (bytes, count) = dir_stats(&p);
        // 磁盘占用按簇对齐粗略估算（4KB）
        let on_disk = ((bytes + 4095) / 4096) * 4096;
        (bytes, on_disk.max(bytes), Some(count))
    } else {
        let len = meta.len();
        let on_disk = allocation_size(&p).unwrap_or_else(|| ((len + 4095) / 4096) * 4096);
        (len, on_disk.max(len), None)
    };

    let (kind, kind_label) = classify_owned(&name, is_dir);
    let location = format_location(&p);
    let size_label = format_size_summary(size_bytes, size_on_disk_bytes, item_count);

    let (readonly, hidden) = file_attrs(&meta);

    Ok(ItemInfo {
        name,
        path,
        is_dir,
        kind,
        kind_label,
        size_bytes,
        size_on_disk_bytes,
        size_label,
        item_count,
        location,
        created_at: meta
            .created()
            .ok()
            .and_then(format_system_time)
            .unwrap_or_else(|| "--".into()),
        modified_at: meta
            .modified()
            .ok()
            .and_then(format_system_time)
            .unwrap_or_else(|| "--".into()),
        accessed_at: meta
            .accessed()
            .ok()
            .and_then(format_system_time)
            .unwrap_or_else(|| "--".into()),
        readonly,
        hidden,
    })
}

fn dir_stats(root: &Path) -> (u64, u64) {
    let mut bytes = 0u64;
    let mut count = 0u64;
    let mut stack = vec![root.to_path_buf()];
    // 防止扫整盘过久
    const MAX_ENTRIES: u64 = 50_000;

    while let Some(dir) = stack.pop() {
        let read = match fs::read_dir(&dir) {
            Ok(r) => r,
            Err(_) => continue,
        };
        for entry in read.flatten() {
            count += 1;
            if count > MAX_ENTRIES {
                return (bytes, count);
            }
            let path = entry.path();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                stack.push(path);
            } else {
                bytes = bytes.saturating_add(meta.len());
            }
        }
    }
    (bytes, count)
}

fn format_location(path: &Path) -> String {
    let parent = path.parent().unwrap_or(path);
    let mut parts: Vec<String> = Vec::new();
    for comp in parent.components() {
        use std::path::Component;
        match comp {
            Component::Prefix(p) => {
                let s = p.as_os_str().to_string_lossy().replace('\\', "");
                if !s.is_empty() {
                    parts.push(s);
                }
            }
            Component::RootDir => {}
            Component::Normal(s) => parts.push(s.to_string_lossy().to_string()),
            _ => {}
        }
    }
    if parts.is_empty() {
        parent.to_string_lossy().to_string()
    } else {
        parts.join(" › ")
    }
}

fn format_size_summary(bytes: u64, on_disk: u64, item_count: Option<u64>) -> String {
    let main = format_bytes_full(bytes);
    let disk = format_bytes_short(on_disk);
    match item_count {
        Some(n) => format!("{main}（磁盘上的 {disk}），共 {n} 个项目"),
        None => format!("{main}（磁盘上的 {disk}）"),
    }
}

fn format_bytes_full(bytes: u64) -> String {
    let s = bytes
        .to_string()
        .as_bytes()
        .rchunks(3)
        .rev()
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join(",");
    format!("{s} 字节")
}

fn format_bytes_short(bytes: u64) -> String {
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

fn classify_owned(name: &str, is_dir: bool) -> (String, String) {
    if is_dir {
        return ("folder".into(), "文件夹".into());
    }
    let ext = Path::new(name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let (kind, label) = match ext.as_str() {
        "jpg" | "jpeg" => ("image", "JPEG 图像"),
        "png" => ("image", "PNG 图像"),
        "gif" => ("image", "GIF 图像"),
        "webp" => ("image", "WebP 图像"),
        "txt" | "md" | "rtf" => ("document", "文稿"),
        "pdf" => ("document", "PDF 文稿"),
        "exe" => ("file", "应用程序"),
        "dll" => ("file", "应用程序扩展"),
        "zip" | "7z" | "rar" => ("file", "压缩文件"),
        "dmg" | "iso" => ("disk", "磁盘映像"),
        "" => ("file", "文件"),
        other => {
            return (
                "file".into(),
                format!("{} 文件", other.to_ascii_uppercase()),
            );
        }
    };
    (kind.into(), label.into())
}

fn file_attrs(meta: &fs::Metadata) -> (bool, bool) {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_READONLY: u32 = 0x1;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        let attrs = meta.file_attributes();
        (
            attrs & FILE_ATTRIBUTE_READONLY != 0,
            attrs & FILE_ATTRIBUTE_HIDDEN != 0,
        )
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        (false, false)
    }
}

#[cfg(windows)]
fn allocation_size(path: &Path) -> Option<u64> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetCompressedFileSizeW(lp_file_name: *const u16, lp_file_size_high: *mut u32) -> u32;
    }

    let wide: Vec<u16> = OsStr::new(path)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut high = 0u32;
    let low = unsafe { GetCompressedFileSizeW(wide.as_ptr(), &mut high) };
    if low == u32::MAX && high == 0 {
        return None;
    }
    Some(((high as u64) << 32) | low as u64)
}

#[cfg(not(windows))]
fn allocation_size(_path: &Path) -> Option<u64> {
    None
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
        let weekdays = ["日", "一", "二", "三", "四", "五", "六"];
        let wd = weekdays
            .get(st.w_day_of_week as usize)
            .copied()
            .unwrap_or("?");
        Some(format!(
            "{}年{}月{}日 星期{} {:02}:{:02}",
            st.w_year, st.w_month, st.w_day, wd, st.w_hour, st.w_minute
        ))
    }
}
