//! M2：FSCTL_ENUM_USN_DATA 全量索引构建
//!
//! entries 按 file_id 作下标（填洞墓碑），父指针回溯为 O(1) 数组访问。

use super::query::{search_index, SearchHitOut};
use super::volume::{list_volumes, volume_device_path, VolumeInfo};
use std::time::Instant;

/// 单条文件记录，定长 32 字节
#[repr(C)]
#[derive(Clone, Copy)]
pub struct FileEntry {
    pub file_id: u64,
    pub parent_id: u64,
    pub name_off: u32,
    pub name_len: u32,
    pub flags: u8, // bit0=目录 bit1=墓碑
    pub _pad: [u8; 7],
}

impl FileEntry {
    pub const FLAG_DIR: u8 = 0x01;
    pub const FLAG_TOMB: u8 = 0x02;

    pub fn tombstone(id: u64) -> Self {
        Self {
            file_id: id,
            parent_id: 0,
            name_off: 0,
            name_len: 0,
            flags: Self::FLAG_TOMB,
            _pad: [0; 7],
        }
    }

    #[inline]
    pub fn is_dir(&self) -> bool {
        self.flags & Self::FLAG_DIR != 0
    }

    #[inline]
    pub fn is_tomb(&self) -> bool {
        self.flags & Self::FLAG_TOMB != 0
    }
}

pub struct Index {
    pub entries: Vec<FileEntry>,
    pub names: Vec<u8>,
    pub names_lower: Vec<u8>,
    pub root_id: u64,
    /// M4 USN 增量预留
    #[allow(dead_code)]
    pub usn_journal_id: u64,
    #[allow(dead_code)]
    pub next_usn: i64,
    pub volume: char,
    #[allow(dead_code)]
    pub built_at: Instant,
    pub entry_count: u64,
}

impl Index {
    pub fn mem_bytes(&self) -> usize {
        self.entries.capacity() * std::mem::size_of::<FileEntry>()
            + self.names.capacity()
            + self.names_lower.capacity()
    }
}

pub struct IndexManager {
    pub volumes: Vec<VolumeInfo>,
    pub indexes: Vec<Index>,
    pub compat_warn: Vec<String>,
    pub last_error: Option<String>,
}

impl IndexManager {
    pub fn new() -> Self {
        Self {
            volumes: Vec::new(),
            indexes: Vec::new(),
            compat_warn: Vec::new(),
            last_error: None,
        }
    }

    pub fn rebuild_all(&mut self) -> Result<(), String> {
        self.volumes = list_volumes()?;
        self.indexes.clear();
        self.compat_warn.clear();
        self.last_error = None;

        for vol in self.volumes.clone() {
            if !vol.ntfs {
                self.compat_warn.push(format!(
                    "{} 为 {}，兼容模式暂不索引（仅 NTFS 可走 MFT）",
                    vol.root, vol.fs_name
                ));
                continue;
            }
            match build_ntfs_index(vol.letter) {
                Ok(idx) => self.indexes.push(idx),
                Err(e) => {
                    let msg = format!("{} 索引失败 — {e}", vol.root);
                    self.compat_warn.push(msg.clone());
                    self.last_error = Some(msg);
                }
            }
        }
        if self.indexes.is_empty() {
            return Err(self.last_error.clone().unwrap_or_else(|| {
                "没有可用的 NTFS 索引。请以管理员身份运行本应用以读取卷 MFT。".into()
            }));
        }
        Ok(())
    }

    pub fn search(&self, query: &str, limit: usize) -> Vec<SearchHitOut> {
        let mut all = Vec::new();
        for idx in &self.indexes {
            all.extend(search_index(idx, query, limit));
        }
        all.sort_by(|a, b| {
            b.score
                .cmp(&a.score)
                .then_with(|| a.name.len().cmp(&b.name.len()))
                .then_with(|| a.path.cmp(&b.path))
        });
        all.truncate(limit);
        all
    }

