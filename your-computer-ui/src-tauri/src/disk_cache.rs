//! 列表持久缓存：进程退出后仍可用，指纹不变直接命中。

use serde::{de::DeserializeOwned, Serialize};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

static CACHE_ROOT: OnceLock<PathBuf> = OnceLock::new();

pub fn init(app_data: PathBuf) {
    let dir = app_data.join("list-cache");
    let _ = fs::create_dir_all(&dir);
    let _ = CACHE_ROOT.set(dir);
}

fn root() -> Option<&'static Path> {
    CACHE_ROOT.get().map(|p| p.as_path())
}

fn key_file(key: &str) -> Option<PathBuf> {
    let root = root()?;
    let mut h = std::collections::hash_map::DefaultHasher::new();
    key.hash(&mut h);
    Some(root.join(format!("{:016x}.json", h.finish())))
}

#[derive(Serialize, serde::Deserialize)]
struct Envelope<T> {
    fingerprint: u64,
    data: T,
}

pub fn load_if_match<T: DeserializeOwned>(key: &str, fingerprint: u64) -> Option<T> {
    let path = key_file(key)?;
    let raw = fs::read_to_string(path).ok()?;
    let env: Envelope<T> = serde_json::from_str(&raw).ok()?;
    if env.fingerprint == fingerprint {
        Some(env.data)
    } else {
        None
    }
}

/// 指纹不匹配时仍可读出旧数据（用于先上屏再后台刷新）
pub fn load_any<T: DeserializeOwned>(key: &str) -> Option<(u64, T)> {
    let path = key_file(key)?;
    let raw = fs::read_to_string(path).ok()?;
    let env: Envelope<T> = serde_json::from_str(&raw).ok()?;
    Some((env.fingerprint, env.data))
}

pub fn save<T: Serialize>(key: &str, fingerprint: u64, data: &T) {
    let Some(path) = key_file(key) else {
        return;
    };
    let env = Envelope { fingerprint, data };
    if let Ok(raw) = serde_json::to_string(&env) {
        let _ = fs::write(path, raw);
    }
}

pub fn remove(key: &str) {
    if let Some(path) = key_file(key) {
        let _ = fs::remove_file(path);
    }
}
