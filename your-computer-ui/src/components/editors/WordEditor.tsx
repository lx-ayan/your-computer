import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import Editor, {
  type ICatalog,
  type IEditorData,
  type IElement,
  type IRangeStyle,
  ElementType,
  ListStyle,
  ListType,
  PaperDirection,
  RowFlex,
  TextDecorationStyle,
  TitleLevel,
  splitText,
} from "@hufe921/canvas-editor";
import docxPlugin from "@hufe921/canvas-editor-plugin-docx";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  BookMarked,
  ClipboardPaste,
  Columns2,
  Copy,
  Eraser,
  ExternalLink,
  Clock,
  FilePlus,
  FolderOpen,
  Highlighter,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Plus,
  Printer,
  Redo2,
  RefreshCw,
  Replace,
  Save,
  Scissors,
  Search,
  SeparatorHorizontal,
  Strikethrough,
  Subscript,
  Superscript,
  Table as TableIcon,
  ChevronDown,
  Type,
  Underline,
  Undo2,
  X,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { DocContextMenu, type DocMenuNode } from "./DocContextMenu";
import {
  ColorPickerPop,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
} from "./ColorPickerPop";
import {
  FontDialog,
  LinkDialog,
  ParagraphDialog,
  type AlignValue,
  type FontPayload,
  type LinkPayload,
  type ParagraphPayload,
  type UnderlineStyle,
} from "./WordDialogs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readOfficeZipBuffer, uint8ToBase64 } from "../../lib/localFile";
import {
  clearWordRecent,
  loadWordRecent,
  pruneWordRecent,
  pushWordRecent,
  removeWordRecent,
  seedWordRecentDemo,
  WORD_RECENT_DEMO,
  WORD_RECENT_EVENT,
  WORD_RECENT_MENU_LIMIT,
  type WordRecentEntry,
} from "../../lib/wordRecent";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { EditorShell, fileNameFromPath } from "./EditorShell";

function formatRecentTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "--";
  }
}

type Props = { path: string | null };
type RibbonTab = "home" | "insert" | "page" | "refs";

/** 右键菜单打开瞬间的上下文快照 */
type CtxSnap = {
  x: number;
  y: number;
  /** 右键时是否存在非折叠选区 */
  hasSelection: boolean;
  /** 选区纯文本（未选中时为空） */
  selectionText: string;
  /** 右键位置所在的样式上下文 */
  style: Partial<IRangeStyle> | null;
  /** 右键点中的超链接地址（未命中为 null） */
  url: string | null;
  /** 右键时的选区范围，对话框抢走焦点后用于还原 */
  range: { startIndex: number; endIndex: number } | null;
};

/** 从元素节点还原出右键位置的行内/段落样式（只写入已定义的键） */
function styleFromElement(el: IElement | null): Partial<IRangeStyle> {
  if (!el) return {};
  const out: Partial<IRangeStyle> = {};
  if (el.type) out.type = el.type;
  if (el.font) out.font = el.font;
  if (el.size) out.size = el.size;
  if (el.bold !== undefined) out.bold = !!el.bold;
  if (el.italic !== undefined) out.italic = !!el.italic;
  if (el.underline !== undefined) out.underline = !!el.underline;
  if (el.strikeout !== undefined) out.strikeout = !!el.strikeout;
  out.color = el.color ?? null;
  out.highlight = el.highlight ?? null;
  out.rowFlex = el.rowFlex ?? null;
  out.rowMargin = el.rowMargin ?? 1;
  out.spacingBefore = el.spacingBefore ?? 0;
  out.spacingAfter = el.spacingAfter ?? 0;
  out.indentLeft = el.indentLeft ?? 0;
  out.indentRight = el.indentRight ?? 0;
  out.indentFirstLine = el.indentFirstLine ?? 0;
  out.level = el.level ?? null;
  out.listType = el.listType ?? null;
  out.listStyle = el.listStyle ?? null;
  return out;
}

/** 段落级属性来自段落首元素，行内属性来自命中的字符 */
function buildSnapshotStyle(
  paraFirst: IElement | null,
  hit: IElement | null,
): Partial<IRangeStyle> {
  const base = styleFromElement(paraFirst);
  const inline = styleFromElement(hit);
  const merged: Partial<IRangeStyle> = { ...base };
  if (inline.type) merged.type = inline.type;
  if (inline.font) merged.font = inline.font;
  if (inline.size) merged.size = inline.size;
  if (hit) {
    merged.bold = inline.bold;
    merged.italic = inline.italic;
    merged.underline = inline.underline;
    merged.strikeout = inline.strikeout;
  }
  merged.color = hit?.color ?? base.color ?? null;
  merged.highlight = hit?.highlight ?? base.highlight ?? null;
  return merged;
}

type DocTab = {
  id: string;
  path: string | null;
  name: string;
  data: IEditorData | null;
  dirty: boolean;
};

const FONT_SIZES = ["12", "14", "16", "18", "20", "24", "28", "32", "36", "48"];
const FONT_FAMILIES = [
  "微软雅黑",
  "宋体",
  "黑体",
  "楷体",
  "仿宋",
  "Calibri",
  "Arial",
  "Times New Roman",
];
const SYMBOLS = [
  "©",
  "®",
  "™",
  "§",
  "¶",
  "†",
  "‡",
  "•",
  "…",
  "–",
  "—",
  "°",
  "±",
  "×",
  "÷",
  "≈",
  "≠",
  "≤",
  "≥",
  "∞",
  "√",
  "π",
  "µ",
  "€",
  "£",
  "¥",
  "←",
  "→",
  "↑",
  "↓",
  "★",
  "☆",
  "✓",
  "✗",
  "①",
  "②",
  "③",
  "④",
];

const PAPER_PX: Record<"a4" | "letter" | "b5", { w: number; h: number; label: string }> = {
  a4: { w: 794, h: 1123, label: "A4" },
  letter: { w: 816, h: 1056, label: "Letter" },
  b5: { w: 729, h: 1032, label: "B5" },
};

const TITLE_LEVEL_ORDER: TitleLevel[] = [
  TitleLevel.FIRST,
  TitleLevel.SECOND,
  TitleLevel.THIRD,
  TitleLevel.FOURTH,
  TitleLevel.FIFTH,
  TitleLevel.SIXTH,
];

