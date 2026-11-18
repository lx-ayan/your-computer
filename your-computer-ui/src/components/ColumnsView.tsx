import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  File,
  FileText,
  Folder,
  HardDrive,
  Image as ImageIcon,
} from "lucide-react";
import { localImagePreviewSrc } from "../lib/filePreview";
import {
  loadIconSettings,
  resolveOverrideIcon,
} from "../lib/iconSettings";
import type { ItemInfo } from "./GetInfoWindow";

export type ColumnFileItem = {
  id: string;
  name: string;
  kind: "folder" | "document" | "image" | "file" | "disk";
  kindLabel: string;
  openedAt: string;
  size: string;
  path?: string;
  iconDataUrl?: string;
};

export type ColumnPane = {
  path: string;
  items: ColumnFileItem[];
  selectedId: string | null;
};

const DEFAULT_COL_WIDTH = 200;
const MIN_COL_WIDTH = 140;
const DEFAULT_PREVIEW_WIDTH = 280;
const ICON_STROKE = 2.5;

function pathBaseName(path: string): string {
  const cleaned = path.replace(/[\\/]+$/, "");
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function Glyph({
  kind,
  size = "sm",
  active = false,
  lastActive = false,
  iconDataUrl,
  path,
}: {
  kind: ColumnFileItem["kind"];
  size?: "sm" | "lg";
  active?: boolean;
  lastActive?: boolean;
  iconDataUrl?: string;
  path?: string;
}) {
  const tone =
    active && lastActive && size === "sm"
      ? "text-white"
      : size === "lg"
        ? "text-[var(--finder-accent)]"
        : "text-[var(--finder-icon)]";
  const className = `${
    size === "lg" ? "size-20" : "mt-[0.125em] size-4"
  } ${tone}`;
  const override = resolveOverrideIcon(loadIconSettings(), { path, kind });
  const imagePreview = localImagePreviewSrc(path, kind);
  const preview = override ?? imagePreview ?? iconDataUrl;
  const isImagePreview = Boolean(imagePreview) && !override;
  if (preview) {
    if (size === "lg" && isImagePreview) {
      return (
        <img
          src={preview}
          alt=""
          className="size-20 rounded-[12px] object-cover bg-[#f2f2f2]"
          draggable={false}
          decoding="async"
        />
      );
    }
    return (
      <img
        src={preview}
        alt=""
        className={`${size === "lg" ? "size-20" : "mt-[0.125em] size-4"} object-contain bg-transparent`}
        draggable={false}
        decoding="async"
      />
    );
  }
  switch (kind) {
    case "folder":
      return <Folder className={className} strokeWidth={ICON_STROKE} />;
    case "document":
      return <FileText className={className} strokeWidth={ICON_STROKE} />;
    case "image":
      return <ImageIcon className={className} strokeWidth={ICON_STROKE} />;
    case "disk":
      return <HardDrive className={className} strokeWidth={ICON_STROKE} />;
    default:
      return <File className={className} strokeWidth={ICON_STROKE} />;
  }
}

function ColumnHeader({ title }: { title: string }) {
  return (
    <div className="flex h-[28px] shrink-0 items-center border-b border-black/10 bg-white px-3 text-[12px] text-[var(--finder-text-secondary)]">
      <span className="truncate">{title}</span>
    </div>
  );
}

function ResizeHandle({
  onDrag,
}: {
  onDrag: (deltaX: number) => void;
}) {
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="absolute top-0 right-0 z-10 h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none hover:bg-[#0165e1]/30"
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const pointerId = e.pointerId;
        (e.currentTarget as HTMLElement).setPointerCapture(pointerId);
        let lastX = e.clientX;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const target = e.currentTarget as HTMLElement;
        const onMove = (ev: globalThis.PointerEvent) => {
          const dx = ev.clientX - lastX;
          lastX = ev.clientX;
          if (dx !== 0) onDragRef.current(dx);
        };
        const onUp = () => {
          target.releasePointerCapture(pointerId);
          target.removeEventListener("pointermove", onMove);
          target.removeEventListener("pointerup", onUp);
          target.removeEventListener("pointercancel", onUp);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        };
        target.addEventListener("pointermove", onMove);
        target.addEventListener("pointerup", onUp);
        target.addEventListener("pointercancel", onUp);
      }}
    />
  );
}

