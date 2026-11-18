use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriveInfo {
    /// 侧栏 id，如 drive-c
    pub id: String,
    /// 盘符字母，如 C
    pub letter: String,
    /// 卷标；为空时前端显示「本地磁盘」
    pub name: String,
    /// 根路径，如 C:\
    pub path: String,
    /// 总容量（字节）
    pub total_bytes: u64,
    /// 可用空间（字节）
    pub available_bytes: u64,
}

#[tauri::command]
pub fn list_drives() -> Result<Vec<DriveInfo>, String> {
    #[cfg(windows)]
    {
        Ok(list_windows_drives())
    }
    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

#[cfg(windows)]
fn list_windows_drives() -> Vec<DriveInfo> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLogicalDrives() -> u32;
    }

    let mask = unsafe { GetLogicalDrives() };
    let mut drives = Vec::new();
    for i in 0..26u8 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i) as char;
        let path = format!("{}:\\", letter);
        // 未就绪的可移动介质仍会出现在掩码里，但根路径可能访问失败
        if !Path::new(&path).exists() {
            continue;
        }
        let name = volume_label(&path).unwrap_or_default();
        let (available_bytes, total_bytes) = disk_space(&path).unwrap_or((0, 0));
        drives.push(DriveInfo {
            id: format!("drive-{}", letter.to_ascii_lowercase()),
            letter: letter.to_string(),
            name,
            path,
            total_bytes,
            available_bytes,
        });
    }
    drives
}

#[cfg(windows)]
fn volume_label(root: &str) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetVolumeInformationW(
            lp_root_path_name: *const u16,
            lp_volume_name_buffer: *mut u16,
            n_volume_name_size: u32,
            lp_volume_serial_number: *mut u32,
            lp_maximum_component_length: *mut u32,
            lp_file_system_flags: *mut u32,
            lp_file_system_name_buffer: *mut u16,
            n_file_system_name_size: u32,
        ) -> i32;
    }

    let wide: Vec<u16> = OsStr::new(root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut name_buf = [0u16; 261];
    let ok = unsafe {
        GetVolumeInformationW(
            wide.as_ptr(),
            name_buf.as_mut_ptr(),
            name_buf.len() as u32,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
        )
    };
    if ok == 0 {
        return None;
    }
    let len = name_buf.iter().position(|&c| c == 0).unwrap_or(name_buf.len());
    let label = String::from_utf16_lossy(&name_buf[..len]).trim().to_string();
    if label.is_empty() {
        None
    } else {
        Some(label)
    }
}

#[cfg(windows)]
fn disk_space(root: &str) -> Option<(u64, u64)> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetDiskFreeSpaceExW(
            lp_directory_name: *const u16,
            lp_free_bytes_available_to_caller: *mut u64,
            lp_total_number_of_bytes: *mut u64,
            lp_total_number_of_free_bytes: *mut u64,
        ) -> i32;
    }

    let wide: Vec<u16> = OsStr::new(root)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut available = 0u64;
    let mut total = 0u64;
    let ok = unsafe {
        GetDiskFreeSpaceExW(
            wide.as_ptr(),
            &mut available,
            &mut total,
            std::ptr::null_mut(),
        )
    };
    if ok == 0 {
        None
    } else {
        Some((available, total))
    }
}
