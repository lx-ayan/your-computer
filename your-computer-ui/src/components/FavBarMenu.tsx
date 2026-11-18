import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { File, FileText, Folder, HardDrive, Image as ImageIcon } from "lucide-react";

export type FavBarMenuItem = {
  id: number;
  path: string;
  name: string;
  kind: string;
  kindLabel: string;
};

type Props = {
  anchor: DOMRect;
  items: FavBarMenuItem[];
  onPick: (item: FavBarMenuItem) => void;
  onClose: () => void;
};

const panelClass =
  "min-w-[180px] max-w-[280px] rounded-[10px] border border-black/8 bg-[rgba(252,252,253,0.96)] py-[0.125rem] shadow-[0_0_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)] backdrop-blur-xl";

function KindGlyph({ kind }: { kind: string }) {
  const className = "size-[14px] shrink-0 text-[var(--finder-icon)]";
  switch (kind) {
    case "folder":
      return <Folder className={className} strokeWidth={2.25} />;
    case "document":
      return <FileText className={className} strokeWidth={2.25} />;
    case "image":
      return <ImageIcon className={className} strokeWidth={2.25} />;
    case "disk":
      return <HardDrive className={className} strokeWidth={2.25} />;
    default:
      return <File className={className} strokeWidth={2.25} />;
  }
}

export function FavBarMenu({ anchor, items, onPick, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({
    left: Math.max(8, anchor.left),
    top: anchor.bottom + 6,
  });

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const pad = 8;
    const width = el.offsetWidth || 180;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (left + width + pad > vw) left = Math.max(pad, vw - width - pad);
    if (left < pad) left = pad;
    const h = el.offsetHeight || 120;
    if (top + h + pad > vh) top = Math.max(pad, anchor.top - h - 6);
    setPos({ left, top });
  }, [anchor, items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDocPointer = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    const t = window.setTimeout(() => {
      document.addEventListener("pointerdown", onDocPointer, true);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDocPointer, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={rootRef}
      className={`fixed z-[200] ${panelClass}`}
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.length === 0 ? (
        <div className="px-3 py-1 text-[13px] text-[var(--finder-text-secondary)]">
          暂无收藏
        </div>
      ) : (
        <ul className="max-h-[280px] overflow-y-auto px-1">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                title={item.path}
                className="flex w-full items-center gap-2 rounded-[6px] px-2 py-[2px] text-left text-[13px] leading-[18px] text-[var(--finder-text)] outline-none hover:bg-black/[0.06]"
                onClick={() => onPick(item)}
              >
                <KindGlyph kind={item.kind} />
                <span className="min-w-0 flex-1 truncate">{item.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