function PreviewPane({
  item,
  width,
  onTrash,
}: {
  item: ColumnFileItem;
  width: number;
  onTrash: (item: ColumnFileItem) => void;
}) {
  const [info, setInfo] = useState<ItemInfo | null>(null);
  const path = item.path ?? item.id;

  useEffect(() => {
    let cancelled = false;
    setInfo(null);
    if (!path) return;
    invoke<ItemInfo>("get_item_info", { path })
      .then((data) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const sizeLine = `${item.kindLabel} — ${item.kind === "folder" ? "--" : item.size}`;

  return (
    <div
      className="relative flex h-full shrink-0 flex-col overflow-auto bg-white"
      style={{ width }}
    >
      <ColumnHeader title={item.name} />
      <div className="relative flex min-h-0 flex-1 flex-col overflow-auto px-5 py-6">
        <div className="flex flex-col items-center text-center">
          <div className="mb-3 flex size-[96px] items-center justify-center rounded-[18px] bg-[#f4f5f5]">
            <Glyph
              kind={item.kind}
              size="lg"
              path={item.path}
              iconDataUrl={item.iconDataUrl}
            />
          </div>
          <div className="max-w-full truncate text-[15px] font-semibold text-[var(--finder-text)]">
            {item.name}
          </div>
          <div className="mt-1 max-w-full truncate text-[12px] text-[var(--finder-text-secondary)]">
            {sizeLine}
          </div>
        </div>

        <div className="mt-6 border-t border-black/10 pt-3">
          <div className="mb-2 text-[11px] font-semibold text-[var(--finder-text)]">
            信息
          </div>
          <div className="space-y-1.5 text-[12px]">
            <div className="flex gap-2">
              <span className="w-[64px] shrink-0 text-right text-[var(--finder-text-secondary)]">
                创建时间：
              </span>
              <span className="min-w-0 break-words text-[var(--finder-text)]">
                {info?.createdAt ?? "--"}
              </span>
            </div>
            <div className="flex gap-2">
              <span className="w-[64px] shrink-0 text-right text-[var(--finder-text-secondary)]">
                修改时间：
              </span>
              <span className="min-w-0 break-words text-[var(--finder-text)]">
                {info?.modifiedAt ?? item.openedAt}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-auto flex justify-center pt-6">
          <button
            type="button"
            className="rounded-full bg-[#ff3b30] px-5 py-2 text-[13px] font-medium text-white outline-none hover:brightness-110"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onTrash(item);
            }}
          >
            移动到废纸篓
          </button>
        </div>
      </div>
    </div>
  );
}

type Props = {
  columns: ColumnPane[];
  preview: ColumnFileItem | null;
  pathTags?: Record<string, string>;
  searchQuery?: string;
  onSelect: (columnIndex: number, item: ColumnFileItem) => void;
  onOpen: (item: ColumnFileItem) => void;
  onTrash: (item: ColumnFileItem) => void;
  onItemPointerDown?: (e: PointerEvent, item: ColumnFileItem) => void;
  dropTargetPath?: string | null;
};

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
  return [{ text: name, hit: false }];
}

