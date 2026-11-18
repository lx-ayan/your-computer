export type GlobalIconKey = "folder" | "video" | "audio";

export type CustomIconRule = {
  id: string;
  /** 不含点的小写后缀，如 mp4 */
  ext: string;
  iconDataUrl: string;
};

export type IconSettings = {
  global: Record<GlobalIconKey, string | null>;
  custom: CustomIconRule[];
};

export const ICON_SETTINGS_KEY = "yc-icon-settings";
export const ICON_SETTINGS_EVENT = "icon-settings-changed";

export const GLOBAL_ICON_LABELS: Record<GlobalIconKey, string> = {
  folder: "文件夹",
  video: "视频文件",
  audio: "音频文件",
};

const VIDEO_EXTS = new Set([
  "mp4",
  "mkv",
  "avi",
  "mov",
  "wmv",
  "flv",
  "webm",
  "m4v",
  "mpeg",
  "mpg",
  "3gp",
  "ts",
]);

const AUDIO_EXTS = new Set([
  "mp3",
  "wav",
  "flac",
  "aac",
  "m4a",
  "ogg",
  "wma",
  "aiff",
  "opus",
  "ape",
]);

export const DEFAULT_ICON_SETTINGS: IconSettings = {
  global: { folder: null, video: null, audio: null },
  custom: [],
};

export function normalizeExt(raw: string): string {
  return raw.trim().replace(/^\.+/, "").toLowerCase();
}

