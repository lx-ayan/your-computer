use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathResult {
    pub path: String,
    pub name: String,
}

fn unique_name(parent: &Path, base: &str) -> PathBuf {
    let candidate = parent.join(base);
    if !candidate.exists() {
        return candidate;
    }
    let path = Path::new(base);
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(base);
    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    for i in 2..10_000 {
        let name = format!("{stem} {i}{ext}");
        let p = parent.join(&name);
        if !p.exists() {
            return p;
        }
    }
    parent.join(format!("{stem}-copy{ext}"))
}

fn path_result(p: PathBuf) -> PathResult {
    let name = p
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    PathResult {
        path: p.to_string_lossy().to_string(),
        name,
    }
}

#[tauri::command]
pub fn create_folder(parent: String, name: Option<String>) -> Result<PathResult, String> {
    let parent_path = PathBuf::from(&parent);
    if !parent_path.is_dir() {
        return Err(format!("不是有效目录: {parent}"));
    }
    let base = name.unwrap_or_else(|| "新建文件夹".into());
    let target = unique_name(&parent_path, &base);
    fs::create_dir(&target).map_err(|e| format!("创建文件夹失败: {e}"))?;
    crate::fs_list::invalidate_dir_cache(&parent);
    Ok(path_result(target))
}

#[tauri::command]
pub fn create_file(parent: String, name: Option<String>) -> Result<PathResult, String> {
    let parent_path = PathBuf::from(&parent);
    if !parent_path.is_dir() {
        return Err(format!("不是有效目录: {parent}"));
    }
    let base = name.unwrap_or_else(|| "新建文稿.txt".into());
    let target = unique_name(&parent_path, &base);
    fs::File::create(&target).map_err(|e| format!("创建文件失败: {e}"))?;
    crate::fs_list::invalidate_dir_cache(&parent);
    Ok(path_result(target))
}

#[tauri::command]
pub fn rename_path(path: String, new_name: String) -> Result<PathResult, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    let new_name = new_name.trim();
    if new_name.is_empty() {
        return Err("名称不能为空".into());
    }
    if new_name.contains(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
        return Err("名称包含非法字符".into());
    }
    let parent = src.parent().ok_or("无法获取父目录")?;
    let dest = parent.join(new_name);
    if dest.exists() {
        return Err("目标名称已存在".into());
    }
    fs::rename(&src, &dest).map_err(|e| format!("重命名失败: {e}"))?;
    crate::fs_list::invalidate_dir_cache(&path);
    Ok(path_result(dest))
}

#[tauri::command]
pub fn duplicate_path(path: String) -> Result<PathResult, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    let parent = src.parent().ok_or("无法获取父目录")?;
    let name = src
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("无效文件名")?;
    let stem = Path::new(name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or(name);
    let ext = Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|e| format!(".{e}"))
        .unwrap_or_default();
    let copy_name = format!("{stem} 的副本{ext}");
    let dest = unique_name(parent, &copy_name);
    copy_any(&src, &dest)?;
    crate::fs_list::invalidate_dir_cache(&path);
    Ok(path_result(dest))
}

fn copy_any(src: &Path, dest: &Path) -> Result<(), String> {
    if src.is_dir() {
        copy_dir_recursive(src, dest)
    } else {
        fs::copy(src, dest)
            .map(|_| ())
            .map_err(|e| format!("复制失败: {e}"))
    }
}

