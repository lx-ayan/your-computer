//! M3：内存线性扫描 + 路径回溯

use super::build::{FileEntry, Index};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHitOut {
    pub id: String,
    pub name: String,
    pub path: String,
    pub parent: String,
    pub kind: String,
    pub kind_label: String,
    pub size: String,
    pub opened_at: String,
    pub score: i32,
}

pub fn search_index(index: &Index, query: &str, limit: usize) -> Vec<SearchHitOut> {
    let q = query.trim();
    if q.is_empty() || limit == 0 {
        return Vec::new();
    }
    // 多关键词 AND：空格分隔
    let keywords: Vec<String> = q
        .split_whitespace()
        .map(|s| s.to_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    if keywords.is_empty() {
        return Vec::new();
    }

    // 线性扫描 + 有限 top-N（按 score），路径只拼装入选条目
    let mut top: Vec<(i32, usize)> = Vec::with_capacity(limit + 1);
    for (i, ent) in index.entries.iter().enumerate() {
        if ent.is_tomb() || ent.name_len == 0 {
            continue;
        }
        let Some(score) = match_score(index, ent, &keywords) else {
            continue;
        };
        if top.len() < limit {
            top.push((score, i));
            if top.len() == limit {
                top.sort_unstable_by(|a, b| a.0.cmp(&b.0).then_with(|| b.1.cmp(&a.1)));
            }
        } else if score > top[0].0 || (score == top[0].0 && i < top[0].1) {
            top[0] = (score, i);
            // 恢复最小堆序（小顶）
            let mut j = 0;
            loop {
                let l = j * 2 + 1;
                let r = l + 1;
                let mut smallest = j;
                if l < top.len()
                    && (top[l].0 < top[smallest].0
                        || (top[l].0 == top[smallest].0 && top[l].1 > top[smallest].1))
                {
                    smallest = l;
                }
                if r < top.len()
                    && (top[r].0 < top[smallest].0
                        || (top[r].0 == top[smallest].0 && top[r].1 > top[smallest].1))
                {
                    smallest = r;
                }
                if smallest == j {
                    break;
                }
                top.swap(j, smallest);
                j = smallest;
            }
        }
    }
    top.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));

    let mut hits = Vec::with_capacity(top.len());
    for (score, i) in top {
        let ent = &index.entries[i];
        let name = name_of(index, ent);
        let path = match path_of(index, i as u64) {
            Some(p) => p,
            None => continue,
        };
        let path_str = path.to_string_lossy().to_string();
        let parent = path
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let (kind, kind_label) = if ent.is_dir() {
            ("folder", "文件夹")
        } else {
            ("file", "文件")
        };
        hits.push(SearchHitOut {
            id: path_str.clone(),
            name,
            path: path_str,
            parent,
            kind: kind.into(),
            kind_label: kind_label.into(),
            size: "--".into(),
            opened_at: "--".into(),
            score,
        });
    }
    hits
}

fn name_of(index: &Index, ent: &FileEntry) -> String {
    let start = ent.name_off as usize;
    let end = start + ent.name_len as usize;
    if end > index.names.len() {
        return String::new();
    }
    String::from_utf8_lossy(&index.names[start..end]).into_owned()
}

fn haystack(index: &Index, ent: &FileEntry) -> Option<String> {
    let start = ent.name_off as usize;
    let end = start + ent.name_len as usize;
    if end > index.names.len() {
        return None;
    }
    let raw = &index.names[start..end];
    let lower_ok = end <= index.names_lower.len()
        && index.names_lower[start..end].iter().any(|&b| b != 0);
    Some(if lower_ok {
        String::from_utf8_lossy(&index.names_lower[start..end]).into_owned()
    } else {
        String::from_utf8_lossy(raw).to_lowercase()
    })
}

fn match_score(index: &Index, ent: &FileEntry, keywords: &[String]) -> Option<i32> {
    let hay = haystack(index, ent)?;
    if !keywords.iter().all(|k| hay.contains(k.as_str())) {
        return None;
    }
    let primary = &keywords[0];
    let mut score = 10;
    if hay == *primary {
        score = 100;
    } else if hay.starts_with(primary.as_str()) {
        score = 80;
    } else if let Some(pos) = hay.find(primary.as_str()) {
        score = if pos == 0 { 80 } else { 40 };
    }
    // 短文件名略优先
    score += (32i32.saturating_sub(ent.name_len as i32)).max(0);
    Some(score)
}

/// 沿 parent_id 回溯拼路径；深度保护防环
pub fn path_of(index: &Index, id: u64) -> Option<PathBuf> {
    let mut parts: Vec<String> = Vec::new();
    let mut cur = id;
    let mut depth = 0u32;
    const MAX_DEPTH: u32 = 512;

    while depth < MAX_DEPTH {
        if cur as usize >= index.entries.len() {
            break;
        }
        let ent = &index.entries[cur as usize];
        if ent.is_tomb() && ent.name_len == 0 {
            break;
        }
        if cur == index.root_id {
            break;
        }
        let name = name_of(index, ent);
        if name.is_empty() {
            break;
        }
        parts.push(name);
        let parent = ent.parent_id;
        if parent == cur {
            break;
        }
        cur = parent;
        depth += 1;
    }

    parts.reverse();
    let mut path = PathBuf::from(format!("{}:\\", index.volume));
    for p in parts {
        path.push(p);
    }
    Some(path)
}
