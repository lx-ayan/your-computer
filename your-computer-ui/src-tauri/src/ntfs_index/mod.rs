//! NTFS MFT 内存索引（Everything 性能来源）
//!
//! 硬约束：
//! 1. FSCTL_ENUM_USN_DATA 读 MFT，禁止目录遍历作为主路径
//! 2. 只存 {file_id, parent_id, name}，路径按需沿 parent_id 回溯
//! 3. 查询为内存线性扫描（小写子串 / 多词 AND）
//! 4. 结果只拼装前 N 条路径

mod build;
mod query;
mod volume;

pub use build::{ensure_indexed, index_status, IndexManager};
pub use query::SearchHitOut;
pub use volume::{list_volumes, VolumeInfo};

use std::sync::RwLock;

pub static INDEX: RwLock<Option<IndexManager>> = RwLock::new(None);

pub fn with_manager<R>(f: impl FnOnce(&mut IndexManager) -> R) -> Result<R, String> {
    let mut guard = INDEX.write().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(IndexManager::new());
    }
    Ok(f(guard.as_mut().unwrap()))
}