fn copy_dir_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("创建目录失败: {e}"))?;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败: {e}"))? {
        let entry = entry.map_err(|e| format!("读取条目失败: {e}"))?;
        let from = entry.path();
        let to = dest.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else {
            fs::copy(&from, &to).map_err(|e| format!("复制失败: {e}"))?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn move_path(from: String, to_dir: String) -> Result<PathResult, String> {
    let src = PathBuf::from(&from);
    let dest_dir = PathBuf::from(&to_dir);
    if !src.exists() {
        return Err(format!("路径不存在: {from}"));
    }
    if !dest_dir.is_dir() {
        return Err(format!("目标不是目录: {to_dir}"));
    }
    let name = src
        .file_name()
        .ok_or("无效文件名")?
        .to_string_lossy()
        .to_string();
    let dest = unique_name(&dest_dir, &name);
    fs::rename(&src, &dest).or_else(|_| {
        copy_any(&src, &dest)?;
        remove_any(&src)
    })?;
    crate::fs_list::invalidate_dir_cache(&from);
    crate::fs_list::invalidate_dir_cache(&to_dir);
    Ok(path_result(dest))
}

#[tauri::command]
pub fn copy_into(from: String, to_dir: String) -> Result<PathResult, String> {
    let src = PathBuf::from(&from);
    let dest_dir = PathBuf::from(&to_dir);
    if !src.exists() {
        return Err(format!("路径不存在: {from}"));
    }
    if !dest_dir.is_dir() {
        return Err(format!("目标不是目录: {to_dir}"));
    }
    let name = src
        .file_name()
        .ok_or("无效文件名")?
        .to_string_lossy()
        .to_string();
    let dest = unique_name(&dest_dir, &name);
    copy_any(&src, &dest)?;
    crate::fs_list::invalidate_dir_cache(&to_dir);
    Ok(path_result(dest))
}

fn remove_any(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("删除失败: {e}"))
    } else {
        fs::remove_file(path).map_err(|e| format!("删除失败: {e}"))
    }
}

#[tauri::command]
pub fn trash_path(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        trash_windows(&path)?;
        crate::fs_list::invalidate_dir_cache(&path);
        crate::recycle_bin::invalidate_recycle_cache();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        remove_any(Path::new(&path))?;
        crate::fs_list::invalidate_dir_cache(&path);
        Ok(())
    }
}

#[cfg(windows)]
fn trash_windows(path: &str) -> Result<(), String> {
    // 通过 PowerShell 送入回收站
    let script = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic; \
         if (Test-Path -LiteralPath $p -PathType Container) {{ \
           [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') \
         }} else {{ \
           [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') \
         }}",
    );
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("$p = '{}'; {}", path.replace('\'', "''"), script),
        ])
        .output()
        .map_err(|e| format!("无法调用回收站: {e}"))?;
    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("移到废纸篓失败: {err}"));
    }
    Ok(())
}

#[tauri::command]
pub fn compress_zip(path: String) -> Result<PathResult, String> {
    let src = PathBuf::from(&path);
    if !src.exists() {
        return Err(format!("路径不存在: {path}"));
    }
    let parent = src.parent().ok_or("无法获取父目录")?;
    let stem = src
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("archive");
    let zip_name = format!("{stem}.zip");
    let dest = unique_name(parent, &zip_name);
    let dest_str = dest.to_string_lossy().to_string();
    let src_str = src.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        let output = Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Compress-Archive -LiteralPath '{}' -DestinationPath '{}' -Force",
                    src_str.replace('\'', "''"),
                    dest_str.replace('\'', "''")
                ),
            ])
            .output()
            .map_err(|e| format!("压缩失败: {e}"))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("压缩失败: {err}"));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (src_str, dest_str);
        return Err("当前平台暂不支持压缩".into());
    }

    crate::fs_list::invalidate_dir_cache(&path);
    Ok(path_result(dest))
}

#[tauri::command]
pub fn open_path(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("打开失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("当前平台暂不支持".into())
    }
}

#[tauri::command]
pub fn open_in_terminal(path: String) -> Result<(), String> {
    let dir = PathBuf::from(&path);
    let cwd = if dir.is_dir() {
        dir
    } else {
        dir.parent()
            .map(|p| p.to_path_buf())
            .unwrap_or(dir)
    };
    let cwd_str = cwd.to_string_lossy().to_string();

    #[cfg(windows)]
    {
        // 优先 Windows Terminal，失败则 cmd
        let wt = Command::new("wt")
            .args(["-d", &cwd_str])
            .spawn();
        if wt.is_err() {
            Command::new("cmd")
                .args(["/C", "start", "cmd", "/K", "cd", "/D", &cwd_str])
                .spawn()
                .map_err(|e| format!("打开终端失败: {e}"))?;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = cwd_str;
        Err("当前平台暂不支持".into())
    }
}

#[tauri::command]
pub fn reveal_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("打开资源管理器失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("当前平台暂不支持".into())
    }
}

