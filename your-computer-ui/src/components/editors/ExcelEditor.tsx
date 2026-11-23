import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  ChevronDown,
  Clock,
  FilePlus,
  FolderOpen,
  Save,
  X,
} from "lucide-react";
import { Workbook } from "@fortune-sheet/react";
import type { WorkbookInstance } from "@fortune-sheet/react";
import type { Sheet } from "@fortune-sheet/core";
import "@fortune-sheet/react/dist/index.css";
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
import { readLocalArrayBuffer, uint8ToBase64 } from "../../lib/localFile";
import {
  clearExcelRecent,
  EXCEL_RECENT_EVENT,
  EXCEL_RECENT_KEY,
  EXCEL_RECENT_MENU_LIMIT,
  loadExcelRecent,
  pruneExcelRecent,
  pushExcelRecent,
  removeExcelRecent,
  type ExcelRecentEntry,
} from "../../lib/excelRecent";
import { ConfirmCloseDialog } from "./ConfirmCloseDialog";
import { EditorShell, fileNameFromPath } from "./EditorShell";
import { ExcelRibbon, type ExcelRibbonTab } from "./ExcelRibbon";
import {
  arrayBufferToSheets,
  blankSheets,
  blobToUint8Array,
  clearSelectionCache,
  exportExcelBlob,
  readActiveCell,
  rememberSelection,
  snapshotWorkbook,
  writeCellText,
  type FortuneSheetData,
} from "./excelOps";

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

/** 隔离 FortuneSheet，避免父组件重渲染时重建 hooks/onOp */
const FortuneSheetPane = memo(function FortuneSheetPane({
  workbookKey,
  data,
  onWorkbookRef,
  onOp,
  hooks,
}: {
  workbookKey: string;
  data: FortuneSheetData;
  onWorkbookRef: (inst: WorkbookInstance | null) => void;
  onOp: () => void;
  hooks: {
    afterSelectionChange?: (
      sheetId: string,
      selection: { row: number[]; column: number[] },
    ) => void;
    afterUpdateCell?: (
      row: number,
      column: number,
      oldValue: unknown,
      newValue: unknown,
    ) => void;
  };
}) {
  return (
    <div className="h-full min-h-0 w-full overflow-hidden bg-white [&_.fortune-container]:h-full [&_.fortune-container]:w-full [&_.fortune-sheet-container]:h-full">
      <Workbook
        key={workbookKey}
        ref={onWorkbookRef}
        data={data as Sheet[]}
        lang="zh"
        showToolbar={false}
        showFormulaBar={false}
        showSheetTabs
        column={26}
        row={60}
        onOp={onOp}
        hooks={hooks}
      />
    </div>
  );
});

type Props = { path: string | null };

type DocTab = {
  id: string;
  path: string | null;
  name: string;
  /** FortuneSheet data；null=尚未载入 */
  sheets: FortuneSheetData | null;
  dirty: boolean;
};

