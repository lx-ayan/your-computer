use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithApp {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

fn fallback_apps() -> Vec<OpenWithApp> {
    vec![
        OpenWithApp {
            id: "choose-another".into(),
            name: "选择其他应用…".into(),
            is_default: false,
        },
        OpenWithApp {
            id: "ms-store".into(),
            name: "在 Microsoft Store 中查找应用".into(),
            is_default: false,
        },
    ]
}

#[tauri::command]
pub fn list_open_with(path: String) -> Result<Vec<OpenWithApp>, String> {
    let p = Path::new(&path);
    if p.is_dir() {
        return Ok(fallback_apps());
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
        .unwrap_or_default();

    #[cfg(windows)]
    {
        // 打包后 spawn `reg.exe` 可能卡住；WinAPI + 超时避免「打开方式」一直加载中
        let ext_owned = ext.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::Builder::new()
            .name("list-open-with".into())
            .spawn(move || {
                let mut apps = Vec::new();
                if let Some(name) = friendly_app_name(&ext_owned) {
                    apps.push(OpenWithApp {
                        id: "default".into(),
                        name,
                        is_default: true,
                    });
                }
                for (i, name) in open_with_list_from_registry(&ext_owned)
                    .into_iter()
                    .enumerate()
                {
                    if apps.iter().any(|a| a.name.eq_ignore_ascii_case(&name)) {
                        continue;
                    }
                    apps.push(OpenWithApp {
                        id: format!("app-{i}"),
                        name,
                        is_default: false,
                    });
                }
                apps.extend(fallback_apps());
                let _ = tx.send(apps);
            })
            .map_err(|e| format!("spawn failed: {e}"))?;

        match rx.recv_timeout(Duration::from_millis(1200)) {
            Ok(apps) => Ok(apps),
            Err(_) => Ok(fallback_apps()),
        }
    }

    #[cfg(not(windows))]
    {
        let _ = ext;
        Ok(fallback_apps())
    }
}

#[cfg(windows)]
fn friendly_app_name(ext: &str) -> Option<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    const ASSOCSTR_FRIENDLYAPPNAME: u32 = 4;
    const ASSOCF_NONE: u32 = 0;

    #[link(name = "shlwapi")]
    unsafe extern "system" {
        fn AssocQueryStringW(
            flags: u32,
            str_type: u32,
            psz_assoc: *const u16,
            psz_extra: *const u16,
            psz_out: *mut u16,
            pcch_out: *mut u32,
        ) -> i32;
    }

    if ext.is_empty() {
        return None;
    }
    let assoc: Vec<u16> = OsStr::new(ext)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut len = 0u32;
    let hr = unsafe {
        AssocQueryStringW(
            ASSOCF_NONE,
            ASSOCSTR_FRIENDLYAPPNAME,
            assoc.as_ptr(),
            std::ptr::null(),
            std::ptr::null_mut(),
            &mut len,
        )
    };
    if len == 0 || len > 2048 {
        let _ = hr;
        return None;
    }
    let mut buf = vec![0u16; len as usize];
    let hr2 = unsafe {
        AssocQueryStringW(
            ASSOCF_NONE,
            ASSOCSTR_FRIENDLYAPPNAME,
            assoc.as_ptr(),
            std::ptr::null(),
            buf.as_mut_ptr(),
            &mut len,
        )
    };
    if hr2 < 0 {
        return None;
    }
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let name = String::from_utf16_lossy(&buf[..end]).trim().to_string();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// 直接读注册表 OpenWithList，避免打包后调用 reg.exe 卡住
#[cfg(windows)]
fn open_with_list_from_registry(ext: &str) -> Vec<String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumValueW, RegOpenKeyExW, HKEY_CURRENT_USER, KEY_READ, REG_SZ,
    };

    if ext.is_empty() {
        return Vec::new();
    }

    let sub = format!(
        r"Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{ext}\OpenWithList"
    );
    let sub_w: Vec<u16> = OsStr::new(&sub)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut hkey = Default::default();
    let open = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(sub_w.as_ptr()),
            Some(0),
            KEY_READ,
            &mut hkey,
        )
    };
    if open != ERROR_SUCCESS {
        return Vec::new();
    }

    let mut names = Vec::new();
    let mut index = 0u32;
    loop {
        let mut name_buf = [0u16; 64];
        let mut name_len = name_buf.len() as u32;
        let mut data_buf = [0u16; 260];
        let mut data_bytes = (data_buf.len() * 2) as u32;
        let mut ty = 0u32;

        let st = unsafe {
            RegEnumValueW(
                hkey,
                index,
                Some(windows::core::PWSTR(name_buf.as_mut_ptr())),
                &mut name_len,
                None,
                Some(&mut ty),
                Some(data_buf.as_mut_ptr() as *mut u8),
                Some(&mut data_bytes),
            )
        };
        if st != ERROR_SUCCESS {
            break;
        }
        index += 1;

        if ty != REG_SZ.0 {
            continue;
        }
        // 键名 a/b/c…；跳过 MRUList
        let key_name = String::from_utf16_lossy(&name_buf[..name_len as usize]);
        if key_name.len() != 1 {
            continue;
        }
        let nchars = (data_bytes as usize / 2).saturating_sub(1.min(data_bytes as usize / 2));
        let end = data_buf[..nchars.min(data_buf.len())]
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(nchars.min(data_buf.len()));
        let val = String::from_utf16_lossy(&data_buf[..end]).trim().to_string();
        if val.is_empty() || val.eq_ignore_ascii_case("MRUList") {
            continue;
        }
        let display = val
            .trim_end_matches(".exe")
            .trim_end_matches(".EXE")
            .to_string();
        if !display.is_empty() {
            names.push(display);
        }
    }

    unsafe {
        let _ = RegCloseKey(hkey);
    }
    names
}
