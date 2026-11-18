import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  File,
  FileText,
  Folder,
  HardDrive,
  Image as ImageIcon,
  Search,
  X,
} from "lucide-react";

export type SearchHit = {
  id: string;
  name: string;
  path: string;
  parent: string;
  kind: string;
  kindLabel: string;
  size: string;
  openedAt: string;
  score: number;
  iconDataUrl?: string;
};

function highlightParts(
  name: string,
  query: string,
): { text: string; hit: boolean }[] {
  const q = query.trim();
  if (!q) return [{ text: name, hit: false }];
  const lower = name.toLowerCase();
  const qLower = q.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx < 0) return [{ text: name, hit: false }];
  const parts: { text: string; hit: boolean }[] = [];
  if (idx > 0) parts.push({ text: name.slice(0, idx), hit: false });
  parts.push({ text: name.slice(idx, idx + q.length), hit: true });
  if (idx + q.length < name.length) {
    parts.push({ text: name.slice(idx + q.length), hit: false });
  }
  return parts;
}

function HitGlyph({
  kind,
  iconDataUrl,
}: {
  kind: string;
  iconDataUrl?: string;
}) {
  if (iconDataUrl) {
    return (
      <img
        src={iconDataUrl}
        alt=""
        className="size-4 object-contain bg-transparent"
        draggable={false}
      />
    );
  }
  const cls = "size-4 text-[var(--finder-icon)]";
  switch (kind) {
    case "folder":
      return <Folder className={cls} strokeWidth={2.5} />;
    case "document":
      return <FileText className={cls} strokeWidth={2.5} />;
    case "image":
      return <ImageIcon className={cls} strokeWidth={2.5} />;
    case "disk":
      return <HardDrive className={cls} strokeWidth={2.5} />;
    default:
      return <File className={cls} strokeWidth={2.5} />;
  }
}

function useAcrylic() {
  useEffect(() => {
    void invoke("apply_window_acrylic", {
      alpha: 200,
      r: 248,
      g: 248,
      b: 250,
    }).catch(() => {
      /* ignore */
    });
  }, []);
}

