import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight } from "lucide-react";

export type SortKey =
  | "name"
  | "modified"
  | "kind"
  | "size"
  | "created"
  | "author"
  | "tags"
  | "title";

export type SortDir = "asc" | "desc";

const PRIMARY_KEYS: { id: SortKey; label: string }[] = [
  { id: "name", label: "名称" },
  { id: "modified", label: "修改日期" },
  { id: "kind", label: "类型" },
];

const MORE_KEYS: { id: SortKey; label: string }[] = [
  { id: "size", label: "大小" },
  { id: "created", label: "创建日期" },
  { id: "author", label: "作者" },
  { id: "tags", label: "标记" },
  { id: "title", label: "标题" },
];

const GROUP_KEYS: { id: SortKey; label: string }[] = [
  { id: "name", label: "名称" },
  { id: "modified", label: "修改日期" },
  { id: "kind", label: "类型" },
  { id: "size", label: "大小" },
  { id: "created", label: "创建日期" },
  { id: "author", label: "作者" },
  { id: "tags", label: "标记" },
  { id: "title", label: "标题" },
];

type SubMenu = "more" | "group" | null;

type Props = {
  anchor: DOMRect;
  sortKey: SortKey;
  sortDir: SortDir;
  groupBy: SortKey | null;
  onSortKey: (key: SortKey) => void;
  onSortDir: (dir: SortDir) => void;
  onGroupBy: (key: SortKey | null) => void;
  onClose: () => void;
};

function Dot({ on }: { on: boolean }) {
  return (
    <span
      className={`mr-1.5 inline-block size-[4px] shrink-0 rounded-full ${
        on ? "bg-[var(--finder-text)]" : "bg-transparent"
      }`}
    />
  );
}

const panelClass =
  "rounded-[10px] border border-black/8 bg-[rgba(252,252,253,0.96)] py-0.5 shadow-[0_0_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-xl";

export function SortMenu({
  anchor,
  sortKey,
  sortDir,
  groupBy,
  onSortKey,
  onSortDir,
  onGroupBy,
  onClose,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({
    left: Math.max(8, anchor.right - 180),
    top: anchor.bottom + 6,
  });
  const [sub, setSub] = useState<SubMenu>(null);
  const [subTop, setSubTop] = useState(0);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const pad = 8;
    const width = 180;
    const subW = sub ? 156 : 0;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let left = anchor.right - width;
    let top = anchor.bottom + 6;
    if (left < pad) left = pad;
    if (left + width + subW + pad > vw) {
      left = Math.max(pad, vw - width - subW - pad);
    }
    const h = el.offsetHeight || 220;
    if (top + h + pad > vh) top = Math.max(pad, anchor.top - h - 6);
    setPos({ left, top });
  }, [anchor, sub]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDocPointer = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    // 下一事件循环再监听，避开打开菜单的那次点击
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocPointer, true);
    };
  }, [onClose]);

  const rowBtn =
    "flex w-full items-center rounded-[4px] px-2 py-[2px] text-left text-[14px] leading-[18px] text-[var(--finder-text)] hover:bg-black/[0.06]";

  const isPrimary =
    sortKey === "name" || sortKey === "modified" || sortKey === "kind";
  const isMore = MORE_KEYS.some((k) => k.id === sortKey);

  return createPortal(
    <div
      ref={rootRef}
      className="fixed z-[200]"
      style={{ left: pos.left, top: pos.top, fontSize: 14 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={`relative w-[180px] ${panelClass}`}>
        <ul className="px-1">
          {PRIMARY_KEYS.map((k) => (
            <li key={k.id}>
              <button
                type="button"
                className={rowBtn}
                onClick={() => {
                  onSortKey(k.id);
                  onClose();
                }}
              >
                <Dot on={sortKey === k.id} />
                <span className="min-w-0 flex-1 truncate">{k.label}</span>
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={`${rowBtn} ${sub === "more" ? "bg-black/[0.06]" : ""}`}
              onMouseEnter={(e) => {
                setSub("more");
                setSubTop(e.currentTarget.offsetTop);
              }}
              onClick={(e) => {
                setSub("more");
                setSubTop(e.currentTarget.offsetTop);
              }}
            >
              <Dot on={isMore && !isPrimary} />
              <span className="min-w-0 flex-1 truncate">更多</span>
              <ChevronRight className="size-3.5 shrink-0 text-[var(--finder-text-muted)]" />
            </button>
          </li>
        </ul>

        <div className="mx-2 my-0.5 h-px bg-black/10" />

        <ul className="px-1">
          <li>
            <button
              type="button"
              className={rowBtn}
              onClick={() => {
                onSortDir("asc");
                onClose();
              }}
            >
              <Dot on={sortDir === "asc"} />
              <span>递增</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              className={rowBtn}
              onClick={() => {
                onSortDir("desc");
                onClose();
              }}
            >
              <Dot on={sortDir === "desc"} />
              <span>递减</span>
            </button>
          </li>
        </ul>

        <div className="mx-2 my-0.5 h-px bg-black/10" />

        <ul className="px-1">
          <li>
            <button
              type="button"
              className={`${rowBtn} ${sub === "group" ? "bg-black/[0.06]" : ""}`}
              onMouseEnter={(e) => {
                setSub("group");
                setSubTop(e.currentTarget.offsetTop);
              }}
              onClick={(e) => {
                setSub("group");
                setSubTop(e.currentTarget.offsetTop);
              }}
            >
              <span className="ml-[12px] min-w-0 flex-1 truncate">
                分组依据
              </span>
              <ChevronRight className="size-3.5 shrink-0 text-[var(--finder-text-muted)]" />
            </button>
          </li>
        </ul>

        {sub === "more" ? (
          <div
            className={`absolute left-full z-[1] ml-1 w-[156px] ${panelClass}`}
            style={{ top: subTop }}
            onMouseLeave={() => setSub(null)}
          >
            <ul className="px-1">
              {MORE_KEYS.map((k) => (
                <li key={k.id}>
                  <button
                    type="button"
                    className={rowBtn}
                    onClick={() => {
                      onSortKey(k.id);
                      onClose();
                    }}
                  >
                    <Dot on={sortKey === k.id} />
                    <span>{k.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {sub === "group" ? (
          <div
            className={`absolute left-full z-[1] ml-1 w-[156px] ${panelClass}`}
            style={{ top: Math.max(0, subTop - 40) }}
            onMouseLeave={() => setSub(null)}
          >
            <ul className="px-1">
              <li>
                <button
                  type="button"
                  className={rowBtn}
                  onClick={() => {
                    onGroupBy(null);
                    onClose();
                  }}
                >
                  <Dot on={groupBy == null} />
                  <span>无</span>
                </button>
              </li>
              {GROUP_KEYS.map((k) => (
                <li key={k.id}>
                  <button
                    type="button"
                    className={rowBtn}
                    onClick={() => {
                      onGroupBy(k.id);
                      onClose();
                    }}
                  >
                    <Dot on={groupBy === k.id} />
                    <span>{k.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
