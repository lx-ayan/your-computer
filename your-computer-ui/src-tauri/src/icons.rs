//! Windows 外壳图标 → 透明 PNG data URL
//! 优先取 Jumbo / ExtraLarge，避免宫格把 32×32 放大发糊。

use serde::Serialize;
use std::path::{Path, PathBuf};

/// 提取文件外壳图标（文件夹请勿调用，前端用默认图标）
#[cfg(windows)]
pub fn shell_icon_data_url(path: &Path) -> Option<String> {
    if path.is_dir() {
        return None;
    }
    let hicon = extract_shell_hicon(path)?;
    let data = hicon_to_png_data_url(hicon.0 as isize);
    unsafe {
        let _ = windows::Win32::UI::WindowsAndMessaging::DestroyIcon(hicon);
    }
    data
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIconEntry {
    pub path: String,
    pub icon_data_url: String,
}

/// 按需批量取外壳图标（供前端可视区懒加载；单次限量）
#[tauri::command]
pub fn get_shell_icons(paths: Vec<String>) -> Vec<ShellIconEntry> {
    const MAX: usize = 48;
    let mut out = Vec::new();
    for raw in paths.into_iter().take(MAX) {
        let path = PathBuf::from(&raw);
        // 用 is_dir 排除文件夹即可；.lnk 等快捷方式在部分环境下 is_file 会误判
        if path.is_dir() {
            continue;
        }
        if let Some(icon_data_url) = shell_icon_data_url(&path) {
            out.push(ShellIconEntry {
                path: raw,
                icon_data_url,
            });
        }
    }
    out
}

/// 单路径取图标（兼容旧调用）
#[tauri::command]
pub fn get_shell_icon(path: String) -> Option<String> {
    shell_icon_data_url(Path::new(&path))
}

#[cfg(windows)]
fn extract_shell_hicon(path: &Path) -> Option<windows::Win32::UI::WindowsAndMessaging::HICON> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Controls::{IImageList, ILD_TRANSPARENT};
    use windows::Win32::UI::Shell::{
        SHGetFileInfoW, SHGetImageList, SHFILEINFOW, SHGFI_SYSICONINDEX, SHIL_EXTRALARGE,
        SHIL_JUMBO, SHIL_LARGE,
    };
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, HICON};

    let wide: Vec<u16> = path
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        let mut info = SHFILEINFOW::default();
        let ok = SHGetFileInfoW(
            PCWSTR(wide.as_ptr()),
            Default::default(),
            Some(&mut info),
            std::mem::size_of::<SHFILEINFOW>() as u32,
            SHGFI_SYSICONINDEX,
        );
        if ok == 0 {
            return None;
        }
        let index = info.iIcon;
        // SHGFI_SYSICONINDEX 也可能顺带返回 hIcon，先丢掉以免泄漏
        if !info.hIcon.is_invalid() {
            let _ = DestroyIcon(info.hIcon);
        }

        for size in [SHIL_JUMBO, SHIL_EXTRALARGE, SHIL_LARGE] {
            let list: IImageList = match SHGetImageList(size as i32) {
                Ok(v) => v,
                Err(_) => continue,
            };
            if let Ok(icon) = list.GetIcon(index, ILD_TRANSPARENT.0) {
                if !icon.is_invalid() {
                    return Some(icon);
                }
            }
        }
        let _ = HICON::default();
        None
    }
}

#[cfg(not(windows))]
pub fn shell_icon_data_url(_path: &Path) -> Option<String> {
    None
}