    pub fn total_entries(&self) -> u64 {
        self.indexes.iter().map(|i| i.entry_count).sum()
    }

    pub fn total_mem(&self) -> usize {
        self.indexes.iter().map(|i| i.mem_bytes()).sum()
    }
}

pub fn ensure_indexed(mgr: &mut IndexManager) -> Result<(), String> {
    if mgr.indexes.is_empty() {
        mgr.rebuild_all()?;
    }
    Ok(())
}

pub fn index_status(mgr: &IndexManager) -> serde_json::Value {
    serde_json::json!({
        "volumes": mgr.volumes,
        "indexedVolumes": mgr.indexes.iter().map(|i| format!("{}:", i.volume)).collect::<Vec<_>>(),
        "entryCount": mgr.total_entries(),
        "memBytes": mgr.total_mem(),
        "warnings": mgr.compat_warn,
        "lastError": mgr.last_error,
    })
}

const FSCTL_ENUM_USN_DATA: u32 = 0x000900B3;
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x00000010;
const MFT_INDEX_MASK: u64 = 0x0000_FFFF_FFFF_FFFF;
const NTFS_ROOT_ID: u64 = 5;

#[repr(C)]
struct MftEnumDataV0 {
    start_file_reference_number: u64,
    low_usn: i64,
    high_usn: i64,
}

struct RawRec {
    file_id: u64,
    parent_id: u64,
    name: String,
    is_dir: bool,
}