function newDocId() {
  return `xlsx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankDoc(name = "未命名.xlsx"): DocTab {
  return {
    id: newDocId(),
    path: null,
    name,
    sheets: blankSheets(),
    dirty: false,
  };
}

export function ExcelEditor({ path }: Props) {
  const workbookRef = useRef<WorkbookInstance | null>(null);
  const initialPath = useRef(path);
  const untitledSeq = useRef(1);
  const formulaInputRef = useRef<HTMLInputElement>(null);
  const bootOnce = useRef(false);

  const [docs, setDocs] = useState<DocTab[]>(() => [
    path
      ? {
          id: newDocId(),
          path,
          name: fileNameFromPath(path) || "未命名.xlsx",
          sheets: null,
          dirty: false,
        }
      : blankDoc(),
  ]);
  const [activeId, setActiveId] = useState(() => docs[0].id);
  const activeDoc = docs.find((d) => d.id === activeId) ?? docs[0];
  const activePath = activeDoc?.path ?? null;
  const [recentFiles, setRecentFiles] = useState<ExcelRecentEntry[]>(() =>
    loadExcelRecent(),
  );
  const [recentManageOpen, setRecentManageOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const rememberRecent = useCallback((filePath: string, name?: string) => {
    setRecentFiles(pushExcelRecent(filePath, name));
  }, []);

  const [sheetData, setSheetData] = useState<FortuneSheetData>(
    () => activeDoc?.sheets ?? blankSheets(),
  );
  const [workbookKey, setWorkbookKey] = useState(() => activeId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ribbonTab, setRibbonTab] = useState<ExcelRibbonTab>("home");
  const [fontFamily, setFontFamily] = useState("微软雅黑");
  const [fontSize, setFontSize] = useState(11);
  const [foreColor, setForeColor] = useState("#1d1d1f");
  const [fillColor, setFillColor] = useState("#ffe566");
  const [ready, setReady] = useState(false);

  const docsRef = useRef(docs);
  const activeIdRef = useRef(activeId);
  const dirtyRef = useRef(dirty);
  const formulaTargetRef = useRef<{ row: number; col: number } | null>(null);
  const formulaEditingRef = useRef(false);
  const formulaTextRef = useRef("");
  const cellAddrRef = useRef<HTMLInputElement>(null);
  const skipNextFormulaCommitRef = useRef(false);
  docsRef.current = docs;
  activeIdRef.current = activeId;
  dirtyRef.current = dirty;

  const markDirty = useCallback(() => {
    // 已脏则不再 setState，避免每次按键整页重渲染
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    setDirty(true);
    const id = activeIdRef.current;
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, dirty: true } : d)),
    );
  }, []);

  const isFormulaBarFocused = useCallback(() => {
    return document.activeElement === formulaInputRef.current;
  }, []);

  /** 同步钉住当前选区；公式栏编辑中不覆盖输入 */
  const syncFormulaBar = useCallback(() => {
    const wb = workbookRef.current;
    if (!wb) return;
    try {
      const { addr, text, row, col } = readActiveCell(wb);
      // 目标格始终跟当前选区走，避免「改到上一格」
      if (!formulaEditingRef.current || !isFormulaBarFocused()) {
        formulaTargetRef.current = { row, col };
      }
      if (formulaEditingRef.current && isFormulaBarFocused()) return;

      formulaTextRef.current = text;
      if (cellAddrRef.current && cellAddrRef.current.value !== addr) {
        cellAddrRef.current.value = addr;
      }
      const input = formulaInputRef.current;
      if (input && document.activeElement !== input && input.value !== text) {
        input.value = text;
      }
    } catch {
      // workbook 尚未就绪
    }
  }, [isFormulaBarFocused]);

  /** 把公式栏内容写回「钉住的」单元格，然后切到当前选区 */
  const commitFormulaBarToPinned = useCallback(() => {
    const wb = workbookRef.current;
    const pinned = formulaTargetRef.current;
    if (!wb || !pinned) {
      formulaEditingRef.current = false;
      return false;
    }
    const live = formulaInputRef.current?.value ?? formulaTextRef.current;
    formulaTextRef.current = live;
    writeCellText(wb, pinned.row, pinned.col, live);
    formulaEditingRef.current = false;
    markDirty();
    return true;
  }, [markDirty]);

  const flushActiveToDocs = useCallback(() => {
    const wb = workbookRef.current;
    if (!wb) return;
    try {
      const sheets = snapshotWorkbook(wb);
      const id = activeIdRef.current;
      setSheetData(sheets);
      setDocs((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, sheets, dirty: dirtyRef.current } : d,
        ),
      );
    } catch {
      // ignore
    }
  }, []);

  const mountSheets = useCallback((docId: string, sheets: FortuneSheetData) => {
    clearSelectionCache();
    formulaTargetRef.current = { row: 0, col: 0 };
    setSheetData(sheets);
    setWorkbookKey(`${docId}-${Date.now().toString(36)}`);
    setReady(false);
  }, []);

  const loadDocSheets = useCallback(
    async (doc: DocTab): Promise<FortuneSheetData> => {
      if (doc.sheets) return doc.sheets;
      if (!doc.path) return blankSheets();
      const raw = await readLocalArrayBuffer(doc.path);
      try {
        const sheets = await arrayBufferToSheets(raw);
        if (raw.byteLength === 0) {
          setHint("空表格，可直接编辑后保存");
          setDirty(true);
        }
        return sheets;
      } catch (err) {
        console.warn("import excel failed", err);
        setHint("文件无法解析，已打开空白表");
        setDirty(true);
        return blankSheets();
      }
    },
    [],
  );

  const showSnapOrBlank = useCallback(
    async (doc: DocTab) => {
      setLoading(true);
      setError(null);
      try {
        const sheets = await loadDocSheets(doc);
        setDocs((prev) =>
          prev.map((d) =>
            d.id === doc.id
              ? {
                  ...d,
                  sheets,
                  dirty: dirtyRef.current || d.dirty || !doc.path,
                }
              : d,
          ),
        );
        mountSheets(doc.id, sheets);
        formulaEditingRef.current = false;
        queueMicrotask(() => syncFormulaBar());
      } catch (err) {
        console.error("Excel load failed", err);
        const sheets = blankSheets();
        setHint(
          `已打开空白表（原文件无法解析: ${
            err instanceof Error ? err.message : String(err)
          }）`,
        );
        setDirty(true);
        setDocs((prev) =>
          prev.map((d) =>
            d.id === doc.id ? { ...d, sheets, dirty: true } : d,
          ),
        );
        mountSheets(doc.id, sheets);
      } finally {
        setLoading(false);
      }
    },
    [loadDocSheets, mountSheets, syncFormulaBar],
  );

  // 首次启动：打开初始路径或空白表
  useEffect(() => {
    if (bootOnce.current) return;
    bootOnce.current = true;
    const boot = async () => {
      setLoading(true);
      try {
        const initPath = initialPath.current;
        if (initPath) {
          const raw = await readLocalArrayBuffer(initPath);
          let sheets = blankSheets();
          try {
            sheets = await arrayBufferToSheets(raw);
            if (raw.byteLength === 0) {
              setHint("空表格，可直接编辑后保存");
              setDirty(true);
            } else {
              setHint(null);
            }
          } catch {
            setHint("文件无法解析，已打开空白表，保存将覆盖原文件");
            setDirty(true);
          }
          const id = activeIdRef.current;
          setDocs((prev) =>
            prev.map((d) =>
              d.id === id
                ? { ...d, sheets, dirty: dirtyRef.current }
                : d,
            ),
          );
          mountSheets(id, sheets);
          rememberRecent(initPath, fileNameFromPath(initPath));
        } else {
          setHint("空表格，可直接编辑后保存");
          mountSheets(activeIdRef.current, blankSheets());
        }
      } catch (err) {
        console.error(err);
        setHint("空表格，可直接编辑后保存");
        mountSheets(activeIdRef.current, blankSheets());
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, [mountSheets, rememberRecent]);

  const activateDoc = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) return;
      flushActiveToDocs();
      const target = docsRef.current.find((d) => d.id === id);
      if (!target) return;
      setActiveId(id);
      setDirty(target.dirty);
      setHint(null);
      await showSnapOrBlank(target);
    },
    [flushActiveToDocs, showSnapOrBlank],
  );

  const writeXlsxToPath = useCallback(
    async (savePath: string) => {
      const wb = workbookRef.current;
      if (!wb) throw new Error("编辑器未就绪");
      const blob = await exportExcelBlob(wb);
      const bytes = await blobToUint8Array(blob);
      await invoke("write_file_base64", {
        path: savePath,
        dataBase64: uint8ToBase64(bytes),
      });
      const name = fileNameFromPath(savePath);
      const id = activeIdRef.current;
      const sheets = snapshotWorkbook(wb);
      setSheetData(sheets);
      setDocs((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, path: savePath, name, sheets, dirty: false }
            : d,
        ),
      );
      setDirty(false);
      rememberRecent(savePath, name);
    },
    [rememberRecent],
  );

  const onSaveAs = useCallback(async () => {
    setSaving(true);
    setHint(null);
    try {
      const defaultName = `${
        activeDoc?.name?.replace(/\.[^.]+$/i, "") || "未命名"
      }.xlsx`;
      const picked = await invoke<string | null>("pick_save_file", {
        defaultName,
      });
      if (!picked) return;
      const savePath = /\.xlsx$/i.test(picked) ? picked : `${picked}.xlsx`;
      await writeXlsxToPath(savePath);
      setHint(`已另存为 ${fileNameFromPath(savePath)}`);
    } catch (err) {
      setHint(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [activeDoc?.name, writeXlsxToPath]);

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
      if (!/\.xlsx$/i.test(curPath)) {
        savePath = `${curPath.replace(/\.[^.]+$/, "")}.xlsx`;
      }
      await writeXlsxToPath(savePath);
      setHint("已保存");
      setError(null);
    } catch (err) {
      setHint(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [activePath, onSaveAs, writeXlsxToPath]);

  const onNew = useCallback(() => {
    flushActiveToDocs();
    const name = `未命名${untitledSeq.current}.xlsx`;
    untitledSeq.current += 1;
    const doc = blankDoc(name);
    doc.dirty = true;
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
    setDirty(true);
    mountSheets(doc.id, doc.sheets ?? blankSheets());
    setHint("已新建表格");
  }, [flushActiveToDocs, mountSheets]);

  /** 真正关掉页签；若已无标签则关闭窗口 */
  const performCloseDocs = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const closeSet = new Set(ids);
      const wasActive = closeSet.has(activeIdRef.current);
      if (wasActive) flushActiveToDocs();

      setDocs((prev) => {
        const next = prev.filter((d) => !closeSet.has(d.id));
        if (!next.length) {
          queueMicrotask(() => {
            void getCurrentWindow().close();
          });
          return prev;
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
    [activateDoc, flushActiveToDocs],
  );

  const onCloseDoc = useCallback(
    (id: string) => {
      const target = docsRef.current.find((d) => d.id === id);
      if (!target) return;
      if (target.dirty) {
        setCloseConfirm({ id: target.id, name: target.name });
        return;
      }
      performCloseDocs([id]);
    },
    [performCloseDocs],
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

      if (!opts?.force) {
        const dirty = matches.find((d) => d.dirty);
        if (dirty) {
          setCloseConfirm({ id: dirty.id, name: dirty.name });
          return;
        }
      }
      performCloseDocs(matches.map((d) => d.id));
    },
    [performCloseDocs],
  );

  /** 删除最近记录；若页签已打开则一并关掉 */
  const dismissRecentPath = useCallback(
    (filePath: string, opts?: { force?: boolean }) => {
      setRecentFiles(removeExcelRecent(filePath));
      closeDocsByPath(filePath, opts);
    },
    [closeDocsByPath],
  );

  const pruneMissingRecent = useCallback(async () => {
    const before = loadExcelRecent();
    const next = await pruneExcelRecent(async (p) => {
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
    const sync = () => setRecentFiles(loadExcelRecent());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === EXCEL_RECENT_KEY) sync();
    };
    window.addEventListener(EXCEL_RECENT_EVENT, sync);
    window.addEventListener("storage", onStorage);
    void pruneMissingRecent();
    return () => {
      window.removeEventListener(EXCEL_RECENT_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, [pruneMissingRecent]);

  const openDocPath = useCallback(
    async (filePath: string) => {
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
          sheets: null,
          dirty: false,
        } satisfies DocTab);
      if (created) {
        setDocs((prev) => [...prev, tab]);
      }
      setActiveId(tab.id);
      setDirty(false);
      try {
        await showSnapOrBlank(tab);
        rememberRecent(filePath, tab.name);
        setHint(`已打开 ${tab.name}`);
      } catch (err) {
        setHint(
          `打开失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        dismissRecentPath(filePath, { force: true });
      }
    },
    [dismissRecentPath, flushActiveToDocs, rememberRecent, showSnapOrBlank],
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
          sheets: null,
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
      await showSnapOrBlank(focus);
      setHint(`已打开 ${focus.name}`);
    } catch (err) {
      setHint(`打开失败: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  }, [flushActiveToDocs, rememberRecent, showSnapOrBlank]);

  const commitFormulaBar = useCallback(() => {
    if (skipNextFormulaCommitRef.current) {
      skipNextFormulaCommitRef.current = false;
      formulaEditingRef.current = false;
      syncFormulaBar();
      return;
    }
    commitFormulaBarToPinned();
    syncFormulaBar();
  }, [commitFormulaBarToPinned, syncFormulaBar]);

  const onWorkbookRef = useCallback(
    (inst: WorkbookInstance | null) => {
      workbookRef.current = inst;
      if (inst) {
        setReady(true);
        syncFormulaBar();
      } else {
        setReady(false);
      }
    },
    [syncFormulaBar],
  );

  // 稳定 hooks / onOp 引用，防止 Workbook 因 props 变化反复内部更新
  const hooks = useMemo(
    () => ({
      afterSelectionChange: (
        _sheetId: string,
        selection: { row: number[]; column: number[] },
      ) => {
        rememberSelection(selection);
        if (formulaEditingRef.current && isFormulaBarFocused()) {
          // 公式栏编辑中：先提交钉住的格，再跟随新选区
          commitFormulaBarToPinned();
        }
        formulaEditingRef.current = false;
        if (selection?.row?.length && selection?.column?.length) {
          formulaTargetRef.current = {
            row: selection.row[0],
            col: selection.column[0],
          };
        }
        syncFormulaBar();
      },
      afterUpdateCell: () => {
        markDirty();
        if (!formulaEditingRef.current && !isFormulaBarFocused()) {
          syncFormulaBar();
        }
      },
    }),
    [
      commitFormulaBarToPinned,
      isFormulaBarFocused,
      markDirty,
      syncFormulaBar,
    ],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
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
      if (key === "w") {
        e.preventDefault();
        if (activeIdRef.current) onCloseDoc(activeIdRef.current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCloseDoc, onNew, onOpen, onSave, onSaveAs]);

  const title = `VExcel · ${activeDoc?.name || "未命名.xlsx"}`;

  return (
    <EditorShell
      title={title}
      dirty={dirty}
      saving={saving}
      hint={loading ? "加载中…" : hint}
      onSave={() => void onSave()}
    >
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
                          .slice(0, EXCEL_RECENT_MENU_LIMIT)
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
                      {recentFiles.length > EXCEL_RECENT_MENU_LIMIT ? (
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
                      recentFiles.length <= EXCEL_RECENT_MENU_LIMIT ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              const list = [...recentFiles];
                              setRecentFiles(clearExcelRecent());
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
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <ExcelRibbon
            tab={ribbonTab}
            onTabChange={setRibbonTab}
            getWorkbook={() => (ready ? workbookRef.current : null)}
            onDirty={markDirty}
            onImport={() => void onOpen()}
            fontFamily={fontFamily}
            fontSize={fontSize}
            foreColor={foreColor}
            fillColor={fillColor}
            onFontFamily={setFontFamily}
            onFontSize={setFontSize}
            onForeColor={setForeColor}
            onFillColor={setFillColor}
          />

          <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] bg-white px-2 py-1">
            <input
              ref={cellAddrRef}
              className="h-7 w-[72px] rounded-[5px] border border-black/[0.08] bg-[#fafafa] px-2 text-center text-[12px] outline-none"
              defaultValue="A1"
              readOnly
              title="当前单元格"
            />
            <span className="text-[12px] text-[#8e8e93]">ƒx</span>
            <input
              ref={formulaInputRef}
              className="h-7 min-w-0 flex-1 rounded-[5px] border border-black/[0.08] bg-white px-2 text-[12px] outline-none focus:border-[#0a84ff]"
              defaultValue=""
              onFocus={() => {
                skipNextFormulaCommitRef.current = false;
                const wb = workbookRef.current;
                if (!wb) return;
                // 聚焦时立刻钉住「当前」选区，再允许编辑
                const { addr, text, row, col } = readActiveCell(wb);
                formulaTargetRef.current = { row, col };
                formulaTextRef.current = text;
                formulaEditingRef.current = true;
                if (cellAddrRef.current) cellAddrRef.current.value = addr;
                if (formulaInputRef.current) formulaInputRef.current.value = text;
              }}
              onChange={(e) => {
                formulaEditingRef.current = true;
                formulaTextRef.current = e.target.value;
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  skipNextFormulaCommitRef.current = false;
                  commitFormulaBar();
                  formulaInputRef.current?.blur();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  formulaEditingRef.current = false;
                  skipNextFormulaCommitRef.current = true;
                  syncFormulaBar();
                  formulaInputRef.current?.blur();
                }
              }}
              onBlur={() => {
                if (skipNextFormulaCommitRef.current) {
                  skipNextFormulaCommitRef.current = false;
                  formulaEditingRef.current = false;
                  syncFormulaBar();
                  return;
                }
                if (!formulaEditingRef.current) return;
                commitFormulaBar();
              }}
              placeholder="输入值或公式，如 =SUM(A1:A10)"
            />
          </div>

          {error ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center text-[13px] text-[#6e6e73]">
              <div>无法初始化表格编辑器</div>
              <div className="max-w-[480px] break-all text-[#ff3b30]">
                {error}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-hidden">
              <FortuneSheetPane
                workbookKey={workbookKey}
                data={sheetData}
                onWorkbookRef={onWorkbookRef}
                onOp={markDirty}
                hooks={hooks}
              />
            </div>
          )}
        </div>
      </div>

            <ConfirmCloseDialog
        open={!!closeConfirm}
        fileName={closeConfirm?.name ?? ""}
        onCancel={() => setCloseConfirm(null)}
        onConfirm={() => {
          const id = closeConfirm?.id;
          setCloseConfirm(null);
          if (id) performCloseDocs([id]);
        }}
      />

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
                  setRecentFiles(clearExcelRecent());
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