#[cfg(windows)]
fn hicon_to_png_data_url(hicon: isize) -> Option<String> {
    #[repr(C)]
    struct BitmapInfoHeader {
        bi_size: u32,
        bi_width: i32,
        bi_height: i32,
        bi_planes: u16,
        bi_bit_count: u16,
        bi_compression: u32,
        bi_size_image: u32,
        bi_x_pels_per_meter: i32,
        bi_y_pels_per_meter: i32,
        bi_clr_used: u32,
        bi_clr_important: u32,
    }
    #[repr(C)]
    struct BitmapInfo {
        bmi_header: BitmapInfoHeader,
        bmi_colors: [u32; 1],
    }

    #[link(name = "user32")]
    unsafe extern "system" {
        fn DrawIconEx(
            hdc: isize,
            x_left: i32,
            y_top: i32,
            h_icon: isize,
            cx_width: i32,
            cy_width: i32,
            istep_if_ani_cur: u32,
            hbr_flicker_free_draw: isize,
            di_flags: u32,
        ) -> i32;
        fn GetIconInfo(hicon: isize, piconinfo: *mut IconInfo) -> i32;
    }
    #[link(name = "gdi32")]
    unsafe extern "system" {
        fn CreateCompatibleDC(hdc: isize) -> isize;
        fn DeleteDC(hdc: isize) -> i32;
        fn SelectObject(hdc: isize, h: isize) -> isize;
        fn DeleteObject(ho: isize) -> i32;
        fn CreateDIBSection(
            hdc: isize,
            pbmi: *const BitmapInfo,
            usage: u32,
            ppv_bits: *mut *mut u8,
            h_section: isize,
            offset: u32,
        ) -> isize;
        fn GetDC(hwnd: isize) -> isize;
        fn ReleaseDC(hwnd: isize, hdc: isize) -> i32;
        fn GetObjectW(h: isize, c: i32, pv: *mut core::ffi::c_void) -> i32;
    }

    #[repr(C)]
    struct IconInfo {
        f_icon: i32,
        x_hotspot: u32,
        y_hotspot: u32,
        hbm_mask: isize,
        hbm_color: isize,
    }
    #[repr(C)]
    struct Bitmap {
        bm_type: i32,
        bm_width: i32,
        bm_height: i32,
        bm_width_bytes: i32,
        bm_planes: u16,
        bm_bits_pixel: u16,
        bm_bits: *mut core::ffi::c_void,
    }

    const DI_NORMAL: u32 = 0x0003;

    unsafe {
        let mut ii: IconInfo = core::mem::zeroed();
        if GetIconInfo(hicon, &mut ii) == 0 {
            return None;
        }
        let probe = if ii.hbm_color != 0 {
            ii.hbm_color
        } else {
            ii.hbm_mask
        };
        let mut bm: Bitmap = core::mem::zeroed();
        let mut w = 32i32;
        let mut h = 32i32;
        if probe != 0
            && GetObjectW(
                probe,
                core::mem::size_of::<Bitmap>() as i32,
                &mut bm as *mut _ as *mut _,
            ) != 0
        {
            w = bm.bm_width.clamp(1, 256);
            // 彩色位图高度为真实高度；掩码可能是双倍高度
            let bh = bm.bm_height.abs();
            h = if ii.hbm_color != 0 {
                bh.clamp(1, 256)
            } else {
                (bh / 2).clamp(1, 256)
            };
        }
        if ii.hbm_color != 0 {
            DeleteObject(ii.hbm_color);
        }
        if ii.hbm_mask != 0 {
            DeleteObject(ii.hbm_mask);
        }

        let mut bmi: BitmapInfo = core::mem::zeroed();
        bmi.bmi_header.bi_size = core::mem::size_of::<BitmapInfoHeader>() as u32;
        bmi.bmi_header.bi_width = w;
        bmi.bmi_header.bi_height = -h; // top-down
        bmi.bmi_header.bi_planes = 1;
        bmi.bmi_header.bi_bit_count = 32;
        bmi.bmi_header.bi_compression = 0;

        let screen = GetDC(0);
        let hdc = CreateCompatibleDC(screen);
        ReleaseDC(0, screen);
        if hdc == 0 {
            return None;
        }

        let mut bits_ptr: *mut u8 = core::ptr::null_mut();
        let dib = CreateDIBSection(hdc, &bmi, 0, &mut bits_ptr, 0, 0);
        if dib == 0 || bits_ptr.is_null() {
            DeleteDC(hdc);
            return None;
        }
        let old = SelectObject(hdc, dib);
        let px_count = (w as usize) * (h as usize);
        let slice = core::slice::from_raw_parts_mut(bits_ptr, px_count * 4);

        fn fill(slice: &mut [u8], v: u8) {
            for px in slice.chunks_exact_mut(4) {
                px[0] = v;
                px[1] = v;
                px[2] = v;
                px[3] = 255;
            }
        }

        fill(slice, 0);
        if DrawIconEx(hdc, 0, 0, hicon, w, h, 0, 0, DI_NORMAL) == 0 {
            SelectObject(hdc, old);
            DeleteObject(dib);
            DeleteDC(hdc);
            return None;
        }
        let on_black = slice.to_vec();

        fill(slice, 255);
        if DrawIconEx(hdc, 0, 0, hicon, w, h, 0, 0, DI_NORMAL) == 0 {
            SelectObject(hdc, old);
            DeleteObject(dib);
            DeleteDC(hdc);
            return None;
        }
        let on_white = slice.to_vec();

        SelectObject(hdc, old);
        DeleteObject(dib);
        DeleteDC(hdc);

        let mut rgba = Vec::with_capacity(px_count * 4);
        for (bpx, wpx) in on_black.chunks_exact(4).zip(on_white.chunks_exact(4)) {
            let a_b = 255i32 - (wpx[0] as i32 - bpx[0] as i32);
            let a_g = 255i32 - (wpx[1] as i32 - bpx[1] as i32);
            let a_r = 255i32 - (wpx[2] as i32 - bpx[2] as i32);
            let a = ((a_b + a_g + a_r) / 3).clamp(0, 255) as u8;
            if a < 8 {
                rgba.extend_from_slice(&[0, 0, 0, 0]);
                continue;
            }
            let unpremul = |c: u8, a: u8| -> u8 {
                if a == 0 {
                    0
                } else {
                    ((c as u32 * 255) / a as u32).min(255) as u8
                }
            };
            let r = unpremul(bpx[2], a);
            let g = unpremul(bpx[1], a);
            let b = unpremul(bpx[0], a);
            rgba.extend_from_slice(&[r, g, b, a]);
        }

        // Jumbo 常带大块透明边，裁掉后宫格里才会铺满且更清晰
        let (cw, ch, cropped) = crop_alpha(&rgba, w as u32, h as u32);
        let (ow, oh, out) = if cw.max(ch) > 128 {
            downsample_box(&cropped, cw, ch, 128)
        } else {
            (cw, ch, cropped)
        };

        let png = encode_png_rgba(ow, oh, &out)?;
        Some(format!(
            "data:image/png;base64,{}",
            base64_encode(&png)
        ))
    }
}

