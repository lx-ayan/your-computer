import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eraser } from "lucide-react";
import { ColorPickerPanel } from "tdesign-react";

import "tdesign-react/es/style/index.css";
import "tdesign-react/es/color-picker/style/index.css";

/** 默认色板（与 Word 的「标准色」接近） */
export const TEXT_COLORS = [
  "#000000", "#3d3d3d", "#6e6e73", "#a1a1a6", "#d2d2d7", "#ffffff",
  "#c00000", "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be",
  "#0a84ff", "#5e5ce6", "#af52de", "#ff2d55", "#a2845e", "#8e8e93",
  "#7f1d1d", "#b45309", "#4d7c0f", "#0f766e", "#1d4ed8", "#6d28d9",
];

export const HIGHLIGHT_COLORS = [
  "#ffff00", "#ffe566", "#ffd6a5", "#ffc9de", "#d0bfff", "#b2f2bb",
  "#a5d8ff", "#99e9f2", "#f1f3f5", "#d2d2d7", "#adb5bd", "#495057",
];

/* --------------------------- 最近使用颜色 --------------------------- */

const RECENT_KEY = "word-recent-colors";
const RECENT_MAX = 12;

export function readRecentColors(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    return list.filter((c): c is string => typeof c === "string").slice(0, RECENT_MAX);
  } catch {
    return [];
  }
}

function saveRecentColors(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)));
  } catch {
    /* ignore */
  }
}

/** 新颜色插到最前，去重 + 限长 */
export function pushRecentColor(color: string, prev: string[]): string[] {
  const c = normalizeHex(color);
  if (!c) return prev;
  return [c, ...prev.filter((x) => normalizeHex(x) !== c)].slice(0, RECENT_MAX);
}

/** 规范化成 #rrggbb（面板可能返回 rgb()/hex8/hex3） */
export function normalizeHex(input: string): string {
  const s = String(input ?? "").trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  }
  if (/^#[0-9a-f]{8}$/.test(s)) return s.slice(0, 7);
  const m = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/);
  if (m) {
    const h = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
    return `#${h(+m[1])}${h(+m[2])}${h(+m[3])}`;
  }
  return s;
}

/* --------------------------- 浮层样式微调 --------------------------- */

/** 让 tdesign 面板贴合本项目：去双层阴影、压缩高度、隐藏系统预设色区 */
const TD_SCOPE = `
[data-color-scope] .t-color-picker__panel {
  width: 100%; padding: 0; background: transparent;
  box-shadow: none; border-radius: 0;
}
[data-color-scope] .t-color-picker__panel-body { padding: 0; }
[data-color-scope] .t-color-picker__head { display: none; }
[data-color-scope] .t-color-picker__saturation {
  height: 132px; border-radius: 6px;
}
[data-color-scope] .t-color-picker__saturation::before,
[data-color-scope] .t-color-picker__saturation::after { border-radius: 6px; }
[data-color-scope] .t-color-picker__sliders { padding: 8px 0 0; }
[data-color-scope] .t-color-picker__slider { height: 10px; }
[data-color-scope] .t-color-picker__slider-padding { padding: 0; }
[data-color-scope] .t-color-picker__swatches-wrap {
  padding: 8px 0 0; border-top: 1px solid rgba(0,0,0,0.06);
}
[data-color-scope] .t-color-picker__swatches--title {
  margin: 0 0 4px; height: 14px; line-height: 14px;
  font-size: 11px; font-weight: 400; color: #8e8e93;
}
[data-color-scope] .t-color-picker__swatches--title span { font-size: 11px; line-height: 14px; }
[data-color-scope] .t-color-picker__swatches--item {
  width: 17px; height: 17px; border-radius: 3px; margin: 0;
}
[data-color-scope] .t-color-picker__swatches--items { gap: 4px; }
[data-color-scope] .t-color-picker__swatches--color { border-radius: 3px; }
[data-color-scope] .t-color-picker__icon { display: none; }
[data-color-scope] .t-color-picker__format { display: none; }
`;

export type ColorPickerPopProps = {
  anchor: { left: number; top: number; right: number; bottom: number };
  value: string | null;
  /** 标准色板 */
  colors: string[];
  clearLabel?: string;
  title: string;
  onPick: (color: string | null) => void;
  onClose: () => void;
};

/**
 * 颜色选择浮层：tdesign 取色面板（含「最近使用颜色」）+ 标准色板 + 清除。
 * portal 挂到 body，自动做边界翻转。
 */
