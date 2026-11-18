use serde::Serialize;
use std::path::Path;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenWithApp {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[tauri::command]
pub fn list_open_with(path: String) -> Result<Vec<OpenWithApp>, String> {
    let p = Path::new(&path);
    if p.is_dir() {
        return Ok(Vec::new());
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| format!(".{}", e.to_ascii_lowercase()))
        .unwrap_or_default();

    let mut apps = Vec::new();

    #[cfg(windows)]
    {
        if let Some(name) = friendly_app_name(&ext) {
            apps.push(OpenWithApp {
                id: "default".into(),
                name,
                is_default: true,
            });
        }

        for (i, name) in open_with_list_from_registry(&ext).into_iter().enumerate() {
            if apps.iter().any(|a| a.name == name) {
                continue;
            }
            apps.push(OpenWithApp {
                id: format!("app-{i}"),
                name,
                is_default: false,
            });
        }
    }

    apps.push(OpenWithApp {
        id: "choose-another".into(),
        name: "选择其他应用…".into(),
        is_default: false,
    });
    apps.push(OpenWithApp {
        id: "ms-store".into(),
        name: "在 Microsoft Store 中查找应用".into(),
        is_default: false,
    });

    let _ = ext;
    Ok(apps)
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
    // S_FALSE (1) means buffer too small when querying length
    if len == 0 {
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

#[cfg(windows)]
fn open_with_list_from_registry(ext: &str) -> Vec<String> {
    use std::process::Command;

    if ext.is_empty() {
        return Vec::new();
    }
    // 读取资源管理器「打开方式」MRU 列表
    let key = format!(
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\{ext}\OpenWithList"
    );
    let output = Command::new("reg")
        .args(["query", &key])
        .output();
    let Ok(out) = output else {
        return Vec::new();
    };
    if !out.status.success() {
        return Vec::new();
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut names = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        // 形如: a    REG_SZ    notepad.exe
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() >= 3 && parts[1].eq_ignore_ascii_case("REG_SZ") {
            let val = parts[2..].join(" ");
            if val.eq_ignore_ascii_case("MRUList") || val.is_empty() {
                continue;
            }
            // 键名是 a/b/c；值是 exe 名
            if parts[0].len() == 1 {
                let display = val.trim_end_matches(".exe").trim_end_matches(".EXE");
                names.push(display.to_string());
            }
        }
    }
    names
}