#[tauri::command]
pub fn pin_quick_access(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let script = format!(
            "$shell = New-Object -ComObject Shell.Application; \
             $folder = $shell.NameSpace('{}'); \
             if ($null -eq $folder) {{ throw 'path not found' }}; \
             $folder.Self.InvokeVerb('pintohome')",
            PathBuf::from(&path)
                .to_string_lossy()
                .replace('\'', "''")
        );
        let output = Command::new("powershell")
            .args(["-NoProfile", "-Command", &script])
            .output()
            .map_err(|e| format!("固定失败: {e}"))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("固定到快速访问失败: {err}"));
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("当前平台暂不支持".into())
    }
}

#[tauri::command]
pub fn share_path(path: String) -> Result<(), String> {
    // Windows 无统一简单 Share API，退化为在资源管理器中选中，便于用户共享
    reveal_in_explorer(path)
}

#[tauri::command]
pub fn open_with_picker(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;

        fn wide(s: &str) -> Vec<u16> {
            OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
        }

        #[link(name = "shell32")]
        unsafe extern "system" {
            fn ShellExecuteW(
                hwnd: *mut core::ffi::c_void,
                lp_operation: *const u16,
                lp_file: *const u16,
                lp_parameters: *const u16,
                lp_directory: *const u16,
                n_show_cmd: i32,
            ) -> isize;
        }

        // Shell verb "openas" → 系统「打开方式」对话框
        let op = wide("openas");
        let file = wide(&path);
        let ret = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1, // SW_SHOWNORMAL
            )
        };
        if ret > 32 {
            return Ok(());
        }

        let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let open_with = format!("{system_root}\\System32\\OpenWith.exe");
        if Command::new(&open_with).arg(&path).spawn().is_ok() {
            return Ok(());
        }
        Command::new("rundll32.exe")
            .arg("shell32.dll,OpenAs_RunDLL")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("打开方式失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err("当前平台暂不支持".into())
    }
}

/// 判断路径是否为已存在的普通文件（用于最近打开等列表清理）
#[tauri::command]
pub fn path_exists(path: String) -> Result<bool, String> {
    let p = PathBuf::from(&path);
    Ok(p.is_file())
}

/// 读取文本文件（UTF-8；失败时按有损解码）
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("不是文件".into());
    }
    let bytes = fs::read(&p).map_err(|e| format!("读取失败: {e}"))?;
    if bytes.len() > 32 * 1024 * 1024 {
        return Err("文件过大（上限 32MB）".into());
    }
    match String::from_utf8(bytes.clone()) {
        Ok(s) => Ok(s),
        Err(_) => Ok(String::from_utf8_lossy(&bytes).into_owned()),
    }
}

/// 写入文本文件（UTF-8）
#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err("目标目录不存在".into());
        }
    }
    fs::write(&p, content.as_bytes()).map_err(|e| format!("写入失败: {e}"))
}

/// 读取任意文件为 base64（编辑器用）
#[tauri::command]
pub fn read_file_base64(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("不是文件".into());
    }
    let bytes = fs::read(&p).map_err(|e| format!("读取失败: {e}"))?;
    if bytes.len() > 64 * 1024 * 1024 {
        return Err("文件过大（上限 64MB）".into());
    }
    Ok(crate::icons::base64_encode(&bytes))
}

