export type UserProfile = {
  name: string;
  avatarDataUrl: string | null;
};

const PROFILE_KEY = "yc-user-profile";
const DEFAULT_NAME = "Your Computer";

export function defaultProfile(): UserProfile {
  return { name: DEFAULT_NAME, avatarDataUrl: null };
}

export function loadProfile(): UserProfile {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return defaultProfile();
    const parsed = JSON.parse(raw) as Partial<UserProfile>;
    const name =
      typeof parsed.name === "string" && parsed.name.trim()
        ? parsed.name.trim()
        : DEFAULT_NAME;
    const avatarDataUrl =
      typeof parsed.avatarDataUrl === "string" && parsed.avatarDataUrl.startsWith("data:")
        ? parsed.avatarDataUrl
        : null;
    return { name, avatarDataUrl };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: UserProfile): UserProfile {
  const next: UserProfile = {
    name: profile.name.trim() || DEFAULT_NAME,
    avatarDataUrl: profile.avatarDataUrl,
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(next));
  return next;
}

/** 从四边 flood-fill 近黑像素为透明（去掉 ico/jpeg 黑框，保留内部深色细节） */
function punchBlackBackground(d: Uint8ClampedArray, w: number, h: number) {
  const isNearBlack = (i: number) => {
    const a = d[i + 3]!;
    if (a < 8) return true;
    const r = d[i]!;
    const g = d[i + 1]!;
    const b = d[i + 2]!;
    return r < 40 && g < 40 && b < 40;
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (seen[idx]) return;
    seen[idx] = 1;
    const pi = idx * 4;
    if (!isNearBlack(pi)) return;
    d[pi + 3] = 0;
    stack.push(idx);
  };
  for (let x = 0; x < w; x += 1) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y += 1) {
    push(0, y);
    push(w - 1, y);
  }
  while (stack.length) {
    const idx = stack.pop()!;
    const x = idx % w;
    const y = (idx / w) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
}

function compressDataUrl(
  src: string,
  maxSize = 256,
  opts: { mime?: "image/jpeg" | "image/png"; quality?: number; punchBlack?: boolean } = {},
): Promise<string> {
  const mime = opts.mime ?? "image/jpeg";
  const quality = opts.quality ?? 0.88;
  // JPEG / 裸 ico 无可靠 alpha；透明区常变成黑底
  const sourceLacksAlpha =
    /^data:image\/(jpe?g|x-icon|vnd\.microsoft\.icon|bmp)/i.test(src);
  const shouldPunch = opts.punchBlack === true || (mime === "image/png" && sourceLacksAlpha);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) {
        reject(new Error("canvas unavailable"));
        return;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      if (shouldPunch) {
        const imageData = ctx.getImageData(0, 0, w, h);
        punchBlackBackground(imageData.data, w, h);
        ctx.putImageData(imageData, 0, 0);
      }
      if (mime === "image/png") {
        resolve(canvas.toDataURL("image/png"));
      } else {
        resolve(canvas.toDataURL("image/jpeg", quality));
      }
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/** 压缩头像为较小 JPEG data URL，避免撑爆 localStorage */
export function readImageAsAvatarDataUrl(file: File, maxSize = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    compressDataUrl(url, maxSize, { mime: "image/jpeg" })
      .then((data) => {
        URL.revokeObjectURL(url);
        resolve(data);
      })
      .catch((err) => {
        URL.revokeObjectURL(url);
        reject(err);
      });
  });
}

export async function avatarFromLocalPath(
  path: string,
  maxSize = 256,
): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  const dataUrl = await invoke<string>("read_image_data_url", { path });
  return compressDataUrl(dataUrl, maxSize, { mime: "image/jpeg" });
}

/** 图标用 PNG 保留透明，并去掉近黑底 */
export async function iconFromLocalPath(path: string): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  const dataUrl = await invoke<string>("read_image_data_url", { path });
  return compressDataUrl(dataUrl, 128, { mime: "image/png", punchBlack: true });
}

/** 把已存图标里的黑底抠成透明（修复旧 JPEG 图标） */
export function stripBlackBackground(dataUrl: string): Promise<string> {
  return compressDataUrl(dataUrl, 128, { mime: "image/png", punchBlack: true });
}

export function isImageFilePath(path: string): boolean {
  return /\.(jpe?g|png|gif|webp|bmp|ico|cur)$/i.test(path);
}

export function profileInitial(name: string): string {
  const t = name.trim();
  if (!t) return "Y";
  return t[0]!.toUpperCase();
}
