import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { startOsFileDrag } from "./lib/osFileDrag";
import {
  AppWindow,
  ArrowDownCircle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Columns3,
  File,
  FileText,
  Folder,
  HardDrive,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Monitor,
  RefreshCw,
  Search,
  Settings,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import {
  ColumnsView,
  type ColumnFileItem,
  type ColumnPane,
} from "./components/ColumnsView";
import {
  FavoritesPicker,
  type FavoritePickTarget,
} from "./components/FavoritesPicker";
import { FavoritesFolderDialog } from "./components/FavoritesFolderDialog";
import {
  BatchCreateDialog,
  macOsBatchName,
  type BatchCreateResult,
} from "./components/BatchCreateDialog";
import {
  ContextMenu,
  type ContextMenuState,
  type OpenWithApp,
} from "./components/ContextMenu";
import {
  SortMenu,
  type SortDir,
  type SortKey,
} from "./components/SortMenu";
import {
  FavBarMenu,
  type FavBarMenuItem,
} from "./components/FavBarMenu";
import {
  DEFAULT_LIQUID_GLASS_CONFIG,
  LiquidGlass,
  useSpring,
} from "./components/LiquidGlass";
import { useVirtualRange } from "./hooks/useVirtualRange";
import {
  fetchShellIconsBatched,
  iconMapFromRows,
} from "./lib/lazyIcons";
import {
  APP_SETTINGS_EVENT,
  loadAppSettings,
  type AppSettings,
} from "./lib/appSettings";
import { localImagePreviewSrc } from "./lib/filePreview";
import {
  ICON_SETTINGS_EVENT,
  applyPickedImage,
  decodePickTarget,
  loadIconSettings,
  migrateIconBlackBackgrounds,
  resolveOverrideIcon,
  type AppIconKey,
  type IconSettings,
} from "./lib/iconSettings";
import { isImageFilePath } from "./lib/profile";
import { showAlert } from "./lib/appDialog";

function infoWindowLabel(path: string) {
  let h = 0;
  for (let i = 0; i < path.length; i += 1) {
    h = (Math.imul(31, h) + path.charCodeAt(i)) >>> 0;
  }
  return `info-${h.toString(16)}`;
}

async function openGetInfoWindow(path: string, name: string) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = infoWindowLabel(path);
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: `/?info=${encodeURIComponent(path)}`,
    title: `“${name}” 简介`,
    width: 340,
    height: 640,
    minWidth: 300,
    minHeight: 420,
    decorations: false,
    transparent: true,
    shadow: false,
    center: true,
    resizable: true,
  });
  win.once("tauri://error", (e) => {
    console.error("get-info window error", e);
  });
}

async function openConfirmDeleteWindow(paths: string[], names: string[]) {
  if (!isTauri()) {
    console.error("confirm-delete requires Tauri");
    return;
  }
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = `confirm-${Date.now().toString(36)}`;
  const payload = encodeURIComponent(JSON.stringify({ paths, names }));
  try {
    const win = new WebviewWindow(label, {
      url: `/?confirmDelete=${payload}`,
      title: "确认删除",
      width: 400,
      height: 280,
      decorations: false,
      transparent: true,
      shadow: false,
      center: true,
      resizable: false,
      focus: true,
      skipTaskbar: true,
    });
    win.once("tauri://error", (e) => {
      console.error("confirm-delete window error", e);
    });
  } catch (err) {
    console.error("confirm-delete create failed", err);
  }
}
async function clientToScreenLogical(clientX: number, clientY: number) {
  const current = getCurrentWindow();
  const [outer, scale] = await Promise.all([
    current.outerPosition(),
    current.scaleFactor(),
  ]);
  return {
    x: outer.x / scale + clientX,
    y: outer.y / scale + clientY,
  };
}

/** 新窗口用 CSS transform（GPU）从点击处放大，避免逐帧改原生尺寸造成割裂 */
async function openBrowseWindow(
  path: string,
  title: string,
  originClient?: { x: number; y: number },
) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = `browse-${infoWindowLabel(path)}`;
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  const width = 1100;
  const height = 700;
  const origin = originClient
    ? await clientToScreenLogical(originClient.x, originClient.y)
    : null;

  const params = new URLSearchParams({ path });
  if (origin) params.set("zoom", "1");

  const win = new WebviewWindow(label, {
    url: `/?${params.toString()}`,
    title,
    width,
    height,
    minWidth: 800,
    minHeight: 500,
    ...(origin
      ? {
          x: Math.round(origin.x - width / 2),
          y: Math.round(origin.y - height / 2),
          center: false,
        }
      : { center: true }),
    decorations: false,
    transparent: true,
    shadow: false,
    resizable: true,
  });

  win.once("tauri://error", (e) => {
    console.error("browse window error", e);
  });
}

async function openSearchWindow() {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = "search-all";
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: "/?search=1",
    title: "搜索",
    width: 780,
    height: 520,
    minWidth: 560,
    minHeight: 360,
    decorations: false,
    transparent: true,
    shadow: false,
    center: true,
    resizable: true,
    focus: true,
  });
  win.once("tauri://error", (e) => {
    console.error("search window error", e);
  });
}

async function openSettingsWindow() {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const label = "settings";
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const win = new WebviewWindow(label, {
    url: "/?settings=1",
    title: "系统设置",
    width: 780,
    height: 640,
    minWidth: 640,
    minHeight: 480,
    decorations: false,
    transparent: true,
    shadow: false,
    center: true,
    resizable: true,
    focus: true,
  });
  win.once("tauri://error", (e) => {
    console.error("settings window error", e);
  });
}

type BuiltinEditorKind = "word" | "markdown" | "excel";

async function openBuiltinEditorWindow(
  kind: BuiltinEditorKind,
  path?: string | null,
  name?: string | null,
  opts?: { appTitle?: string },
) {
  if (!isTauri()) return;
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const blank = !path;
  const label = blank
    ? `editor-${kind}-new-${Date.now().toString(36)}`
    : `editor-${kind}-${infoWindowLabel(path)}`;
  if (!blank) {
    const existing = await WebviewWindow.getByLabel(label);
    // 关掉旧窗口再开，避免编辑器子窗口拿不到最新前端代码
    if (existing) {
      try {
        await existing.close();
      } catch {
        /* ignore */
      }
    }
  }
  const titles: Record<BuiltinEditorKind, string> = {
    word: "VWord",
    markdown: "VMarkdown",
    excel: "VExcel",
  };
  const appTitle = opts?.appTitle ?? titles[kind];
  const display =
    name ||
    (path
      ? path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path
      : "未命名.docx");
  const params = new URLSearchParams({
    editor: kind,
    t: String(Date.now()),
  });
  if (path) params.set("file", path);
  try {
    const win = new WebviewWindow(label, {
      url: `/?${params.toString()}`,
      title: blank ? appTitle : `${appTitle} · ${display}`,
      width: kind === "excel" ? 1100 : 900,
      height: 700,
      minWidth: 640,
      minHeight: 420,
      decorations: false,
      transparent: false,
      shadow: true,
      center: true,
      resizable: true,
      focus: true,
      visible: true,
    });
    win.once("tauri://created", () => {
      void win.show();
      void win.setFocus();
    });
    win.once("tauri://error", (e) => {
      console.error("builtin editor window error", e);
    });
  } catch (err) {
    console.error("openBuiltinEditorWindow failed", err);
  }
}

/** 把 Windows/Unix 路径拆成可点击面包屑 */
function pathBreadcrumbs(path: string): { label: string; path: string }[] {
  const raw = path.trim();
  if (!raw) return [];
  const normalized = raw.replace(/\//g, "\\");

  const drive = normalized.match(/^([A-Za-z]:)(?:\\(.*))?$/);
  if (drive) {
    const rootLabel = drive[1];
    const rootPath = `${drive[1]}\\`;
    const rest = (drive[2] ?? "").replace(/\\+$/, "");
    const crumbs: { label: string; path: string }[] = [
      { label: rootLabel, path: rootPath },
    ];
    if (rest) {
      let acc = rootPath;
      for (const part of rest.split("\\").filter(Boolean)) {
        acc = acc.endsWith("\\") ? acc + part : `${acc}\\${part}`;
        crumbs.push({ label: part, path: acc });
      }
    }
    return crumbs;
  }

  if (normalized.startsWith("\\\\")) {
    const parts = normalized.split("\\").filter(Boolean);
    if (parts.length < 2) return [{ label: normalized, path: normalized }];
    let acc = `\\\\${parts[0]}\\${parts[1]}`;
    const crumbs: { label: string; path: string }[] = [
      { label: `\\\\${parts[0]}\\${parts[1]}`, path: acc },
    ];
    for (const part of parts.slice(2)) {
      acc = `${acc}\\${part}`;
      crumbs.push({ label: part, path: acc });
    }
    return crumbs;
  }

  const parts = normalized.split(/[\\/]/).filter(Boolean);
  const crumbs: { label: string; path: string }[] = [];
  let acc = normalized.startsWith("/") ? "/" : "";
  for (const part of parts) {
    acc = acc === "/" ? `/${part}` : acc ? `${acc}/${part}` : part;
    crumbs.push({ label: part, path: acc });
  }
  return crumbs;
}


type PathResult = { path: string; name: string };
type FileClipboard = { mode: "cut" | "copy"; paths: string[] };

type ViewMode = "icons" | "list" | "columns";

const VIEW_MODE_KEY = "finder-view-mode";

function readStoredViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_MODE_KEY);
    if (v === "icons" || v === "list" || v === "columns") return v;
  } catch {
    /* ignore */
  }
  return "list";
}

type SelBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

function normalizeBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): SelBox {
  return {
    left: Math.min(x0, x1),
    top: Math.min(y0, y1),
    right: Math.max(x0, x1),
    bottom: Math.max(y0, y1),
  };
}

function boxesIntersect(a: SelBox, b: SelBox) {
  return (
    a.left < b.right &&
    a.right > b.left &&
    a.top < b.bottom &&
    a.bottom > b.top
  );
}

type SidebarIconType =
  | "recents"
  | "shared"
  | "apps"
  | "desktop"
  | "documents"
  | "downloads"
  | "drive"
  | "trash";

type SidebarItem = {
  id: string;
  label: string;
  icon: SidebarIconType;
};

type FileItem = {
  id: string;
  name: string;
  kind: "folder" | "document" | "image" | "file" | "disk";
  kindLabel: string;
  openedAt: string;
  size: string;
  path?: string;
  iconDataUrl?: string;
};

type DirEntryInfo = {
  id: string;
  name: string;
  kind: string;
  kindLabel: string;
  openedAt: string;
  size: string;
  path: string;
  iconDataUrl?: string;
};

const FAV_FOLDER_PREFIX = "favorite-folder:";

function isFavoriteFolderPath(path?: string | null) {
  return Boolean(path?.startsWith(FAV_FOLDER_PREFIX));
}

function normFsPath(path: string) {
  return path.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/** 是否允许把 sources 移动进 target 目录（禁止自拖、已在其中、拖进自身子目录） */
function canDropMoveInto(sources: string[], target: string) {
  const t = normFsPath(target);
  if (!t) return false;
  for (const src of sources) {
    const f = normFsPath(src);
    if (!f || f === t) return false;
    if (t === f || t.startsWith(`${f}\\`)) return false;
    const slash = f.lastIndexOf("\\");
    const parent = slash >= 0 ? f.slice(0, slash) : "";
    if (parent === t) return false;
  }
  return true;
}

function parseFavoriteFolderId(path: string) {
  return Number(path.slice(FAV_FOLDER_PREFIX.length));
}

function parseFavoriteItemId(id: string) {
  const m = /^fav-(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

function isTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

function toFileItem(entry: DirEntryInfo): FileItem {
  const allowed = new Set(["folder", "document", "image", "file", "disk"]);
  const kind = (
    allowed.has(entry.kind) ? entry.kind : "file"
  ) as FileItem["kind"];
  return {
    id: entry.id,
    name: entry.name,
    kind,
    kindLabel: entry.kindLabel,
    openedAt: entry.openedAt,
    size: entry.size,
    path: entry.path,
    iconDataUrl: entry.iconDataUrl,
  };
}

function parseSizeBytes(size: string): number {
  if (!size || size === "--") return -1;
  const m = /^([\d.]+)\s*(字节|KB|MB|GB|TB)?$/i.exec(size.trim());
  if (!m) return -1;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return -1;
  const unit = (m[2] || "字节").toUpperCase();
  const mul =
    unit === "TB"
      ? 1024 ** 4
      : unit === "GB"
        ? 1024 ** 3
        : unit === "MB"
          ? 1024 ** 2
          : unit === "KB"
            ? 1024
            : 1;
  return n * mul;
}

function sortValue(
  item: FileItem,
  key: SortKey,
  tags: Record<string, string>,
): string | number {
  switch (key) {
    case "name":
    case "title":
      return item.name.toLowerCase();
    case "modified":
    case "created":
      return item.openedAt;
    case "kind":
      return item.kindLabel || item.kind;
    case "size":
      return item.kind === "folder" ? -1 : parseSizeBytes(item.size);
    case "author":
      return "";
    case "tags":
      return (tags[item.path ?? item.id] || "").toLowerCase();
  }
}

function sortFileItems(
  items: FileItem[],
  key: SortKey,
  dir: SortDir,
  tags: Record<string, string>,
): FileItem[] {
  const mul = dir === "asc" ? 1 : -1;
  return [...items].sort((a, b) => {
    const aDir = a.kind === "folder";
    const bDir = b.kind === "folder";
    if (aDir !== bDir) return aDir ? -1 : 1;
    const av = sortValue(a, key, tags);
    const bv = sortValue(b, key, tags);
    let cmp = 0;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av).localeCompare(String(bv), "zh");
    }
    if (cmp !== 0) return cmp * mul;
    return a.name.localeCompare(b.name, "zh") * mul;
  });
}

function pathKey(path: string) {
  return path.replace(/\//g, "\\").toLowerCase();
}

/** 按名字相关度打分：越大越靠前；-1 表示不匹配 */
function nameSearchScore(name: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const n = name.toLowerCase();
  if (n === q) return 10_000;
  if (n.startsWith(q)) return 8_000 + Math.max(0, 200 - n.length);
  const idx = n.indexOf(q);
  if (idx >= 0) {
    // 越靠前、名字越短越好
    return 5_000 - idx * 10 + Math.max(0, 100 - n.length);
  }
  // 子序列模糊：query 字符按序出现在 name 中
  let qi = 0;
  let gaps = 0;
  let last = -1;
  for (let i = 0; i < n.length && qi < q.length; i++) {
    if (n[i] === q[qi]) {
      if (last >= 0) gaps += i - last - 1;
      last = i;
      qi++;
    }
  }
  if (qi === q.length) {
    return 1_000 - gaps * 5 + Math.max(0, 50 - n.length);
  }
  return -1;
}

function highlightNameParts(
  name: string,
  query: string,
): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text: name, hit: false }];
  const lower = name.toLowerCase();
  const qLower = q.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx >= 0) {
    const parts: { text: string; hit: boolean }[] = [];
    if (idx > 0) parts.push({ text: name.slice(0, idx), hit: false });
    parts.push({ text: name.slice(idx, idx + q.length), hit: true });
    if (idx + q.length < name.length) {
      parts.push({ text: name.slice(idx + q.length), hit: false });
    }
    return parts;
  }
  // 子序列高亮
  const parts: { text: string; hit: boolean }[] = [];
  let qi = 0;
  let buf = "";
  let bufHit = false;
  const flush = () => {
    if (!buf) return;
    parts.push({ text: buf, hit: bufHit });
    buf = "";
  };
  for (let i = 0; i < name.length; i++) {
    const hit = qi < qLower.length && lower[i] === qLower[qi];
    if (hit) qi++;
    if (buf && hit !== bufHit) flush();
    bufHit = hit;
    buf += name[i];
  }
  flush();
  return qi === qLower.length ? parts : [{ text: name, hit: false }];
}