#[cfg(windows)]
fn build_ntfs_index(letter: char) -> Result<Index, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, GENERIC_READ};
    use windows::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_READ, FILE_SHARE_WRITE,
        OPEN_EXISTING,
    };
    use windows::Win32::System::IO::DeviceIoControl;

    let device = volume_device_path(letter);
    let wide: Vec<u16> = device
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let handle = unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            GENERIC_READ.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    }
    .map_err(|e| {
        format!(
            "无法打开卷 {}（通常需要管理员权限）: {e} / last_os={:?}",
            letter,
            std::io::Error::last_os_error()
        )
    })?;

    let started = Instant::now();
    let mut raw: Vec<RawRec> = Vec::with_capacity(256_000);
    let mut start_ref: u64 = 0;
    let mut buf = vec![0u8; 8 << 20]; // 8MB 顺序读

    loop {
        let input = MftEnumDataV0 {
            start_file_reference_number: start_ref,
            low_usn: 0,
            high_usn: i64::MAX,
        };
        let mut returned = 0u32;
        let ok = unsafe {
            DeviceIoControl(
                handle,
                FSCTL_ENUM_USN_DATA,
                Some(std::ptr::from_ref(&input) as *const _),
                std::mem::size_of::<MftEnumDataV0>() as u32,
                Some(buf.as_mut_ptr() as *mut _),
                buf.len() as u32,
                Some(&mut returned),
                None,
            )
        };

        if ok.is_err() {
            let err = std::io::Error::last_os_error();
            let code = err.raw_os_error().unwrap_or(0);
            // ERROR_HANDLE_EOF = 38
            if code == 38 {
                break;
            }
            unsafe {
                let _ = CloseHandle(handle);
            }
            return Err(format!(
                "FSCTL_ENUM_USN_DATA 失败: {err} (GetLastError={code})"
            ));
        }
        if returned < 8 {
            break;
        }

        let next_start = u64::from_le_bytes(buf[0..8].try_into().unwrap());
        let mut off = 8usize;
        while off + 60 <= returned as usize {
            let rec_len =
                u32::from_le_bytes(buf[off..off + 4].try_into().unwrap()) as usize;
            if rec_len < 60 || off + rec_len > returned as usize {
                break;
            }
            let major = u16::from_le_bytes(buf[off + 4..off + 6].try_into().unwrap());
            if major != 2 && major != 3 {
                off += rec_len;
                continue;
            }
            let file_ref = u64::from_le_bytes(buf[off + 8..off + 16].try_into().unwrap());
            let parent_ref =
                u64::from_le_bytes(buf[off + 16..off + 24].try_into().unwrap());
            let attrs = u32::from_le_bytes(buf[off + 52..off + 56].try_into().unwrap());
            let name_len =
                u16::from_le_bytes(buf[off + 56..off + 58].try_into().unwrap()) as usize;
            let name_off =
                u16::from_le_bytes(buf[off + 58..off + 60].try_into().unwrap()) as usize;
            if name_off + name_len > rec_len {
                off += rec_len;
                continue;
            }
            let name_bytes = &buf[off + name_off..off + name_off + name_len];
            let u16s: Vec<u16> = name_bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            let name = String::from_utf16_lossy(&u16s);
            if name.is_empty() || name == "." || name == ".." {
                off += rec_len;
                continue;
            }
            raw.push(RawRec {
                file_id: file_ref & MFT_INDEX_MASK,
                parent_id: parent_ref & MFT_INDEX_MASK,
                name,
                is_dir: attrs & FILE_ATTRIBUTE_DIRECTORY != 0,
            });
            off += rec_len;
        }

        if next_start <= start_ref {
            break;
        }
        start_ref = next_start;
    }

    unsafe {
        let _ = CloseHandle(handle);
    }

    if raw.is_empty() {
        return Err("未读到任何 MFT 记录（权限不足或卷异常）".into());
    }

    let max_id = raw.iter().map(|r| r.file_id).max().unwrap_or(0);
    if max_id > 20_000_000 {
        return Err(format!("MFT 索引异常过大: max_id={max_id}"));
    }

    let mut entries = (0..=max_id)
        .map(FileEntry::tombstone)
        .collect::<Vec<_>>();
    let mut names = Vec::<u8>::with_capacity(raw.len() * 16);
    let mut names_lower = Vec::<u8>::with_capacity(raw.len() * 16);
    let mut live = 0u64;

    for rec in &raw {
        let idx = rec.file_id as usize;
        if idx >= entries.len() {
            continue;
        }
        let name_off = names.len() as u32;
        let bytes = rec.name.as_bytes();
        names.extend_from_slice(bytes);
        let lower = rec.name.to_lowercase();
        let lb = lower.as_bytes();
        // 保持与 names 相同的绝对布局：同 offset/len
        if names_lower.len() < name_off as usize {
            names_lower.resize(name_off as usize, 0);
        }
        if lb.len() == bytes.len() {
            names_lower.extend_from_slice(lb);
        } else {
            // Unicode 大小写变长：占位，查询走 fallback
            names_lower.extend(std::iter::repeat_n(0u8, bytes.len()));
        }

        let mut flags = 0u8;
        if rec.is_dir {
            flags |= FileEntry::FLAG_DIR;
        }
        entries[idx] = FileEntry {
            file_id: rec.file_id,
            parent_id: rec.parent_id,
            name_off,
            name_len: bytes.len() as u32,
            flags,
            _pad: [0; 7],
        };
        live += 1;
    }

    let elapsed = started.elapsed();
    let mem = entries.capacity() * 32 + names.capacity() + names_lower.capacity();
    eprintln!(
        "[ntfs_index] {letter}: live={live}, max_id={max_id}, mem≈{}MB, {elapsed:?}",
        mem / (1024 * 1024)
    );

    Ok(Index {
        entries,
        names,
        names_lower,
        root_id: NTFS_ROOT_ID,
        usn_journal_id: 0,
        next_usn: 0,
        volume: letter.to_ascii_uppercase(),
        built_at: Instant::now(),
        entry_count: live,
    })
}

#[cfg(not(windows))]
fn build_ntfs_index(_letter: char) -> Result<Index, String> {
    Err("仅 Windows 支持".into())
}
