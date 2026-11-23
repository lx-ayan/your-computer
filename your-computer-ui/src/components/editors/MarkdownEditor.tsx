import { useCallback, useEffect, useRef, useState } from "react";
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
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
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
import {
  clearMarkdownRecent,
  loadMarkdownRecent,
  MARKDOWN_RECENT_EVENT,
  MARKDOWN_RECENT_KEY,
  MARKDOWN_RECENT_MENU_LIMIT,
  pruneMarkdownRecent,
  pushMarkdownRecent,
  removeMarkdownRecent,
  type MarkdownRecentEntry,
} from "../../lib/markdownRecent";
import { ConfirmCloseDialog } from "./ConfirmCloseDialog";
import { EditorShell, fileNameFromPath } from "./EditorShell";

type Props = { path: string | null };

type DocTab = {
  id: string;
  path: string | null;
  name: string;
  /** null = 尚未从磁盘载入 */
  content: string | null;
  dirty: boolean;
};

function newDocId() {
  return `md-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function blankDoc(name = "未命名.md"): DocTab {
  return {
    id: newDocId(),
    path: null,
    name,
    content: "",
    dirty: false,
  };
}

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

function ensureMdExt(path: string): string {
  return /\.(md|markdown|txt)$/i.test(path) ? path : `${path}.md`;
}

export function MarkdownEditor({ path }: Props) {
  const initialPath = useRef(path);
  const untitledSeq = useRef(1);
  const bootOnce = useRef(false);

  const [docs, setDocs] = useState<DocTab[]>(() => [
    path
      ? {
          id: newDocId(),
          path,
          name: fileNameFromPath(path) || "未命名.md",
          content: null,
          dirty: false,
        }
      : blankDoc(),
  ]);
  const [activeId, setActiveId] = useState(() => docs[0].id);
  const activeDoc = docs.find((d) => d.id === activeId) ?? docs[0];
  const activePath = activeDoc?.path ?? null;

  const [recentFiles, setRecentFiles] = useState<MarkdownRecentEntry[]>(() =>
    loadMarkdownRecent(),
  );
  const [recentManageOpen, setRecentManageOpen] = useState(false);
  const [closeConfirm, setCloseConfirm] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const docsRef = useRef(docs);
  const activeIdRef = useRef(activeId);
  const dirtyRef = useRef(dirty);
  const valueRef = useRef(value);
  docsRef.current = docs;
  activeIdRef.current = activeId;
  dirtyRef.current = dirty;
  valueRef.current = value;

  const rememberRecent = useCallback((filePath: string, name?: string) => {
    setRecentFiles(pushMarkdownRecent(filePath, name));
  }, []);

  const markDirty = useCallback(() => {
    if (dirtyRef.current) return;
    dirtyRef.current = true;
    setDirty(true);
    const id = activeIdRef.current;
    setDocs((prev) =>
      prev.map((d) => (d.id === id ? { ...d, dirty: true } : d)),
    );
  }, []);

  const flushActiveToDocs = useCallback(() => {
    const id = activeIdRef.current;
    const content = valueRef.current;
    const next = docsRef.current.map((d) =>
      d.id === id ? { ...d, content, dirty: dirtyRef.current } : d,
    );
    docsRef.current = next;
    setDocs(next);
  }, []);

  const showDocContent = useCallback(async (doc: DocTab) => {
    setLoading(true);
    setHint(null);
    try {
      if (doc.content != null) {
        setValue(doc.content);
        valueRef.current = doc.content;
        setDirty(doc.dirty);
        dirtyRef.current = doc.dirty;
        return;
      }
      if (!doc.path) {
        setValue("");
        valueRef.current = "";
        setDirty(doc.dirty);
        dirtyRef.current = doc.dirty;
        return;
      }
      const text = await invoke<string>("read_text_file", { path: doc.path });
      setValue(text);
      valueRef.current = text;
      setDirty(false);
      dirtyRef.current = false;
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id ? { ...d, content: text, dirty: false } : d,
        ),
      );
    } catch (err) {
      setValue("");
      valueRef.current = "";
      setHint(`打开失败: ${err instanceof Error ? err.message : String(err)}`);
      setDirty(true);
      dirtyRef.current = true;
      setDocs((prev) =>
        prev.map((d) =>
          d.id === doc.id ? { ...d, content: "", dirty: true } : d,
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // 首次启动
  useEffect(() => {
    if (bootOnce.current) return;
    bootOnce.current = true;
    const boot = async () => {
      setLoading(true);
      try {
        const initPath = initialPath.current;
        if (initPath) {
          const text = await invoke<string>("read_text_file", {
            path: initPath,
          });
          const id = activeIdRef.current;
          setValue(text);
          valueRef.current = text;
          setDirty(false);
          dirtyRef.current = false;
          setDocs((prev) =>
            prev.map((d) =>
              d.id === id ? { ...d, content: text, dirty: false } : d,
            ),
          );
          rememberRecent(initPath, fileNameFromPath(initPath));
          setHint(null);
        } else {
          setValue("");
          valueRef.current = "";
          setHint("空白文稿，可直接编辑后保存");
        }
      } catch (err) {
        setValue("");
        valueRef.current = "";
        setDirty(true);
        dirtyRef.current = true;
        setHint(
          `无法读取文件，已打开空白文稿（${
            err instanceof Error ? err.message : String(err)
          }）`,
        );
      } finally {
        setLoading(false);
      }
    };
    void boot();
  }, [rememberRecent]);

  const activateDoc = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) return;
      flushActiveToDocs();
      const target = docsRef.current.find((d) => d.id === id);
      if (!target) return;
      setActiveId(id);
      activeIdRef.current = id;
      await showDocContent(target);
    },
    [flushActiveToDocs, showDocContent],
  );

  const writeMdToPath = useCallback(
    async (savePath: string) => {
      const content = valueRef.current;
      await invoke("write_text_file", { path: savePath, content });
      const name = fileNameFromPath(savePath);
      const id = activeIdRef.current;
      setDocs((prev) =>
        prev.map((d) =>
          d.id === id
            ? { ...d, path: savePath, name, content, dirty: false }
            : d,
        ),
      );
      setDirty(false);
      dirtyRef.current = false;
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
      }.md`;
      const picked = await invoke<string | null>("pick_save_file", {
        defaultName,
      });
      if (!picked) return;
      const savePath = ensureMdExt(picked);
      await writeMdToPath(savePath);
      setHint(`已另存为 ${fileNameFromPath(savePath)}`);
    } catch (err) {
      setHint(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [activeDoc?.name, writeMdToPath]);

  const onSave = useCallback(async () => {
    const curPath = activePath;
    if (!curPath) {
      await onSaveAs();
      return;
    }
    setSaving(true);
    setHint(null);
    try {
      const savePath = ensureMdExt(curPath);
      await writeMdToPath(savePath);
      setHint("已保存");
    } catch (err) {
      setHint(`保存失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }, [activePath, onSaveAs, writeMdToPath]);

  const onNew = useCallback(() => {
    flushActiveToDocs();
    const name = `未命名${untitledSeq.current}.md`;
    untitledSeq.current += 1;
    const doc = blankDoc(name);
    doc.dirty = true;
    setDocs((prev) => [...prev, doc]);
    setActiveId(doc.id);
    activeIdRef.current = doc.id;
    setValue("");
    valueRef.current = "";
    setDirty(true);
    dirtyRef.current = true;
    setHint("已新建文稿");
  }, [flushActiveToDocs]);

  const performCloseDocs = useCallback(
    (ids: string[]) => {
      if (!ids.length) return;
      const closeSet = new Set(ids);
      const wasActive = closeSet.has(activeIdRef.current);
      if (wasActive) flushActiveToDocs();

      const next = docsRef.current.filter((d) => !closeSet.has(d.id));
      if (!next.length) {
        queueMicrotask(() => {
          void getCurrentWindow().close();
        });
        return;
      }
      docsRef.current = next;
      setDocs(next);
      if (wasActive) {
        const fallback = next[next.length - 1];
        queueMicrotask(() => {
          void activateDoc(fallback.id);
        });
      }
    },
    [activateDoc, flushActiveToDocs],
  );

  const onCloseDoc = useCallback(
    (id: string) => {
      const target = docsRef.current.find((d) => d.id === id);
      if (!target) return;
      if (target.dirty || (id === activeIdRef.current && dirtyRef.current)) {
        setCloseConfirm({ id: target.id, name: target.name });
        return;
      }
      performCloseDocs([id]);
    },
    [performCloseDocs],
  );

  const closeDocsByPath = useCallback(
    (filePath: string, opts?: { force?: boolean }) => {
      const norm = filePath.replace(/\//g, "\\").toLowerCase();
      const matches = docsRef.current.filter(
        (d) =>
          !!d.path && d.path.replace(/\//g, "\\").toLowerCase() === norm,
      );
      if (!matches.length) return;

      if (!opts?.force) {
        const dirtyTab = matches.find(
          (d) =>
            d.dirty ||
            (d.id === activeIdRef.current && dirtyRef.current),
        );
        if (dirtyTab) {
          setCloseConfirm({ id: dirtyTab.id, name: dirtyTab.name });
          return;
        }
      }
      performCloseDocs(matches.map((d) => d.id));
    },
    [performCloseDocs],
  );

  const dismissRecentPath = useCallback(
    (filePath: string, opts?: { force?: boolean }) => {
      setRecentFiles(removeMarkdownRecent(filePath));
      closeDocsByPath(filePath, opts);
    },
    [closeDocsByPath],
  );

  const pruneMissingRecent = useCallback(async () => {
    const before = loadMarkdownRecent();
    const next = await pruneMarkdownRecent(async (p) => {
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
    const sync = () => setRecentFiles(loadMarkdownRecent());
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === MARKDOWN_RECENT_KEY) sync();
    };
    window.addEventListener(MARKDOWN_RECENT_EVENT, sync);
    window.addEventListener("storage", onStorage);
    void pruneMissingRecent();
    return () => {
      window.removeEventListener(MARKDOWN_RECENT_EVENT, sync);
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
          content: null,
          dirty: false,
        } satisfies DocTab);
      if (created) {
        setDocs((prev) => [...prev, tab]);
      }
      setActiveId(tab.id);
      activeIdRef.current = tab.id;
      try {
        await showDocContent(tab);
        rememberRecent(filePath, tab.name);
        setHint(`已打开 ${tab.name}`);
      } catch (err) {
        setHint(
          `打开失败: ${err instanceof Error ? err.message : String(err)}`,
        );
        dismissRecentPath(filePath, { force: true });
      }
    },
    [dismissRecentPath, flushActiveToDocs, rememberRecent, showDocContent],
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
          content: null,
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
      activeIdRef.current = focus.id;
      await showDocContent(focus);
      setHint(`已打开 ${focus.name}`);
    } catch (err) {
      setHint(`打开失败: ${err instanceof Error ? err.message : String(err)}`);
      setLoading(false);
    }
  }, [flushActiveToDocs, rememberRecent, showDocContent]);

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

  const title = `VMarkdown · ${activeDoc?.name || "未命名.md"}`;

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
                    {d.dirty || (d.id === activeId && dirty) ? "• " : ""}
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
                          .slice(0, MARKDOWN_RECENT_MENU_LIMIT)
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
                      {recentFiles.length > MARKDOWN_RECENT_MENU_LIMIT ? (
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
                      recentFiles.length <= MARKDOWN_RECENT_MENU_LIMIT ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => {
                              const list = [...recentFiles];
                              setRecentFiles(clearMarkdownRecent());
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

          <div className="min-h-0 flex-1" data-color-mode="light">
            <MDEditor
              value={value}
              onChange={(v) => {
                const next = v ?? "";
                setValue(next);
                valueRef.current = next;
                markDirty();
              }}
              height="100%"
              visibleDragbar={false}
              preview="live"
            />
          </div>
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
                  setRecentFiles(clearMarkdownRecent());
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
