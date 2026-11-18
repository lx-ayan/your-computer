//! M1：卷枚举与文件系统检测

use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VolumeInfo {
    pub letter: char,
    pub root: String,
    pub fs_name: String,
    pub serial: u32,
    /// NTFS 可走 MFT 索引；其它为兼容模式（目录遍历）
    pub ntfs: bool,
}

#[cfg(windows)]
pub fn list_volumes() -> Result<Vec<VolumeInfo>, String> {
    use windows::Win32::Storage::FileSystem::GetLogicalDriveStringsW;

    let mut buf = vec![0u16; 512];
    let n = unsafe { GetLogicalDriveStringsW(Some(&mut buf)) };
    if n == 0 {
        return Err(format!(
            "GetLogicalDriveStringsW 失败: {:?}",
            std::io::Error::last_os_error()
        ));
    }
    let mut out = Vec::new();
    let mut i = 0usize;
    while i < n as usize {
        if buf[i] == 0 {
            break;
        }
        let start = i;
        while i < buf.len() && buf[i] != 0 {
            i += 1;
        }
        let drive: String = String::from_utf16_lossy(&buf[start..i]);
        i += 1; // skip NUL
        let letter = drive.chars().next().unwrap_or('?').to_ascii_uppercase();
        if !letter.is_ascii_alphabetic() {
            continue;
        }
        let root = format!("{}:\\", letter);
        let (fs_name, serial, ntfs) = volume_info(&root)?;
        out.push(VolumeInfo {
            letter,
            root,
            fs_name,
            serial,
            ntfs,
        });
    }
    Ok(out)
}

#[cfg(windows)]
fn volume_info(root: &str) -> Result<(String, u32, bool), String> {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetVolumeInformationW;

    let wide: Vec<u16> = root.encode_utf16().chain(std::iter::once(0)).collect();
    let mut fs_buf = [0u16; 64];
    let mut serial = 0u32;
    let ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(wide.as_ptr()),
            None,
            Some(&mut serial),
            None,
            None,
            Some(&mut fs_buf),
        )
    };
    if ok.is_err() {
        // 光驱未就绪等：标为不可索引
        return Ok(("UNKNOWN".into(), 0, false));
    }
    let end = fs_buf.iter().position(|&c| c == 0).unwrap_or(fs_buf.len());
    let fs_name = String::from_utf16_lossy(&fs_buf[..end]);
    let ntfs = fs_name.eq_ignore_ascii_case("NTFS");
    Ok((fs_name, serial, ntfs))
}

#[cfg(not(windows))]
pub fn list_volumes() -> Result<Vec<VolumeInfo>, String> {
    Ok(Vec::new())
}

#[cfg(windows)]
pub fn volume_device_path(letter: char) -> PathBuf {
    PathBuf::from(format!(r"\\.\{}:", letter.to_ascii_uppercase()))
}