export function ColorPickerPop({
  anchor,
  value,
  colors,
  clearLabel,
  title,
  onPick,
  onClose,
}: ColorPickerPopProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [recent, setRecent] = useState<string[]>(() => readRecentColors());
  const [draft, setDraft] = useState<string>(() => normalizeHex(value ?? "#000000"));

  // 只定位一次，之后不随内部渲染抖动
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.left;
    let top = anchor.bottom + 6;
    if (left + r.width > vw - 8) left = Math.max(8, vw - r.width - 8);
    if (left < 8) left = 8;
    if (top + r.height > vh - 8) {
      const above = anchor.top - r.height - 6;
      top = above >= 8 ? above : Math.max(8, vh - r.height - 8);
    }
    setPos({ left, top });
    // anchor 是每帧新对象，只依赖其数值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor.left, anchor.top, anchor.right, anchor.bottom]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.("[data-color-scope]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = (e: Event) => {
      const t = e.target as Element | null;
      if (t?.closest?.("[data-color-scope]")) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  const commit = useCallback(
    (raw: string) => {
      const hex = normalizeHex(raw);
      if (!/^#[0-9a-f]{6}$/.test(hex)) return;
      setRecent((prev) => {
        const next = pushRecentColor(hex, prev);
        saveRecentColors(next);
        return next;
      });
      onPick(hex);
    },
    [onPick],
  );

  const active = value ? normalizeHex(value) : null;
  const isOn = (c: string) => active !== null && active === normalizeHex(c);

  return createPortal(
    <>
      <style>{TD_SCOPE}</style>
      <div
        ref={ref}
        data-color-scope
        className="fixed z-[10001] max-h-[calc(100vh-16px)] w-[264px] select-none overflow-y-auto rounded-[10px] bg-white p-2.5 shadow-[0_10px_34px_rgba(0,0,0,0.18),0_1px_3px_rgba(0,0,0,0.08)] ring-1 ring-black/[0.08]"
        style={
          pos
            ? { left: pos.left, top: pos.top }
            : { left: -9999, top: -9999, visibility: "hidden" }
        }
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-medium text-[#8e8e93]">{title}</span>
          <span className="flex items-center gap-1.5">
            <span
              className="h-[14px] w-[14px] rounded-[3px] ring-1 ring-inset ring-black/15"
              style={{ background: draft }}
            />
            <span className="font-mono text-[10px] uppercase text-[#8e8e93]">
              {draft}
            </span>
          </span>
        </div>

        {/* tdesign 取色面板：自带「最近使用颜色」 */}
        <ColorPickerPanel
          value={draft}
          format="HEX"
          colorModes={["monochrome"]}
          swatchColors={null}
          recentColors={recent}
          onRecentColorsChange={(list) => {
            const next = list.map(normalizeHex).slice(0, RECENT_MAX);
            setRecent(next);
            saveRecentColors(next);
          }}
          onChange={(v) => {
            const hex = normalizeHex(v);
            setDraft(hex);
          }}
          onPaletteBarChange={({ color }) => {
            setDraft(normalizeHex(color.hex));
          }}
        />

        {/* 标准色板 */}
        <div className="mt-2 border-t border-black/[0.06] pt-2">
          <div className="mb-1.5 text-[11px] text-[#8e8e93]">标准色</div>
          <div className="grid grid-cols-8 gap-1">
            {colors.map((c) => (
              <button
                key={c}
                type="button"
                title={c}
                className={`size-[17px] rounded-[3px] ring-1 ring-inset ring-black/10 transition-transform hover:scale-110 ${
                  isOn(c) ? "outline outline-2 outline-offset-1 outline-[#0165e1]" : ""
                }`}
                style={{ background: c }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(c)}
              />
            ))}
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1 border-t border-black/[0.06] pt-2">
          <div
            className="h-[24px] text-[14px] items-center flex justify-center flex-1 rounded-[5px] bg-[#0165e1] text-[14px] font-medium leading-none text-white hover:bg-[#0165e1]/90"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => commit(draft)}
          >
            确定
          </div>
          {clearLabel ? (
            <div
              className="flex h-[24px] flex-1 items-center justify-center gap-1 rounded-[5px] text-[11px] leading-none text-[#6e6e73] hover:bg-black/[0.05] hover:text-[#1d1d1f]"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(null)}
            >
              <Eraser size={11} />
              {clearLabel}
            </div>
          ) : null}
        </div>
      </div>
    </>,
    document.body,
  );
}
