/** VWord 最近打开的文档（localStorage） */

export type WordRecentEntry = {
  path: string;
  name: string;
  openedAt: number;
};

export const WORD_RECENT_KEY = "yc-word-recent";
/** 本地最多保留条数 */
export const WORD_RECENT_MAX = 50;
/** 「最近打开」子菜单最多展示条数，超出用「查看全部」 */
export const WORD_RECENT_MENU_LIMIT = 10;
export const WORD_RECENT_EVENT = "word-recent-changed";

/**
 * 演示数据开关：为 true 时写入 15 条模拟记录（便于看「查看全部」）。
 * 看完效果后改回 false。
 */
export const WORD_RECENT_DEMO = true;

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

/** 写入演示用最近打开列表（假路径，仅 UI 预览） */
export function seedWordRecentDemo(): WordRecentEntry[] {
  const names = [
    "项目计划.docx",
    "会议纪要.docx",
    "产品需求.docx",
    "周报-第12周.docx",
    "合同草案.docx",
    "面试题库.docx",
    "技术方案.docx",
    "培训手册.docx",
    "客户反馈整理.docx",
    "发布说明.docx",
    "预算表说明.docx",
    "设计评审记录.docx",
    "上线检查清单.docx",
    "对外公告.docx",
    "未命名草稿.docx",
  ];
  const now = Date.now();
  const list: WordRecentEntry[] = names.map((name, i) => ({
    path: `E:\\Documents\\VWordDemo\\${name}`,
    name,
    openedAt: now - i * 45 * 60 * 1000,
  }));
  return writeRaw(list);
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

/**
 * 按存在性校验清理最近打开：文件已删 / 读不到则去掉记录（不删文件）。
 * `exists` 返回 false 或抛错都会移除该项。
 */
export async function pruneWordRecent(
  exists: (path: string) => Promise<boolean>,
): Promise<WordRecentEntry[]> {
  const cur = readRaw();
  if (!cur.length) return cur;
  const kept: WordRecentEntry[] = [];
  for (const item of cur) {
    try {
      if (await exists(item.path)) kept.push(item);
    } catch {
      /* 读不到则丢弃记录 */
    }
  }
  if (kept.length === cur.length) return cur;
  return writeRaw(kept);
}
