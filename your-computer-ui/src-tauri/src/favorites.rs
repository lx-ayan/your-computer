//! 收藏 / 收藏夹 — SQLite 持久化

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct FavoritesDb(pub Mutex<Connection>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteFolder {
    pub id: i64,
    pub name: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteItem {
    pub id: i64,
    pub folder_id: i64,
    pub path: String,
    pub name: String,
    pub kind: String,
    pub kind_label: String,
}

fn db_file(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = match app.path().app_data_dir() {
        Ok(d) => d,
        Err(_) => {
            let base = std::env::var("LOCALAPPDATA")
                .or_else(|_| std::env::var("APPDATA"))
                .map_err(|e| format!("app data env: {e}"))?;
            PathBuf::from(base).join("your-computer-ui")
        }
    };
    fs::create_dir_all(&dir).map_err(|e| format!("create app data: {e}"))?;
    Ok(dir.join("favorites.db"))
}

pub fn init_db(app: &AppHandle) -> Result<FavoritesDb, String> {
    let path = db_file(app)?;
    let conn = Connection::open(&path).map_err(|e| format!("open db: {e}"))?;
    conn.execute_batch(
        r#"
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS favorite_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE TABLE IF NOT EXISTS favorites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          folder_id INTEGER NOT NULL REFERENCES favorite_folders(id) ON DELETE CASCADE,
          path TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'file',
          kind_label TEXT NOT NULL DEFAULT '文件',
          created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          UNIQUE(folder_id, path)
        );
        "#,
    )
    .map_err(|e| format!("migrate: {e}"))?;

    crate::tags::migrate_tags(&conn)?;

    // 确保至少有一个默认收藏夹
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM favorite_folders", [], |r| r.get(0))
        .unwrap_or(0);
    if count == 0 {
        conn.execute(
            "INSERT INTO favorite_folders (name, sort_order) VALUES (?1, 0)",
            params!["默认收藏夹"],
        )
        .map_err(|e| format!("seed folder: {e}"))?;
    }

    Ok(FavoritesDb(Mutex::new(conn)))
}

#[tauri::command]
pub fn list_favorite_folders(db: State<'_, FavoritesDb>) -> Result<Vec<FavoriteFolder>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, sort_order FROM favorite_folders ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok(FavoriteFolder {
                id: r.get(0)?,
                name: r.get(1)?,
                sort_order: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

#[tauri::command]
pub fn create_favorite_folder(
    db: State<'_, FavoritesDb>,
    name: String,
) -> Result<FavoriteFolder, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("收藏夹名称不能为空".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let next: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM favorite_folders",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO favorite_folders (name, sort_order) VALUES (?1, ?2)",
        params![name, next],
    )
    .map_err(|e| e.to_string())?;
    let id = conn.last_insert_rowid();
    Ok(FavoriteFolder {
        id,
        name,
        sort_order: next,
    })
}

#[tauri::command]
pub fn list_favorites(
    db: State<'_, FavoritesDb>,
    folder_id: Option<i64>,
) -> Result<Vec<FavoriteItem>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    if let Some(fid) = folder_id {
        let mut stmt = conn
            .prepare(
                "SELECT id, folder_id, path, name, kind, kind_label FROM favorites
                 WHERE folder_id = ?1 ORDER BY id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![fid], map_fav)
            .map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT id, folder_id, path, name, kind, kind_label FROM favorites
                 ORDER BY id DESC",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt.query_map([], map_fav).map_err(|e| e.to_string())?;
        for row in rows {
            out.push(row.map_err(|e| e.to_string())?);
        }
    }
    Ok(out)
}

fn map_fav(r: &rusqlite::Row<'_>) -> rusqlite::Result<FavoriteItem> {
    Ok(FavoriteItem {
        id: r.get(0)?,
        folder_id: r.get(1)?,
        path: r.get(2)?,
        name: r.get(3)?,
        kind: r.get(4)?,
        kind_label: r.get(5)?,
    })
}

#[tauri::command]
pub fn add_favorite(
    db: State<'_, FavoritesDb>,
    folder_id: i64,
    path: String,
    name: String,
    kind: String,
    kind_label: String,
) -> Result<FavoriteItem, String> {
    let path = path.trim().to_string();
    let name = name.trim().to_string();
    if path.is_empty() || name.is_empty() {
        return Err("路径或名称无效".into());
    }
    let kind = if kind.is_empty() {
        "file".into()
    } else {
        kind
    };
    let kind_label = if kind_label.is_empty() {
        "文件".into()
    } else {
        kind_label
    };

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    // 确认收藏夹存在
    let exists: Option<i64> = conn
        .query_row(
            "SELECT id FROM favorite_folders WHERE id = ?1",
            params![folder_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if exists.is_none() {
        return Err("收藏夹不存在".into());
    }

    conn.execute(
        "INSERT INTO favorites (folder_id, path, name, kind, kind_label)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(folder_id, path) DO UPDATE SET
           name = excluded.name,
           kind = excluded.kind,
           kind_label = excluded.kind_label",
        params![folder_id, path, name, kind, kind_label],
    )
    .map_err(|e| e.to_string())?;

    let id: i64 = conn
        .query_row(
            "SELECT id FROM favorites WHERE folder_id = ?1 AND path = ?2",
            params![folder_id, path],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;

    Ok(FavoriteItem {
        id,
        folder_id,
        path,
        name,
        kind,
        kind_label,
    })
}

#[tauri::command]
pub fn remove_favorite(db: State<'_, FavoritesDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM favorites WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn rename_favorite_folder(
    db: State<'_, FavoritesDb>,
    id: i64,
    name: String,
) -> Result<(), String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("名称不能为空".into());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE favorite_folders SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn delete_favorite_folder(db: State<'_, FavoritesDb>, id: i64) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM favorite_folders", [], |r| r.get(0))
        .map_err(|e| e.to_string())?;
    if count <= 1 {
        return Err("至少保留一个收藏夹".into());
    }
    conn.execute("DELETE FROM favorite_folders WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}
