import { convertFileSrc, invoke } from "@tauri-apps/api/core";

function looksLikeZip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const u = new Uint8Array(buf);
  // PK\x03\x04 或空 zip PK\x05\x06
  return u[0] === 0x50 && u[1] === 0x4b;
}

/** 可靠读取本地二进制文件为 ArrayBuffer（允许 0 字节空文件） */
export async function readLocalArrayBuffer(path: string): Promise<ArrayBuffer> {
  // 优先后端 base64：中文路径下 asset 协议更易踩坑
  try {
    const b64 = await invoke<string>("read_file_base64", { path });
    // 空字符串 / 空文件：直接返回 0 字节，不再走 asset 回退（避免误报）
    return base64ToArrayBuffer(b64 ?? "");
  } catch (err) {
    console.warn("read_file_base64 failed, try asset protocol", err);
  }

  const url = convertFileSrc(path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`读取失败 HTTP ${res.status}`);
  return res.arrayBuffer();
}

/** 读取 Office 压缩包（docx/xlsx），并校验 ZIP 头 */
export async function readOfficeZipBuffer(path: string): Promise<ArrayBuffer> {
  const buf = await readLocalArrayBuffer(path);
  if (!looksLikeZip(buf)) {
    throw new Error("文件不是有效的 Office 文档（缺少 ZIP 头）");
  }
  return buf;
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const cleaned = b64.replace(/\s/g, "");
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  // 拷贝到独立 ArrayBuffer，避免 SharedArrayBuffer / 视图偏移问题
  return out.slice().buffer;
}

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

export function uint8ToBase64(bytes: Uint8Array): string {
  const copy = bytes.slice();
  return arrayBufferToBase64(copy.buffer);
}