function newDocId() {
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankData(): IEditorData {
  return { main: [{ value: "\n" }] };
}

function blankDoc(name = "未命名.docx"): DocTab {
  return {
    id: newDocId(),
    path: null,
    name,
    data: blankData(),
    dirty: false,
  };
}

function cmToPx(cm: number) {
  return Math.round(Math.max(0.5, cm) * 37.8);
}

function flattenCatalog(
  items: ICatalog | null | undefined,
  depth = 0,
): { id: string; text: string; level: number }[] {
  if (!items?.length) return [];
  const out: { id: string; text: string; level: number }[] = [];
  for (const item of items) {
    out.push({ id: item.id, text: item.name, level: depth });
    out.push(...flattenCatalog(item.subCatalog, depth + 1));
  }
  return out;
}

function Sep() {
  return <div className="mx-0.5 h-6 w-px shrink-0 bg-black/[0.08]" />;
}

function ToolBtn({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-[5px] px-1.5 text-[#1d1d1f] hover:bg-black/[0.06] disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-black/[0.08]" : ""
      }`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 flex w-full items-center pt-2 text-left text-[11px] leading-none text-[#8e8e93]">
      {children}
    </div>
  );
}

function ColorPickBtn({
  title,
  color,
  mode,
  onPick,
  children,
}: {
  title: string;
  color: string;
  mode: "fore" | "back";
  onPick: (color: string | null) => void;
  children: ReactNode;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);
  const palette = mode === "fore" ? TEXT_COLORS : HIGHLIGHT_COLORS;
  const fallback = mode === "fore" ? "#1d1d1f" : "#ffe566";

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        className="relative text-[6px] inline-flex h-7 min-w-7 flex-col items-center justify-center rounded-[5px] px-1.5 text-[#1d1d1f] hover:bg-black/[0.06]"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const el = btnRef.current;
          if (!el) return;
          const r = el.getBoundingClientRect();
          setAnchor({
            left: r.left,
            top: r.top,
            right: r.right,
            bottom: r.bottom,
          });
          setOpen(true);
        }}
      >
        {children}
        <span
          className="mt-0.5 h-[3px] w-3.5 rounded-[1px]"
          style={{ background: color || fallback }}
        />
      </button>
      {open && anchor ? (
        <ColorPickerPop
          anchor={anchor}
          value={color || fallback}
          colors={palette}
          clearLabel={mode === "back" ? "清除高亮" : undefined}
          title={title}
          onClose={() => setOpen(false)}
          onPick={(c) => {
            onPick(c);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

export function WordEditor({ path }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const initialPath = useRef(path);
  const untitledSeq = useRef(1);
  const skipContentChange = useRef(false);
  const readyRef = useRef(false);

  const [docs, setDocs] = useState<DocTab[]>(() => [
    path
      ? {
          id: newDocId(),
          path,
          name: fileNameFromPath(path) || "未命名.docx",
          data: null,
          dirty: false,
        }
      : blankDoc(),
  ]);
  const [activeId, setActiveId] = useState(() => docs[0].id);
  const activeDoc = docs.find((d) => d.id === activeId) ?? docs[0];
  const activePath = activeDoc?.path ?? null;
  const [recentFiles, setRecentFiles] = useState<WordRecentEntry[]>(() =>
    WORD_RECENT_DEMO ? seedWordRecentDemo() : loadWordRecent(),
  );
  const [recentManageOpen, setRecentManageOpen] = useState(false);

  const rememberRecent = useCallback((filePath: string, name?: string) => {
    setRecentFiles(pushWordRecent(filePath, name));
  }, []);

  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [tab, setTab] = useState<RibbonTab>("home");

  const docsRef = useRef(docs);
  const activeIdRef = useRef(activeId);
  const dirtyRef = useRef(dirty);
  docsRef.current = docs;
  activeIdRef.current = activeId;
  dirtyRef.current = dirty;

  const [fontSize, setFontSize] = useState("16");
  const [fontFamily, setFontFamily] = useState("微软雅黑");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findCount, setFindCount] = useState(0);
  const [findIndex, setFindIndex] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [paper, setPaper] = useState<"a4" | "letter" | "b5">("a4");
  const [landscape, setLandscape] = useState(false);
  const [marginCm, setMarginCm] = useState(2.54);
  const [watermark, setWatermark] = useState("");
  const [columns, setColumns] = useState<1 | 2>(1);
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [tocItems, setTocItems] = useState<
    { id: string; text: string; level: number }[]
  >([]);
  const [rangeStyle, setRangeStyle] = useState<IRangeStyle | null>(null);
  const [foreColor, setForeColor] = useState("#1d1d1f");
  const [backColor, setBackColor] = useState("#ffe566");

  /** 编辑器右键菜单坐标 + 右键时刻的状态快照 */
  const [ctxMenu, setCtxMenu] = useState<CtxSnap | null>(null);
  /** 对话框打开瞬间的快照（菜单关闭后仍要用它做状态比对与选区还原） */
  const dialogSnapRef = useRef<CtxSnap | null>(null);
  const [fontDialog, setFontDialog] = useState<FontPayload | null>(null);
  const [paraDialog, setParaDialog] = useState<ParagraphPayload | null>(null);
  const [linkDialog, setLinkDialog] = useState<
    (LinkPayload & { editing: boolean; textLocked: boolean }) | null
  >(null);

  const cmd = () => editorRef.current?.command ?? null;

  const markDirty = useCallback(() => {
    setDirty(true);
    const id = activeIdRef.current;
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, dirty: true } : d)),
    );
  }, []);

  const refreshWordCount = useCallback(async () => {
    const c = cmd();
    if (!c) return;
    try {
      const n = await c.getWordCount();
      setWordCount(n);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshToc = useCallback(async () => {
    const c = cmd();
    if (!c) {
      setTocItems([]);
      return;
    }
    try {
      const catalog = await c.getCatalog();
      setTocItems(flattenCatalog(catalog));
    } catch (err) {
      console.warn("getCatalog failed", err);
      setTocItems([]);
    }
  }, []);

  const syncFindNav = useCallback(() => {
    const c = cmd();
    if (!c) {
      setFindCount(0);
      setFindIndex(0);
      return;
    }
    const info = c.getSearchNavigateInfo();
    if (!info) {
      setFindCount(0);
      setFindIndex(0);
      return;
    }
    setFindCount(info.count);
    setFindIndex(info.index + 1);
  }, []);

  const captureActiveData = useCallback((): IEditorData | null => {
    const c = cmd();
    if (!c) return null;
    try {
      return c.getValue().data;
    } catch {
      return null;
    }
  }, []);

  const applyData = useCallback((data: IEditorData | null) => {
    const c = cmd();
    if (!c) return;
    skipContentChange.current = true;
    try {
      c.executeSetValue(data ?? blankData());
    } finally {
      queueMicrotask(() => {
        skipContentChange.current = false;
      });
    }
  }, []);

  const flushActiveToDocs = useCallback(() => {
    const data = captureActiveData();
    if (!data) return;
    const id = activeIdRef.current;
    setDocs((prev) =>
      prev.map((d) =>
        d.id === id ? { ...d, data, dirty: dirtyRef.current } : d,
      ),
    );
  }, [captureActiveData]);

  const loadDocxIntoEditor = useCallback(async (filePath: string) => {
    const c = cmd();
    if (!c) throw new Error("编辑器未就绪");
    const arrayBuffer = await readOfficeZipBuffer(filePath);
    skipContentChange.current = true;
    try {
      // 插件声明为 void，实现为 Promise；用 Promise.resolve 兼容两种返回
      await Promise.resolve(c.executeImportDocx({ arrayBuffer }));
    } finally {
      queueMicrotask(() => {
        skipContentChange.current = false;
      });
    }
  }, []);

  // Mount canvas-editor once（空依赖，避免 StrictMode/回调变化反复销毁实例）
  useEffect(() => {
    const el = containerRef.current;
    if (!el || editorRef.current) return;

    const instance = new Editor(el, blankData(), {
      defaultFont: "微软雅黑",
      defaultSize: 16,
      width: PAPER_PX.a4.w,
      height: PAPER_PX.a4.h,
    });
    instance.use(docxPlugin);
    editorRef.current = instance;
    readyRef.current = true;

    instance.listener.contentChange = () => {
      if (skipContentChange.current) return;
      markDirty();
      void refreshWordCount();
    };
    instance.listener.rangeStyleChange = (payload) => {
      setRangeStyle(payload);
      if (payload.font) setFontFamily(payload.font);
      if (payload.size) setFontSize(String(payload.size));
      if (payload.color) setForeColor(payload.color);
      if (payload.highlight) setBackColor(payload.highlight);
    };

    let cancelled = false;
    const filePath = initialPath.current;
    setLoading(true);
    void (async () => {
      try {
        if (filePath) {
          await loadDocxIntoEditor(filePath);
          if (cancelled) return;
          const data = captureActiveData();
          setDocs((prev) =>
            prev.map((d, i) =>
              i === 0
                ? {
                    ...d,
                    path: filePath,
                    name: fileNameFromPath(filePath) || d.name,
                    data,
                    dirty: false,
                  }
                : d,
            ),
          );
          setDirty(false);
          setRecentFiles(pushWordRecent(filePath));
        } else {
          applyData(blankData());
          setDirty(false);
        }
        // 先关 loading，再做非关键统计，避免 getWordCount 挂起导致一直「加载中」
        if (!cancelled) {
          setLoading(false);
          void refreshWordCount();
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Word load failed", err);
          setHint(
            `打开失败: ${err instanceof Error ? err.message : String(err)}`,
          );
          applyData(blankData());
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      readyRef.current = false;
      instance.listener.contentChange = null;
      instance.listener.rangeStyleChange = null;
      try {
        instance.destroy();
      } catch {
        /* ignore */
      }
      if (editorRef.current === instance) editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  const activateDoc = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) return;
      flushActiveToDocs();
      const target = docsRef.current.find((d) => d.id === id);
      if (!target) return;
      setActiveId(id);
      setDirty(target.dirty);
      setLoading(true);
      setHint(null);
      try {
        if (target.data) {
          applyData(target.data);
        } else if (target.path) {
          await loadDocxIntoEditor(target.path);
          const data = captureActiveData();
          setDocs((prev) =>
            prev.map((d) => (d.id === id ? { ...d, data } : d)),
          );
        } else {
          applyData(blankData());
        }
        setLoading(false);
        void refreshWordCount();
        if (tocOpen) void refreshToc();
      } catch (err) {
        setHint(
          `切换失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        setLoading(false);
      }
    },
    [
      applyData,
      captureActiveData,
      flushActiveToDocs,
      loadDocxIntoEditor,
      refreshToc,
      refreshWordCount,
      tocOpen,
    ],
  );

  /** 按路径关闭页签；force 时跳过未保存确认（文件已失效） */
  const closeDocsByPath = useCallback(
    (filePath: string, opts?: { force?: boolean }) => {
      const norm = filePath.replace(/\//g, "\\").toLowerCase();
      const matches = docsRef.current.filter(
        (d) =>
          !!d.path && d.path.replace(/\//g, "\\").toLowerCase() === norm,
      );
      if (!matches.length) return;

      const toClose: string[] = [];
      for (const target of matches) {
        if (!opts?.force && target.dirty) {
          const ok = window.confirm(
            `「${target.name}」尚未保存，确定关闭？`,
          );
          if (!ok) continue;
        }
        toClose.push(target.id);
      }
      if (!toClose.length) return;

      const closeSet = new Set(toClose);
      const wasActive = closeSet.has(activeIdRef.current);
      if (wasActive) flushActiveToDocs();

      setDocs((prev) => {
        const next = prev.filter((d) => !closeSet.has(d.id));
        if (!next.length) {
          const blank = blankDoc(`未命名${untitledSeq.current}.docx`);
          untitledSeq.current += 1;
          queueMicrotask(() => {
            setActiveId(blank.id);
            applyData(blank.data);
            setDirty(false);
            void refreshWordCount();
          });
          return [blank];
        }
        if (wasActive) {
          const fallback = next[next.length - 1];
          queueMicrotask(() => {
            void activateDoc(fallback.id);
          });
        }
        return next;
      });
    },
    [activateDoc, applyData, flushActiveToDocs, refreshWordCount],
  );

  /** 删除最近记录；若页签已打开则一并关掉 */
  const dismissRecentPath = useCallback(
    (filePath: string, opts?: { force?: boolean }) => {
      setRecentFiles(removeWordRecent(filePath));
      closeDocsByPath(filePath, opts);
    },
    [closeDocsByPath],
  );

  const pruneMissingRecent = useCallback(async () => {
    // 演示数据为假路径，跳过存在性校验以免被清空
    if (WORD_RECENT_DEMO) {
      setRecentFiles(loadWordRecent());
      return;
    }
    const before = loadWordRecent();
    const next = await pruneWordRecent(async (p) => {
      try {
        return await invoke<boolean>("path_exists", { path: p });
      } catch {
        return false;
      }
    });
    setRecentFiles(next);
    const kept = new Set(
      next.map((r) => r.path.replace(/\//g, "\\").toLowerCase()),
    );
    for (const item of before) {
      const key = item.path.replace(/\//g, "\\").toLowerCase();
      if (!kept.has(key)) closeDocsByPath(item.path, { force: true });
    }
  }, [closeDocsByPath]);

  useEffect(() => {
    const sync = () => setRecentFiles(loadWordRecent());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "yc-word-recent") sync();
    };
    window.addEventListener(WORD_RECENT_EVENT, sync);
    window.addEventListener("storage", onStorage);
    void pruneMissingRecent();
    return () => {
      window.removeEventListener(WORD_RECENT_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [pruneMissingRecent]);

  const writeDocxToPath = useCallback(
    async (savePath: string) => {
      const c = cmd();
      if (!c) throw new Error("编辑器未就绪");
      const fileName = fileNameFromPath(savePath) || "document.docx";
      const blob = await c.executeExportDocx({ fileName });
      const buf = new Uint8Array(await blob.arrayBuffer());
      await invoke("write_file_base64", {
        path: savePath,
        dataBase64: uint8ToBase64(buf),
      });
      const data = captureActiveData();
      const name = fileNameFromPath(savePath);
      const id = activeIdRef.current;
      setDocs((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, path: savePath, name, data, dirty: false }
            : d,
        ),
      );
      setDirty(false);
      rememberRecent(savePath, name);
    },
    [captureActiveData, rememberRecent],
  );

  const onSaveAs = useCallback(async () => {
    setSaving(true);
    setHint(null);
    try {
      const defaultName = `${
        activeDoc?.name?.replace(/\.[^.]+$/i, "") || "未命名"
      }.docx`;
      const picked = await invoke<string | null>("pick_save_file", {
        defaultName,
      });
      if (!picked) return;
      const savePath = /\.docx$/i.test(picked) ? picked : `${picked}.docx`;
      await writeDocxToPath(savePath);
      setHint(`已另存为 ${fileNameFromPath(savePath)}`);
    } catch (err) {
      setHint(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [activeDoc?.name, writeDocxToPath]);

  const onSave = useCallback(async () => {
    const curPath = activePath;
    if (!curPath) {
      await onSaveAs();
      return;
    }
    setSaving(true);
    setHint(null);
    try {
      let savePath = curPath;
      if (!/\.docx$/i.test(curPath)) {
        savePath = `${curPath.replace(/\.[^.]+$/, "")}.docx`;
      }
      await writeDocxToPath(savePath);
      setHint("已保存");
    } catch (err) {
      setHint(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [activePath, onSaveAs, writeDocxToPath]);

  const onNew = useCallback(() => {
    flushActiveToDocs();
    const name = `未命名${untitledSeq.current}.docx`;
    untitledSeq.current += 1;
    const doc = blankDoc(name);
    doc.dirty = true;
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
    applyData(doc.data);
    setDirty(true);
    void refreshWordCount();
    setHint("已新建文档");
  }, [applyData, flushActiveToDocs, refreshWordCount]);

  const openDocPath = useCallback(
    async (filePath: string) => {
      // 打开前先确认文件仍在；不在则删记录并关掉对应页签
      try {
        const ok = await invoke<boolean>("path_exists", { path: filePath });
        if (!ok) {
          dismissRecentPath(filePath, { force: true });
          setHint("文件不存在，已从最近打开中移除");
          return;
        }
      } catch {
        dismissRecentPath(filePath, { force: true });
        setHint("无法读取该文件，已从最近打开中移除");
        return;
      }

      flushActiveToDocs();
      const existing = docsRef.current.find((d) => d.path === filePath);
      const created = !existing;
      const tab =
        existing ??
        ({
          id: newDocId(),
          path: filePath,
          name: fileNameFromPath(filePath),
          data: null,
          dirty: false,
        } satisfies DocTab);
      if (created) {
        setDocs((prev) => [...prev, tab]);
      }
      setActiveId(tab.id);
      setDirty(false);
      setLoading(true);
      try {
        await loadDocxIntoEditor(filePath);
        const data = captureActiveData();
        setDocs((prev) =>
          prev.map((d) => (d.id === tab.id ? { ...d, data } : d)),
        );
        rememberRecent(filePath, tab.name);
        setLoading(false);
        void refreshWordCount();
        setHint(`已打开 ${tab.name}`);
      } catch (err) {
        setHint(
          `打开失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        setLoading(false);
        // 读不到：删记录并关掉页签（不删文件）
        dismissRecentPath(filePath, { force: true });
      }
    },
    [
      captureActiveData,
      dismissRecentPath,
      flushActiveToDocs,
      loadDocxIntoEditor,
      refreshWordCount,
      rememberRecent,
    ],
  );

  const onOpen = useCallback(async () => {
    try {
      const files = await invoke<string[]>("pick_open_files");
      if (!files?.length) return;
      flushActiveToDocs();
      const opened: DocTab[] = [];
      for (const filePath of files) {
        const existing = docsRef.current.find((d) => d.path === filePath);
        if (existing) {
          opened.push(existing);
          rememberRecent(filePath, existing.name);
          continue;
        }
        const tab: DocTab = {
          id: newDocId(),
          path: filePath,
          name: fileNameFromPath(filePath),
          data: null,
          dirty: false,
        };
        opened.push(tab);
        rememberRecent(filePath, tab.name);
      }
      if (!opened.length) return;
      setDocs((prev) => {
        const next = [...prev];
        for (const d of opened) {
          if (!next.some((x) => x.id === d.id)) next.push(d);
        }
        return next;
      });
      const focus = opened[opened.length - 1];
      setActiveId(focus.id);
      setDirty(false);
      setLoading(true);
      try {
        if (focus.path) {
          await loadDocxIntoEditor(focus.path);
          const data = captureActiveData();
          setDocs((prev) =>
            prev.map((d) => (d.id === focus.id ? { ...d, data } : d)),
          );
        }
        setLoading(false);
        void refreshWordCount();
        setHint(`已打开 ${focus.name}`);
      } catch (err) {
        setHint(
          `打开失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        setLoading(false);
        if (focus.path) dismissRecentPath(focus.path, { force: true });
      }
    } catch (err) {
      setHint(`打开失败: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  }, [
    captureActiveData,
    dismissRecentPath,
    flushActiveToDocs,
    loadDocxIntoEditor,
    refreshWordCount,
    rememberRecent,
  ]);

  const onCloseDoc = useCallback(
    (id: string) => {
      if (id === activeIdRef.current) flushActiveToDocs();
      const target = docsRef.current.find((d) => d.id === id);
      if (target?.dirty) {
        const ok = window.confirm(`「${target.name}」尚未保存，确定关闭？`);
        if (!ok) return;
      }
      setDocs((prev) => {
        const next = prev.filter((d) => d.id !== id);
        if (!next.length) {
          const blank = blankDoc(`未命名${untitledSeq.current}.docx`);
          untitledSeq.current += 1;
          queueMicrotask(() => {
            setActiveId(blank.id);
            applyData(blank.data);
            setDirty(false);
            void refreshWordCount();
          });
          return [blank];
        }
        if (id === activeIdRef.current) {
          const fallback = next[next.length - 1];
          queueMicrotask(() => {
            void activateDoc(fallback.id);
          });
        }
        return next;
      });
    },
    [activateDoc, applyData, flushActiveToDocs, refreshWordCount],
  );

  const onPrint = useCallback(() => {
    const c = cmd();
    if (!c) {
      setHint("编辑器未就绪");
      return;
    }
    void c.executePrint().catch((err: unknown) => {
      setHint(`打印失败: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, []);

  const run = useCallback(
    (fn: (c: NonNullable<ReturnType<typeof cmd>>) => void) => {
      const c = cmd();
      if (!c) return;
      fn(c);
    },
    [],
  );

  const applyPaper = useCallback(
    (size: "a4" | "letter" | "b5", isLandscape: boolean) => {
      const c = cmd();
      if (!c) return;
      const p = PAPER_PX[size];
      const w = isLandscape ? p.h : p.w;
      const h = isLandscape ? p.w : p.h;
      c.executePaperSize(w, h);
      c.executePaperDirection(
        isLandscape ? PaperDirection.HORIZONTAL : PaperDirection.VERTICAL,
      );
    },
    [],
  );

  const applyMargin = useCallback((cm: number) => {
    const c = cmd();
    if (!c) return;
    const px = cmToPx(cm);
    c.executeSetPaperMargin([px, px, px, px]);
  }, []);

  const insertImageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      if (!value) return;
      const img = new Image();
      img.onload = () => {
        const maxW = 480;
        const scale = img.width > maxW ? maxW / img.width : 1;
        run((c) => {
          c.executeImage({
            value,
            width: Math.round(img.width * scale),
            height: Math.round(img.height * scale),
          });
        });
      };
      img.src = value;
    };
    reader.readAsDataURL(file);
  }, [run]);

  const insertSymbol = useCallback(
    (ch: string) => {
      const list: IElement[] = splitText(ch).map((value) => ({ value }));
      run((c) => c.executeInsertElementList(list));
    },
    [run],
  );

  const insertLink = useCallback(() => {
    const c = cmd();
    if (!c) return;
    const sel = c.getRangeText();
    // 弹窗获取焦点会丢选区，先记下来
    let range: { startIndex: number; endIndex: number } | null = null;
    try {
      const r = c.getRange();
      if (typeof r.startIndex === "number" && typeof r.endIndex === "number") {
        range = { startIndex: r.startIndex, endIndex: r.endIndex };
      }
    } catch {
      /* ignore */
    }
    dialogSnapRef.current = {
      x: 0,
      y: 0,
      hasSelection: !!sel,
      selectionText: sel,
      style: {},
      url: null,
      range,
    };
    setLinkDialog({
      text: sel,
      url: "https://",
      editing: false,
      textLocked: !!sel,
    });
  }, []);

  /* --------------------------- 右键菜单 --------------------------- */

  /** 采集当前光标/选区上下文，供右键菜单与对话框共用 */
  const captureSnap = useCallback(
    (x: number, y: number): CtxSnap => {
      const c = cmd();
      const snap: CtxSnap = {
        x,
        y,
        hasSelection: false,
        selectionText: "",
        style: {},
        url: null,
        range: null,
      };
      if (!c) return snap;
      try {
        const ctx = c.getRangeContext();
        snap.hasSelection = !!ctx && !ctx.isCollapsed;
        snap.selectionText = ctx?.selectionText ?? "";
        const hit = ctx?.startElement ?? null;
        if (hit?.url) snap.url = hit.url;
        // 段落首元素提供对齐/缩进/行距，命中元素提供粗斜体等行内样式
        snap.style = buildSnapshotStyle(c.getRangeParagraph()?.[0] ?? hit, hit);
        const r = c.getRange();
        if (typeof r.startIndex === "number" && typeof r.endIndex === "number") {
          snap.range = { startIndex: r.startIndex, endIndex: r.endIndex };
        }
      } catch {
        /* ignore */
      }
      return snap;
    },
    [],
  );

  const openContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const c = cmd();
      if (!c) return;

      // 图片 / 表格保留 canvas-editor 自带的专用菜单（插入行列、环绕方式等）
      try {
        const pos = c.getPositionContextByEvent(e.nativeEvent, {
          isMustDirectHit: false,
        });
        const t = pos?.element?.type;
        if (
          t === ElementType.IMAGE ||
          t === ElementType.TABLE ||
          pos?.tableInfo
        ) {
          setCtxMenu(null);
          return;
        }
      } catch {
        /* ignore */
      }

      e.preventDefault();
      // 捕获阶段拦下，避免 canvas-editor 再弹自己的英文菜单
      e.stopPropagation();

      setCtxMenu(captureSnap(e.clientX, e.clientY));
      // 新一轮右键 → 丢弃上一轮对话框残留的快照
      dialogSnapRef.current = null;
    },
    [captureSnap],
  );

  /** 还原选区：对话框/菜单抢焦点后 canvas 选区会失效 */
  const restoreRange = useCallback(
    (c: NonNullable<ReturnType<typeof cmd>>) => {
      const r = dialogSnapRef.current?.range ?? ctxMenu?.range;
      if (!r || r.startIndex < 0 || r.endIndex < 0) return;
      try {
        const cur = c.getRange();
        if (cur.startIndex === r.startIndex && cur.endIndex === r.endIndex) {
          return;
        }
        c.executeSetRange(r.startIndex, r.endIndex);
      } catch {
        /* ignore */
      }
    },
    [ctxMenu?.range],
  );

  /** 菜单/对话框里的所有命令都先在快照选区上执行 */
  const runAtSnap = useCallback(
    (fn: (c: NonNullable<ReturnType<typeof cmd>>) => void) => {
      run((c) => {
        restoreRange(c);
        fn(c);
      });
    },
    [restoreRange, run],
  );

  /** 把当前右键快照转成字体对话框初始值 */
  const openFontDialog = useCallback(() => {
    dialogSnapRef.current = ctxMenu;
    const s = ctxMenu?.style ?? rangeStyle;
    const deco = s?.textDecoration?.style as UnderlineStyle | undefined;
    const underlineStyle: UnderlineStyle =
      s?.underline && deco && deco !== "none"
        ? deco
        : s?.underline
          ? "solid"
          : "none";
    setFontDialog({
      font: s?.font || fontFamily,
      size: s?.size || Number(fontSize) || 16,
      bold: !!s?.bold,
      italic: !!s?.italic,
      underline: underlineStyle !== "none",
      underlineStyle,
      strikeout: !!s?.strikeout,
      script:
        s?.type === ElementType.SUPERSCRIPT
          ? "super"
          : s?.type === ElementType.SUBSCRIPT
            ? "sub"
            : "none",
      color: s?.color ?? foreColor,
      highlight: s?.highlight ?? null,
    });
  }, [ctxMenu, fontFamily, fontSize, foreColor, rangeStyle]);

  /** 把当前右键快照转成段落对话框初始值 */
  const openParagraphDialog = useCallback(() => {
    dialogSnapRef.current = ctxMenu;
    const s = ctxMenu?.style ?? rangeStyle;
    const flex = s?.rowFlex;
    const align: AlignValue =
      flex === RowFlex.CENTER
        ? "center"
        : flex === RowFlex.RIGHT
          ? "right"
          : flex === RowFlex.ALIGNMENT || flex === RowFlex.JUSTIFY
            ? "justify"
            : "left";
    const levelMap: Record<string, 1 | 2 | 3 | 4 | 5 | 6> = {
      [TitleLevel.FIRST]: 1,
      [TitleLevel.SECOND]: 2,
      [TitleLevel.THIRD]: 3,
      [TitleLevel.FOURTH]: 4,
      [TitleLevel.FIFTH]: 5,
      [TitleLevel.SIXTH]: 6,
    };
    setParaDialog({
      align,
      outlineLevel: s?.level ? levelMap[s.level] ?? null : null,
      rowMargin: s?.rowMargin ?? 1,
      spacingBefore: s?.spacingBefore ?? 0,
      spacingAfter: s?.spacingAfter ?? 0,
      indentLeft: s?.indentLeft ?? 0,
      indentRight: s?.indentRight ?? 0,
      indentFirstLine: s?.indentFirstLine ?? 0,
    });
  }, [ctxMenu, rangeStyle]);

  const applyFont = useCallback(
    (p: FontPayload) => {
      setFontDialog(null);
      const cur = dialogSnapRef.current?.style ?? ctxMenu?.style ?? rangeStyle;
      const wantUnderline = p.underlineStyle !== "none" && p.underline;
      run((c) => {
        restoreRange(c);
        c.executeFont(p.font);
        c.executeSize(p.size);
        c.executeColor(p.color);
        c.executeHighlight(p.highlight);
        // 以下命令是「切换」语义，需要与目标状态比对
        if (!!cur?.bold !== p.bold) c.executeBold();
        if (!!cur?.italic !== p.italic) c.executeItalic();
        if (!!cur?.underline !== wantUnderline) {
          if (wantUnderline && p.underlineStyle !== "none") {
            c.executeUnderline({
              style: p.underlineStyle as TextDecorationStyle,
            });
          } else {
            c.executeUnderline();
          }
        } else if (
          wantUnderline &&
          p.underlineStyle !== "none" &&
          cur?.textDecoration?.style &&
          cur.textDecoration.style !== p.underlineStyle
        ) {
          // 已有下划线但线型不同：再设一次样式
          c.executeUnderline({
            style: p.underlineStyle as TextDecorationStyle,
          });
        }
        if (!!cur?.strikeout !== p.strikeout) c.executeStrikeout();
        const curScript =
          cur?.type === ElementType.SUPERSCRIPT
            ? "super"
            : cur?.type === ElementType.SUBSCRIPT
              ? "sub"
              : "none";
        if (curScript !== p.script) {
          if (p.script === "super") c.executeSuperscript();
          else if (p.script === "sub") c.executeSubscript();
          else if (curScript === "super") c.executeSuperscript();
          else if (curScript === "sub") c.executeSubscript();
        }
      });
      setFontFamily(p.font);
      setFontSize(String(p.size));
      setForeColor(p.color ?? foreColor);
      setBackColor(p.highlight ?? backColor);
    },
    [backColor, ctxMenu?.style, foreColor, rangeStyle, restoreRange, run],
  );

  const applyParagraph = useCallback(
    (p: ParagraphPayload) => {
      setParaDialog(null);
      run((c) => {
        restoreRange(c);
        const flex =
          p.align === "center"
            ? RowFlex.CENTER
            : p.align === "right"
              ? RowFlex.RIGHT
              : p.align === "justify"
                ? RowFlex.ALIGNMENT
                : RowFlex.LEFT;
        c.executeRowFlex(flex);
        const titleLevels = [
          null,
          TitleLevel.FIRST,
          TitleLevel.SECOND,
          TitleLevel.THIRD,
          TitleLevel.FOURTH,
          TitleLevel.FIFTH,
          TitleLevel.SIXTH,
        ] as const;
        c.executeTitle(
          p.outlineLevel == null ? null : titleLevels[p.outlineLevel],
        );
        c.executeRowMargin(p.rowMargin);
        c.executeSpacingBefore(p.spacingBefore);
        c.executeSpacingAfter(p.spacingAfter);
        c.executeIndentLeft(p.indentLeft);
        c.executeIndentRight(p.indentRight);
        c.executeIndentFirstLine(p.indentFirstLine);
      });
    },
    [restoreRange, run],
  );

  const applyLink = useCallback(
    (p: LinkPayload) => {
      const editing = linkDialog?.editing;
      setLinkDialog(null);
      run((c) => {
        restoreRange(c);
        if (editing) {
          c.executeEditHyperlink(p.url);
          return;
        }
        const valueList = splitText(p.text || p.url).map((value) => ({ value }));
        c.executeHyperlink({ url: p.url, valueList });
      });
    },
    [linkDialog?.editing, restoreRange, run],
  );

  const openLinkDialog = useCallback(
    (editing: boolean) => {
      const snap = ctxMenu;
      dialogSnapRef.current = snap;
      if (editing) {
        setLinkDialog({
          text: snap?.selectionText ?? "",
          url: snap?.url ?? "",
          editing: true,
          textLocked: true,
        });
        return;
      }
      const c = cmd();
      let sel = snap?.selectionText ?? "";
      if (!sel) {
        try {
          sel = c?.getRangeText?.() ?? "";
        } catch {
          /* ignore */
        }
      }
      setLinkDialog({
        text: sel,
        url: "https://",
        editing: false,
        textLocked: !!sel,
      });
    },
    [ctxMenu],
  );

  const applyList = useCallback(
    (kind: "disc" | "decimal" | "circle" | "square" | "checkbox") => {
      run((c) => {
        restoreRange(c);
        const cur = ctxMenu?.style ?? rangeStyle;
        if (kind === "decimal") {
          c.executeList(
            cur?.listType === ListType.OL ? null : ListType.OL,
            ListStyle.DECIMAL,
          );
          return;
        }
        const style =
          kind === "circle"
            ? ListStyle.CIRCLE
            : kind === "square"
              ? ListStyle.SQUARE
              : kind === "checkbox"
                ? ListStyle.CHECKBOX
                : ListStyle.DISC;
        c.executeList(
          cur?.listType === ListType.UL && cur?.listStyle === style
            ? null
            : ListType.UL,
          style,
        );
      });
    },
    [ctxMenu?.style, rangeStyle, restoreRange, run],
  );

  const ctxMenuItems = useMemo<DocMenuNode[]>(() => {
    if (!ctxMenu) return [];
    const snap = ctxMenu;
    const s = snap.style;
    const isLink = !!snap.url;

    const node = (n: DocMenuNode) => n;

    return [
      node({
        kind: "item",
        id: "cut",
        label: "剪切",
        shortcut: "Ctrl+X",
        icon: Scissors,
        onSelect: () => runAtSnap((cc) => cc.executeCut()),
      }),
      node({
        kind: "item",
        id: "copy",
        label: "复制",
        shortcut: "Ctrl+C",
        icon: Copy,
        onSelect: () => runAtSnap((cc) => cc.executeCopy()),
      }),
      node({
        kind: "item",
        id: "paste",
        label: "粘贴",
        shortcut: "Ctrl+V",
        icon: ClipboardPaste,
        onSelect: () => runAtSnap((cc) => cc.executePaste()),
      }),
      { kind: "sep" },
      node({
        kind: "sub",
        id: "font",
        label: "字体",
        icon: Type,
        children: [
          node({
            kind: "item",
            id: "font-dialog",
            label: "字体设置…",
            onSelect: openFontDialog,
          }),
          { kind: "sep" },
          node({
            kind: "item",
            id: "bold",
            label: "加粗",
            shortcut: "Ctrl+B",
            checked: !!s?.bold,
            onSelect: () => runAtSnap((cc) => cc.executeBold()),
          }),
          node({
            kind: "item",
            id: "italic",
            label: "斜体",
            shortcut: "Ctrl+I",
            checked: !!s?.italic,
            onSelect: () => runAtSnap((cc) => cc.executeItalic()),
          }),
          node({
            kind: "item",
            id: "underline",
            label: "下划线",
            shortcut: "Ctrl+U",
            checked: !!s?.underline,
            onSelect: () => runAtSnap((cc) => cc.executeUnderline()),
          }),
          node({
            kind: "item",
            id: "strikeout",
            label: "删除线",
            checked: !!s?.strikeout,
            onSelect: () => runAtSnap((cc) => cc.executeStrikeout()),
          }),
          { kind: "sep" },
          node({
            kind: "item",
            id: "sup",
            label: "上标",
            checked: s?.type === ElementType.SUPERSCRIPT,
            onSelect: () => runAtSnap((cc) => cc.executeSuperscript()),
          }),
          node({
            kind: "item",
            id: "sub",
            label: "下标",
            checked: s?.type === ElementType.SUBSCRIPT,
            onSelect: () => runAtSnap((cc) => cc.executeSubscript()),
          }),
          { kind: "sep" },
          node({
            kind: "item",
            id: "size-add",
            label: "增大字号",
            onSelect: () => runAtSnap((cc) => cc.executeSizeAdd()),
          }),
          node({
            kind: "item",
            id: "size-minus",
            label: "减小字号",
            onSelect: () => runAtSnap((cc) => cc.executeSizeMinus()),
          }),
          { kind: "sep" },
          { kind: "label", text: "字体颜色" },
          {
            kind: "colors",
            id: "font-color",
            title: "字体颜色",
            value: s?.color ?? null,
            colors: TEXT_COLORS,
            clearLabel: "自动",
            onPick: (color) => runAtSnap((cc) => cc.executeColor(color)),
          },
          { kind: "label", text: "突出显示" },
          {
            kind: "colors",
            id: "font-highlight",
            title: "突出显示",
            value: s?.highlight ?? null,
            colors: HIGHLIGHT_COLORS,
            clearLabel: "无",
            onPick: (color) => runAtSnap((cc) => cc.executeHighlight(color)),
          },
        ],
      }),
      node({
        kind: "sub",
        id: "paragraph",
        label: "段落",
        icon: Pilcrow,
        children: [
          node({
            kind: "item",
            id: "para-dialog",
            label: "段落设置…",
            onSelect: openParagraphDialog,
          }),
          { kind: "sep" },
          node({
            kind: "item",
            id: "align-left",
            label: "左对齐",
            checked: !s?.rowFlex || s?.rowFlex === RowFlex.LEFT,
            onSelect: () => runAtSnap((cc) => cc.executeRowFlex(RowFlex.LEFT)),
          }),
          node({
            kind: "item",
            id: "align-center",
            label: "居中",
            checked: s?.rowFlex === RowFlex.CENTER,
            onSelect: () => runAtSnap((cc) => cc.executeRowFlex(RowFlex.CENTER)),
          }),
          node({
            kind: "item",
            id: "align-right",
            label: "右对齐",
            checked: s?.rowFlex === RowFlex.RIGHT,
            onSelect: () => runAtSnap((cc) => cc.executeRowFlex(RowFlex.RIGHT)),
          }),
          node({
            kind: "item",
            id: "align-justify",
            label: "两端对齐",
            checked:
              s?.rowFlex === RowFlex.ALIGNMENT || s?.rowFlex === RowFlex.JUSTIFY,
            onSelect: () => runAtSnap((cc) => cc.executeRowFlex(RowFlex.ALIGNMENT)),
          }),
          { kind: "sep" },
          node({
            kind: "item",
            id: "indent-add",
            label: "增加缩进",
            onSelect: () =>
              runAtSnap((cc) => cc.executeIndentLeft((s?.indentLeft ?? 0) + 20)),
          }),
          node({
            kind: "item",
            id: "indent-minus",
            label: "减少缩进",
            onSelect: () =>
              runAtSnap((cc) =>
                cc.executeIndentLeft(Math.max(0, (s?.indentLeft ?? 0) - 20)),
              ),
          }),
          { kind: "sep" },
          node({
            kind: "sub",
            id: "line-spacing",
            label: "行距",
            children: [1, 1.15, 1.5, 2, 2.5, 3].map((m) =>
              node({
                kind: "item" as const,
                id: `line-${m}`,
                label: `${m} 倍`,
                checked: (s?.rowMargin ?? 1) === m,
                onSelect: () => runAtSnap((cc) => cc.executeRowMargin(m)),
              }),
            ),
          }),
          node({
            kind: "sub",
            id: "heading",
            label: "标题样式",
            children: [
              node({
                kind: "item",
                id: "heading-none",
                label: "正文",
                checked: !s?.level,
                onSelect: () => runAtSnap((cc) => cc.executeTitle(null)),
              }),
              { kind: "sep" },
              ...TITLE_LEVEL_ORDER.map((lv, i) =>
                node({
                  kind: "item" as const,
                  id: `heading-${lv}`,
                  label: `标题 ${i + 1}`,
                  checked: s?.level === lv,
                  onSelect: () => runAtSnap((cc) => cc.executeTitle(lv)),
                }),
              ),
            ],
          }),
        ],
      }),
      node({
        kind: "sub",
        id: "list",
        label: "项目符号和编号",
        icon: List,
        children: [
          node({
            kind: "item",
            id: "list-disc",
            label: "实心圆点",
            checked:
              s?.listType === ListType.UL && s?.listStyle === ListStyle.DISC,
            onSelect: () => applyList("disc"),
          }),
          node({
            kind: "item",
            id: "list-circle",
            label: "空心圆点",
            checked:
              s?.listType === ListType.UL && s?.listStyle === ListStyle.CIRCLE,
            onSelect: () => applyList("circle"),
          }),
          node({
            kind: "item",
            id: "list-square",
            label: "实心方块",
            checked:
              s?.listType === ListType.UL && s?.listStyle === ListStyle.SQUARE,
            onSelect: () => applyList("square"),
          }),
          node({
            kind: "item",
            id: "list-checkbox",
            label: "复选框",
            checked:
              s?.listType === ListType.UL &&
              s?.listStyle === ListStyle.CHECKBOX,
            onSelect: () => applyList("checkbox"),
          }),
          { kind: "sep" },
          node({
            kind: "item",
            id: "list-decimal",
            label: "数字编号 1. 2. 3.",
            checked: s?.listType === ListType.OL,
            onSelect: () => applyList("decimal"),
          }),
          { kind: "sep" },
          node({
            kind: "item",
            id: "list-none",
            label: "取消列表",
            disabled: !s?.listType,
            onSelect: () =>
              runAtSnap((cc) =>
                cc.executeList(null, s?.listStyle ?? ListStyle.DISC),
              ),
          }),
        ],
      }),
      { kind: "sep" },
      node({
        kind: "sub",
        id: "link",
        label: "超链接",
        icon: Link2,
        children: [
          node({
            kind: "item",
            id: "link-insert",
            label: isLink ? "编辑超链接…" : "插入超链接…",
            shortcut: "Ctrl+K",
            onSelect: () => openLinkDialog(isLink),
          }),
          { kind: "sep" },
          node({
            kind: "item",
            id: "link-open",
            label: "打开链接",
            icon: ExternalLink,
            disabled: !isLink,
            onSelect: () => {
              const target = snap.url;
              if (!target) return;
              void openUrl(target).catch((err: unknown) => {
                setHint(
                  `打开链接失败: ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                );
              });
            },
          }),
          { kind: "sep" },
          node({
            kind: "item",
            id: "link-cancel",
            label: "取消超链接",
            disabled: !isLink,
            onSelect: () => runAtSnap((cc) => cc.executeCancelHyperlink()),
          }),
          node({
            kind: "item",
            id: "link-remove",
            label: "删除链接文字",
            disabled: !isLink,
            onSelect: () => runAtSnap((cc) => cc.executeDeleteHyperlink()),
          }),
        ],
      }),
      { kind: "sep" },
      node({
        kind: "item",
        id: "clear-format",
        label: "清除格式",
        icon: Eraser,
        onSelect: () => runAtSnap((cc) => cc.executeFormat()),
      }),
      { kind: "sep" },
      node({
        kind: "item",
        id: "select-all",
        label: "全选",
        shortcut: "Ctrl+A",
        onSelect: () => runAtSnap((cc) => cc.executeSelectAll()),
      }),
      node({
        kind: "item",
        id: "print",
        label: "打印",
        shortcut: "Ctrl+P",
        icon: Printer,
        onSelect: onPrint,
      }),
    ];
  }, [
    applyList,
    ctxMenu,
    openFontDialog,
    openLinkDialog,
    openParagraphDialog,
    onPrint,
    rangeStyle,
    runAtSnap,
  ]);

  const doSearch = useCallback(
    (query: string) => {
      run((c) => c.executeSearch(query || null));
      syncFindNav();
    },
    [run, syncFindNav],
  );

  const doReplace = useCallback(() => {
    if (!findQuery) return;
    run((c) => {
      c.executeSearch(findQuery);
      c.executeReplace(replaceQuery);
    });
    syncFindNav();
  }, [findQuery, replaceQuery, run, syncFindNav]);

  const doReplaceAll = useCallback(() => {
    if (!findQuery) return;
    run((c) => {
      c.executeSearch(findQuery);
      let guard = 0;
      while (guard < 500) {
        const info = c.getSearchNavigateInfo();
        if (!info || info.count <= 0) break;
        c.executeReplace(replaceQuery);
        c.executeSearch(findQuery);
        guard += 1;
      }
    });
    syncFindNav();
  }, [findQuery, replaceQuery, run, syncFindNav]);

  useEffect(() => {
    if (!tocOpen) return;
    void refreshToc();
  }, [tocOpen, activeId, refreshToc]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "k") {
        // 弹出对话框前拦下 canvas-editor 的默认处理
        e.preventDefault();
        e.stopPropagation();
        insertLink();
        return;
      }
      if (key === "s") {
        e.preventDefault();
        if (e.shiftKey) void onSaveAs();
        else void onSave();
        return;
      }
      if (key === "n") {
        e.preventDefault();
        onNew();
        return;
      }
      if (key === "o") {
        e.preventDefault();
        void onOpen();
        return;
      }
      if (key === "p") {
        e.preventDefault();
        onPrint();
        return;
      }
      if (key === "f") {
        e.preventDefault();
        setFindOpen(true);
        queueMicrotask(() => findInputRef.current?.focus());
        return;
      }
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        run((c) => c.executeUndo());
        return;
      }
      if (key === "y" || (key === "z" && e.shiftKey)) {
        e.preventDefault();
        run((c) => c.executeRedo());
        return;
      }
      if (key === "w") {
        e.preventDefault();
        if (activeIdRef.current) onCloseDoc(activeIdRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [insertLink, onCloseDoc, onNew, onOpen, onPrint, onSave, onSaveAs, run]);

  const title = `Word · ${activeDoc?.name || "未命名"}`;
  const statsLabel = useMemo(() => `字数 ${wordCount}`, [wordCount]);

  const ribbonTabs: { id: RibbonTab; label: string }[] = [
    { id: "home", label: "开始" },
    { id: "insert", label: "插入" },
    { id: "page", label: "页面" },
    { id: "refs", label: "引用" },
  ];

  const scriptSup = rangeStyle?.type === ElementType.SUPERSCRIPT;
  const scriptSub = rangeStyle?.type === ElementType.SUBSCRIPT;

  return (
    <EditorShell
      title={title}
      dirty={dirty}
      saving={saving}
      hint={loading ? "加载中…" : hint}
      onSave={() => void onSave()}
    >
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) insertImageFile(f);
          e.target.value = "";
        }}
      />
      <div className="relative flex h-full min-h-0 flex-col">
        {loading ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/80 text-[13px] text-[#6e6e73]">
            加载中…
          </div>
        ) : null}
        <div className="flex h-full min-h-0 flex-col">
          <div className="shrink-0 border-b border-black/[0.06] bg-[#fafafa]">
            <div className="flex items-center gap-0.5 overflow-x-auto border-b border-black/[0.04] px-2 pt-1">
              {docs.map((d) => (
                <div
                  key={d.id}
                  className={`group flex max-w-[180px] shrink-0 items-center gap-1 rounded-t-[6px] px-2.5 py-1 text-[12px] ${
                    d.id === activeId
                      ? "bg-white font-medium text-[#1d1d1f]"
                      : "text-[#6e6e73] hover:bg-white/70 hover:text-[#1d1d1f]"
                  }`}
                  onClick={() => void activateDoc(d.id)}
                >
                  <span className="min-w-0 truncate">
                    {d.dirty ? "• " : ""}
                    {d.name}
                  </span>
                  <button
                    type="button"
                    title="关闭"
                    className="rounded p-0.5 opacity-50 hover:bg-black/[0.06] hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseDoc(d.id);
                    }}
                  >
                    <X size={12} className="translate-y-[0.125em]" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                title="新建 (Ctrl+N)"
                className="mb-0.5 rounded-[4px] px-1.5 py-1 text-[#6e6e73] hover:bg-black/[0.06] hover:text-[#1d1d1f]"
                onClick={onNew}
              >
                <FilePlus size={14} className="translate-y-[0.125em]" />
              </button>
            </div>

            <div className="flex items-center gap-0.5 px-2 pt-1">
              <DropdownMenu>
                <DropdownMenuTrigger className="inline-flex items-center gap-0.5 rounded-t-[6px] px-3 py-1 text-[14px] text-[#6e6e73] outline-none hover:bg-white/80 hover:text-[#1d1d1f] data-popup-open:bg-white data-popup-open:font-medium data-popup-open:text-[#1d1d1f]">
                  <span className="text-[12px]">文件</span>
                  <ChevronDown
                    size={12}
                    className="translate-y-[0.125em] opacity-60"
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-44">
                  <DropdownMenuItem onClick={onNew}>
                    <FilePlus /> 新建
                    <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void onOpen()}>
                    <FolderOpen /> 打开
                    <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuSub
                    onOpenChange={(open) => {
                      if (open) void pruneMissingRecent();
                    }}
                  >
                    <DropdownMenuSubTrigger>
                      <Clock /> 最近打开
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-[240px] max-w-[380px]">
                      {recentFiles.length === 0 ? (
                        <DropdownMenuItem disabled>
                          暂无最近文件
                        </DropdownMenuItem>
                      ) : (
                        recentFiles
                          .slice(0, WORD_RECENT_MENU_LIMIT)
                          .map((item) => (
                            <div
                              key={item.path}
                              className="group flex items-center gap-0.5 rounded-md pr-1 focus-within:bg-accent hover:bg-accent"
                            >
                              <DropdownMenuItem
                                className="min-w-0 flex-1 flex-col items-start gap-0.5 py-1.5 focus:bg-transparent"
                                title={item.path}
                                onClick={() => void openDocPath(item.path)}
                              >
                                <span className="w-full truncate text-[13px]">
                                  {item.name}
                                </span>
                                <span className="w-full truncate text-[11px] text-muted-foreground">
                                  {item.path}
                                </span>
                              </DropdownMenuItem>
                              <button
                                type="button"
                                title="从最近打开中移除（不删除文件；若已打开页签会一并关闭）"
                                className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-60 hover:bg-black/[0.06] hover:text-[#ff3b30] hover:opacity-100"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  dismissRecentPath(item.path);
                                }}
                                onPointerDown={(e) => e.stopPropagation()}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          ))
                      )}
                      {recentFiles.length > WORD_RECENT_MENU_LIMIT ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="justify-center text-[#0165e1] focus:text-[#0165e1]"
                            onClick={() => setRecentManageOpen(true)}
                          >
                            查看全部
                          </DropdownMenuItem>
                        </>
                      ) : null}
                      {recentFiles.length > 0 &&
                      recentFiles.length <= WORD_RECENT_MENU_LIMIT ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              const list = [...recentFiles];
                              setRecentFiles(clearWordRecent());
                              for (const item of list) {
                                closeDocsByPath(item.path);
                              }
                            }}
                          >
                            清除最近打开
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => void onSave()}>
                    <Save /> 保存
                    <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void onSaveAs()}>
                    <Save /> 另存为
                    <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onPrint}>
                    <Printer /> 打印
                    <DropdownMenuShortcut>Ctrl+P</DropdownMenuShortcut>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {ribbonTabs.map((t) => (
                <div
                  key={t.id}
                  className={`rounded-t-[6px] px-3 py-1 text-[12px] ${
                    tab === t.id
                      ? "bg-white font-medium text-[#1d1d1f]"
                      : "text-[#6e6e73] hover:text-[#1d1d1f]"
                  }`}
                  onClick={() => {
                    setTab(t.id);
                    setSymbolOpen(false);
                  }}
                >
                  {t.label}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-start gap-1 border-t border-black/[0.04] bg-white px-2 py-1.5">
              {tab === "home" ? (
                <>
                  <div className="flex flex-col">
                    <GroupLabel>剪贴板</GroupLabel>
                    <div className="flex items-center">
                      <ToolBtn
                        title="剪切"
                        onClick={() => run((c) => c.executeCut())}
                      >
                        <Scissors size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="复制"
                        onClick={() => run((c) => c.executeCopy())}
                      >
                        <Copy size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="粘贴"
                        onClick={() => run((c) => c.executePaste())}
                      >
                        <ClipboardPaste size={14} />
                      </ToolBtn>
                      <Sep />
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <GroupLabel>字体</GroupLabel>
                    <div className="flex flex-wrap items-center gap-0.5">
                      <ToolBtn
                        title="撤销"
                        onClick={() => run((c) => c.executeUndo())}
                      >
                        <Undo2 size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="重做"
                        onClick={() => run((c) => c.executeRedo())}
                      >
                        <Redo2 size={14} />
                      </ToolBtn>
                      <select
                        className="h-7 max-w-[110px] rounded-[5px] border border-black/[0.08] bg-white px-1 text-[12px] outline-none"
                        value={fontFamily}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFontFamily(v);
                          run((c) => c.executeFont(v));
                        }}
                      >
                        {FONT_FAMILIES.map((f) => (
                          <option key={f} value={f}>
                            {f}
                          </option>
                        ))}
                      </select>
                      <select
                        className="h-7 w-14 rounded-[5px] border border-black/[0.08] bg-white px-1 text-[12px] outline-none"
                        value={fontSize}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const v = e.target.value;
                          setFontSize(v);
                          run((c) => c.executeSize(Number(v)));
                        }}
                      >
                        {FONT_SIZES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                      <ToolBtn
                        title="增大字号"
                        onClick={() => run((c) => c.executeSizeAdd())}
                      >
                        <Plus size={13} />
                      </ToolBtn>
                      <ToolBtn
                        title="减小字号"
                        onClick={() => run((c) => c.executeSizeMinus())}
                      >
                        <Minus size={13} />
                      </ToolBtn>
                      <ToolBtn
                        title="加粗"
                        active={!!rangeStyle?.bold}
                        onClick={() => run((c) => c.executeBold())}
                      >
                        <Bold size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="斜体"
                        active={!!rangeStyle?.italic}
                        onClick={() => run((c) => c.executeItalic())}
                      >
                        <Italic size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="下划线"
                        active={!!rangeStyle?.underline}
                        onClick={() => run((c) => c.executeUnderline())}
                      >
                        <Underline size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="删除线"
                        active={!!rangeStyle?.strikeout}
                        onClick={() => run((c) => c.executeStrikeout())}
                      >
                        <Strikethrough size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="下标"
                        active={scriptSub}
                        onClick={() => run((c) => c.executeSubscript())}
                      >
                        <Subscript size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="上标"
                        active={scriptSup}
                        onClick={() => run((c) => c.executeSuperscript())}
                      >
                        <Superscript size={14} />
                      </ToolBtn>
                      <ColorPickBtn
                        title="字体颜色"
                        color={foreColor}
                        mode="fore"
                        onPick={(color) => {
                          if (!color) return;
                          setForeColor(color);
                          run((c) => c.executeColor(color));
                        }}
                      >
                        <span className="text-[13px] font-semibold leading-none">
                          A
                        </span>
                      </ColorPickBtn>
                      <ColorPickBtn
                        title="高亮"
                        color={backColor}
                        mode="back"
                        onPick={(color) => {
                          if (color) {
                            setBackColor(color);
                            run((c) => c.executeHighlight(color));
                          } else {
                            run((c) => c.executeHighlight(null));
                          }
                        }}
                      >
                        <Highlighter size={14} />
                      </ColorPickBtn>
                      <ToolBtn
                        title="清除格式"
                        onClick={() => run((c) => c.executeFormat())}
                      >
                        <Eraser size={14} />
                      </ToolBtn>
                    </div>
                  </div>

                  <div className="flex flex-col">
                    <GroupLabel>段落</GroupLabel>
                    <div className="flex flex-wrap items-center gap-0.5">
                      <ToolBtn
                        title="左对齐"
                        active={rangeStyle?.rowFlex === RowFlex.LEFT}
                        onClick={() =>
                          run((c) => c.executeRowFlex(RowFlex.LEFT))
                        }
                      >
                        <AlignLeft size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="居中"
                        active={rangeStyle?.rowFlex === RowFlex.CENTER}
                        onClick={() =>
                          run((c) => c.executeRowFlex(RowFlex.CENTER))
                        }
                      >
                        <AlignCenter size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="右对齐"
                        active={rangeStyle?.rowFlex === RowFlex.RIGHT}
                        onClick={() =>
                          run((c) => c.executeRowFlex(RowFlex.RIGHT))
                        }
                      >
                        <AlignRight size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="两端对齐"
                        active={
                          rangeStyle?.rowFlex === RowFlex.ALIGNMENT ||
                          rangeStyle?.rowFlex === RowFlex.JUSTIFY
                        }
                        onClick={() =>
                          run((c) => c.executeRowFlex(RowFlex.ALIGNMENT))
                        }
                      >
                        <AlignJustify size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="项目符号"
                        active={rangeStyle?.listType === ListType.UL}
                        onClick={() =>
                          run((c) =>
                            c.executeList(
                              rangeStyle?.listType === ListType.UL
                                ? null
                                : ListType.UL,
                              ListStyle.DISC,
                            ),
                          )
                        }
                      >
                        <List size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="编号"
                        active={rangeStyle?.listType === ListType.OL}
                        onClick={() =>
                          run((c) =>
                            c.executeList(
                              rangeStyle?.listType === ListType.OL
                                ? null
                                : ListType.OL,
                              ListStyle.DECIMAL,
                            ),
                          )
                        }
                      >
                        <ListOrdered size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="增加缩进"
                        onClick={() =>
                          run((c) =>
                            c.executeIndentLeft(
                              (rangeStyle?.indentLeft ?? 0) + 20,
                            ),
                          )
                        }
                      >
                        <IndentIncrease size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="减少缩进"
                        onClick={() =>
                          run((c) =>
                            c.executeIndentLeft(
                              Math.max(0, (rangeStyle?.indentLeft ?? 0) - 20),
                            ),
                          )
                        }
                      >
                        <IndentDecrease size={14} />
                      </ToolBtn>
                      <select
                        className="h-7 rounded-[5px] border border-black/[0.08] bg-white px-1 text-[12px] outline-none"
                        value={rangeStyle?.level ?? ""}
                        onMouseDown={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const v = e.target.value;
                          run((c) =>
                            c.executeTitle(
                              v ? (v as TitleLevel) : null,
                            ),
                          );
                        }}
                      >
                        <option value="">正文</option>
                        {TITLE_LEVEL_ORDER.map((lv, i) => (
                          <option key={lv} value={lv}>
                            标题 {i + 1}
                          </option>
                        ))}
                      </select>
                      <ToolBtn
                        title="查找替换"
                        active={findOpen}
                        onClick={() => {
                          setFindOpen((v) => !v);
                          queueMicrotask(() => findInputRef.current?.focus());
                        }}
                      >
                        <Search size={14} />
                      </ToolBtn>
                    </div>
                  </div>
                </>
              ) : null}

              {tab === "insert" ? (
                <>
                  <div className="flex flex-col">
                    <GroupLabel>插入</GroupLabel>
                    <div className="flex flex-wrap items-center gap-0.5">
                      <ToolBtn
                        title="表格"
                        onClick={() =>
                          run((c) => c.executeInsertTable(3, 3))
                        }
                      >
                        <TableIcon size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="图片"
                        onClick={() => imageInputRef.current?.click()}
                      >
                        <ImageIcon size={14} />
                      </ToolBtn>
                      <ToolBtn title="超链接 (Ctrl+K)" onClick={insertLink}>
                        <Link2 size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="分页符"
                        onClick={() => run((c) => c.executePageBreak())}
                      >
                        <SeparatorHorizontal size={14} />
                      </ToolBtn>
                      <ToolBtn
                        title="符号"
                        active={symbolOpen}
                        onClick={() => setSymbolOpen((v) => !v)}
                      >
                        <Type size={14} />
                      </ToolBtn>
                    </div>
                  </div>
                  {symbolOpen ? (
                    <div className="mt-1 flex max-w-full flex-wrap gap-0.5 rounded-[6px] border border-black/[0.06] bg-[#fafafa] p-1.5">
                      {SYMBOLS.map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          className="flex size-7 items-center justify-center rounded-[4px] text-[14px] hover:bg-black/[0.06]"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertSymbol(ch)}
                        >
                          {ch}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : null}

              {tab === "page" ? (
                <div className="flex flex-col">
                  <GroupLabel>页面设置</GroupLabel>
                  <div className="flex flex-wrap items-center gap-0.5">
                    <select
                      className="h-7 rounded-[5px] border border-black/[0.08] bg-white px-1 text-[12px] outline-none"
                      value={paper}
                      onChange={(e) => {
                        const v = e.target.value as "a4" | "letter" | "b5";
                        setPaper(v);
                        applyPaper(v, landscape);
                      }}
                    >
                      {Object.entries(PAPER_PX).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                    <ToolBtn
                      title="横向"
                      active={landscape}
                      onClick={() => {
                        const next = !landscape;
                        setLandscape(next);
                        applyPaper(paper, next);
                      }}
                    >
                      横向
                    </ToolBtn>
                    <label className="ml-1 flex items-center gap-1 text-[12px] text-[#6e6e73]">
                      边距(cm)
                      <input
                        type="number"
                        min={0.5}
                        max={5}
                        step={0.1}
                        value={marginCm}
                        className="h-7 w-14 rounded-[5px] border border-black/[0.08] px-1 text-[12px] outline-none"
                        onChange={(e) => {
                          const v = Number(e.target.value) || 2.54;
                          setMarginCm(v);
                          applyMargin(v);
                        }}
                      />
                    </label>
                    <ToolBtn
                      title="分栏"
                      active={columns === 2}
                      onClick={() => {
                        const next = columns === 1 ? 2 : 1;
                        setColumns(next);
                        run((c) =>
                          c.executeSetColumns(
                            next === 1 ? null : { count: 2, gap: 40 },
                          ),
                        );
                      }}
                    >
                      <Columns2 size={14} />
                    </ToolBtn>
                    <input
                      type="text"
                      placeholder="水印文字"
                      value={watermark}
                      className="h-7 w-28 rounded-[5px] border border-black/[0.08] px-1.5 text-[12px] outline-none"
                      onChange={(e) => setWatermark(e.target.value)}
                    />
                    <ToolBtn
                      title="应用水印"
                      onClick={() => {
                        if (!watermark.trim()) {
                          run((c) => c.executeDeleteWatermark());
                          return;
                        }
                        run((c) =>
                          c.executeAddWatermark({
                            data: watermark.trim(),
                            size: 48,
                            color: "#c0c0c0",
                            opacity: 0.35,
                            repeat: true,
                          }),
                        );
                      }}
                    >
                      水印
                    </ToolBtn>
                  </div>
                </div>
              ) : null}

              {tab === "refs" ? (
                <div className="flex flex-col">
                  <GroupLabel>目录</GroupLabel>
                  <div className="flex flex-wrap items-center gap-0.5">
                    <ToolBtn
                      title="显示目录"
                      active={tocOpen}
                      onClick={() => setTocOpen((v) => !v)}
                    >
                      <BookMarked size={14} />
                      <span className="ml-1 text-[12px]">目录</span>
                    </ToolBtn>
                    <ToolBtn
                      title="更新目录"
                      onClick={() => void refreshToc()}
                    >
                      <RefreshCw size={14} />
                      <span className="ml-1 text-[12px]">更新</span>
                    </ToolBtn>
                  </div>
                </div>
              ) : null}
            </div>

            {findOpen ? (
              <div className="flex flex-wrap items-center gap-1 border-t border-black/[0.04] bg-white px-2 py-1.5">
                <Search size={14} className="text-[#6e6e73]" />
                <input
                  ref={findInputRef}
                  value={findQuery}
                  onChange={(e) => {
                    const v = e.target.value;
                    setFindQuery(v);
                    doSearch(v);
                  }}
                  placeholder="查找"
                  className="h-7 w-40 rounded-[5px] border border-black/[0.08] px-2 text-[12px] outline-none"
                />
                <Replace size={14} className="text-[#6e6e73]" />
                <input
                  value={replaceQuery}
                  onChange={(e) => setReplaceQuery(e.target.value)}
                  placeholder="替换为"
                  className="h-7 w-40 rounded-[5px] border border-black/[0.08] px-2 text-[12px] outline-none"
                />
                <span className="text-[11px] text-[#6e6e73]">
                  {findCount > 0 ? `${findIndex}/${findCount}` : "无结果"}
                </span>
                <ToolBtn
                  title="上一个"
                  onClick={() => {
                    run((c) => c.executeSearchNavigatePre());
                    syncFindNav();
                  }}
                >
                  ↑
                </ToolBtn>
                <ToolBtn
                  title="下一个"
                  onClick={() => {
                    run((c) => c.executeSearchNavigateNext());
                    syncFindNav();
                  }}
                >
                  ↓
                </ToolBtn>
                <ToolBtn title="替换" onClick={doReplace}>
                  替换
                </ToolBtn>
                <ToolBtn title="全部替换" onClick={doReplaceAll}>
                  全部
                </ToolBtn>
                <ToolBtn
                  title="关闭"
                  onClick={() => {
                    setFindOpen(false);
                    doSearch("");
                  }}
                >
                  <X size={14} />
                </ToolBtn>
              </div>
            ) : null}
          </div>

          <div className="flex min-h-0 flex-1">
            {tocOpen ? (
              <aside className="flex w-56 shrink-0 flex-col border-r border-black/[0.06] bg-[#fafafa]">
                <div className="flex items-center justify-between border-b border-black/[0.06] px-2 py-1.5 text-[12px] font-medium">
                  <span>目录</span>
                  <button
                    type="button"
                    className="rounded p-0.5 hover:bg-black/[0.06]"
                    onClick={() => setTocOpen(false)}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-auto p-1">
                  {tocItems.length === 0 ? (
                    <div className="px-2 py-3 text-[12px] text-[#8e8e93]">
                      暂无标题（请设置标题样式）
                    </div>
                  ) : (
                    tocItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="block w-full truncate rounded-[4px] px-2 py-1 text-left text-[12px] text-[#1d1d1f] hover:bg-black/[0.06]"
                        style={{ paddingLeft: 8 + item.level * 12 }}
                        onClick={() =>
                          run((c) => c.executeLocationCatalog(item.id))
                        }
                      >
                        {item.text || "（空标题）"}
                      </button>
                    ))
                  )}
                </div>
              </aside>
            ) : null}

            <div className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-[#e8e8ed]">
              <div
                ref={containerRef}
                className="canvas-editor-host h-full min-h-0 w-full py-4"
                onContextMenuCapture={openContextMenu}
              />
            </div>
          </div>

          <div className="flex h-7 shrink-0 items-center justify-between border-t border-black/[0.06] bg-[#fafafa] px-3 text-[11px] text-[#6e6e73]">
            <span>{statsLabel}</span>
            <span>
              {PAPER_PX[paper].label}
              {landscape ? " · 横向" : ""}
            </span>
          </div>
        </div>
      </div>

      {ctxMenu ? (
        <DocContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenuItems}
          onClose={() => setCtxMenu(null)}
        />
      ) : null}

      {fontDialog ? (
        <FontDialog
          initial={fontDialog}
          fonts={FONT_FAMILIES}
          sizes={FONT_SIZES}
          onCancel={() => setFontDialog(null)}
          onApply={applyFont}
        />
      ) : null}

      {paraDialog ? (
        <ParagraphDialog
          initial={paraDialog}
          size={Number(fontSize) || 16}
          onCancel={() => setParaDialog(null)}
          onApply={applyParagraph}
        />
      ) : null}

      {linkDialog ? (
        <LinkDialog
          initial={{ text: linkDialog.text, url: linkDialog.url }}
          editing={linkDialog.editing}
          textLocked={linkDialog.textLocked}
          onCancel={() => setLinkDialog(null)}
          onApply={applyLink}
        />
      ) : null}

      <Dialog
        open={recentManageOpen}
        onOpenChange={(open) => {
          setRecentManageOpen(open);
          if (open) void pruneMissingRecent();
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="z-[10000] flex w-[720px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden rounded-[12px] bg-white p-0 text-[#1d1d1f] shadow-[0_24px_64px_rgba(0,0,0,0.28)] ring-1 ring-black/10 sm:max-w-[720px]"
        >
          <DialogHeader className="h-9 shrink-0 flex-row items-center gap-0 pl-4 pr-2">
            <DialogTitle className="text-[13px] font-medium text-[#1d1d1f]">
              最近打开
            </DialogTitle>
            <DialogClose
              render={
                <button
                  type="button"
                  aria-label="关闭"
                  className="ml-auto flex size-6 items-center justify-center rounded-[5px] text-[#8e8e93] transition-colors hover:bg-black/[0.06] hover:text-[#1d1d1f]"
                />
              }
            >
              <X size={14} />
            </DialogClose>
          </DialogHeader>

          <div className="max-h-[min(480px,70vh)] overflow-auto px-3 py-2">
            {recentFiles.length === 0 ? (
              <p className="px-1 py-8 text-center text-[13px] text-[#8e8e93]">
                暂无最近打开记录
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-[28%] text-[12px] text-[#6e6e73]">
                      名称
                    </TableHead>
                    <TableHead className="text-[12px] text-[#6e6e73]">
                      路径
                    </TableHead>
                    <TableHead className="w-[140px] text-[12px] text-[#6e6e73]">
                      打开时间
                    </TableHead>
                    <TableHead className="w-[120px] text-right text-[12px] text-[#6e6e73]">
                      操作
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentFiles.map((item) => (
                    <TableRow key={item.path}>
                      <TableCell
                        className="max-w-[160px] truncate text-[13px]"
                        title={item.name}
                      >
                        {item.name}
                      </TableCell>
                      <TableCell
                        className="max-w-[280px] truncate text-[12px] text-[#6e6e73] whitespace-normal"
                        title={item.path}
                      >
                        <span className="line-clamp-2 break-all">
                          {item.path}
                        </span>
                      </TableCell>
                      <TableCell className="text-[12px] text-[#6e6e73] tabular-nums">
                        {formatRecentTime(item.openedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[12px] text-[#0165e1] hover:text-[#0165e1]"
                            onClick={() => {
                              setRecentManageOpen(false);
                              void openDocPath(item.path);
                            }}
                          >
                            打开
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-[12px] text-[#ff3b30] hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]"
                            onClick={() => dismissRecentPath(item.path)}
                          >
                            移除
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <span className="text-[12px] text-[#8e8e93]">
              共 {recentFiles.length} 条（仅删除记录，不删除文件）
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="h-7 rounded-[6px] border-black/[0.12] bg-white px-3 text-[12px] font-normal text-[#1d1d1f] hover:bg-black/[0.03] disabled:opacity-40"
                disabled={recentFiles.length === 0}
                onClick={() => {
                  const list = [...recentFiles];
                  setRecentFiles(clearWordRecent());
                  for (const item of list) closeDocsByPath(item.path);
                }}
              >
                全部清除
              </Button>
              <Button
                className="h-7 rounded-[6px] bg-[#0165e1] px-3.5 text-[12px] font-medium text-white shadow-none hover:bg-[#0165e1]/90"
                onClick={() => setRecentManageOpen(false)}
              >
                关闭
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </EditorShell>
  );
}