function HighlightedName({
  name,
  query,
  active,
  className = "truncate",
}: {
  name: string;
  query: string;
  active?: boolean;
  className?: string;
}) {
  const q = query.trim();
  if (!q) {
    return <span className={className}>{name}</span>;
  }
  const parts = highlightNameParts(name, q);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.hit ? (
          <mark
            key={i}
            className={`rounded-[2px] px-[1px] ${
              active
                ? "bg-white/35 text-inherit"
                : "bg-[#ffe566] text-[var(--finder-text)]"
            }`}
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

function splitDisplayName(name: string, isFolder: boolean) {
  if (isFolder) return { stem: name, ext: "" };
  const i = name.lastIndexOf(".");
  if (i <= 0 || i === name.length - 1) return { stem: name, ext: "" };
  return { stem: name.slice(0, i), ext: name.slice(i) };
}

function TagDot({
  color,
  className = "size-[8px]",
}: {
  color?: string;
  className?: string;
}) {
  if (!color) return null;
  return (
    <span
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}

/** 图标视图：文本左圆点；最多三行；后缀完整、名字可省略 */
function IconCaption({
  name,
  isFolder,
  tagColor,
  active,
  highlightQuery = "",
}: {
  name: string;
  isFolder: boolean;
  tagColor?: string;
  active?: boolean;
  highlightQuery?: string;
}) {
  const { stem, ext } = splitDisplayName(name, isFolder);
  const q = highlightQuery.trim();
  const renderStem = () => {
    if (!q) return stem;
    // 查询命中在后缀时，stem 不拆；整名高亮更直观
    if (name.toLowerCase().includes(q.toLowerCase())) {
      return (
        <HighlightedName
          name={stem}
          query={
            stem.toLowerCase().includes(q.toLowerCase()) ? q : ""
          }
          active={active}
          className="break-all"
        />
      );
    }
    return (
      <HighlightedName
        name={stem}
        query={q}
        active={active}
        className="break-all"
      />
    );
  };
  const renderExt = () => {
    if (!ext) return null;
    if (q && ext.toLowerCase().includes(q.toLowerCase())) {
      return (
        <HighlightedName name={ext} query={q} active={active} />
      );
    }
    return <span>{ext}</span>;
  };
  return (
    <span
      className={`flex w-full max-w-full justify-center rounded-[4px] px-1 py-0.5 text-[12px] leading-[1.2] ${
        active
          ? "bg-[var(--finder-row-selected)] text-white"
          : "text-[var(--finder-text)]"
      }`}
    >
      <span className="inline-flex max-w-full items-start gap-1 text-center">
        <TagDot color={tagColor} className="mt-[3px] size-[7px]" />
        <span className="min-w-0 line-clamp-2 break-all text-center">
          {q && !ext ? (
            <HighlightedName
              name={stem}
              query={q}
              active={active}
              className="break-all"
            />
          ) : (
            <>
              {renderStem()}
              {renderExt()}
            </>
          )}
        </span>
      </span>
    </span>
  );
}

const topItems: SidebarItem[] = [
  { id: "recents", label: "最近使用", icon: "recents" },
  { id: "shared", label: "共享", icon: "shared" },
  { id: "builtin-apps", label: "内置应用", icon: "apps" },
];

const builtinAppEntries: {
  id: AppIconKey;
  label: string;
  kind: BuiltinEditorKind;
  blankName: string;
}[] = [
  { id: "vword", label: "VWord", kind: "word", blankName: "未命名.docx" },
  { id: "vexcel", label: "VExcel", kind: "excel", blankName: "未命名.xlsx" },
  {
    id: "vmarkdown",
    label: "VMarkdown",
    kind: "markdown",
    blankName: "未命名.md",
  },
];

const favorites: SidebarItem[] = [
  { id: "favorites", label: "收藏", icon: "apps" },
  { id: "desktop", label: "桌面", icon: "desktop" },
  { id: "documents", label: "文稿", icon: "documents" },
  { id: "downloads", label: "下载", icon: "downloads" },
];

const trashItem: SidebarItem = {
  id: "trash",
  label: "废纸篓",
  icon: "trash",
};

type DriveInfo = {
  id: string;
  letter: string;
  name: string;
  path: string;
  totalBytes: number;
  availableBytes: number;
};

function driveToSidebarItem(drive: DriveInfo): SidebarItem {
  const volume = drive.name.trim() || "本地磁盘";
  return {
    id: drive.id,
    label: `${drive.letter}: ${volume}`,
    icon: "drive",
  };
}

const tags = [
  { id: "tag-red", label: "红色", color: "#ff3b30" },
  { id: "tag-orange", label: "橙色", color: "#ff9500" },
  { id: "tag-yellow", label: "黄色", color: "#ffcc00" },
  { id: "tag-green", label: "绿色", color: "#28cd41" },
  { id: "tag-blue", label: "蓝色", color: "#007aff" },
  { id: "tag-purple", label: "紫色", color: "#af52de" },
  { id: "tag-gray", label: "灰色", color: "#8e8e93" },
];

const mockFiles: Record<string, FileItem[]> = {
  recents: [
    {
      id: "r1",
      name: "Cursor-win32-x64-2.5.17-manual.dmg",
      kind: "disk",
      kindLabel: "磁盘映像",
      openedAt: "2026年3月26日 12:39",
      size: "188 MB",
    },
    {
      id: "r2",
      name: "Cursor-darwin-arm64-2.5.20.dmg",
      kind: "disk",
      kindLabel: "磁盘映像",
      openedAt: "2026年3月26日 12:14",
      size: "176 MB",
    },
    {
      id: "r3",
      name: "Cursor 2.5.17-manual",
      kind: "folder",
      kindLabel: "文件夹",
      openedAt: "2026年3月26日 12:05",
      size: "--",
    },
    {
      id: "r4",
      name: "CursorSetup-x64-2.5.17-manual.exe",
      kind: "file",
      kindLabel: "Windows 可执行文件",
      openedAt: "2026年3月26日 11:53",
      size: "142 MB",
    },
    {
      id: "r5",
      name: "1.txt",
      kind: "document",
      kindLabel: "纯文本文稿",
      openedAt: "2026年3月26日 11:34",
      size: "1 KB",
    },
    {
      id: "r6",
      name: "Cursor-darwin-arm64.dmg",
      kind: "disk",
      kindLabel: "磁盘映像",
      openedAt: "2026年3月26日 00:16",
      size: "170 MB",
    },
    {
      id: "r7",
      name: "CursorSetup-x64.exe",
      kind: "file",
      kindLabel: "Windows 可执行文件",
      openedAt: "2026年3月26日 00:15",
      size: "140 MB",
    },
    {
      id: "r8",
      name: "cursor_2.5.20_amd64.deb",
      kind: "file",
      kindLabel: "Debian 软件包",
      openedAt: "2026年3月25日 21:54",
      size: "132 MB",
    },
    {
      id: "r9",
      name: "Cursor-darwin-universal.dmg",
      kind: "disk",
      kindLabel: "磁盘映像",
      openedAt: "2026年3月25日 21:53",
      size: "312 MB",
    },
    {
      id: "r10",
      name: "node-v22.14.0.pkg",
      kind: "file",
      kindLabel: "安装器软件包",
      openedAt: "2026年3月25日 17:12",
      size: "74 MB",
    },
  ],
  shared: [],
  apps: [
    {
      id: "a1",
      name: "Safari.app",
      kind: "file",
      kindLabel: "应用程序",
      openedAt: "2026年3月20日 09:00",
      size: "--",
    },
    {
      id: "a2",
      name: "Notes.app",
      kind: "file",
      kindLabel: "应用程序",
      openedAt: "2026年3月18日 16:22",
      size: "--",
    },
  ],
  desktop: [
    {
      id: "d1",
      name: "项目说明.txt",
      kind: "document",
      kindLabel: "纯文本文稿",
      openedAt: "2026年3月26日 09:12",
      size: "2 KB",
    },
    {
      id: "d2",
      name: "截图.png",
      kind: "image",
      kindLabel: "PNG 图像",
      openedAt: "2026年3月25日 18:40",
      size: "1.2 MB",
    },
    {
      id: "d3",
      name: "工作",
      kind: "folder",
      kindLabel: "文件夹",
      openedAt: "2026年3月24日 14:02",
      size: "--",
    },
  ],
  documents: [
    {
      id: "doc1",
      name: "会议纪要.md",
      kind: "document",
      kindLabel: "Markdown 文稿",
      openedAt: "2026年3月26日 11:20",
      size: "8 KB",
    },
    {
      id: "doc2",
      name: "设计稿",
      kind: "folder",
      kindLabel: "文件夹",
      openedAt: "2026年3月19日 10:00",
      size: "--",
    },
  ],
  downloads: [
    {
      id: "dl1",
      name: "installer.dmg",
      kind: "disk",
      kindLabel: "磁盘映像",
      openedAt: "2026年3月26日 08:01",
      size: "86 MB",
    },
    {
      id: "dl2",
      name: "参考图.jpg",
      kind: "image",
      kindLabel: "JPEG 图像",
      openedAt: "2026年3月25日 21:15",
      size: "3.4 MB",
    },
  ],
  trash: [
    {
      id: "t1",
      name: "旧备份.zip",
      kind: "file",
      kindLabel: "ZIP 归档",
      openedAt: "2026年3月01日 12:00",
      size: "24 MB",
    },
  ],
};

function SidebarGlyph({ type }: { type: SidebarIconType }) {
  const className =
    "mt-[0.125em] size-[15px] shrink-0 text-[var(--finder-icon)]";
  const stroke = 2.5;

  switch (type) {
    case "recents":
      return <Clock className={className} strokeWidth={stroke} />;
    case "shared":
      return <Users className={className} strokeWidth={stroke} />;
    case "apps":
      return <AppWindow className={className} strokeWidth={stroke} />;
    case "desktop":
      return <Monitor className={className} strokeWidth={stroke} />;
    case "documents":
      return <FileText className={className} strokeWidth={stroke} />;
    case "downloads":
      return <ArrowDownCircle className={className} strokeWidth={stroke} />;
    case "drive":
      return <HardDrive className={className} strokeWidth={stroke} />;
    case "trash":
      return <Trash2 className={className} strokeWidth={stroke} />;
  }
}

function FileGlyph({
  kind,
  size = "sm",
  active = false,
  iconDataUrl,
  isImagePreview = false,
}: {
  kind: FileItem["kind"];
  size?: "sm" | "lg";
  active?: boolean;
  iconDataUrl?: string;
  /** 真实图片预览（非外壳图标） */
  isImagePreview?: boolean;
}) {
  const tone = active
    ? "text-white"
    : size === "lg"
      ? "text-[var(--finder-accent)]"
      : "text-[var(--finder-icon)]";
  const className = `${
    size === "lg" ? "size-16" : "mt-[0.125em] size-4"
  } ${tone}`;

  if (iconDataUrl) {
    if (size === "lg" && isImagePreview) {
      return (
        <img
          src={iconDataUrl}
          alt=""
          className="size-[56px] rounded-[8px] object-cover bg-[#f2f2f2]"
          draggable={false}
          decoding="async"
        />
      );
    }
    return (
      <img
        src={iconDataUrl}
        alt=""
        className={`${size === "lg" ? "size-[56px]" : "mt-[0.125em] size-4"} object-contain bg-transparent`}
        draggable={false}
        decoding="async"
      />
    );
  }

  switch (kind) {
    case "folder":
      return <Folder className={className} strokeWidth={2.5} />;
    case "document":
      return <FileText className={className} strokeWidth={2.5} />;
    case "image":
      return <ImageIcon className={className} strokeWidth={2.5} />;
    case "disk":
      return <HardDrive className={className} strokeWidth={2.5} />;
    case "file":
      return <File className={className} strokeWidth={2.5} />;
  }
}

function SidebarButton({
  item,
  active,
  onSelect,
}: {
  item: SidebarItem;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-[7px] rounded-[6px] px-[10px] py-[4px] text-left text-[13px] leading-[18px] text-[var(--finder-text)] ${
        active
          ? "bg-[var(--finder-sidebar-selected)] font-medium"
          : "hover:bg-[var(--finder-hover)]"
      }`}
      onClick={() => onSelect(item.id)}
    >
      <SidebarGlyph type={item.icon} />
      <span className="truncate">{item.label}</span>
    </button>
  );
}

const BUILTIN_APP_TILE: Record<
  BuiltinEditorKind,
  { bg: string; glyph: string }
> = {
  word: { bg: "#2b5cff", glyph: "W" },
  excel: { bg: "#1f7a3f", glyph: "X" },
  markdown: { bg: "#5b5b5f", glyph: "M" },
};

function BuiltinAppsPage({
  appIcons,
  onOpen,
}: {
  appIcons: IconSettings["apps"];
  onOpen: (app: (typeof builtinAppEntries)[number]) => void;
}) {
  return (
    <div className="min-h-full p-6">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-4">
        {builtinAppEntries.map((app) => {
          const tile = BUILTIN_APP_TILE[app.kind];
          const custom = appIcons[app.id];
          return (
            <button
              key={app.id}
              type="button"
              className="group flex flex-col items-center gap-2 rounded-[12px] p-3 text-center hover:bg-[var(--finder-hover)]"
              onDoubleClick={() => onOpen(app)}
              onClick={() => onOpen(app)}
            >
              {custom ? (
                <span className="flex size-[72px] items-center justify-center overflow-hidden rounded-[18px] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-transform group-active:scale-[0.97]">
                  <img
                    src={custom}
                    alt=""
                    className="size-[72px] object-contain"
                    draggable={false}
                  />
                </span>
              ) : (
                <span
                  className="flex size-[72px] items-center justify-center rounded-[18px] text-[28px] font-semibold text-white shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-transform group-active:scale-[0.97]"
                  style={{ backgroundColor: tile.bg }}
                >
                  {tile.glyph}
                </span>
              )}
              <span className="w-full truncate text-[12px] leading-[16px] text-[var(--finder-text)]">
                {app.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function App({
  initialPath = null,
  zoomIn = false,
  pickMode = null,
  pickTarget = null,
}: {
  initialPath?: string | null;
  zoomIn?: boolean;
  /** 设置等场景：用本资源管理器选图片 */
  pickMode?: "image" | null;
  /** 选图用途：avatar / global:folder / custom-new … */
  pickTarget?: string | null;
}) {
  const [activeSidebar, setActiveSidebar] = useState("drive-c");
  const activeSidebarRef = useRef(activeSidebar);
  activeSidebarRef.current = activeSidebar;
  const [appSettings, setAppSettings] = useState<AppSettings>(() =>
    loadAppSettings(),
  );
  const [iconSettings, setIconSettings] = useState<IconSettings>(() =>
    loadIconSettings(),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(readStoredViewMode);
  const [search] = useState("");
  const [marquee, setMarquee] = useState<SelBox | null>(null);
  const [drives, setDrives] = useState<DriveInfo[]>([]);
  const [driveFiles, setDriveFiles] = useState<Record<string, FileItem[]>>({});
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const currentPathRef = useRef<string | null>(null);
  currentPathRef.current = currentPath;
  const [pathEditing, setPathEditing] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const pathInputRef = useRef<HTMLInputElement>(null);
  const [folderItems, setFolderItems] = useState<FileItem[]>([]);
  const dirCacheRef = useRef<Map<string, FileItem[]>>(new Map());
  const specialPathRef = useRef<Record<string, string>>({});
  const specialReqRef = useRef(0);
  const recentsCacheRef = useRef<FileItem[] | null>(null);
  const recentsReqRef = useRef(0);
  const trashCacheRef = useRef<FileItem[] | null>(null);
  const trashReqRef = useRef(0);
  const iconHydrateGenRef = useRef(0);
  /** 外壳图标独立缓存，禁止写回 folderItems（否则会触发整表重排/重渲染） */
  const [iconByPath, setIconByPath] = useState<Record<string, string>>({});
  const iconByPathRef = useRef(iconByPath);
  iconByPathRef.current = iconByPath;
  const [pathTags, setPathTags] = useState<Record<string, string>>({});
  const [navStack, setNavStack] = useState<string[]>([]);
  const [navIndex, setNavIndex] = useState(-1);
  const [columns, setColumns] = useState<ColumnPane[]>([]);
  const [columnPreview, setColumnPreview] = useState<ColumnFileItem | null>(
    null,
  );

  const [favoritePick, setFavoritePick] = useState<FavoritePickTarget | null>(null);
  const [favoriteFolderId, setFavoriteFolderId] = useState<number | null>(null);
  const [favBarFolders, setFavBarFolders] = useState<
    { id: number; name: string; sortOrder: number }[]
  >([]);
  const [favBarItems, setFavBarItems] = useState<
    {
      id: number;
      folderId: number;
      path: string;
      name: string;
      kind: string;
      kindLabel: string;
    }[]
  >([]);
  const [favBarActiveFolderId, setFavBarActiveFolderId] = useState<number | null>(
    null,
  );
  const [favBarMenu, setFavBarMenu] = useState<{
    folderId: number;
    anchor: DOMRect;
  } | null>(null);
  const [favBarDropTargetId, setFavBarDropTargetId] = useState<number | null>(
    null,
  );
  const [fileDragging, setFileDragging] = useState(false);
  const [fileDropTargetPath, setFileDropTargetPath] = useState<string | null>(
    null,
  );
  const [dragGhost, setDragGhost] = useState<{
    x: number;
    y: number;
    label: string;
  } | null>(null);
  const fileDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    started: boolean;
    /** 已交给系统原生拖出，避免与应用内拖放冲突 */
    osDragStarted: boolean;
    payload: {
      path: string;
      name: string;
      kind: string;
      kindLabel: string;
    }[];
    label: string;
    /** 拖出预览图标（png data URL） */
    previewIcon: string | null;
  } | null>(null);
  const [favFolderDialog, setFavFolderDialog] = useState<
    null | { mode: "create" } | { mode: "rename"; folderId: number; name: string }
  >(null);
  const [batchCreateOpen, setBatchCreateOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
    null,
  );
  const [openWithApps, setOpenWithApps] = useState<OpenWithApp[]>([]);
  const [clipboard, setClipboard] = useState<FileClipboard | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    additive: boolean;
    baseIds: string[];
    moved: boolean;
  } | null>(null);
  const glassConfig = DEFAULT_LIQUID_GLASS_CONFIG;
  // 外壳玻璃关掉（0 需 LiquidGlass 显式支持，否则会被默认值吞掉）
  const shellGlassConfig = {
    ...DEFAULT_LIQUID_GLASS_CONFIG,
    frost: 0.6,
    tint: 0.22,
    scale: 36,
  };

  const thisPcItems = useMemo(
    () => [...drives.map(driveToSidebarItem), trashItem],
    [drives],
  );

  const allSidebarItems = useMemo(
    () => [...topItems, ...favorites, ...thisPcItems],
    [thisPcItems],
  );

  const browsingRealFs = currentPath !== null;
  const isTagSidebar = activeSidebar.startsWith("tag-");
  const isBuiltinApps = activeSidebar === "builtin-apps";
  const virtualSidebar =
    activeSidebar === "recents" ||
    activeSidebar === "favorites" ||
    activeSidebar === "shared" ||
    activeSidebar === "trash" ||
    isBuiltinApps ||
    isTagSidebar;

  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [groupBy, setGroupBy] = useState<SortKey | null>(null);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [sortMenuAnchor, setSortMenuAnchor] = useState<DOMRect | null>(null);
  const sortBtnRef = useRef<HTMLButtonElement>(null);

  const files = useMemo(() => {
    const list =
      browsingRealFs || virtualSidebar
        ? folderItems
        : (driveFiles[activeSidebar] ?? mockFiles[activeSidebar] ?? []);
    const q = search.trim();
    if (q) {
      return list
        .map((item) => ({ item, score: nameSearchScore(item.name, q) }))
        .filter((x) => x.score >= 0)
        .sort(
          (a, b) =>
            b.score - a.score || a.item.name.localeCompare(b.item.name, "zh"),
        )
        .map((x) => x.item);
    }
    // 后端 list_dir 已按「文件夹优先 + 名称」排好；默认排序直接复用，避免上万次 localeCompare
    if (sortKey === "name" && sortDir === "asc") return list;
    return sortFileItems(list, sortKey, sortDir, pathTags);
  }, [
    activeSidebar,
    search,
    driveFiles,
    browsingRealFs,
    virtualSidebar,
    folderItems,
    sortKey,
    sortDir,
    pathTags,
  ]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const sidebarLabel =
    tags.find((t) => t.id === activeSidebar)?.label ??
    allSidebarItems.find((item) => item.id === activeSidebar)?.label ??
    "访达";
  const pathLeaf = currentPath
    ? currentPath.replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean).pop()
    : null;
  const activeLabel = pathLeaf ?? sidebarLabel;
  const breadcrumbs = currentPath
    ? pathBreadcrumbs(currentPath)
    : activeLabel
      ? [{ label: activeLabel, path: "" }]
      : [];
  const canGoBack =
    (activeSidebar === "favorites" && favoriteFolderId != null) || navIndex > 0;
  const canGoForward = navIndex >= 0 && navIndex < navStack.length - 1;

  const normPathKey = useCallback((path: string) => {
    let p = path.replace(/\//g, "\\").replace(/[\\/]+$/, "");
    if (p.length >= 2 && p[1] === ":") {
      p = p[0].toUpperCase() + p.slice(1);
    }
    return p;
  }, []);

  const resolveIcon = useCallback(
    (item: {
      path?: string;
      id: string;
      name?: string;
      iconDataUrl?: string;
      kind: string;
    }) => {
      const path = item.path ?? item.id;
      const override = resolveOverrideIcon(iconSettings, item);
      if (override) return override;
      if (item.kind === "folder") return undefined;
      const preview = localImagePreviewSrc(path, item.kind);
      if (preview) return preview;
      if (item.iconDataUrl) return item.iconDataUrl;
      return iconByPath[normFsPath(path)];
    },
    [iconByPath, iconSettings],
  );

  const isImagePreviewItem = useCallback(
    (item: { path?: string; id: string; name?: string; kind: string }) => {
      // 有自定义/全局覆盖时不当作相册预览
      if (resolveOverrideIcon(iconSettings, item)) return false;
      return Boolean(localImagePreviewSrc(item.path ?? item.id, item.kind));
    },
    [iconSettings],
  );

  const hydrateIconsFor = useCallback((items: FileItem[]) => {
    if (!isTauri()) return;
    const paths = items
      .filter((i) => {
        if (i.kind === "folder") return false;
        // 图片直接预览，不必再抽外壳图标
        if (i.kind === "image" || isImageFilePath(i.path ?? i.id)) return false;
        if (resolveOverrideIcon(iconSettings, i)) return false;
        if (i.iconDataUrl) return false;
        const key = normFsPath(i.path ?? i.id);
        return Boolean(i.path ?? i.id) && !iconByPathRef.current[key];
      })
      .map((i) => i.path ?? i.id);
    if (!paths.length) return;
    const gen = iconHydrateGenRef.current;
    void fetchShellIconsBatched(paths, {
      batchSize: 24,
      isCancelled: () => gen !== iconHydrateGenRef.current,
      onBatch: (rows) => {
        const map = iconMapFromRows(rows);
        if (!map.size) return;
        setIconByPath((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const [k, v] of map) {
            if (!next[k]) {
              next[k] = v;
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
    });
  }, [iconSettings]);

  const loadFolder = useCallback(async (path: string) => {
    // 新目录：作废图标任务 + 清空图标缓存，先上屏无图标列表
    iconHydrateGenRef.current += 1;
    setIconByPath({});
    const entries = await invoke<DirEntryInfo[]>("list_dir", { path });
    const items = entries.map(toFileItem);
    dirCacheRef.current.set(normPathKey(path), items);
    setFolderItems(items);
    setCurrentPath(path);
    return items;
  }, [normPathKey]);

  const loadTrashView = useCallback(async () => {
    if (!isTauri()) {
      setFolderItems([]);
      setSelectedIds([]);
      return;
    }
    const req = ++trashReqRef.current;
    try {
      // 1) 同步 peek 内存/磁盘缓存，立刻上屏（不扫盘）
      try {
        const peeked = await invoke<DirEntryInfo[] | null>("peek_recycle_bin");
        if (req !== trashReqRef.current) return;
        if (peeked && peeked.length) {
          const items = peeked.map(toFileItem);
          trashCacheRef.current = items;
          if (activeSidebarRef.current === "trash") {
            setFolderItems(items);
          }
        }
      } catch {
        /* peek 失败再走全量 */
      }

      // 2) 按指纹刷新；变了才后台重扫
      const entries = await invoke<DirEntryInfo[]>("list_recycle_bin");
      if (req !== trashReqRef.current) return;
      const items = entries.map(toFileItem);
      trashCacheRef.current = items;
      if (activeSidebarRef.current !== "trash") return;
      setFolderItems(items);
      setSelectedIds([]);
    } catch (err) {
      if (req !== trashReqRef.current) return;
      console.error("list_recycle_bin failed", err);
      if (!trashCacheRef.current && activeSidebarRef.current === "trash") {
        setFolderItems([]);
        setSelectedIds([]);
      }
    }
  }, []);

  // 列表虚拟窗口（固定行高）
  const LIST_ROW_H = 28;
  const listVirt = useVirtualRange(files.length, LIST_ROW_H, 10);
  const listVisible = useMemo(
    () => files.slice(listVirt.start, listVirt.end),
    [files, listVirt.start, listVirt.end],
  );

  // 宫格：按行虚拟化
  const [gridCols, setGridCols] = useState(6);
  const GRID_CELL_H = 112;
  const gridRows = Math.max(1, Math.ceil(files.length / Math.max(gridCols, 1)));
  const gridVirt = useVirtualRange(gridRows, GRID_CELL_H, 2);
  const gridVisibleRows = useMemo(() => {
    const cols = Math.max(gridCols, 1);
    const rows: FileItem[][] = [];
    for (let r = gridVirt.start; r < gridVirt.end; r++) {
      const startIdx = r * cols;
      rows.push(files.slice(startIdx, startIdx + cols));
    }
    return rows;
  }, [files, gridCols, gridVirt.start, gridVirt.end]);

  useEffect(() => {
    if (viewMode === "columns") return;
    const slice =
      viewMode === "list" ? listVisible : gridVisibleRows.flat();
    if (slice.length) hydrateIconsFor(slice);
  }, [viewMode, listVisible, gridVisibleRows, hydrateIconsFor]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el || viewMode === "columns") return;
    if (viewMode === "list") return listVirt.attach(el);
    const w = el.clientWidth - 40;
    setGridCols(Math.max(1, Math.floor((w + 12) / (96 + 12))));
    return gridVirt.attach(el);
  }, [listVirt.attach, gridVirt.attach, viewMode, files.length]);

  const navigateTo = useCallback(
    async (path: string, mode: "push" | "replace" | "jump" = "push") => {
      if (!isTauri()) return [];
      try {
        const items = await loadFolder(path);
        if (mode === "replace") {
          setNavStack([path]);
          setNavIndex(0);
        } else if (mode === "push") {
          setNavStack((prev) => {
            const base = prev.slice(0, Math.max(0, navIndex) + 1);
            // 避免连续重复同一路径
            if (base[base.length - 1] === path) {
              setNavIndex(base.length - 1);
              return base;
            }
            const next = [...base, path];
            setNavIndex(next.length - 1);
            return next;
          });
        }
        setSelectedIds([]);
        setMarquee(null);
        return items;
      } catch (err) {
        console.error(`list_dir failed for ${path}`, err);
        return null;
      }
    },
    [loadFolder, navIndex],
  );

  const startPathEdit = useCallback(() => {
    setPathInput(currentPath ?? "");
    setPathEditing(true);
  }, [currentPath]);

  const cancelPathEdit = useCallback(() => {
    setPathEditing(false);
    setPathInput("");
  }, []);

  const commitPathEdit = useCallback(async () => {
    let next = pathInput.trim();
    if (
      (next.startsWith('"') && next.endsWith('"')) ||
      (next.startsWith("'") && next.endsWith("'"))
    ) {
      next = next.slice(1, -1).trim();
    }
    next = next.replace(/\//g, "\\");
    if (!next) {
      cancelPathEdit();
      return;
    }
    const result = await navigateTo(next, "push");
    if (result !== null) {
      setPathEditing(false);
      setPathInput("");
    }
  }, [pathInput, navigateTo, cancelPathEdit]);

  useEffect(() => {
    if (!pathEditing) return;
    const el = pathInputRef.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [pathEditing]);

  const refreshFavBar = useCallback(async () => {
    if (!isTauri()) {
      setFavBarFolders([]);
      setFavBarItems([]);
      return;
    }
    try {
      const folders = await invoke<
        { id: number; name: string; sortOrder: number }[]
      >("list_favorite_folders");
      setFavBarFolders(folders);
      const batches = await Promise.all(
        folders.map(async (f) => {
          try {
            return await invoke<
              {
                id: number;
                folderId: number;
                path: string;
                name: string;
                kind: string;
                kindLabel: string;
              }[]
            >("list_favorites", { folderId: f.id });
          } catch {
            return [];
          }
        }),
      );
      setFavBarItems(batches.flat());
    } catch (err) {
      console.error("refreshFavBar failed", err);
    }
  }, []);

  /* favorites-mgmt */
  const loadFavoritesView = useCallback(async (folderId: number | null = null) => {
    if (!isTauri()) {
      setFolderItems([]);
      setSelectedIds([]);
      return;
    }
    try {
      if (folderId == null) {
        const folders = await invoke<
          { id: number; name: string; sortOrder: number }[]
        >("list_favorite_folders");
        const items: FileItem[] = folders.map((f) => ({
          id: `fav-folder-${f.id}`,
          name: f.name,
          kind: "folder",
          kindLabel: "收藏夹",
          openedAt: "--",
          size: "--",
          path: `${FAV_FOLDER_PREFIX}${f.id}`,
        }));
        setFolderItems(items);
        setSelectedIds([]);
        return;
      }

      const rows = await invoke<
        {
          id: number;
          folderId: number;
          path: string;
          name: string;
          kind: string;
          kindLabel: string;
        }[]
      >("list_favorites", { folderId });
      const items: FileItem[] = rows.map((r) => ({
        id: `fav-${r.id}`,
        name: r.name,
        kind: (["folder", "document", "image", "file", "disk"].includes(r.kind)
          ? r.kind
          : "file") as FileItem["kind"],
        kindLabel: r.kindLabel || "收藏",
        openedAt: "--",
        size: "--",
        path: r.path,
      }));
      setFolderItems(items);
      setSelectedIds([]);
    } catch (err) {
      console.error("loadFavoritesView failed", err);
      setFolderItems([]);
      setSelectedIds([]);
    }
  }, []);

  const loadTagView = useCallback(
    async (tagId: string) => {
      const tag = tags.find((t) => t.id === tagId);
      if (!tag) {
        setFolderItems([]);
        setSelectedIds([]);
        return;
      }
      const colorLc = tag.color.toLowerCase();

      // 与圆点同源：先用本地 pathTags 筛出，保证能立刻看到
      const localItems: FileItem[] = Object.entries(pathTags)
        .filter(([, c]) => c.toLowerCase() === colorLc)
        .map(([key]) => {
          const name =
            key.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || key;
          return {
            id: key,
            name,
            kind: "file" as const,
            kindLabel: "文件",
            openedAt: "--",
            size: "--",
            path: key,
          };
        });
      setFolderItems(localItems);
      setSelectedIds([]);

      if (!isTauri()) return;
      try {
        const entries = await invoke<DirEntryInfo[]>("list_items_by_tag", {
          color: tag.color,
        });
        const items = entries.map(toFileItem);
        // 后端有数据则替换（含正确 kind/图标）；否则保留本地结果
        if (items.length > 0 || localItems.length === 0) {
          setFolderItems(items);
          setSelectedIds([]);
        }
      } catch (err) {
        console.error("list_items_by_tag failed", err);
        // 保留 localItems
      }
    },
    [pathTags],
  );

  const confirmImagePick = useCallback(
    async (path: string) => {
      if (!pickMode || !isImageFilePath(path)) return;
      try {
        const target = decodePickTarget(pickTarget);
        if (target) {
          await applyPickedImage(path, target);
        }
        const { emit, emitTo } = await import("@tauri-apps/api/event");
        const payload = { path, pickTarget: pickTarget ?? null };
        await emit("settings-file-picked", payload);
        try {
          await emitTo("settings", "settings-file-picked", payload);
        } catch {
          /* settings 窗口可能未开 */
        }
        await getCurrentWindow().close();
      } catch (err) {
        console.error("settings-file-picked failed", err);
      }
    },
    [pickMode, pickTarget],
  );

  const openItem = useCallback(
    (item: FileItem) => {
      const path = item.path ?? item.id;
      if (!path) return;
      setContextMenu(null);
      if (activeSidebar === "trash") {
        if (!isTauri()) return;
        void invoke("restore_recycle_bin_item", { path })
          .then(() => loadTrashView())
          .catch((err) => console.error("restore failed", err));
        return;
      }
      if (isFavoriteFolderPath(path)) {
        const fid = parseFavoriteFolderId(path);
        if (!Number.isFinite(fid)) return;
        setActiveSidebar("favorites");
        setCurrentPath(null);
        setFavoriteFolderId(fid);
        void loadFavoritesView(fid);
        return;
      }
      if (item.kind === "folder") {
        void navigateTo(path, "push");
        return;
      }
      if (pickMode === "image") {
        if (isImageFilePath(path)) void confirmImagePick(path);
        return;
      }
      if (isTauri()) {
        void invoke("open_path", { path }).catch((err) =>
          console.error("open_path failed", err),
        );
      }
    },
    [
      navigateTo,
      loadFavoritesView,
      loadTrashView,
      activeSidebar,
      pickMode,
      confirmImagePick,
    ],
  );

  const refreshCurrent = useCallback(async () => {
    if (!isTauri()) return;
    try {
      if (activeSidebar === "favorites") {
        await loadFavoritesView(favoriteFolderId);
        return;
      }
      if (activeSidebar === "trash") {
        await loadTrashView();
        return;
      }
      if (activeSidebar === "recents") {
        const rows = await invoke<DirEntryInfo[]>("list_recents");
        const items = rows.map(toFileItem);
        recentsCacheRef.current = items;
        setFolderItems(items);
        setSelectedIds((prev) =>
          prev.filter((id) => items.some((f) => f.id === id)),
        );
        return;
      }
      if (!currentPath) return;
      const items = await loadFolder(currentPath);
      setSelectedIds((prev) =>
        prev.filter((id) => items.some((f) => f.id === id)),
      );
    } catch (err) {
      console.error("refresh failed", err);
    }
  }, [
    activeSidebar,
    currentPath,
    favoriteFolderId,
    loadFavoritesView,
    loadFolder,
    loadTrashView,
  ]);

  const workingDir = useCallback(() => {
    return (
      currentPath ??
      drives.find((d) => d.id === activeSidebar)?.path ??
      null
    );
  }, [currentPath, drives, activeSidebar]);

  const getSelectedPaths = useCallback(() => {
    if (selectedIds.length === 0) return [] as string[];
    return files
      .filter((f) => selectedIds.includes(f.id))
      .map((f) => f.path ?? f.id)
      .filter(Boolean);
  }, [files, selectedIds]);

  const pickCandidate = useMemo(() => {
    if (pickMode !== "image" || selectedIds.length !== 1) return null;
    const item = files.find((f) => f.id === selectedIds[0]);
    if (!item || item.kind === "folder") return null;
    const path = item.path ?? item.id;
    if (!path || !isImageFilePath(path)) return null;
    return { path, name: item.name };
  }, [pickMode, selectedIds, files]);

  /** 先更新视图，再后台移入废纸篓 */
  const trashPathsOptimistic = useCallback(
    (paths: string[]) => {
      if (!paths.length) return;
      const remove = new Set(paths);
      setFolderItems((prev) =>
        prev.filter((f) => !remove.has(f.path ?? f.id) && !remove.has(f.id)),
      );
      setDriveFiles((prev) => {
        if (!currentPath) return prev;
        const drive = drives.find((d) =>
          currentPath.toLowerCase().startsWith(d.path.toLowerCase()),
        );
        if (!drive || !(drive.id in prev)) return prev;
        return {
          ...prev,
          [drive.id]: prev[drive.id].filter(
            (f) => !remove.has(f.path ?? f.id) && !remove.has(f.id),
          ),
        };
      });
      setSelectedIds([]);
      setMarquee(null);
      setContextMenu(null);

      if (!isTauri()) return;
      void (async () => {
        try {
          await Promise.all(
            paths.map((path) => invoke("trash_path", { path })),
          );
          if (activeSidebar === "trash") {
            await loadTrashView();
          }
        } catch (err) {
          console.error("trash failed", err);
          await refreshCurrent();
        }
      })();
    },
    [currentPath, drives, refreshCurrent, activeSidebar, loadTrashView],
  );

  const copySelection = useCallback(() => {
    const paths = getSelectedPaths();
    if (paths.length) setClipboard({ mode: "copy", paths });
  }, [getSelectedPaths]);

  const cutSelection = useCallback(() => {
    const paths = getSelectedPaths();
    if (paths.length) setClipboard({ mode: "cut", paths });
  }, [getSelectedPaths]);

  const pasteClipboard = useCallback(async () => {
    const dir = workingDir();
    if (!dir || !clipboard || !isTauri()) return;
    try {
      for (const src of clipboard.paths) {
        if (clipboard.mode === "cut") {
          await invoke("move_path", { from: src, toDir: dir });
        } else {
          await invoke("copy_into", { from: src, toDir: dir });
        }
      }
      if (clipboard.mode === "cut") setClipboard(null);
      await refreshCurrent();
    } catch (err) {
      console.error("paste failed", err);
    }
  }, [clipboard, workingDir, refreshCurrent]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  const columnsRootPathRef = useRef<string | null>(null);

  // 分栏：以当前目录为第 0 列；同路径下只同步列表，保留下钻
  useEffect(() => {
    if (viewMode !== "columns") {
      setColumns([]);
      setColumnPreview(null);
      columnsRootPathRef.current = null;
      return;
    }
    // 标签/最近使用等虚拟页：无真实路径，用 folderItems 做单列
    if (!currentPath) {
      if (virtualSidebar) {
        const root = activeSidebar;
        columnsRootPathRef.current = root;
        setColumns([{ path: root, items: folderItems, selectedId: null }]);
        setColumnPreview(null);
      } else {
        setColumns([]);
        setColumnPreview(null);
        columnsRootPathRef.current = null;
      }
      return;
    }
    const pathChanged = columnsRootPathRef.current !== currentPath;
    columnsRootPathRef.current = currentPath;
    if (pathChanged) {
      setColumns([
        { path: currentPath, items: folderItems, selectedId: null },
      ]);
      setColumnPreview(null);
      return;
    }
    setColumns((prev) =>
      prev.length > 0
        ? [{ ...prev[0], items: folderItems }, ...prev.slice(1)]
        : [{ path: currentPath, items: folderItems, selectedId: null }],
    );
  }, [viewMode, currentPath, folderItems, virtualSidebar, activeSidebar]);

  const selectInColumn = useCallback(
    async (columnIndex: number, item: ColumnFileItem) => {
      setSelectedIds([item.id]);
      if (item.kind === "folder") {
        const path = item.path ?? item.id;
        setColumnPreview(null);
        try {
          const entries = await invoke<DirEntryInfo[]>("list_dir", { path });
          const items = entries.map(toFileItem);
          setColumns((prev) => [
            ...prev.slice(0, columnIndex + 1).map((c, i) =>
              i === columnIndex ? { ...c, selectedId: item.id } : c,
            ),
            { path, items, selectedId: null },
          ]);
        } catch (err) {
          console.error("column list_dir failed", err);
          setColumns((prev) =>
            prev.slice(0, columnIndex + 1).map((c, i) =>
              i === columnIndex ? { ...c, selectedId: item.id } : c,
            ),
          );
        }
        return;
      }
      setColumns((prev) =>
        prev.slice(0, columnIndex + 1).map((c, i) =>
          i === columnIndex ? { ...c, selectedId: item.id } : c,
        ),
      );
      setColumnPreview(item);
    },
    [],
  );

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable)
      ) {
        return;
      }
      if (renamingId) return;

      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (ctrl && key === "a") {
        e.preventDefault();
        setSelectedIds(files.map((f) => f.id));
        return;
      }
      if (ctrl && key === "c") {
        e.preventDefault();
        copySelection();
        return;
      }
      if (ctrl && key === "x") {
        e.preventDefault();
        cutSelection();
        return;
      }
      if (ctrl && key === "v") {
        e.preventDefault();
        void pasteClipboard();
        return;
      }
      if (key === "delete" || key === "backspace") {
        // Windows：Delete 移到废纸篓；废纸篓内则为永久删除
        if (key === "backspace" && !e.ctrlKey) return;
        e.preventDefault();
        const paths = getSelectedPaths();
        if (!paths.length) return;
        if (activeSidebar === "trash") {
          if (!isTauri()) return;
          void (async () => {
            try {
              await Promise.all(
                paths.map((path) =>
                  invoke("delete_recycle_bin_item", { path }),
                ),
              );
              await loadTrashView();
            } catch (err) {
              console.error("delete_recycle_bin_item failed", err);
            }
          })();
          return;
        }
        trashPathsOptimistic(paths);
        return;
      }
      if (key === "f2" && selectedIds.length === 1) {
        e.preventDefault();
        const item = files.find((f) => f.id === selectedIds[0]);
        if (item) {
          setRenamingId(item.id);
          setRenameDraft(item.name);
        }
        return;
      }
      if (key === "enter" && selectedIds.length === 1) {
        const item = files.find((f) => f.id === selectedIds[0]);
        if (item) {
          e.preventDefault();
          openItem(item);
        }
        return;
      }
      if (key === "escape") {
        setContextMenu(null);
        setSelectedIds([]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    renamingId,
    files,
    selectedIds,
    copySelection,
    cutSelection,
    pasteClipboard,
    getSelectedPaths,
    trashPathsOptimistic,
    openItem,
    activeSidebar,
    loadTrashView,
  ]);

  useEffect(() => {
    if (!isTauri()) return;
    void invoke<{ path: string; color: string }[]>("list_item_tags")
      .then((rows) => {
        const map: Record<string, string> = {};
        for (const row of rows) {
          map[pathKey(row.path)] = row.color;
        }
        setPathTags(map);
      })
      .catch((err) => console.error("list_item_tags failed", err));
  }, []);

  useEffect(() => {
    const apply = (next: AppSettings) => setAppSettings(next);
    const reloadIcons = () => setIconSettings(loadIconSettings());
    void migrateIconBlackBackgrounds().then((next) => {
      setIconSettings(next ?? loadIconSettings());
    });
    const onLocal = (e: Event) => {
      const detail = (e as CustomEvent<AppSettings>).detail;
      if (detail) apply(detail);
      else apply(loadAppSettings());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === "yc-app-settings") apply(loadAppSettings());
      if (e.key === "yc-icon-settings") reloadIcons();
    };
    window.addEventListener(APP_SETTINGS_EVENT, onLocal);
    window.addEventListener("storage", onStorage);
    const onIconLocal = (e: Event) => {
      const detail = (e as CustomEvent<IconSettings>).detail;
      if (detail) setIconSettings(detail);
      else reloadIcons();
    };
    window.addEventListener(ICON_SETTINGS_EVENT, onIconLocal);
    // 设置窗口改完后切回主窗口时强制重读设置/图标（目录列表进入时加载一次即可）
    const onFocus = () => {
      apply(loadAppSettings());
      reloadIcons();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") onFocus();
    });
    let unlistenApp: (() => void) | undefined;
    let unlistenIcon: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<AppSettings>(APP_SETTINGS_EVENT, (ev) => {
        if (ev.payload) apply(ev.payload);
      }).then((fn) => {
        unlistenApp = fn;
      });
      void listen<IconSettings>(ICON_SETTINGS_EVENT, (ev) => {
        if (ev.payload) setIconSettings(ev.payload);
        else reloadIcons();
      }).then((fn) => {
        unlistenIcon = fn;
      });
    });
    return () => {
      window.removeEventListener(APP_SETTINGS_EVENT, onLocal);
      window.removeEventListener(ICON_SETTINGS_EVENT, onIconLocal);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      unlistenApp?.();
      unlistenIcon?.();
    };
  }, []);

  useEffect(() => {
    if (appSettings.enableTags) return;
    if (activeSidebar.startsWith("tag-")) {
      handleSidebarSelect("desktop");
    }
  }, [appSettings.enableTags, activeSidebar]);

  useEffect(() => {
    void refreshFavBar();
  }, [refreshFavBar]);

  const toggleFavBarMenu = useCallback(
    (folderId: number, el: HTMLElement) => {
      setFavBarMenu((prev) => {
        if (prev?.folderId === folderId) return null;
        return { folderId, anchor: el.getBoundingClientRect() };
      });
    },
    [],
  );

  const openFavBarItem = useCallback(
    (item: FavBarMenuItem) => {
      setFavBarMenu(null);
      setFavBarActiveFolderId(null);
      if (item.kind === "folder") {
        void navigateTo(item.path, "replace");
        return;
      }
      if (!isTauri()) return;
      void invoke("open_path", { path: item.path }).catch((err) =>
        console.error("open fav bar item failed", err),
      );
    },
    [navigateTo],
  );

  type FavDragPayload = {
    path: string;
    name: string;
    kind: string;
    kindLabel: string;
  };

  const buildFavDragPayload = useCallback(
    (item: FileItem): FavDragPayload[] => {
      const path = item.path ?? item.id;
      if (!path || isFavoriteFolderPath(path)) return [];
      const picked =
        selectedSet.has(item.id) && selectedIds.length > 1
          ? files.filter((f) => selectedSet.has(f.id))
          : [item];
      return picked
        .map((f) => ({
          path: f.path ?? f.id,
          name: f.name,
          kind: f.kind,
          kindLabel: f.kindLabel,
        }))
        .filter((p) => p.path && !isFavoriteFolderPath(p.path));
    },
    [files, selectedIds, selectedSet],
  );

  const commitFavDrop = useCallback(
    async (folderId: number, payload: FavDragPayload[]) => {
      if (!isTauri() || !payload.length) return;
      try {
        for (const p of payload) {
          await invoke("add_favorite", {
            folderId,
            path: p.path,
            name: p.name,
            kind: p.kind,
            kindLabel: p.kindLabel,
          });
        }
        await refreshFavBar();
        if (
          activeSidebar === "favorites" &&
          (favoriteFolderId === folderId || favBarActiveFolderId === folderId)
        ) {
          await loadFavoritesView(folderId);
        }
      } catch (err) {
        console.error("drop onto fav folder failed", err);
        void showAlert(String(err));
      }
    },
    [
      activeSidebar,
      favoriteFolderId,
      favBarActiveFolderId,
      loadFavoritesView,
      refreshFavBar,
    ],
  );

  const commitMoveDrop = useCallback(
    async (toDir: string, payload: FavDragPayload[]) => {
      if (!isTauri() || !payload.length) return;
      const paths = payload.map((p) => p.path);
      if (!canDropMoveInto(paths, toDir)) return;
      try {
        for (const p of payload) {
          if (!canDropMoveInto([p.path], toDir)) continue;
          await invoke("move_path", { from: p.path, toDir });
        }
        setSelectedIds([]);
        await refreshCurrent();
      } catch (err) {
        console.error("move drop failed", err);
        void showAlert(String(err));
        await refreshCurrent();
      }
    },
    [refreshCurrent],
  );

  const beginFilePointerDrag = useCallback(
    (e: React.PointerEvent, item: FileItem) => {
      if (e.button !== 0) return;
      if (renamingId === item.id) return;
      const payload = buildFavDragPayload(item);
      if (!payload.length) return;
      const icon = resolveIcon(item);
      fileDragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        started: false,
        osDragStarted: false,
        payload,
        label:
          payload.length > 1
            ? `${payload[0].name} 等 ${payload.length} 项`
            : payload[0].name,
        previewIcon:
          typeof icon === "string" && icon.startsWith("data:image/png")
            ? icon
            : null,
      };
    },
    [buildFavDragPayload, renamingId, resolveIcon],
  );

  useEffect(() => {
    const THRESHOLD = 6;
    /** 需明显拖出 webview，避免贴边/标题栏误触启动 DoDragDrop 卡死 */
    const OUT_MARGIN = 8;
    let pendingOsDragTimer: number | null = null;
    /** 左键是否仍按下（松手后取消尚未启动的原生拖出） */
    let primaryDown = false;

    const hitFavFolderId = (x: number, y: number): number | null => {
      const el = document.elementFromPoint(x, y);
      const chip = el?.closest?.("[data-fav-folder-id]") as HTMLElement | null;
      if (!chip) return null;
      const id = Number(chip.dataset.favFolderId);
      return Number.isFinite(id) ? id : null;
    };

    const hitDropFolderPath = (
      x: number,
      y: number,
      sources: string[],
    ): string | null => {
      const el = document.elementFromPoint(x, y);
      const node = el?.closest?.(
        "[data-drop-folder-path]",
      ) as HTMLElement | null;
      const path = node?.dataset?.dropFolderPath;
      if (!path) return null;
      if (!canDropMoveInto(sources, path)) return null;
      return path;
    };

    const clearInAppDragUi = () => {
      document.body.style.cursor = "";
      setFileDragging(false);
      setDragGhost(null);
      setFavBarDropTargetId(null);
      setFileDropTargetPath(null);
    };

    const cancelPendingOsDrag = () => {
      if (pendingOsDragTimer != null) {
        window.clearTimeout(pendingOsDragTimer);
        pendingOsDragTimer = null;
      }
    };

    const handOffToOsDrag = (
      s: NonNullable<typeof fileDragRef.current>,
      buttons: number,
    ) => {
      if (s.osDragStarted || !isTauri()) return;
      // 左键已松开时绝不能调 startDrag：DoDragDrop 收不到 mouse-up 会永久卡住
      if ((buttons & 1) === 0 || !primaryDown) return;
      s.osDragStarted = true;
      const paths = s.payload.map((p) => p.path);
      const icon = s.previewIcon;
      fileDragRef.current = null;
      clearInAppDragUi();
      cancelPendingOsDrag();
      // 推迟到下一 macrotask：若用户已松手则取消，避免竞态卡死
      pendingOsDragTimer = window.setTimeout(() => {
        pendingOsDragTimer = null;
        if (!primaryDown) return;
        void startOsFileDrag(paths, icon);
      }, 0);
    };

    const onMove = (e: PointerEvent) => {
      primaryDown = (e.buttons & 1) !== 0;
      const s = fileDragRef.current;
      if (!s || s.pointerId !== e.pointerId || s.osDragStarted) return;
      if (!primaryDown) return;
      if (!s.started) {
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;
        if (dx * dx + dy * dy < THRESHOLD * THRESHOLD) return;
        s.started = true;
        setFileDragging(true);
        setFavBarMenu(null);
      }

      // 拖出窗口：交给系统，可放到桌面 / 其它应用
      const outside =
        e.clientX < -OUT_MARGIN ||
        e.clientY < -OUT_MARGIN ||
        e.clientX > window.innerWidth + OUT_MARGIN ||
        e.clientY > window.innerHeight + OUT_MARGIN;
      if (outside) {
        handOffToOsDrag(s, e.buttons);
        return;
      }

      setDragGhost({ x: e.clientX, y: e.clientY, label: s.label });
      const sources = s.payload.map((p) => p.path);
      const favId = hitFavFolderId(e.clientX, e.clientY);
      if (favId != null) {
        setFavBarDropTargetId(favId);
        setFileDropTargetPath(null);
        document.body.style.cursor = "copy";
        return;
      }
      setFavBarDropTargetId(null);
      const dropPath = hitDropFolderPath(e.clientX, e.clientY, sources);
      setFileDropTargetPath(dropPath);
      document.body.style.cursor = dropPath ? "move" : "default";
    };

    const onUp = (e: PointerEvent) => {
      primaryDown = false;
      cancelPendingOsDrag();
      const s = fileDragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      fileDragRef.current = null;
      const wasStarted = s.started && !s.osDragStarted;
      const payload = s.payload;
      const sources = payload.map((p) => p.path);
      clearInAppDragUi();
      if (!wasStarted) return;

      const swallow = (ce: MouseEvent) => {
        ce.preventDefault();
        ce.stopPropagation();
        document.removeEventListener("click", swallow, true);
      };
      document.addEventListener("click", swallow, true);
      window.setTimeout(
        () => document.removeEventListener("click", swallow, true),
        50,
      );

      const folderId = hitFavFolderId(e.clientX, e.clientY);
      if (folderId != null) {
        void commitFavDrop(folderId, payload);
        return;
      }
      const dropPath = hitDropFolderPath(e.clientX, e.clientY, sources);
      if (dropPath) void commitMoveDrop(dropPath, payload);
    };

    const onCancel = (e: PointerEvent) => {
      primaryDown = false;
      cancelPendingOsDrag();
      const s = fileDragRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      fileDragRef.current = null;
      clearInAppDragUi();
    };

    const onDown = (e: PointerEvent) => {
      if (e.button === 0) primaryDown = true;
    };

    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      cancelPendingOsDrag();
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      document.body.style.cursor = "";
    };
  }, [commitFavDrop, commitMoveDrop]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<{ path: string; openFolder?: boolean }>(
        "search-reveal",
        (ev) => {
          const path = ev.payload?.path;
          if (!path) return;
          void navigateTo(path, "push");
        },
      ).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
    };
  }, [navigateTo]);

  useEffect(() => {
    let cancelled = false;

    const loadDrives = async () => {
      if (!isTauri()) return;
      try {
        const list = await invoke<DriveInfo[]>("list_drives");
        if (cancelled) return;
        setDrives(list);

        const startPath =
          initialPath &&
          list.some((d) =>
            initialPath.toLowerCase().startsWith(d.path.toLowerCase()),
          )
            ? initialPath
            : null;

        const preferred =
          (startPath
            ? list.find((d) =>
                startPath.toLowerCase().startsWith(d.path.toLowerCase()),
              )
            : null) ??
          list.find((d) => d.letter.toUpperCase() === "C") ??
          list[0];

        if (preferred) {
          setActiveSidebar(preferred.id);
          setSelectedIds([]);
          const target = startPath ?? preferred.path;
          const items = await loadFolder(target);
          if (cancelled) return;
          setNavStack([target]);
          setNavIndex(0);
          setDriveFiles((prev) => ({ ...prev, [preferred.id]: items }));
          setSelectedIds([]);
        }

        // 其余盘根目录后台预加载缓存
        await Promise.all(
          list
            .filter((d) => d.id !== preferred?.id)
            .map(async (drive) => {
              try {
                const entries = await invoke<DirEntryInfo[]>("list_dir", {
                  path: drive.path,
                });
                if (cancelled) return;
                setDriveFiles((prev) => ({
                  ...prev,
                  [drive.id]: entries.map(toFileItem),
                }));
              } catch (err) {
                console.error(`list_dir failed for ${drive.path}`, err);
                if (!cancelled) {
                  setDriveFiles((prev) => ({ ...prev, [drive.id]: [] }));
                }
              }
            }),
        );
      } catch (err) {
        console.error("list_drives failed", err);
      }
    };

    void loadDrives();

    // 启动时预热废纸篓/桌面磁盘缓存，切过去不卡
    void (async () => {
      try {
        const peeked = await invoke<DirEntryInfo[] | null>("peek_recycle_bin");
        if (!cancelled && peeked?.length) {
          trashCacheRef.current = peeked.map(toFileItem);
        }
      } catch {
        /* ignore */
      }
      try {
        const desk = await invoke<string>("get_special_folder", {
          name: "desktop",
        });
        if (cancelled || !desk) return;
        specialPathRef.current.desktop = desk;
        const entries = await invoke<DirEntryInfo[]>("list_dir", {
          path: desk,
        });
        if (cancelled) return;
        dirCacheRef.current.set(normPathKey(desk), entries.map(toFileItem));
      } catch {
        /* ignore */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadFolder, initialPath, normPathKey]);

  const applyTrashAndPopColumn = useCallback(
    (paths: string[]) => {
      if (!paths.length) return;
      trashPathsOptimistic(paths);
      const remove = new Set(paths);
      setColumnPreview(null);
      setColumns((prev) =>
        prev.map((col) => {
          const items = col.items.filter(
            (i) => !remove.has(i.path ?? i.id) && !remove.has(i.id),
          );
          const selectedId =
            col.selectedId && items.some((i) => i.id === col.selectedId)
              ? col.selectedId
              : null;
          return { ...col, items, selectedId };
        }),
      );
    },
    [trashPathsOptimistic],
  );

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<{ paths: string[] }>("finder-delete-confirmed", (ev) => {
        const paths = ev.payload?.paths ?? [];
        if (paths.length) applyTrashAndPopColumn(paths);
      }).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
    };
  }, [applyTrashAndPopColumn]);

  const hitTestFiles = useCallback((box: SelBox) => {
    const root = contentRef.current;
    if (!root) return [] as string[];
    const rootRect = root.getBoundingClientRect();
    // box 是内容坐标（含 scroll），转成视口坐标做相交检测
    const clientBox: SelBox = {
      left: rootRect.left + box.left - root.scrollLeft,
      top: rootRect.top + box.top - root.scrollTop,
      right: rootRect.left + box.right - root.scrollLeft,
      bottom: rootRect.top + box.bottom - root.scrollTop,
    };
    const ids: string[] = [];
    root.querySelectorAll<HTMLElement>("[data-file-id]").forEach((el) => {
      const id = el.dataset.fileId;
      if (!id) return;
      const r = el.getBoundingClientRect();
      const itemBox: SelBox = {
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      };
      if (boxesIntersect(clientBox, itemBox)) ids.push(id);
    });
    return ids;
  }, []);

      function handleSidebarSelect(id: string) {
    setActiveSidebar(id);
    setMarquee(null);

    if (id === "builtin-apps") {
      setCurrentPath(null);
      setFolderItems([]);
      setNavStack([]);
      setNavIndex(-1);
      setSelectedIds([]);
      return;
    }

    const drive = drives.find((d) => d.id === id);
    if (drive && isTauri()) {
      void navigateTo(drive.path, "replace");
      return;
    }

    if (isTauri() && (id === "desktop" || id === "documents" || id === "downloads")) {
      const req = ++specialReqRef.current;
      // 已知路径时立刻上屏缓存，不等 get_special_folder
      const known = specialPathRef.current[id];
      if (known) {
        const cached = dirCacheRef.current.get(normPathKey(known));
        if (cached) {
          setFolderItems(cached);
          setCurrentPath(known);
          setNavStack([known]);
          setNavIndex(0);
          setSelectedIds([]);
        }
      }
      void invoke<string>("get_special_folder", { name: id })
        .then(async (path) => {
          if (req !== specialReqRef.current) return;
          specialPathRef.current[id] = path;
          const cached = dirCacheRef.current.get(normPathKey(path));
          if (cached) {
            setFolderItems(cached);
            setCurrentPath(path);
            setNavStack([path]);
            setNavIndex(0);
            setSelectedIds([]);
          }
          await navigateTo(path, "replace");
        })
        .catch((err) => console.error("get_special_folder failed", err));
      return;
    }

    if (isTauri() && id === "recents") {
      setCurrentPath(null);
      setNavStack([]);
      setNavIndex(-1);
      // 覆盖：先清掉旧列表 / 展示缓存，避免与上一次目录混在一起
      const cached = recentsCacheRef.current;
      if (cached && cached.length) {
        setFolderItems(cached);
      } else {
        setFolderItems([]);
      }
      setSelectedIds([]);
      const req = ++recentsReqRef.current;
      void invoke<DirEntryInfo[]>("list_recents")
        .then((entries) => {
          if (req !== recentsReqRef.current) return;
          const items = entries.map(toFileItem);
          recentsCacheRef.current = items;
          setFolderItems(items);
          setSelectedIds([]);
        })
        .catch((err) => {
          if (req !== recentsReqRef.current) return;
          console.error("list_recents failed", err);
          if (!recentsCacheRef.current) {
            setFolderItems([]);
            setSelectedIds([]);
          }
        });
      return;
    }

    if (id.startsWith("tag-")) {
      if (!appSettings.enableTags) return;
      setCurrentPath(null);
      setNavStack([]);
      setNavIndex(-1);
      setFolderItems([]);
      setSelectedIds([]);
      void loadTagView(id);
      return;
    }

    if (id === "favorites") {
      setCurrentPath(null);
      setNavStack([]);
      setNavIndex(-1);
      setFavoriteFolderId(null);
      void loadFavoritesView(null);
      return;
    }

    // 共享：暂未实现，空页面
    if (id === "shared") {
      setCurrentPath(null);
      setFolderItems([]);
      setNavStack([]);
      setNavIndex(-1);
      setSelectedIds([]);
      return;
    }

    if (isTauri() && id === "trash") {
      setCurrentPath(null);
      setNavStack([]);
      setNavIndex(-1);
      // 先上屏内存缓存；peek/刷新在 loadTrashView 里完成
      const cached = trashCacheRef.current;
      if (cached) {
        setFolderItems(cached);
      } else {
        setFolderItems([]);
      }
      setSelectedIds([]);
      void loadTrashView();
      return;
    }

    // 其它：mock / 缓存
    setCurrentPath(null);
    setFolderItems([]);
    setNavStack([]);
    setNavIndex(-1);
    const cached = driveFiles[id] ?? mockFiles[id];
    if (cached) {
      setFolderItems(cached);
    }
    setSelectedIds([]);
  }

  function goBack() {
    if (!canGoBack) return;
    if (activeSidebar === "favorites" && favoriteFolderId != null) {
      setFavoriteFolderId(null);
      void loadFavoritesView(null);
      return;
    }
    const nextIndex = navIndex - 1;
    const path = navStack[nextIndex];
    if (!path) return;
    setNavIndex(nextIndex);
    void loadFolder(path).then(() => {
      setSelectedIds([]);
    });
  }

  function goForward() {
    if (!canGoForward) return;
    const nextIndex = navIndex + 1;
    const path = navStack[nextIndex];
    if (!path) return;
    setNavIndex(nextIndex);
    void loadFolder(path).then(() => {
      setSelectedIds([]);
    });
  }

  /** 双击空白：返回上一层目录（父路径）；收藏夹内则退回收藏根 */
  function goUpOneLevel() {
    if (activeSidebar === "favorites" && favoriteFolderId != null) {
      setFavoriteFolderId(null);
      setFavBarActiveFolderId(null);
      void loadFavoritesView(null);
      return;
    }
    if (!currentPath) return;
    const crumbs = pathBreadcrumbs(currentPath);
    if (crumbs.length < 2) return;
    const parent = crumbs[crumbs.length - 2]?.path;
    if (!parent) return;
    void navigateTo(parent, "push");
  }

  function onContentDoubleClick(e: React.MouseEvent<HTMLElement>) {
    if (!appSettings.doubleClickGoUp) return;
    const target = e.target as HTMLElement;
    if (
      target.closest(
        "[data-file-id],button,input,textarea,a,[data-no-marquee]",
      )
    ) {
      return;
    }
    e.preventDefault();
    goUpOneLevel();
  }

  function selectFile(id: string, e: React.MouseEvent) {
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      );
      return;
    }
    if (e.shiftKey && selectedIds.length > 0) {
      const ids = files.map((f) => f.id);
      const anchor = selectedIds[0];
      const a = ids.indexOf(anchor);
      const b = ids.indexOf(id);
      if (a >= 0 && b >= 0) {
        const [from, to] = a < b ? [a, b] : [b, a];
        setSelectedIds(ids.slice(from, to + 1));
        return;
      }
    }
    setSelectedIds([id]);
  }

  function findItemById(id: string): FileItem | null {
    const fromFiles = files.find((f) => f.id === id);
    if (fromFiles) return fromFiles;
    for (const col of columns) {
      const hit = col.items.find((f) => f.id === id);
      if (hit) return hit;
    }
    if (columnPreview?.id === id) return columnPreview;
    return null;
  }

  function onContentContextMenu(e: React.MouseEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    const fileEl = (e.target as HTMLElement).closest(
      "[data-file-id]",
    ) as HTMLElement | null;
    const fileId = fileEl?.dataset.fileId ?? null;

    if (fileId) {
      if (!selectedIds.includes(fileId)) {
        setSelectedIds([fileId]);
      }
      const item = findItemById(fileId);
      setOpenWithApps([]);
      const nextSelected = selectedIds.includes(fileId)
        ? selectedIds
        : [fileId];
      const surface =
        activeSidebar === "favorites"
          ? "favorites"
          : activeSidebar === "trash"
            ? "trash"
            : "normal";
      setContextMenu({
        x: e.clientX,
        y: e.clientY,
        kind: "item",
        itemId: fileId,
        itemName: item?.name ?? null,
        itemPath: item?.path ?? fileId,
        isFile: item ? item.kind !== "folder" : false,
        multiSelect: nextSelected.length > 1,
        showMore: false,
        showOpenWith: false,
        showBuiltinEditors: false,
        surface,
        isFavoriteFolder: isFavoriteFolderPath(item?.path),
      });
      return;
    }

    setOpenWithApps([]);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      kind: "blank",
      itemId: null,
      itemName: null,
      itemPath:
        currentPath ??
        drives.find((d) => d.id === activeSidebar)?.path ??
        null,
      isFile: false,
      multiSelect: false,
      showMore: false,
      showOpenWith: false,
      showBuiltinEditors: false,
      surface:
        activeSidebar === "favorites"
          ? "favorites"
          : activeSidebar === "trash"
            ? "trash"
            : "normal",
      isFavoriteFolder: false,
    });
  }

  async function commitRename(itemId: string, nextName: string) {
    const item = files.find((f) => f.id === itemId);
    setRenamingId(null);
    if (!item || !isTauri()) return;
    const path = item.path ?? item.id;
    const trimmed = nextName.trim();
    if (!trimmed || trimmed === item.name) return;
    try {
      await invoke<PathResult>("rename_path", { path, newName: trimmed });
      await refreshCurrent();
    } catch (err) {
      console.error("rename failed", err);
    }
  }

  function tagOf(item: { path?: string; id: string }) {
    if (!appSettings.enableTags) return undefined;
    const p = item.path ?? item.id;
    return pathTags[pathKey(p)];
  }

  async function applyTagColor(color: string, paths: string[]) {
    if (!paths.length || !isTauri()) return;
    const nextColor = color.trim();
    const updates: { path: string; color: string }[] = [];
    setPathTags((prev) => {
      const next = { ...prev };
      for (const p of paths) {
        const key = pathKey(p);
        // 点同一颜色则取消
        if (next[key] && next[key].toLowerCase() === nextColor.toLowerCase()) {
          delete next[key];
          updates.push({ path: p, color: "" });
        } else {
          next[key] = nextColor;
          updates.push({ path: p, color: nextColor });
        }
      }
      return next;
    });
    try {
      await Promise.all(
        updates.map((u) =>
          invoke("set_item_tag", { path: u.path, color: u.color }),
        ),
      );
      if (activeSidebar.startsWith("tag-")) {
        await loadTagView(activeSidebar);
      }
    } catch (err) {
      console.error("set_item_tag failed", err);
    }
  }

  async function handleContextAction(id: string) {
    if (id === "customize-tags") return;
    if (id.startsWith("tag-")) {
      if (!appSettings.enableTags) return;
      const color = id.slice("tag-".length);
      const selected = getSelectedPaths();
      const paths =
        selected.length > 0
          ? selected
          : contextMenu?.itemPath
            ? [contextMenu.itemPath]
            : [];
      if (!paths.length) {
        console.warn("tag: no target path");
        return;
      }
      await applyTagColor(color, paths);
      return;
    }

    const menu = contextMenu;
    const itemPath = menu?.itemPath ?? null;
    const itemName = menu?.itemName ?? null;
    const dir = workingDir();

    const resolveTarget = (): FileItem | null => {
      if (!menu?.itemId) return null;
      const found = findItemById(menu.itemId);
      if (found) return found;
      if (menu.itemPath) {
        return {
          id: menu.itemId,
          name: menu.itemName ?? menu.itemPath,
          kind: menu.isFile ? "file" : "folder",
          kindLabel: menu.isFile ? "文件" : "文件夹",
          openedAt: "--",
          size: "--",
          path: menu.itemPath,
        };
      }
      return null;
    };
    const target = resolveTarget();

    try {
      if (id === "open") {
        if (target) openItem(target);
        else if (itemPath && isTauri()) {
          await invoke("open_path", { path: itemPath });
        } else if (dir) {
          void navigateTo(dir, "replace");
        }
        return;
      }

      if (id === "open-window") {
        const path = itemPath ?? dir;
        if (path) {
          void openBrowseWindow(path, itemName ?? activeLabel, {
            x: menu?.x ?? window.innerWidth / 2,
            y: menu?.y ?? window.innerHeight / 2,
          });
        }
        return;
      }

      if (id === "get-info") {
        const path = itemPath ?? dir;
        if (path && isTauri()) {
          void openGetInfoWindow(path, itemName ?? activeLabel ?? "项目");
        }
        return;
      }

      if (id === "rename" && target) {
        setRenamingId(target.id);
        setRenameDraft(target.name);
        return;
      }

      if (id === "refresh") {
        await refreshCurrent();
        return;
      }

      if (id === "batch-create") {
        if (!dir) {
          void showAlert("当前不在可写目录中");
          return;
        }
        setBatchCreateOpen(true);
        return;
      }

      if (id === "new-folder" && dir && isTauri()) {
        const created = await invoke<PathResult>("create_folder", {
          parent: dir,
          name: null,
        });
        await refreshCurrent();
        setSelectedIds([created.path]);
        setRenamingId(created.path);
        setRenameDraft(created.name);
        return;
      }

      if (id === "new-file" && dir && isTauri()) {
        const created = await invoke<PathResult>("create_file", {
          parent: dir,
          name: null,
        });
        await refreshCurrent();
        setSelectedIds([created.path]);
        setRenamingId(created.path);
        setRenameDraft(created.name);
        return;
      }

      if (id === "fav-new-folder") {
        setFavFolderDialog({ mode: "create" });
        return;
      }

      if (id === "fav-rename-folder") {
        const path = itemPath;
        if (!path || !isFavoriteFolderPath(path)) return;
        setFavFolderDialog({
          mode: "rename",
          folderId: parseFavoriteFolderId(path),
          name: itemName ?? target?.name ?? "",
        });
        return;
      }

      if (id === "fav-delete-folder") {
        const path = itemPath;
        if (!path || !isFavoriteFolderPath(path) || !isTauri()) return;
        const folderId = parseFavoriteFolderId(path);
        try {
          await invoke("delete_favorite_folder", { id: folderId });
          if (favoriteFolderId === folderId) setFavoriteFolderId(null);
          if (favBarActiveFolderId === folderId) setFavBarActiveFolderId(null);
          await loadFavoritesView(
            favoriteFolderId === folderId ? null : favoriteFolderId,
          );
          await refreshFavBar();
        } catch (err) {
          console.error("delete_favorite_folder failed", err);
          void showAlert(String(err));
        }
        return;
      }

      if (id === "fav-remove") {
        const favId = menu?.itemId ? parseFavoriteItemId(menu.itemId) : null;
        if (favId == null || !isTauri()) return;
        try {
          await invoke("remove_favorite", { id: favId });
          await loadFavoritesView(favoriteFolderId);
          await refreshFavBar();
        } catch (err) {
          console.error("remove_favorite failed", err);
        }
        return;
      }

      if (id === "favorite") {
        const path = itemPath;
        if (!path || isFavoriteFolderPath(path)) return;
        setFavoritePick({
          path,
          name: itemName ?? target?.name ?? path,
          kind: target?.kind ?? (menu?.isFile ? "file" : "folder"),
          kindLabel:
            target?.kindLabel ?? (menu?.isFile ? "文件" : "文件夹"),
        });
        return;
      }

      if (id === "trash-restore") {
        const paths =
          selectedIds.length > 1
            ? getSelectedPaths()
            : itemPath
              ? [itemPath]
              : [];
        if (!paths.length || !isTauri()) return;
        try {
          await Promise.all(
            paths.map((path) => invoke("restore_recycle_bin_item", { path })),
          );
          await loadTrashView();
        } catch (err) {
          console.error("restore_recycle_bin_item failed", err);
        }
        return;
      }

      if (id === "trash-delete") {
        const paths =
          selectedIds.length > 1
            ? getSelectedPaths()
            : itemPath
              ? [itemPath]
              : [];
        if (!paths.length || !isTauri()) return;
        try {
          await Promise.all(
            paths.map((path) => invoke("delete_recycle_bin_item", { path })),
          );
          await loadTrashView();
        } catch (err) {
          console.error("delete_recycle_bin_item failed", err);
        }
        return;
      }

      if (id === "trash-empty") {
        if (!isTauri()) return;
        try {
          await invoke("empty_recycle_bin");
          await loadTrashView();
        } catch (err) {
          console.error("empty_recycle_bin failed", err);
        }
        return;
      }

      if (id === "trash") {
        const paths =
          selectedIds.length > 1
            ? getSelectedPaths()
            : itemPath
              ? [itemPath]
              : [];
        trashPathsOptimistic(paths);
        return;
      }

      if (id === "duplicate" && itemPath && isTauri()) {
        const created = await invoke<PathResult>("duplicate_path", {
          path: itemPath,
        });
        await refreshCurrent();
        setSelectedIds([created.path]);
        return;
      }

      if ((id === "compress" || id === "win-zip") && itemPath && isTauri()) {
        const created = await invoke<PathResult>("compress_zip", {
          path: itemPath,
        });
        await refreshCurrent();
        setSelectedIds([created.path]);
        return;
      }

      if (id === "cut") {
        if (selectedIds.length > 1) cutSelection();
        else if (itemPath) setClipboard({ mode: "cut", paths: [itemPath] });
        return;
      }

      if (id === "paste") {
        await pasteClipboard();
        return;
      }

      if (id === "open-terminal" && isTauri()) {
        const path = itemPath ?? dir;
        if (path) await invoke("open_in_terminal", { path });
        return;
      }

      if (id === "share" && isTauri()) {
        const path = itemPath ?? dir;
        if (path) await invoke("share_path", { path });
        return;
      }

      if (id === "win-pin" && isTauri()) {
        const path = itemPath ?? dir;
        if (path) await invoke("pin_quick_access", { path });
        return;
      }

      if (id === "win-path" && itemPath) {
        await navigator.clipboard.writeText(itemPath);
        return;
      }

      if (id.startsWith("open-with:") && itemPath && isTauri()) {
        const appId = id.slice("open-with:".length);
        if (appId === "choose-another") {
          await invoke("open_with_picker", { path: itemPath });
        } else if (appId === "ms-store") {
          await invoke("open_ms_store_search", { query: itemName ?? "app" });
        } else {
          await invoke("open_path", { path: itemPath });
        }
      }

      if (id.startsWith("builtin-") && itemPath) {
        const kind =
          id === "builtin-word"
            ? "word"
            : id === "builtin-markdown"
              ? "markdown"
              : id === "builtin-excel"
                ? "excel"
                : null;
        if (kind) {
          await openBuiltinEditorWindow(kind, itemPath, itemName);
        }
      }
    } catch (err) {
      console.error("context action failed", id, err);
    }
  }

  function handleToggleOpenWith() {
    setContextMenu((prev) => {
      if (!prev) return prev;
      const next = !prev.showOpenWith;
      if (next && prev.itemPath && isTauri()) {
        void invoke<OpenWithApp[]>("list_open_with", { path: prev.itemPath })
          .then(setOpenWithApps)
          .catch((err) => {
            console.error("list_open_with failed", err);
            setOpenWithApps([
              { id: "choose-another", name: "选择其他应用…", isDefault: false },
              {
                id: "ms-store",
                name: "在 Microsoft Store 中查找应用",
                isDefault: false,
              },
            ]);
          });
      }
      return {
        ...prev,
        showOpenWith: next,
        showMore: false,
        showBuiltinEditors: next ? prev.showBuiltinEditors : false,
      };
    });
  }

  function handleToggleBuiltinEditors() {
    setContextMenu((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        showBuiltinEditors: !prev.showBuiltinEditors,
        showOpenWith: true,
        showMore: false,
      };
    });
  }

  function onContentPointerDown(e: React.PointerEvent<HTMLElement>) {
    if (e.button !== 0) return;
    if (contextMenu) setContextMenu(null);
    const target = e.target as HTMLElement;
    if (target.closest("[data-file-id],button,input,textarea,a,[data-no-marquee]"))
      return;

    const root = contentRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const x = e.clientX - rect.left + root.scrollLeft;
    const y = e.clientY - rect.top + root.scrollTop;
    const additive = e.metaKey || e.ctrlKey;

    dragRef.current = {
      pointerId: e.pointerId,
      startX: x,
      startY: y,
      additive,
      baseIds: additive ? [...selectedIds] : [],
      moved: false,
    };
    root.setPointerCapture(e.pointerId);
    if (!additive) setSelectedIds([]);
    setMarquee({ left: x, top: y, right: x, bottom: y });
  }

  function onContentPointerMove(e: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const root = contentRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const x = e.clientX - rect.left + root.scrollLeft;
    const y = e.clientY - rect.top + root.scrollTop;
    if (
      Math.abs(x - drag.startX) > 3 ||
      Math.abs(y - drag.startY) > 3
    ) {
      drag.moved = true;
    }
    const box = normalizeBox(drag.startX, drag.startY, x, y);
    setMarquee(box);
    const hits = hitTestFiles(box);
    if (drag.additive) {
      setSelectedIds([...new Set([...drag.baseIds, ...hits])]);
    } else {
      setSelectedIds(hits);
    }
  }

  function onContentPointerUp(e: React.PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    setMarquee(null);
    try {
      contentRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  const viewButtons: { id: ViewMode; label: string; icon: typeof LayoutGrid }[] =
    [
      { id: "icons", label: "图标", icon: LayoutGrid },
      { id: "list", label: "列表", icon: List },
      { id: "columns", label: "分栏", icon: Columns3 },
    ];

  const viewIndex = Math.max(
    0,
    viewButtons.findIndex((item) => item.id === viewMode),
  );
  // k 偏低、ζ 适中：左右滑动带一点过冲阻尼
  const viewThumb = useSpring(viewIndex, 220, 0.72);

  // 阴影只往右下，扩散约 2~4px
  // 四周轻阴影，扩散加大约 4px
  const toolShadow = "shadow-[0_0_8px_rgba(0,0,0,0.07),0_2px_6px_rgba(0,0,0,0.05)]";
  const toolGroup = `flex translate-y-2 items-center rounded-full bg-white p-[3px] ${toolShadow}`;
  const toolCircle = `inline-flex size-8 translate-y-2 items-center justify-center rounded-full bg-white text-[var(--finder-text-secondary)] ${toolShadow} hover:text-[var(--finder-text)]`;

  return (
    <div
      className={`h-full w-full${zoomIn ? " finder-zoom-in" : ""}`}
    >
    <LiquidGlass
      className="finder-window h-full w-full text-[13px] text-[var(--finder-text)]"
      contentClassName="flex h-full min-h-0 w-full flex-row"
      config={shellGlassConfig}
      radius={24}
    >
      {/* Sidebar card: traffic lights + nav */}
      <div
        className="relative z-20 flex h-full shrink-0 flex-col py-2 pl-2 pr-0"
        style={{
          background:
            "linear-gradient(to right, var(--finder-sidebar-rail), transparent)",
        }}
      >
        <LiquidGlass
          className="flex min-h-0 w-[220px] flex-1 flex-col shadow-[0_0_8px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.05)]"
          config={glassConfig}
          radius={16}
        >
          <div
            className="flex h-[52px] shrink-0 items-center gap-[8px] px-[16px]"
            data-tauri-drag-region
          >
            <div className="flex items-center gap-[8px]">
              <button
                type="button"
                aria-label="关闭"
                className="size-[12px] rounded-full bg-[var(--finder-traffic-close)] outline-none"
                onClick={() => void getCurrentWindow().close()}
              />
              <button
                type="button"
                aria-label="最小化"
                className="size-[12px] rounded-full bg-[var(--finder-traffic-minimize)] outline-none"
                onClick={() => void getCurrentWindow().minimize()}
              />
              <button
                type="button"
                aria-label="最大化"
                className="size-[12px] rounded-full bg-[var(--finder-traffic-maximize)] outline-none"
                onClick={() => void getCurrentWindow().toggleMaximize()}
              />
            </div>
          </div>

          <nav className="min-h-0 flex-1 overflow-auto px-[10px] pb-3">
            <ul className="mb-3 space-y-[1px]">
              {topItems.map((item) => (
                <li key={item.id}>
                  <SidebarButton
                    item={item}
                    active={item.id === activeSidebar}
                    onSelect={handleSidebarSelect}
                  />
                </li>
              ))}
            </ul>

            <section className="mb-3">
              <h2 className="mb-[2px] px-[10px] text-[11px] font-semibold text-[var(--finder-text-muted)]">
                个人收藏
              </h2>
              <ul className="space-y-[1px]">
                {favorites.map((item) => (
                  <li key={item.id}>
                    <SidebarButton
                      item={item}
                      active={item.id === activeSidebar}
                      onSelect={handleSidebarSelect}
                    />
                  </li>
                ))}
              </ul>
            </section>

            <section className="mb-3">
              <h2 className="mb-[2px] px-[10px] text-[11px] font-semibold text-[var(--finder-text-muted)]">
                此电脑
              </h2>
              <ul className="space-y-[1px]">
                {thisPcItems.map((item) => (
                  <li key={item.id}>
                    <SidebarButton
                      item={item}
                      active={item.id === activeSidebar}
                      onSelect={handleSidebarSelect}
                    />
                  </li>
                ))}
              </ul>
            </section>

            {appSettings.enableTags ? (
            <section>
              <h2 className="mb-[2px] px-[10px] text-[11px] font-semibold text-[var(--finder-text-muted)]">
                标签
              </h2>
              <ul className="space-y-[1px]">
                {tags.map((tag) => {
                  const active = tag.id === activeSidebar;
                  return (
                    <li key={tag.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-[8px] rounded-[6px] px-[10px] py-[4px] text-left text-[13px] ${
                          active
                            ? "bg-[var(--finder-sidebar-selected)] font-medium"
                            : "hover:bg-[var(--finder-hover)]"
                        }`}
                        onClick={() => handleSidebarSelect(tag.id)}
                      >
                        <span
                          className="size-[10px] rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span>{tag.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
            ) : null}
          </nav>
        </LiquidGlass>
      </div>

      {/* Main */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col bg-[var(--finder-content)]">
        <header className="flex h-[52px] shrink-0 items-center gap-3 bg-white px-3">
          <div
            className="flex min-w-0 flex-1 items-center gap-3 self-stretch"
            data-tauri-drag-region
          >
            <div
              className={`${toolGroup} ${canGoBack || canGoForward ? "" : "opacity-50"}`}
              style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <button
                type="button"
                disabled={!canGoBack}
                className={`rounded-full p-1 ${
                  canGoBack
                    ? "text-[var(--finder-text-secondary)] hover:text-[var(--finder-text)]"
                    : "text-[var(--finder-text-muted)]"
                }`}
                aria-label="后退"
                onClick={goBack}
              >
                <ChevronLeft className="size-[18px]" strokeWidth={2} />
              </button>
              <button
                type="button"
                disabled={!canGoForward}
                className={`rounded-full p-1 ${
                  canGoForward
                    ? "text-[var(--finder-text-secondary)] hover:text-[var(--finder-text)]"
                    : "text-[var(--finder-text-muted)]"
                }`}
                aria-label="前进"
                onClick={goForward}
              >
                <ChevronRight className="size-[18px]" strokeWidth={2} />
              </button>
            </div>

            <div
              className={toolGroup}
              style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
            >
              <button
                type="button"
                className="rounded-full p-1 text-[var(--finder-text-secondary)] hover:text-[var(--finder-text)]"
                aria-label="刷新"
                title="刷新"
                onClick={() => void refreshCurrent()}
              >
                <RefreshCw className="size-[15px]" strokeWidth={2} />
              </button>
            </div>

            <div
              className="flex min-w-0 flex-1 translate-y-2 items-center overflow-hidden rounded-full bg-[#f2f2f2] px-3 py-[5px] text-[13px] font-normal tracking-tight"
              style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
              title={pathEditing ? undefined : (currentPath ?? activeLabel ?? "")}
              onDoubleClick={() => {
                if (!pathEditing) startPathEdit();
              }}
            >
              {pathEditing ? (
                <input
                  ref={pathInputRef}
                  value={pathInput}
                  onChange={(e) => setPathInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void commitPathEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      cancelPathEdit();
                    }
                  }}
                  onBlur={() => {
                    // 延迟，避免点击外部按钮时抢焦点误关
                    window.setTimeout(() => {
                      if (document.activeElement !== pathInputRef.current) {
                        cancelPathEdit();
                      }
                    }, 120);
                  }}
                  spellCheck={false}
                  className="h-[22px] w-full min-w-0 border-0 bg-transparent p-0 text-[13px] font-normal text-[var(--finder-text)] outline-none"
                  placeholder="输入或粘贴路径后按回车"
                  aria-label="路径"
                />
              ) : (
                <div
                  className="flex min-w-0 flex-1 cursor-text items-center gap-0.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  onClick={(e) => {
                    // 点空白处进入编辑；点面包屑按钮不进
                    if (e.target === e.currentTarget) startPathEdit();
                  }}
                >
                  {breadcrumbs.map((crumb, i) => {
                    const isLast = i === breadcrumbs.length - 1;
                    return (
                      <span key={`${crumb.path}-${i}`} className="flex min-w-0 items-center gap-0.5">
                        {i > 0 ? (
                          <ChevronRight
                            className="size-3.5 shrink-0 text-[var(--finder-text-muted)]"
                            strokeWidth={2}
                          />
                        ) : null}
                        <button
                          type="button"
                          className={`max-w-[180px] truncate rounded px-1 py-0.5 outline-none ${
                            isLast
                              ? "text-[var(--finder-text)]"
                              : "text-[var(--finder-text-secondary)] hover:bg-black/5 hover:text-[var(--finder-text)]"
                          } ${crumb.path ? "cursor-pointer" : "cursor-default"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!crumb.path) {
                              startPathEdit();
                              return;
                            }
                            void navigateTo(crumb.path, isLast ? "replace" : "push");
                          }}
                        >
                          {crumb.label}
                        </button>
                      </span>
                    );
                  })}
                  {/* 右侧空白可点进编辑 */}
                  <button
                    type="button"
                    aria-label="编辑路径"
                    className="h-[22px] min-w-[24px] flex-1 cursor-text"
                    onClick={startPathEdit}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-5">
            <div className={`relative ${toolGroup}`}>
              <div
                aria-hidden
                className="pointer-events-none absolute top-[3px] bottom-[3px] left-[3px] w-[calc((100%-6px)/3)] rounded-full bg-[#e6e6e6]"
                style={{
                  transform: `translateX(${viewThumb.x * 100}%)`,
                  willChange: "transform",
                }}
              />
              {viewButtons.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-label={label}
                  className={`relative z-[1] flex-1 rounded-full px-2.5 py-[5px] ${
                    viewMode === id
                      ? "text-[var(--finder-text)]"
                      : "text-[var(--finder-text-secondary)] hover:text-[var(--finder-text)]"
                  }`}
                  onClick={() => setViewMode(id)}
                >
                  <Icon className="mx-auto size-[15px]" strokeWidth={1.75} />
                </button>
              ))}
            </div>

            <div className={toolGroup}>
              <button
                ref={sortBtnRef}
                type="button"
                className={`rounded-full p-1.5 ${
                  sortMenuOpen
                    ? "bg-[#e6e6e6] text-[var(--finder-text)]"
                    : "text-[var(--finder-text-secondary)] hover:text-[var(--finder-text)]"
                }`}
                aria-label="排序"
                title="排序"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  if (sortMenuOpen) {
                    setSortMenuOpen(false);
                    return;
                  }
                  const rect =
                    sortBtnRef.current?.getBoundingClientRect() ??
                    (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
                  setSortMenuAnchor(rect);
                  setSortMenuOpen(true);
                }}
              >
                <ArrowUpDown className="size-[15px]" strokeWidth={1.75} />
              </button>
              <button
                type="button"
                className="rounded-full p-1.5 text-[var(--finder-text-secondary)] hover:text-[var(--finder-text)]"
                aria-label="设置"
                title="设置"
                onClick={() => void openSettingsWindow()}
              >
                <Settings className="size-[15px]" strokeWidth={1.75} />
              </button>
            </div>

            <button
              type="button"
              className={toolCircle}
              aria-label="搜索"
              title="搜索全部磁盘"
              onClick={() => void openSearchWindow()}
            >
              <Search className="size-[15px]" strokeWidth={1.75} />
            </button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col pt-4">
          {appSettings.showFavoritesBar &&
            (favBarFolders.length > 0 || fileDragging) && (
            <div
              className={`flex shrink-0 items-center gap-2 overflow-x-auto px-3 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                fileDragging ? "min-h-[28px]" : ""
              }`}
            >
              <Star
                className="size-[14px] shrink-0 text-[var(--finder-icon)]"
                strokeWidth={2.25}
                aria-hidden
              />
              {fileDragging && favBarFolders.length === 0 ? (
                <span className="text-[13px] text-[var(--finder-text-secondary)]">
                  请先在侧栏创建收藏夹
                </span>
              ) : null}
              {favBarFolders.map((folder) => {
                const active =
                  activeSidebar === "favorites" &&
                  (favBarActiveFolderId === folder.id ||
                    favoriteFolderId === folder.id);
                const menuOpen = favBarMenu?.folderId === folder.id;
                const dropping = favBarDropTargetId === folder.id;
                return (
                  <button
                    key={`fav-bar-folder-${folder.id}`}
                    type="button"
                    data-fav-folder-id={folder.id}
                    title={`${folder.name}（拖入可收藏）`}
                    className={`max-w-[180px] shrink-0 truncate rounded-[6px] px-2 py-[3px] text-[14px] leading-[20px] outline-none ${
                      dropping
                        ? "bg-[rgba(0,122,255,0.12)] font-medium text-[var(--finder-accent)]"
                        : fileDragging
                          ? "text-[var(--finder-accent)]"
                          : active || menuOpen
                            ? "bg-[rgba(0,0,0,0.08)] font-medium text-[var(--finder-text)]"
                            : "text-[var(--finder-text)] hover:bg-[rgba(0,0,0,0.04)]"
                    }`}
                    onClick={(e) =>
                      toggleFavBarMenu(folder.id, e.currentTarget)
                    }
                  >
                    {folder.name}
                  </button>
                );
              })}
            </div>
          )}

          <section
            ref={contentRef}
            className={`relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--finder-content)] select-none ${
              viewMode === "columns" ? "overflow-hidden" : "overflow-auto"
            }`}
            onPointerDown={onContentPointerDown}
            onPointerMove={onContentPointerMove}
            onPointerUp={onContentPointerUp}
            onPointerCancel={onContentPointerUp}
            onDoubleClick={onContentDoubleClick}
            onContextMenu={onContentContextMenu}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (viewMode === "list") listVirt.onScroll(el);
              if (viewMode === "icons") {
                const w = el.clientWidth - 40;
                const cols = Math.max(1, Math.floor((w + 12) / (96 + 12)));
                if (cols !== gridCols) setGridCols(cols);
                gridVirt.onScroll(el);
              }
            }}
          >
            {isBuiltinApps ? (
              <BuiltinAppsPage
                appIcons={iconSettings.apps}
                onOpen={(app) => {
                  void openBuiltinEditorWindow(app.kind, null, app.blankName, {
                    appTitle: app.label,
                  });
                }}
              />
            ) : viewMode === "columns" ? (
              <ColumnsView
                columns={columns}
                preview={columnPreview}
                pathTags={appSettings.enableTags ? pathTags : {}}
                searchQuery={search}
                onSelect={(colIndex, item) =>
                  void selectInColumn(colIndex, item)
                }
                onOpen={(item) => openItem(item)}
                onTrash={(item) => {
                  const p = item.path ?? item.id;
                  if (!p) return;
                  void openConfirmDeleteWindow([p], [item.name]);
                }}
                onItemPointerDown={(e, item) =>
                  beginFilePointerDrag(e, item as FileItem)
                }
                dropTargetPath={fileDropTargetPath}
              />
            ) : viewMode === "list" ? (
              <>
                <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.4fr)_minmax(120px,0.7fr)_minmax(90px,0.5fr)_minmax(180px,1fr)] bg-white px-4 py-[6px] text-[12px] text-[var(--finder-text-secondary)]">
                  <span>名称</span>
                  <span>种类</span>
                  <span>大小</span>
                  <span>上次打开日期</span>
                </div>
                {files.length === 0 ? (
                  <p className="px-4 py-10 text-center text-[13px] text-[var(--finder-text-muted)]">
                    没有项目
                  </p>
                ) : (
                  <div
                    className="relative w-full"
                    style={{ height: listVirt.totalH }}
                  >
                    <ul
                      className="absolute left-0 right-0"
                      style={{ top: listVirt.offsetY }}
                    >
                      {listVisible.map((item, i) => {
                        const index = listVirt.start + i;
                        const active = selectedSet.has(item.id);
                        const zebra = index % 2 === 1;
                        const sizeLabel =
                          item.kind === "folder" ? "--" : item.size;
                        const dropPath =
                          item.kind === "folder" &&
                          item.path &&
                          !isFavoriteFolderPath(item.path)
                            ? item.path
                            : undefined;
                        const dropHover =
                          !!dropPath &&
                          fileDropTargetPath != null &&
                          normFsPath(fileDropTargetPath) ===
                            normFsPath(dropPath);
                        return (
                          <li
                            key={item.id}
                            style={{ height: LIST_ROW_H }}
                            className="flex items-center"
                          >
                            <button
                              type="button"
                              data-file-id={item.id}
                              data-drop-folder-path={dropPath}
                              className={`mx-2 grid h-[26px] w-[calc(100%-1rem)] grid-cols-[minmax(0,1.4fr)_minmax(120px,0.7fr)_minmax(90px,0.5fr)_minmax(180px,1fr)] items-center rounded-[6px] px-2 text-left text-[13px] ${
                                dropHover
                                  ? "bg-[rgba(0,122,255,0.14)] text-[var(--finder-text)] ring-1 ring-inset ring-[var(--finder-accent)]"
                                  : active
                                    ? "bg-[var(--finder-row-selected)] text-[var(--finder-selected-text)]"
                                    : zebra
                                      ? "bg-[var(--finder-zebra)] hover:bg-[var(--finder-hover)]"
                                      : "bg-transparent hover:bg-[var(--finder-hover)]"
                              }`}
                              onClick={(e) => selectFile(item.id, e)}
                              onDoubleClick={() => openItem(item)}
                              onPointerDown={(e) =>
                                beginFilePointerDrag(e, item)
                              }
                            >
                              <span className="flex min-w-0 items-center gap-2 truncate">
                                <TagDot
                                  color={tagOf(item)}
                                  className="size-[8px]"
                                />
                                <FileGlyph
                                  kind={item.kind}
                                  active={active}
                                  iconDataUrl={resolveIcon(item)}
                                  isImagePreview={isImagePreviewItem(item)}
                                />
                                {renamingId === item.id ? (
                                  <input
                                    ref={renameInputRef}
                                    value={renameDraft}
                                    onChange={(e) =>
                                      setRenameDraft(e.target.value)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void commitRename(
                                          item.id,
                                          renameDraft,
                                        );
                                      } else if (e.key === "Escape") {
                                        setRenamingId(null);
                                      }
                                    }}
                                    onBlur={() =>
                                      void commitRename(item.id, renameDraft)
                                    }
                                    className="min-w-0 flex-1 rounded-[3px] border border-[#0165e1] bg-white px-1 py-0 text-[13px] text-[var(--finder-text)] outline-none"
                                  />
                                ) : (
                                  <HighlightedName
                                    name={item.name}
                                    query={search}
                                    active={active}
                                    className="min-w-0 flex-1 truncate"
                                  />
                                )}
                              </span>
                              <span
                                className={`truncate ${active ? "text-white/90" : "text-[var(--finder-text-secondary)]"}`}
                              >
                                {item.kindLabel}
                              </span>
                              <span
                                className={`truncate tabular-nums ${active ? "text-white/90" : "text-[var(--finder-text-secondary)]"}`}
                              >
                                {sizeLabel}
                              </span>
                              <span
                                className={`truncate ${active ? "text-white/90" : "text-[var(--finder-text-secondary)]"}`}
                              >
                                {item.openedAt}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="min-h-full p-5">
                {files.length === 0 ? (
                  <p className="py-10 text-center text-[13px] text-[var(--finder-text-muted)]">
                    没有项目
                  </p>
                ) : (
                  <div
                    className="relative w-full"
                    style={{ height: gridVirt.totalH }}
                  >
                    <div
                      className="absolute left-0 right-0"
                      style={{ top: gridVirt.offsetY }}
                    >
                      {gridVisibleRows.map((row, rowIdx) => (
                        <div
                          key={`grid-row-${gridVirt.start + rowIdx}`}
                          className="grid gap-3"
                          style={{
                            height: GRID_CELL_H,
                            gridTemplateColumns: `repeat(${Math.max(gridCols, 1)}, minmax(0, 1fr))`,
                          }}
                        >
                          {row.map((item) => {
                            const active = selectedSet.has(item.id);
                            const dropPath =
                              item.kind === "folder" &&
                              item.path &&
                              !isFavoriteFolderPath(item.path)
                                ? item.path
                                : undefined;
                            const dropHover =
                              !!dropPath &&
                              fileDropTargetPath != null &&
                              normFsPath(fileDropTargetPath) ===
                                normFsPath(dropPath);
                            return (
                              <button
                                key={item.id}
                                type="button"
                                data-file-id={item.id}
                                data-drop-folder-path={dropPath}
                                className="flex w-full flex-col items-center gap-1.5 p-1 text-center"
                                onClick={(e) => selectFile(item.id, e)}
                                onDoubleClick={() => openItem(item)}
                                onPointerDown={(e) =>
                                  beginFilePointerDrag(e, item)
                                }
                              >
                                <span
                                  className={`flex size-[72px] items-center justify-center rounded-[10px] ${
                                    dropHover
                                      ? "bg-[rgba(0,122,255,0.14)] ring-1 ring-[var(--finder-accent)]"
                                      : active
                                        ? "bg-[#e6e6e6]"
                                        : "hover:bg-[var(--finder-hover)]"
                                  }`}
                                >
                                  <FileGlyph
                                    kind={item.kind}
                                    size="lg"
                                    iconDataUrl={resolveIcon(item)}
                                    isImagePreview={isImagePreviewItem(item)}
                                  />
                                </span>
                                {renamingId === item.id ? (
                                  <input
                                    ref={renameInputRef}
                                    value={renameDraft}
                                    onChange={(e) =>
                                      setRenameDraft(e.target.value)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={(e) =>
                                      e.stopPropagation()
                                    }
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") {
                                        e.preventDefault();
                                        void commitRename(
                                          item.id,
                                          renameDraft,
                                        );
                                      } else if (e.key === "Escape") {
                                        setRenamingId(null);
                                      }
                                    }}
                                    onBlur={() =>
                                      void commitRename(item.id, renameDraft)
                                    }
                                    className="w-full rounded-[3px] border border-[#0165e1] bg-white px-1 py-0.5 text-center text-[12px] text-[var(--finder-text)] outline-none"
                                  />
                                ) : (
                                  <IconCaption
                                    name={item.name}
                                    isFolder={item.kind === "folder"}
                                    tagColor={tagOf(item)}
                                    active={active}
                                    highlightQuery={search}
                                  />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {marquee ? (
              <div
                aria-hidden
                className="pointer-events-none absolute z-20 border border-[rgba(60,60,67,0.55)] bg-[rgba(60,60,67,0.18)]"
                style={{
                  left: marquee.left,
                  top: marquee.top,
                  width: Math.max(1, marquee.right - marquee.left),
                  height: Math.max(1, marquee.bottom - marquee.top),
                }}
              />
            ) : null}
          </section>

          {pickMode === "image" ? (
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-black/[0.08] bg-white px-4 py-3">
              <span className="min-w-0 truncate text-[12px] text-[var(--finder-text-secondary)]">
                {pickCandidate
                  ? `已选：${pickCandidate.name}`
                  : "请选择一张图片，然后点击选取"}
              </span>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  className="rounded-[8px] px-3 py-1.5 text-[13px] text-[var(--finder-text-secondary)] hover:bg-black/[0.04]"
                  onClick={() => void getCurrentWindow().close()}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={!pickCandidate}
                  className="rounded-[8px] bg-[#0a84ff] px-3.5 py-1.5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={() => {
                    if (pickCandidate) void confirmImagePick(pickCandidate.path);
                  }}
                >
                  选取
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {dragGhost ? (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[9999] max-w-[220px] truncate rounded-[8px] bg-[var(--finder-row-selected)] px-3 py-1.5 text-[13px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.18)]"
          style={{
            left: dragGhost.x + 14,
            top: dragGhost.y + 12,
          }}
        >
          {dragGhost.label}
        </div>
      ) : null}

      {favFolderDialog ? (
        <FavoritesFolderDialog
          mode={favFolderDialog.mode}
          initialName={
            favFolderDialog.mode === "rename" ? favFolderDialog.name : ""
          }
          onClose={() => setFavFolderDialog(null)}
          onSubmit={async (name) => {
            if (!isTauri()) return;
            if (favFolderDialog.mode === "create") {
              await invoke("create_favorite_folder", { name });
              setFavoriteFolderId(null);
              await loadFavoritesView(null);
              await refreshFavBar();
              return;
            }
            await invoke("rename_favorite_folder", {
              id: favFolderDialog.folderId,
              name,
            });
            await loadFavoritesView(favoriteFolderId);
            await refreshFavBar();
          }}
        />
      ) : null}

      {batchCreateOpen ? (
        <BatchCreateDialog
          onClose={() => setBatchCreateOpen(false)}
          onSubmit={async (spec: BatchCreateResult) => {
            const dir = workingDir();
            if (!dir || !isTauri()) {
              throw new Error("当前不在可写目录中");
            }
            const ext = spec.kind === "file" ? spec.extension : null;
            const createdIds: string[] = [];
            for (let i = 0; i < spec.count; i++) {
              const name = macOsBatchName(
                spec.baseName,
                ext,
                i,
                spec.seqType,
                spec.connector,
              );
              if (spec.kind === "folder") {
                const created = await invoke<PathResult>("create_folder", {
                  parent: dir,
                  name,
                });
                createdIds.push(created.path);
              } else {
                const created = await invoke<PathResult>("create_file", {
                  parent: dir,
                  name,
                });
                createdIds.push(created.path);
              }
            }
            await refreshCurrent();
            if (createdIds.length) setSelectedIds(createdIds);
          }}
        />
      ) : null}

      {favoritePick ? (
        <FavoritesPicker
          target={favoritePick}
          onClose={() => setFavoritePick(null)}
          onSaved={() => {
            void refreshFavBar();
            if (activeSidebar === "favorites") {
              void loadFavoritesView(favoriteFolderId);
            }
          }}
        />
      ) : null}

      {contextMenu ? (
        <ContextMenu
          menu={contextMenu}
          openWithApps={openWithApps}
          canPaste={!!clipboard?.paths.length}
          enableTags={appSettings.enableTags}
          onClose={() => setContextMenu(null)}
          onToggleMore={() =>
            setContextMenu((prev) =>
              prev
                ? {
                    ...prev,
                    showMore: !prev.showMore,
                    showOpenWith: false,
                    showBuiltinEditors: false,
                  }
                : prev,
            )
          }
          onToggleOpenWith={handleToggleOpenWith}
          onToggleBuiltinEditors={handleToggleBuiltinEditors}
          onAction={(actionId) => void handleContextAction(actionId)}
        />
      ) : null}

      {sortMenuOpen && sortMenuAnchor ? (
        <SortMenu
          anchor={sortMenuAnchor}
          sortKey={sortKey}
          sortDir={sortDir}
          groupBy={groupBy}
          onSortKey={setSortKey}
          onSortDir={setSortDir}
          onGroupBy={setGroupBy}
          onClose={() => setSortMenuOpen(false)}
        />
      ) : null}

      {favBarMenu ? (
        <FavBarMenu
          anchor={favBarMenu.anchor}
          items={favBarItems.filter(
            (item) => item.folderId === favBarMenu.folderId,
          )}
          onPick={openFavBarItem}
          onClose={() => setFavBarMenu(null)}
        />
      ) : null}

    </LiquidGlass>

    </div>
  );
}

export default App;