/// 裁透明边（阈值 1px）
fn crop_alpha(rgba: &[u8], w: u32, h: u32) -> (u32, u32, Vec<u8>) {
    let w = w as usize;
    let h = h as usize;
    if w == 0 || h == 0 || rgba.len() < w * h * 4 {
        return (w as u32, h as u32, rgba.to_vec());
    }
    let mut min_x = w;
    let mut min_y = h;
    let mut max_x = 0usize;
    let mut max_y = 0usize;
    for y in 0..h {
        for x in 0..w {
            let a = rgba[(y * w + x) * 4 + 3];
            if a > 16 {
                min_x = min_x.min(x);
                min_y = min_y.min(y);
                max_x = max_x.max(x);
                max_y = max_y.max(y);
            }
        }
    }
    if min_x > max_x || min_y > max_y {
        return (w as u32, h as u32, rgba.to_vec());
    }
    // 轻微外扩，避免裁太狠
    min_x = min_x.saturating_sub(1);
    min_y = min_y.saturating_sub(1);
    max_x = (max_x + 1).min(w - 1);
    max_y = (max_y + 1).min(h - 1);
    let cw = max_x - min_x + 1;
    let ch = max_y - min_y + 1;
    let mut out = Vec::with_capacity(cw * ch * 4);
    for y in min_y..=max_y {
        let start = (y * w + min_x) * 4;
        out.extend_from_slice(&rgba[start..start + cw * 4]);
    }
    (cw as u32, ch as u32, out)
}

fn downsample_box(rgba: &[u8], w: u32, h: u32, max_side: u32) -> (u32, u32, Vec<u8>) {
    let scale = (w.max(h) as f32) / max_side as f32;
    if scale <= 1.0 {
        return (w, h, rgba.to_vec());
    }
    let nw = ((w as f32) / scale).round().max(1.0) as u32;
    let nh = ((h as f32) / scale).round().max(1.0) as u32;
    let mut out = vec![0u8; (nw * nh * 4) as usize];
    for y in 0..nh {
        for x in 0..nw {
            let x0 = ((x as f32) * scale).floor() as u32;
            let y0 = ((y as f32) * scale).floor() as u32;
            let x1 = (((x as f32 + 1.0) * scale).ceil() as u32).min(w);
            let y1 = (((y as f32 + 1.0) * scale).ceil() as u32).min(h);
            let mut sum = [0u64; 4];
            let mut n = 0u64;
            for yy in y0..y1 {
                for xx in x0..x1 {
                    let i = ((yy * w + xx) * 4) as usize;
                    sum[0] += rgba[i] as u64;
                    sum[1] += rgba[i + 1] as u64;
                    sum[2] += rgba[i + 2] as u64;
                    sum[3] += rgba[i + 3] as u64;
                    n += 1;
                }
            }
            let o = ((y * nw + x) * 4) as usize;
            if n == 0 {
                continue;
            }
            out[o] = (sum[0] / n) as u8;
            out[o + 1] = (sum[1] / n) as u8;
            out[o + 2] = (sum[2] / n) as u8;
            out[o + 3] = (sum[3] / n) as u8;
        }
    }
    (nw, nh, out)
}