/// 将 base64 写入文件
#[tauri::command]
pub fn write_file_base64(path: String, data_base64: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err("目标目录不存在".into());
        }
    }
    let bytes = crate::icons::base64_decode(&data_base64)
        .map_err(|e| format!("解码失败: {e}"))?;
    fs::write(&p, bytes).map_err(|e| format!("写入失败: {e}"))
}

/// 打开文件对话框（可多选）
#[tauri::command]
pub fn pick_open_files() -> Result<Vec<String>, String> {
    let files = rfd::FileDialog::new()
        .add_filter("Word 文档", &["docx"])
        .add_filter("文本", &["txt", "md", "html", "htm"])
        .add_filter("所有文件", &["*"])
        .pick_files()
        .unwrap_or_default();
    Ok(files
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
}

/// 另存为对话框
#[tauri::command]
pub fn pick_save_file(default_name: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new().add_filter("Word 文档", &["docx"]);
    if let Some(name) = default_name.filter(|s| !s.is_empty()) {
        dialog = dialog.set_file_name(&name);
    } else {
        dialog = dialog.set_file_name("未命名.docx");
    }
    Ok(dialog
        .save_file()
        .map(|p| p.to_string_lossy().to_string()))
}

fn find_chromium_browser() -> Option<PathBuf> {
    const CANDIDATES: &[&str] = &[
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];
    CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
}

fn path_as_file_url(path: &Path) -> String {
    let abs = path
        .canonicalize()
        .unwrap_or_else(|_| path.to_path_buf());
    let mut s = abs.to_string_lossy().replace('\\', "/");
    // Windows canonicalize 可能带 \\?\ 前缀
    if let Some(stripped) = s.strip_prefix("//?/") {
        s = stripped.to_string();
    }
    // 非 ASCII 路径 percent-encode，避免 headless 打不开
    let encoded: String = s
        .chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '/' | ':' | '-' | '_' | '.' | '~' => {
                c.to_string()
            }
            _ => {
                let mut buf = [0u8; 4];
                c.encode_utf8(&mut buf)
                    .bytes()
                    .map(|b| format!("%{b:02X}"))
                    .collect()
            }
        })
        .collect();
    if encoded.starts_with('/') {
        format!("file://{encoded}")
    } else {
        format!("file:///{encoded}")
    }
}

#[cfg(windows)]
fn wide_null(s: &str) -> Vec<u16> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    OsStr::new(s)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

/// ShellExecuteW 动词（print / open）。返回值 > 32 表示成功。
#[cfg(windows)]
fn shell_execute(verb: &str, file: &Path, params: Option<&str>) -> bool {
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(
            hwnd: *mut core::ffi::c_void,
            lp_operation: *const u16,
            lp_file: *const u16,
            lp_parameters: *const u16,
            lp_directory: *const u16,
            n_show_cmd: i32,
        ) -> isize;
    }
    let op = wide_null(verb);
    let path = wide_null(&file.to_string_lossy());
    let params_w = params.map(wide_null);
    let ret = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            path.as_ptr(),
            params_w
                .as_ref()
                .map(|v| v.as_ptr())
                .unwrap_or(std::ptr::null()),
            std::ptr::null(),
            1, // SW_SHOWNORMAL
        )
    };
    ret > 32
}

