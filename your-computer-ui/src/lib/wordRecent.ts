/** VWord 最近打开的文档（localStorage） */

export type WordRecentEntry = {
  path: string;
  name: string;
  openedAt: number;
};

export const WORD_RECENT_KEY = "yc-word-recent";
export const WORD_RECENT_MAX = 12;
export const WORD_RECENT_EVENT = "word-recent-changed";

function fileNameFromPath(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\//g, "\\");
}

function readRaw(): WordRecentEntry[] {
  try {
    const raw = localStorage.getItem(WORD_RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: WordRecentEntry[] = [];
    const seen = new Set<string>();
    for (const row of parsed) {
      const path =
        typeof row?.path === "string" ? normalizePath(row.path) : "";
      if (!path || seen.has(path.toLowerCase())) continue;
      seen.add(path.toLowerCase());
      out.push({
        path,
        name:
          typeof row?.name === "string" && row.name
            ? row.name
            : fileNameFromPath(path),
        openedAt:
          typeof row?.openedAt === "number" && Number.isFinite(row.openedAt)
            ? row.openedAt
            : Date.now(),
      });
      if (out.length >= WORD_RECENT_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

function writeRaw(list: WordRecentEntry[]): WordRecentEntry[] {
  const next = list.slice(0, WORD_RECENT_MAX);
  try {
    localStorage.setItem(WORD_RECENT_KEY, JSON.stringify(next));
  } catch (err) {
    console.error("save word recent failed", err);
  }
  try {
    window.dispatchEvent(
      new CustomEvent(WORD_RECENT_EVENT, { detail: next }),
    );
  } catch {
    /* ignore */
  }
  return next;
}

export function loadWordRecent(): WordRecentEntry[] {
  return readRaw();
}

/** 记录一次打开/保存；同路径置顶 */
export function pushWordRecent(path: string, name?: string): WordRecentEntry[] {
  const p = normalizePath(path);
  if (!p) return readRaw();
  const entry: WordRecentEntry = {
    path: p,
    name: name || fileNameFromPath(p),
    openedAt: Date.now(),
  };
  const rest = readRaw().filter(
    (r) => r.path.toLowerCase() !== p.toLowerCase(),
  );
  return writeRaw([entry, ...rest]);
}

export function removeWordRecent(path: string): WordRecentEntry[] {
  const p = normalizePath(path).toLowerCase();
  return writeRaw(readRaw().filter((r) => r.path.toLowerCase() !== p));
}

export function clearWordRecent(): WordRecentEntry[] {
  return writeRaw([]);
}