/// 无第三方依赖的未压缩 PNG（RGBA）
fn encode_png_rgba(width: u32, height: u32, rgba: &[u8]) -> Option<Vec<u8>> {
    if rgba.len() != (width as usize) * (height as usize) * 4 {
        return None;
    }
    let mut raw = Vec::with_capacity((width as usize + 1) * height as usize * 4);
    for row in 0..height as usize {
        raw.push(0); // filter None
        let start = row * width as usize * 4;
        let end = start + width as usize * 4;
        raw.extend_from_slice(&rgba[start..end]);
    }
    let compressed = zlib_store(&raw);

    let mut out = Vec::new();
    out.extend_from_slice(&[137, 80, 78, 71, 13, 10, 26, 10]);

    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&width.to_be_bytes());
    ihdr.extend_from_slice(&height.to_be_bytes());
    ihdr.push(8); // bit depth
    ihdr.push(6); // RGBA
    ihdr.push(0);
    ihdr.push(0);
    ihdr.push(0);
    write_chunk(&mut out, b"IHDR", &ihdr);
    write_chunk(&mut out, b"IDAT", &compressed);
    write_chunk(&mut out, b"IEND", &[]);
    Some(out)
}

fn write_chunk(out: &mut Vec<u8>, ty: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(ty);
    out.extend_from_slice(data);
    let mut crc_data = Vec::with_capacity(4 + data.len());
    crc_data.extend_from_slice(ty);
    crc_data.extend_from_slice(data);
    out.extend_from_slice(&crc32(&crc_data).to_be_bytes());
}

fn zlib_store(data: &[u8]) -> Vec<u8> {
    let mut out = vec![0x78, 0x01];
    let mut offset = 0usize;
    while offset < data.len() {
        let remaining = data.len() - offset;
        let chunk = remaining.min(65535);
        let is_last = offset + chunk >= data.len();
        out.push(if is_last { 0x01 } else { 0x00 });
        let n = chunk as u16;
        out.extend_from_slice(&n.to_le_bytes());
        out.extend_from_slice(&(!n).to_le_bytes());
        out.extend_from_slice(&data[offset..offset + chunk]);
        offset += chunk;
    }
    if data.is_empty() {
        out.push(0x01);
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0xffffu16.to_le_bytes());
    }
    out.extend_from_slice(&adler32(data).to_be_bytes());
    out
}

fn adler32(data: &[u8]) -> u32 {
    let mut a: u32 = 1;
    let mut b: u32 = 0;
    for &byte in data {
        a = (a + byte as u32) % 65521;
        b = (b + a) % 65521;
    }
    (b << 16) | a
}

fn crc32(data: &[u8]) -> u32 {
    let mut crc: u32 = 0xffff_ffff;
    for &byte in data {
        crc ^= byte as u32;
        for _ in 0..8 {
            if crc & 1 != 0 {
                crc = (crc >> 1) ^ 0xEDB88320;
            } else {
                crc >>= 1;
            }
        }
    }
    !crc
}

pub(crate) fn base64_encode(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let mut buf = [0u8; 3];
        for (i, b) in chunk.iter().enumerate() {
            buf[i] = *b;
        }
        let n = chunk.len();
        let x = ((buf[0] as u32) << 16) | ((buf[1] as u32) << 8) | (buf[2] as u32);
        out.push(T[((x >> 18) & 63) as usize] as char);
        out.push(T[((x >> 12) & 63) as usize] as char);
        out.push(if n > 1 {
            T[((x >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if n > 2 {
            T[(x & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}
