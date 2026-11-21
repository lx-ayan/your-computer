import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { ColorPickerPop } from "./ColorPickerPop";

export type DocMenuNode =
  | { kind: "sep" }
  | { kind: "label"; text: string }
  | {
      kind: "item";
      id: string;
      label: string;
      shortcut?: string;
      icon?: LucideIcon;
      checked?: boolean;
      disabled?: boolean;
      onSelect?: () => void;
    }
  | {
      kind: "sub";
      id: string;
      label: string;
      icon?: LucideIcon;
      disabled?: boolean;
      children: DocMenuNode[];
    }
  | {
      kind: "colors";
      id: string;
      value: string | null;
      colors: string[];
      clearLabel?: string;
      /** 面板标题，如「字体颜色」 */
      title?: string;
      onPick: (color: string | null) => void;
    };

const PANEL_CLASS =
  "select-none text-[#1d1d1f] rounded-[10px] bg-white/[0.92] p-1 shadow-[0_10px_34px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.08] backdrop-blur-2xl";

const ITEM_CLASS =
  "group flex h-[26px] min-w-0 cursor-default select-none items-center gap-2 rounded-[5px] px-2 text-[13px] text-[#1d1d1f]";

/* ------------------------------ 颜色条目 ------------------------------ */

/**
 * 菜单里的「字体颜色 / 突出显示」条目：
 * 左半是常用色快选（点即生效），右侧小箭头弹出 tdesign 取色面板（含最近使用）。
 */