export function fileExtFromPath(path: string): string {
  const base = path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

export function isVideoExt(ext: string): boolean {
  return VIDEO_EXTS.has(normalizeExt(ext));
}

export function isAudioExt(ext: string): boolean {
  return AUDIO_EXTS.has(normalizeExt(ext));
}

function normalizeSettings(raw: Partial<IconSettings> | null | undefined): IconSettings {
  const g: Partial<Record<GlobalIconKey, string | null>> = raw?.global ?? {};
  const customIn = Array.isArray(raw?.custom) ? raw!.custom! : [];
  const seen = new Set<string>();
  const custom: CustomIconRule[] = [];
  for (const row of customIn) {
    const ext = normalizeExt(String(row?.ext ?? ""));
    const iconDataUrl =
      typeof row?.iconDataUrl === "string" && row.iconDataUrl.startsWith("data:")
        ? row.iconDataUrl
        : "";
    if (!ext || !iconDataUrl || seen.has(ext)) continue;
    seen.add(ext);
    custom.push({
      id: typeof row?.id === "string" && row.id ? row.id : `icon-${ext}-${custom.length}`,
      ext,
      iconDataUrl,
    });
  }
  return {
    global: {
      folder:
        typeof g.folder === "string" && g.folder.startsWith("data:") ? g.folder : null,
      video:
        typeof g.video === "string" && g.video.startsWith("data:") ? g.video : null,
      audio:
        typeof g.audio === "string" && g.audio.startsWith("data:") ? g.audio : null,
    },
    custom,
  };
}

export function loadIconSettings(): IconSettings {
  try {
    const raw = localStorage.getItem(ICON_SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_ICON_SETTINGS);
    return normalizeSettings(JSON.parse(raw) as Partial<IconSettings>);
  } catch {
    return structuredClone(DEFAULT_ICON_SETTINGS);
  }
}

const ICON_ALPHA_MIGRATED_KEY = "yc-icon-alpha-migrated-v2";

/** 把已存图标黑底（含 ico/jpeg→png 残留）一次性抠成透明 */
export async function migrateIconBlackBackgrounds(): Promise<IconSettings | null> {
  try {
    if (localStorage.getItem(ICON_ALPHA_MIGRATED_KEY) === "1") return null;
  } catch {
    /* ignore */
  }
  const cur = loadIconSettings();
  const hasAny =
    Object.values(cur.global).some((v) => Boolean(v)) || cur.custom.length > 0;
  if (!hasAny) {
    try {
      localStorage.setItem(ICON_ALPHA_MIGRATED_KEY, "1");
    } catch {
      /* ignore */
    }
    return null;
  }
  const { stripBlackBackground } = await import("./profile");
  const global = { ...cur.global };
  for (const key of ["folder", "video", "audio"] as const) {
    const v = global[key];
    if (v?.startsWith("data:")) {
      global[key] = await stripBlackBackground(v);
    }
  }
  const custom = await Promise.all(
    cur.custom.map(async (r) => {
      if (!r.iconDataUrl.startsWith("data:")) return r;
      return { ...r, iconDataUrl: await stripBlackBackground(r.iconDataUrl) };
    }),
  );
  const next = saveIconSettings({ global, custom });
  try {
    localStorage.setItem(ICON_ALPHA_MIGRATED_KEY, "1");
  } catch {
    /* ignore */
  }
  return next;
}

export function saveIconSettings(next: IconSettings): IconSettings {
  const value = normalizeSettings(next);
  try {
    localStorage.setItem(ICON_SETTINGS_KEY, JSON.stringify(value));
  } catch (err) {
    console.error("saveIconSettings failed", err);
    throw err;
  }
  try {
    window.dispatchEvent(
      new CustomEvent(ICON_SETTINGS_EVENT, { detail: value }),
    );
  } catch {
    /* ignore */
  }
  void import("@tauri-apps/api/event")
    .then(({ emit }) => emit(ICON_SETTINGS_EVENT, value))
    .catch(() => {
      /* ignore */
    });
  return value;
}

export function setGlobalIcon(
  key: GlobalIconKey,
  iconDataUrl: string | null,
): IconSettings {
  const cur = loadIconSettings();
  return saveIconSettings({
    ...cur,
    global: { ...cur.global, [key]: iconDataUrl },
  });
}

export type PickTargetPayload =
  | { type: "avatar" }
  | { type: "global"; key: GlobalIconKey }
  | { type: "custom-new" }
  | { type: "custom-edit"; id: string };

export function encodePickTarget(target: PickTargetPayload): string {
  if (target.type === "avatar") return "avatar";
  if (target.type === "global") return `global:${target.key}`;
  if (target.type === "custom-new") return "custom-new";
  return `custom-edit:${target.id}`;
}

export function decodePickTarget(raw: string | null | undefined): PickTargetPayload | null {
  if (!raw) return null;
  if (raw === "avatar") return { type: "avatar" };
  if (raw === "custom-new") return { type: "custom-new" };
  if (raw.startsWith("global:")) {
    const key = raw.slice("global:".length) as GlobalIconKey;
    if (key === "folder" || key === "video" || key === "audio") {
      return { type: "global", key };
    }
  }
  if (raw.startsWith("custom-edit:")) {
    const id = raw.slice("custom-edit:".length);
    if (id) return { type: "custom-edit", id };
  }
  return null;
}

const PENDING_AVATAR_KEY = "yc-pending-avatar";
const PENDING_CUSTOM_NEW_KEY = "yc-pending-custom-icon";

/** 选图窗口直接落盘，避免跨窗口事件丢失 */
export async function applyPickedImage(
  path: string,
  target: PickTargetPayload,
): Promise<void> {
  const { iconFromLocalPath, avatarFromLocalPath } = await import("./profile");
  if (target.type === "avatar") {
    const dataUrl = await avatarFromLocalPath(path);
    localStorage.setItem(PENDING_AVATAR_KEY, dataUrl);
    return;
  }
  const dataUrl = await iconFromLocalPath(path);
  if (target.type === "global") {
    setGlobalIcon(target.key, dataUrl);
    return;
  }
  if (target.type === "custom-edit") {
    updateCustomIconImage(target.id, dataUrl);
    return;
  }
  // custom-new：先暂存，设置页点「添加」时再用
  localStorage.setItem(PENDING_CUSTOM_NEW_KEY, dataUrl);
}

export function takePendingAvatar(): string | null {
  try {
    const v = localStorage.getItem(PENDING_AVATAR_KEY);
    if (v) localStorage.removeItem(PENDING_AVATAR_KEY);
    return v && v.startsWith("data:") ? v : null;
  } catch {
    return null;
  }
}

export function takePendingCustomIcon(): string | null {
  try {
    const v = localStorage.getItem(PENDING_CUSTOM_NEW_KEY);
    if (v) localStorage.removeItem(PENDING_CUSTOM_NEW_KEY);
    return v && v.startsWith("data:") ? v : null;
  } catch {
    return null;
  }
}

export function upsertCustomIcon(extRaw: string, iconDataUrl: string): IconSettings {
  const ext = normalizeExt(extRaw);
  if (!ext || !iconDataUrl.startsWith("data:")) return loadIconSettings();
  const cur = loadIconSettings();
  const idx = cur.custom.findIndex((r) => r.ext === ext);
  const nextCustom = [...cur.custom];
  if (idx >= 0) {
    nextCustom[idx] = { ...nextCustom[idx], iconDataUrl };
  } else {
    nextCustom.push({
      id: `icon-${ext}-${Date.now().toString(36)}`,
      ext,
      iconDataUrl,
    });
  }
  return saveIconSettings({ ...cur, custom: nextCustom });
}

export function removeCustomIcon(id: string): IconSettings {
  const cur = loadIconSettings();
  return saveIconSettings({
    ...cur,
    custom: cur.custom.filter((r) => r.id !== id),
  });
}

export function updateCustomIconImage(
  id: string,
  iconDataUrl: string,
): IconSettings {
  const cur = loadIconSettings();
  return saveIconSettings({
    ...cur,
    custom: cur.custom.map((r) =>
      r.id === id ? { ...r, iconDataUrl } : r,
    ),
  });
}

/** 按路径/类型解析用户自定义或全局图标 */
export function resolveOverrideIcon(
  settings: IconSettings,
  item: { path?: string; id?: string; kind?: string; name?: string },
): string | undefined {
  if (item.kind === "folder") {
    return settings.global.folder || undefined;
  }
  const path = item.path ?? item.id ?? "";
  const name =
    item.name || path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
  // 优先从文件名取后缀，再回退到完整路径
  const ext = fileExtFromPath(name) || fileExtFromPath(path);
  if (!ext) return undefined;
  const custom = settings.custom.find((r) => r.ext === ext);
  if (custom?.iconDataUrl) return custom.iconDataUrl;
  if (isVideoExt(ext) && settings.global.video) return settings.global.video;
  if (isAudioExt(ext) && settings.global.audio) return settings.global.audio;
  return undefined;
}