/// 将 HTML 打印为无页眉页脚的 PDF，并调起系统打印。
/// 成功时返回提示文案（打印对话框 / 已打开 PDF）。
#[tauri::command]
pub fn print_html_document(html: String) -> Result<String, String> {
    use std::process::{Command, Stdio};
    use std::time::{Duration, Instant};

    let browser = find_chromium_browser().ok_or_else(|| {
        "未找到 Microsoft Edge 或 Chrome，无法打印".to_string()
    })?;

    // 独立目录 + 独立 profile，避免与正在运行的 Edge 冲突
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("your-computer-print-{stamp}"));
    let profile = dir.join("profile");
    fs::create_dir_all(&profile).map_err(|e| format!("创建临时目录失败: {e}"))?;
    let html_path = dir.join("document.html");
    let pdf_path = dir.join("document.pdf");

    fs::write(&html_path, html.as_bytes()).map_err(|e| format!("写入 HTML 失败: {e}"))?;

    let file_url = path_as_file_url(&html_path);
    let pdf_arg = format!("--print-to-pdf={}", pdf_path.to_string_lossy());
    let profile_arg = format!("--user-data-dir={}", profile.to_string_lossy());

    let run_headless = |headless: &str| -> Result<std::process::ExitStatus, String> {
        Command::new(&browser)
            .args([
                headless,
                "--disable-gpu",
                "--disable-extensions",
                "--no-first-run",
                "--no-default-browser-check",
                "--allow-file-access-from-files",
                "--no-pdf-header-footer",
                &profile_arg,
                &pdf_arg,
                &file_url,
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map_err(|e| format!("启动浏览器失败: {e}"))
    };

    let status = run_headless("--headless=new")?;
    if !status.success() {
        let status2 = run_headless("--headless")?;
        if !status2.success() {
            return Err("生成打印 PDF 失败（Edge/Chrome headless）".into());
        }
    }

    let deadline = Instant::now() + Duration::from_secs(20);
    loop {
        if pdf_path.is_file() {
            if let Ok(meta) = fs::metadata(&pdf_path) {
                if meta.len() > 0 {
                    break;
                }
            }
        }
        if Instant::now() >= deadline {
            return Err("生成打印 PDF 超时".into());
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    #[cfg(windows)]
    {
        // 1) 系统「打印」动词
        if shell_execute("print", &pdf_path, None) {
            return Ok("已调起系统打印".into());
        }
        // 2) 部分机器 .pdf 未注册 print：对 HTML 再试
        if shell_execute("print", &html_path, None) {
            return Ok("已调起系统打印".into());
        }
        // 3) 用 Edge 打开无页眉 PDF（可 Ctrl+P）
        let pdf_str = pdf_path.to_string_lossy().to_string();
        if Command::new(&browser)
            .arg(&pdf_str)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .is_ok()
        {
            return Ok("已打开 PDF，请按 Ctrl+P 打印".into());
        }
        // 4) open 动词兜底
        if shell_execute("open", &pdf_path, None) {
            return Ok("已打开 PDF，请按 Ctrl+P 打印".into());
        }
        return Err(
            "已生成 PDF，但无法调起打印。请手动打开临时目录中的 document.pdf".into(),
        );
    }

    #[cfg(not(windows))]
    {
        let _ = (browser, pdf_path);
        Err("当前平台暂不支持系统打印".into())
    }
}

/// 读取本地图片为 data URL（供设置头像等选用）
#[tauri::command]
pub fn read_image_data_url(path: String) -> Result<String, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("不是文件".into());
    }
    let ext = p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    // .ico / .cur：浏览器常把透明画成黑底；走外壳解码成带 alpha 的 PNG
    if matches!(ext.as_str(), "ico" | "cur") {
        #[cfg(windows)]
        {
            if let Some(url) = crate::icons::shell_icon_data_url(&p) {
                return Ok(url);
            }
        }
        return Err("无法解析该图标文件".into());
    }
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return Err("请选择图片文件（jpg / png / gif / webp / bmp / ico）".into()),
    };
    let bytes = fs::read(&p).map_err(|e| format!("读取失败: {e}"))?;
    if bytes.len() > 16 * 1024 * 1024 {
        return Err("图片过大（上限 16MB）".into());
    }
    Ok(format!(
        "data:{mime};base64,{}",
        crate::icons::base64_encode(&bytes)
    ))
}

#[tauri::command]
pub fn open_ms_store_search(query: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let url = format!(
            "ms-windows-store://search/?query={}",
            urlencoding_light(&query)
        );
        Command::new("cmd")
            .args(["/C", "start", "", &url])
            .spawn()
            .map_err(|e| format!("打开 Store 失败: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = query;
        Err("当前平台暂不支持".into())
    }
}

fn urlencoding_light(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