function ColumnHighlightedName({
  name,
  query,
  active,
}: {
  name: string;
  query: string;
  active: boolean;
}) {
  const q = query.trim();
  if (!q) return <span className="min-w-0 flex-1 truncate">{name}</span>;
  const parts = highlightNameParts(name, q);
  return (
    <span className="min-w-0 flex-1 truncate">
      {parts.map((p, i) =>
        p.hit ? (
          <mark
            key={i}
            className={`rounded-[2px] px-[1px] ${
              active ? "bg-white/35 text-inherit" : "bg-[#ffe566] text-inherit"
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

function tagPathKey(path: string) {
  return path.replace(/\//g, "\\").toLowerCase();
}

function columnNameScore(name: string, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const n = name.toLowerCase();
  if (n === q) return 10_000;
  if (n.startsWith(q)) return 8_000 + Math.max(0, 200 - n.length);
  const idx = n.indexOf(q);
  if (idx >= 0) return 5_000 - idx * 10 + Math.max(0, 100 - n.length);
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
  if (qi === q.length) return 1_000 - gaps * 5 + Math.max(0, 50 - n.length);
  return -1;
}

function rankColumnItems(items: ColumnFileItem[], query: string) {
  const q = query.trim();
  if (!q) return items;
  return items
    .map((item) => ({ item, score: columnNameScore(item.name, q) }))
    .filter((x) => x.score >= 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.item.name.localeCompare(b.item.name, "zh"),
    )
    .map((x) => x.item);
}

export function ColumnsView({
  columns,
  preview,
  pathTags = {},
  searchQuery = "",
  onSelect,
  onOpen,
  onTrash,
  onItemPointerDown,
  dropTargetPath = null,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [widths, setWidths] = useState<number[]>(() =>
    columns.map(() => DEFAULT_COL_WIDTH),
  );
  const previewWidth = DEFAULT_PREVIEW_WIDTH;

  useEffect(() => {
    setWidths((prev) =>
      columns.map((_, i) => prev[i] ?? DEFAULT_COL_WIDTH),
    );
  }, [columns.length]);

  // 层级变深时滚到最右侧；延迟以免第一次单击后的滚动打断双击打开
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const timer = window.setTimeout(() => {
      el.scrollTo({ left: el.scrollWidth, behavior: "smooth" });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [columns.length, preview?.id]);

  let lastSelectedCol = -1;
  columns.forEach((c, i) => {
    if (c.selectedId) lastSelectedCol = i;
  });

  const resizeColumn = (index: number, deltaX: number) => {
    setWidths((prev) => {
      const next = [...prev];
      const cur = next[index] ?? DEFAULT_COL_WIDTH;
      next[index] = Math.max(MIN_COL_WIDTH, cur + deltaX);
      return next;
    });
  };

  return (
    <div
      ref={scrollerRef}
      className="flex h-full min-h-0 min-w-0 w-full overflow-x-auto bg-[var(--finder-content)]"
    >
      {columns.map((col, colIndex) => {
        const width = widths[colIndex] ?? DEFAULT_COL_WIDTH;
        const rankedItems = rankColumnItems(col.items, searchQuery);
        return (
          <div
            key={`${col.path}-${colIndex}`}
            className="relative flex h-full shrink-0 flex-col"
            style={{ width }}
          >
            <ColumnHeader title={pathBaseName(col.path)} />
            <div className="relative min-h-0 flex-1 border-r border-black/10">
              <ul className="h-full overflow-y-auto py-1">
                {rankedItems.length === 0 ? (
                  <li className="px-3 py-6 text-center text-[12px] text-[var(--finder-text-muted)]">
                    没有项目
                  </li>
                ) : (
                  rankedItems.map((item) => {
                    const active = col.selectedId === item.id;
                    const isLast = colIndex === lastSelectedCol;
                    const isFolder = item.kind === "folder";
                    const dropPath =
                      isFolder && item.path ? item.path : undefined;
                    const dropHover =
                      !!dropPath &&
                      !!dropTargetPath &&
                      dropPath.replace(/\//g, "\\").toLowerCase() ===
                        dropTargetPath.replace(/\//g, "\\").toLowerCase();
                    const tagColor =
                      pathTags[tagPathKey(item.path ?? item.id)];
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-file-id={item.id}
                          data-drop-folder-path={dropPath}
                          className={`mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-[6px] px-2 py-[3px] text-left text-[13px] text-[var(--finder-text)] ${
                            dropHover
                              ? "bg-[rgba(0,122,255,0.14)] ring-1 ring-inset ring-[var(--finder-accent)]"
                              : active
                                ? isLast
                                  ? "bg-[var(--finder-row-selected)] text-white"
                                  : "bg-[#DCDBDC]"
                                : "hover:bg-[var(--finder-hover)]"
                          }`}
                          onClick={() => onSelect(colIndex, item)}
                          onDoubleClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            onOpen(item);
                          }}
                          onPointerDown={(e) =>
                            onItemPointerDown?.(e, item)
                          }
                        >
                          {tagColor ? (
                            <span
                              className="size-[8px] shrink-0 rounded-full"
                              style={{ backgroundColor: tagColor }}
                              aria-hidden
                            />
                          ) : null}
                          <Glyph
                            kind={item.kind}
                            active={active}
                            lastActive={isLast}
                            path={item.path}
                            iconDataUrl={item.iconDataUrl}
                          />
                          <ColumnHighlightedName
                            name={item.name}
                            query={searchQuery}
                            active={active && isLast}
                          />
                          {isFolder ? (
                            <ChevronRight
                              className={`mt-[0.125em] size-3.5 shrink-0 ${
                                active && isLast
                                  ? "text-white/90"
                                  : "text-[var(--finder-text-muted)]"
                              }`}
                              strokeWidth={ICON_STROKE}
                            />
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
              <ResizeHandle onDrag={(dx) => resizeColumn(colIndex, dx)} />
            </div>
          </div>
        );
      })}
      {preview ? (
        <PreviewPane
          item={preview}
          width={previewWidth}
          onTrash={onTrash}
        />
      ) : (
        <div className="flex min-w-0 flex-1 flex-col bg-white">
          <ColumnHeader title="名称" />
          <div className="min-h-0 flex-1" />
        </div>
      )}
    </div>
  );
}