export function SearchWindow() {
  useAcrylic();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [indexing, setIndexing] = useState(false);
  const reqRef = useRef(0);
  const indexedRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q) {
      setHits([]);
      setActiveQuery("");
      setSearched(false);
      setError(null);
      setLoading(false);
      return;
    }
    const req = ++reqRef.current;
    setLoading(true);
    setError(null);
    setSearched(true);
    setActiveQuery(q);
    if (!indexedRef.current) {
      setIndexing(true);
    }
    try {
      const rows = await invoke<SearchHit[]>("search_drive", {
        query: q,
        limit: 200,
      });
      if (req !== reqRef.current) return;
      setHits(rows);
      setSelected(0);
      indexedRef.current = true;
    } catch (err) {
      if (req !== reqRef.current) return;
      console.error("search_drive failed", err);
      setHits([]);
      setError(String(err));
    } finally {
      if (req === reqRef.current) {
        setLoading(false);
        setIndexing(false);
      }
    }
  }, []);

  const close = useCallback(() => {
    void getCurrentWindow().close();
  }, []);

  const openHit = useCallback(async (hit: SearchHit) => {
    try {
      if (hit.kind === "folder") {
        await emit("search-reveal", { path: hit.path, openFolder: true });
        await invoke("open_path", { path: hit.path }).catch(() => {
          /* fallthrough */
        });
      } else {
        await invoke("open_path", { path: hit.path });
      }
    } catch (err) {
      console.error("open hit failed", err);
    }
  }, []);

  const revealHit = useCallback(async (hit: SearchHit) => {
    try {
      await emit("search-reveal", {
        path: hit.kind === "folder" ? hit.path : hit.parent || hit.path,
        openFolder: true,
      });
      if (hit.kind !== "folder") {
        await invoke("reveal_in_explorer", { path: hit.path });
      }
    } catch (err) {
      console.error("reveal failed", err);
    }
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((i) => Math.min(Math.max(hits.length - 1, 0), i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // 输入框聚焦时：回车开始全盘搜索；有结果且想打开当前项时用 Ctrl+Enter
      if (e.ctrlKey || e.metaKey) {
        if (hits[selected]) void openHit(hits[selected]);
        return;
      }
      void runSearch(query);
    }
  };

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden bg-[rgba(248,248,250,0.92)] text-[13px] text-[var(--finder-text)]"
      onKeyDown={onKeyDown}
    >
      <header
        className="flex h-[44px] shrink-0 items-center gap-2 border-b border-black/10 px-3"
        data-tauri-drag-region
      >
        <Search className="size-4 shrink-0 text-[var(--finder-text-muted)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索全部磁盘…（回车开始搜索）"
          className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--finder-text-muted)]"
        />
        <button
          type="button"
          className="shrink-0 rounded-[6px] bg-[var(--finder-row-selected)] px-3 py-[4px] text-[12px] text-white disabled:opacity-50"
          disabled={loading || !query.trim()}
          onClick={() => void runSearch(query)}
        >
          {loading ? "搜索中…" : "搜索"}
        </button>
        <span className="shrink-0 text-[11px] text-[var(--finder-text-muted)]">
          {!loading && searched ? `${hits.length} 项` : ""}
        </span>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-full text-[var(--finder-text-secondary)] hover:bg-black/5"
          aria-label="关闭"
          onClick={close}
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      </header>

      <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_88px_150px] border-b border-black/8 bg-white/70 px-3 py-[5px] text-[11px] text-[var(--finder-text-secondary)]">
        <span>名称</span>
        <span>路径</span>
        <span>大小</span>
        <span>修改日期</span>
      </div>

      <ul className="min-h-0 flex-1 overflow-auto pb-2">
        {!searched ? (
          <li className="px-4 py-12 text-center text-[13px] text-[var(--finder-text-muted)]">
            输入名称后按回车，搜索全部磁盘
          </li>
        ) : error ? (
          <li className="px-4 py-12 text-center text-[13px] text-red-600">
            {error}
          </li>
        ) : indexing ? (
          <li className="px-4 py-12 text-center text-[13px] text-[var(--finder-text-muted)]">
            正在通过 FSCTL_ENUM_USN_DATA 读取 MFT 构建索引…
          </li>
        ) : hits.length === 0 && !loading ? (
          <li className="px-4 py-12 text-center text-[13px] text-[var(--finder-text-muted)]">
            未找到匹配项
          </li>
        ) : (
          hits.map((hit, index) => {
            const active = index === selected;
            const parts = highlightParts(hit.name, activeQuery);
            return (
              <li key={hit.id}>
                <button
                  type="button"
                  className={`mx-1 grid w-[calc(100%-0.5rem)] grid-cols-[minmax(0,1.2fr)_minmax(0,1.6fr)_88px_150px] items-center rounded-[6px] px-2 py-[3px] text-left ${
                    active
                      ? "bg-[var(--finder-row-selected)] text-[var(--finder-selected-text)]"
                      : "hover:bg-[var(--finder-hover)]"
                  }`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => setSelected(index)}
                  onDoubleClick={() => void openHit(hit)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    void revealHit(hit);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2 truncate">
                    <HitGlyph kind={hit.kind} iconDataUrl={hit.iconDataUrl} />
                    <span className="truncate">
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
                  </span>
                  <span
                    className={`truncate ${active ? "text-white/85" : "text-[var(--finder-text-secondary)]"}`}
                    title={hit.parent}
                  >
                    {hit.parent}
                  </span>
                  <span
                    className={`truncate tabular-nums ${active ? "text-white/85" : "text-[var(--finder-text-secondary)]"}`}
                  >
                    {hit.size}
                  </span>
                  <span
                    className={`truncate ${active ? "text-white/85" : "text-[var(--finder-text-secondary)]"}`}
                  >
                    {hit.openedAt}
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>

      <footer className="flex h-[28px] shrink-0 items-center justify-between gap-3 border-t border-black/10 px-3 text-[11px] text-[var(--finder-text-muted)]">
        <span className="truncate">
          回车搜索 · 双击打开 · Ctrl+Enter 打开选中项 · 右键显示位置
        </span>
        <span className="shrink-0">
          {loading ? "正在搜索..." : ""}
        </span>
      </footer>
    </div>
  );
}
