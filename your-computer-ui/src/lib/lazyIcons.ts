import { invoke } from "@tauri-apps/api/core";

export type ShellIconRow = {
  path: string;
  iconDataUrl: string;
};

function normKey(path: string) {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** 分批拉取外壳图标；每批之间让出主线程，避免卡 UI */
export async function fetchShellIconsBatched(
  paths: string[],
  opts: {
    batchSize?: number;
    isCancelled?: () => boolean;
    onBatch?: (rows: ShellIconRow[]) => void;
  } = {},
) {
  const batchSize = opts.batchSize ?? 32;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const p of paths) {
    const k = normKey(p);
    if (!p || seen.has(k)) continue;
    seen.add(k);
    unique.push(p);
  }
  for (let i = 0; i < unique.length; i += batchSize) {
    if (opts.isCancelled?.()) return;
    const chunk = unique.slice(i, i + batchSize);
    try {
      const rows = await invoke<ShellIconRow[]>("get_shell_icons", {
        paths: chunk,
      });
      if (opts.isCancelled?.()) return;
      if (rows?.length) opts.onBatch?.(rows);
    } catch (err) {
      console.error("get_shell_icons failed", err);
    }
    // 让出一帧，保持滚动/点击流畅
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 0);
    });
  }
}

export function applyIconMap<T extends { path?: string; id: string; iconDataUrl?: string }>(
  items: T[],
  map: Map<string, string>,
): T[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.iconDataUrl) return item;
    const key = normKey(item.path ?? item.id);
    const icon = map.get(key);
    if (!icon) return item;
    changed = true;
    return { ...item, iconDataUrl: icon };
  });
  return changed ? next : items;
}

export function iconMapFromRows(rows: ShellIconRow[]) {
  const map = new Map<string, string>();
  for (const r of rows) map.set(normKey(r.path), r.iconDataUrl);
  return map;
}