function ColorRow({
  node,
  onDone,
}: {
  node: Extract<DocMenuNode, { kind: "colors" }>;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const quick = node.colors.slice(0, 7);

  return (
    <>
      <div
        className={`${ITEM_CLASS} hover:bg-[#0165e1] hover:text-white`}
        onMouseDown={(e) => e.preventDefault()}
      >
        <span className="flex shrink-0 items-center gap-[3px]">
          {quick.map((c) => (
            <button
              key={c}
              type="button"
              title={c}
              className="size-[11px] rounded-[2px] ring-1 ring-inset ring-black/15"
              style={{ background: c }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                node.onPick(c);
                onDone();
              }}
            />
          ))}
        </span>
        <button
          type="button"
          title="更多颜色…"
          className="ml-auto flex size-[18px] shrink-0 items-center justify-center rounded-[4px] opacity-70 hover:bg-black/[0.08] hover:opacity-100"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            setAnchor(e.currentTarget.getBoundingClientRect());
            setOpen(true);
          }}
        >
          <ChevronDown size={12} />
        </button>
      </div>

      {open && anchor ? (
        <ColorPickerPopHost
          anchor={anchor}
          node={node}
          onDone={onDone}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ColorPickerPopHost({
  anchor,
  node,
  onDone,
  onClose,
}: {
  anchor: DOMRect;
  node: Extract<DocMenuNode, { kind: "colors" }>;
  onDone: () => void;
  onClose: () => void;
}) {
  return (
    <ColorPickerPop
      anchor={anchor}
      value={node.value}
      colors={node.colors}
      clearLabel={node.clearLabel}
      title={node.title ?? "颜色"}
      onClose={onClose}
      onPick={(c) => {
        node.onPick(c);
        onClose();
        onDone();
      }}
    />
  );
}

/* ------------------------------ 单个面板 ------------------------------ */

function MenuList({
  items,
  onClose,
}: {
  items: DocMenuNode[];
  onClose: () => void;
}) {
  const [opened, setOpened] = useState<{
    id: string;
    rect: DOMRect;
    children: DocMenuNode[];
  } | null>(null);
  const closeTimer = useRef<number | null>(null);

  const cancelClose = useCallback(() => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      // 取色浮层是 portal，挂在 body 上；指针移入它会触发子菜单 mouseleave，
      // 此时若强行关闭会把浮层一起卸载（表现为"点一下颜色面板就消失"）。
      if (document.querySelector("[data-color-scope]")) return;
      setOpened(null);
    }, 160);
  }, [cancelClose]);

  useEffect(() => cancelClose, [cancelClose]);

  return (
    <div className="flex flex-col" data-doc-ctx>
      {items.map((node, i) => {
        if (node.kind === "sep") {
          const prev = items[i - 1];
          const next = items[i + 1];
          if (!prev || !next || prev.kind === "sep" || next.kind === "sep") {
            return null;
          }
          return (
            <div
              key={`sep-${i}`}
              className="my-1 h-px shrink-0 bg-black/[0.08]"
            />
          );
        }

        if (node.kind === "label") {
          return (
            <div
              key={`label-${i}-${node.text}`}
              className="px-2 pb-0.5 pt-1 text-[11px] font-medium text-[#8e8e93]"
            >
              {node.text}
            </div>
          );
        }

        if (node.kind === "colors") {
          return (
            <div key={node.id} className="px-0.5">
              <ColorRow node={node} onDone={onClose} />
            </div>
          );
        }

        const Icon = node.icon;

        if (node.kind === "sub") {
          const isOpen = opened?.id === node.id;
          return (
            <div
              key={node.id}
              className={`${ITEM_CLASS} ${
                node.disabled
                  ? "opacity-40"
                  : isOpen
                    ? "bg-[#0165e1] text-white"
                    : "hover:bg-[#0165e1] hover:text-white"
              }`}
              onMouseEnter={(e) => {
                if (node.disabled) return;
                cancelClose();
                if (opened?.id === node.id) return;
                setOpened({
                  id: node.id,
                  rect: e.currentTarget.getBoundingClientRect(),
                  children: node.children,
                });
              }}
              onMouseLeave={scheduleClose}
              onMouseDown={(e) => e.preventDefault()}
            >
              <span className="flex size-4 shrink-0 items-center justify-center">
                {Icon ? <Icon size={14} strokeWidth={1.9} /> : null}
              </span>
              <span className="min-w-0 flex-1 truncate">{node.label}</span>
              <ChevronRight
                size={13}
                className="shrink-0 opacity-50 group-hover:opacity-90"
              />
            </div>
          );
        }

        return (
          <div
            key={node.id}
            className={`${ITEM_CLASS} ${
              node.disabled
                ? "pointer-events-none opacity-40"
                : "hover:bg-[#0165e1] hover:text-white"
            }`}
            onMouseEnter={() => {
              cancelClose();
              setOpened(null);
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (node.disabled) return;
              node.onSelect?.();
              onClose();
            }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center">
              {node.checked ? (
                <Check size={14} strokeWidth={2.4} />
              ) : Icon ? (
                <Icon size={14} strokeWidth={1.9} />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{node.label}</span>
            {node.shortcut ? (
              <span className="ml-3 shrink-0 text-[11px] text-[#8e8e93] group-hover:text-white/80">
                {node.shortcut}
              </span>
            ) : null}
          </div>
        );
      })}

      {opened ? (
        <SubPanel anchor={opened.rect} onEnter={cancelClose} onLeave={scheduleClose}>
          <MenuList items={opened.children} onClose={onClose} />
        </SubPanel>
      ) : null}
    </div>
  );
}

/* ------------------------------ 子面板定位 ------------------------------ */

function SubPanel({
  anchor,
  onEnter,
  onLeave,
  children,
}: {
  anchor: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{
    left: number;
    top: number;
    maxHeight: number;
  } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right + 2;
    if (left + rect.width > vw - 6) left = anchor.left - rect.width - 2;
    if (left < 6) left = Math.max(6, vw - rect.width - 6);
    let top = anchor.top - 5;
    if (top + rect.height > vh - 6) top = Math.max(6, vh - rect.height - 6);
    setStyle({ left, top, maxHeight: Math.max(120, vh - 12) });
    // 只在锚点变化时重新定位，避免 children 每次渲染导致死循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.left, anchor.top, anchor.right]);

  return createPortal(
    <div
      ref={ref}
      data-doc-ctx
      className={`fixed z-[9999] overflow-y-auto ${PANEL_CLASS}`}
      style={
        style
          ? { left: style.left, top: style.top, maxHeight: style.maxHeight }
          : { left: -9999, top: -9999, visibility: "hidden" }
      }
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

/* ------------------------------ 根菜单 ------------------------------ */

export function DocContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: DocMenuNode[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({
    left: x,
    top: y,
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - 6) left = Math.max(6, vw - rect.width - 6);
    if (top + rect.height > vh - 6) top = Math.max(6, vh - rect.height - 6);
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    // 取色浮层（tdesign 面板 + 标准色板）是独立 portal，不属于菜单节点，
    // 但它"逻辑上"属于菜单；点击它不应视为点到外面。
    const isInside = (target: Element | null) =>
      !!target?.closest?.("[data-doc-ctx], [data-color-scope]");

    const onPointerDown = (e: MouseEvent) => {
      if (isInside(e.target as Element | null)) return;
      onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // 菜单自身滚动不应触发关闭
    const onScroll = (e: Event) => {
      if (isInside(e.target as Element | null)) return;
      onClose();
    };
    window.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const isEmpty = items.every((n) => n.kind === "sep");
  if (isEmpty) return null;

  return createPortal(
    <div
      ref={ref}
      data-doc-ctx
      className={`fixed z-[9999] w-[236px] max-h-[calc(100vh-12px)] overflow-y-auto ${PANEL_CLASS}`}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <MenuList items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}
