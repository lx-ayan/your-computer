//! 全盘文件名搜索 — NTFS MFT 内存索引（见 documents/everything-rust-prompt.md）

use crate::ntfs_index::{self, SearchHitOut};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub id: String,
    pub name: String,
    pub path: String,
    pub parent: String,
    pub kind: String,
    pub kind_label: String,
    pub size: String,
    pub opened_at: String,
    pub score: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_data_url: Option<String>,
}

impl From<SearchHitOut> for SearchHit {
    fn from(h: SearchHitOut) -> Self {
        Self {
            id: h.id,
            name: h.name,
            path: h.path,
            parent: h.parent,
            kind: h.kind,
            kind_label: h.kind_label,
            size: h.size,
            opened_at: h.opened_at,
            score: h.score,
            icon_data_url: None,
        }
    }
}

/// 回车触发；搜索全部已索引 NTFS 卷（首次会构建 MFT 索引，需管理员）
#[tauri::command]
pub fn search_drive(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>, String> {
    let q = query.trim().to_string();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let limit = limit.unwrap_or(200).clamp(20, 500) as usize;

    ntfs_index::with_manager(|mgr| {
        ntfs_index::ensure_indexed(mgr)?;
        let hits = mgr.search(&q, limit);
        Ok(hits.into_iter().map(SearchHit::from).collect())
    })?
}

/// 强制重建全部 NTFS 卷索引
#[tauri::command]
pub fn rebuild_search_index() -> Result<serde_json::Value, String> {
    ntfs_index::with_manager(|mgr| {
        mgr.rebuild_all()?;
        Ok(ntfs_index::index_status(mgr))
    })?
}

/// 索引状态（卷 / 条数 / 内存 / 警告）
#[tauri::command]
pub fn search_index_status() -> Result<serde_json::Value, String> {
    ntfs_index::with_manager(|mgr| Ok(ntfs_index::index_status(mgr)))?
}

#[tauri::command]
pub fn list_search_volumes() -> Result<Vec<ntfs_index::VolumeInfo>, String> {
    ntfs_index::list_volumes()
}
