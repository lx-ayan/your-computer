//! 文件/文件夹彩色标签

use crate::favorites::FavoritesDb;
use rusqlite::params;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTag {
    pub path: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaggedEntry {
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

pub fn migrate_tags(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS item_tags (
          path TEXT PRIMARY KEY COLLATE NOCASE,
          color TEXT NOT NULL
        );
        "#,
    )
    .map_err(|e| format!("migrate tags: {e}"))?;
    Ok(())
}

fn normalize_path(path: &str) -> String {
    path.trim().replace('/', "\\")
}

#[tauri::command]
pub fn list_item_tags(db: State<'_, FavoritesDb>) -> Result<Vec<ItemTag>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT path, color FROM item_tags")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ItemTag {
                path: r.get(0)?,
                color: r.get(1)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

/// color 为空字符串则清除标签
#[tauri::command]
pub fn set_item_tag(
    db: State<'_, FavoritesDb>,
    path: String,
    color: String,
) -> Result<(), String> {
    let path = normalize_path(&path);
    if path.is_empty() {
        return Err("路径为空".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let color = color.trim().to_string();
    if color.is_empty() {
        conn.execute("DELETE FROM item_tags WHERE path = ?1 COLLATE NOCASE", params![path])
            .map_err(|e| e.to_string())?;
        return Ok(());
    }
    conn.execute(
        "INSERT INTO item_tags (path, color) VALUES (?1, ?2)
         ON CONFLICT(path) DO UPDATE SET color = excluded.color",
        params![path, color],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// 按标签颜色筛出仍存在的文件/文件夹
#[tauri::command]
pub fn list_items_by_tag(
    db: State<'_, FavoritesDb>,
    color: String,
) -> Result<Vec<TaggedEntry>, String> {
    let color = color.trim().to_string();
    if color.is_empty() {
        return Ok(Vec::new());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT path FROM item_tags WHERE lower(color) = lower(?1)")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![color], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut entries = Vec::new();
    let mut missing = Vec::new();
    for row in rows {
        let path_str = row.map_err(|e| e.to_string())?;
        let path = PathBuf::from(&path_str);
        if !path.exists() {
            missing.push(path_str);
            continue;
        }
        let meta = match path.metadata() {
            Ok(m) => m,
            Err(_) => {
                missing.push(path_str);
                continue;
            }
        };
        let is_dir = meta.is_dir();
        let name = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| path_str.clone());
        let (kind, kind_label) = classify(&name, is_dir);
        let size = if is_dir {
            "--".to_string()
        } else {
            crate::fs_list::format_bytes_pub(meta.len())
        };
        let opened_at = meta
            .modified()
            .ok()
            .and_then(crate::fs_list::format_system_time_pub)
            .unwrap_or_else(|| "--".into());
        let icon_data_url = if is_dir {
            None
        } else {
            crate::icons::shell_icon_data_url(&path)
        };
        let open = path.to_string_lossy().to_string();
        entries.push(TaggedEntry {
            id: open.clone(),
            name,
            kind: kind.into(),
            kind_label: kind_label.into(),
            opened_at,
            size,
            path: open,
            icon_data_url,
        });
    }
    drop(stmt);

    // 清理已不存在的路径
    for p in missing {
        let _ = conn.execute(
            "DELETE FROM item_tags WHERE path = ?1 COLLATE NOCASE",
            params![p],
        );
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
        "jpg" | "jpeg" | "png" | "gif" | "webp" | "bmp" | "ico" | "cur" | "svg" => ("image", "图像"),
        "txt" | "md" | "rtf" | "pdf" | "doc" | "docx" => ("document", "文稿"),
        "dmg" | "iso" | "img" => ("disk", "磁盘映像"),
        "exe" | "lnk" | "msi" => ("file", "应用程序"),
        _ => ("file", "文件"),
    }
}
