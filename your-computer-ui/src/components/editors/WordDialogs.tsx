import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { Link2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import {
  ColorPickerPop,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
} from "./ColorPickerPop";

export { HIGHLIGHT_COLORS, TEXT_COLORS };

type DialogShellProps = {
  title: string;
  children: ReactNode;
  confirmText?: string;
  confirmDisabled?: boolean;
  /** 打开时优先聚焦的元素（默认交给 dialog 自动定位） */
  initialFocus?: RefObject<HTMLElement | null>;
  onCancel: () => void;
  onConfirm: () => void;
};

function DialogShell({
  title,
  children,
  confirmText = "确定",
  confirmDisabled,
  initialFocus,
  onCancel,
  onConfirm,
}: DialogShellProps) {
  // 回车确定（多行文本框留住换行、下拉框留住展开、按钮/链接留住自身激活）；Esc 交给 dialog 自身关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "A"
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (!confirmDisabled) onConfirm();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmDisabled, onConfirm]);

  return (
    <Dialog
      open
      modal
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={initialFocus}
        className="z-[10000] flex w-[420px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden rounded-[12px] bg-white p-0 text-[#1d1d1f] shadow-[0_24px_64px_rgba(0,0,0,0.28)] ring-1 ring-black/10 sm:max-w-[420px]"
      >
        <DialogHeader className="h-9 shrink-0 flex-row items-center gap-0 pl-4 pr-2">
          <DialogTitle className="text-[13px] font-medium text-[#1d1d1f]">
            {title}
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

        <div className="px-4 py-3.5">{children}</div>

        <DialogFooter className="mx-0 mb-0 flex-row items-center justify-end gap-2 rounded-b-[12px] border-t-0 bg-transparent px-4 pb-3.5 pt-1">
          <Button
            variant="outline"
            className="h-7 rounded-[6px] border-black/[0.12] bg-white px-3.5 text-[12px] font-normal text-[#1d1d1f] hover:bg-black/[0.03]"
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            className="h-7 rounded-[6px] bg-[#0165e1] px-3.5 text-[12px] font-medium text-white shadow-none hover:bg-[#0165e1]/90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SELECT_CLASS =
  "h-7 w-full rounded-[6px] border border-black/[0.12] bg-white px-1.5 text-[12px] text-[#1d1d1f] outline-none focus:border-[#0165e1]";
const INPUT_CLASS =
  "h-7 w-full rounded-[6px] border border-black/[0.12] bg-white px-2 text-[12px] text-[#1d1d1f] outline-none focus:border-[#0165e1]";

function Row({
  label,
  children,
  width = 64,
}: {
  label: string;
  children: ReactNode;
  width?: number;
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span
        className="shrink-0 text-[12px] text-[#6e6e73]"
        style={{ width }}
      >
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function ColorRow({
  label,
  colors,
  value,
  onChange,
  allowNone,
  clearLabel,
  title,
}: {
  label: string;
  colors: string[];
  value: string | null;
  onChange: (v: string | null) => void;
  allowNone?: boolean;
  clearLabel?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    right: number;
    bottom: number;
  } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const quick = colors.slice(0, 8);
  const display = value ?? "#ffffff";

  return (
    <Row label={label}>
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          title={value ?? "自动"}
          className="mr-0.5 size-[20px] rounded-[4px] ring-1 ring-inset ring-black/15"
          style={{
            background: value
              ? value
              : "linear-gradient(135deg, #fff 46%, #ff3b30 46%, #ff3b30 54%, #fff 54%)",
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const el = moreRef.current;
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
        />
        {allowNone ? (
          <button
            type="button"
            title="无"
            className={`h-[18px] w-[18px] rounded-[4px] border border-black/15 text-[10px] text-[#8e8e93] ${
              value === null ? "ring-2 ring-[#0165e1] ring-offset-1" : ""
            }`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(null)}
          >
            /
          </button>
        ) : null}
        {quick.map((c) => (
          <button
            key={c}
            type="button"
            title={c}
            className={`size-[18px] rounded-[4px] ring-1 ring-inset ring-black/10 ${
              value && value.toLowerCase() === c.toLowerCase()
                ? "ring-2 ring-[#0165e1] ring-offset-1"
                : ""
            }`}
            style={{ background: c }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(c)}
          />
        ))}
        <button
          ref={moreRef}
          type="button"
          title="更多颜色…"
          className="ml-0.5 h-[18px] rounded-[4px] px-1.5 text-[11px] text-[#0165e1] hover:bg-[#0165e1]/08"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const el = moreRef.current;
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
          更多…
        </button>
      </div>
      {open && anchor ? (
        <ColorPickerPop
          anchor={anchor}
          value={display}
          colors={colors}
          clearLabel={allowNone ? clearLabel ?? "清除" : undefined}
          title={title ?? label}
          onClose={() => setOpen(false)}
          onPick={(c) => {
            onChange(c);
            setOpen(false);
          }}
        />
      ) : null}
    </Row>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-default items-center gap-1.5 text-[12px] text-[#1d1d1f]">
      <input
        type="checkbox"
        checked={checked}
        className="size-3.5 accent-[#0165e1]"
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  );
}

/* ------------------------------ 字体 ------------------------------ */

/** 下划线线型（与 canvas-editor TextDecorationStyle 对齐；none = 无） */
export type UnderlineStyle =
  | "none"
  | "solid"
  | "double"
  | "dashed"
  | "dotted"
  | "wavy";

export type FontPayload = {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  /** 兼容旧字段：有下划线时为 true */
  underline: boolean;
  underlineStyle: UnderlineStyle;
  strikeout: boolean;
  script: "none" | "super" | "sub";
  color: string | null;
  highlight: string | null;
};

const UNDERLINE_OPTIONS: { value: UnderlineStyle; label: string }[] = [
  { value: "none", label: "(无)" },
  { value: "solid", label: "单实线" },
  { value: "double", label: "双实线" },
  { value: "dashed", label: "虚线" },
  { value: "dotted", label: "点线" },
  { value: "wavy", label: "波浪线" },
];

type FontStyleKey = "regular" | "italic" | "bold" | "boldItalic";

function styleKeyOf(bold: boolean, italic: boolean): FontStyleKey {
  if (bold && italic) return "boldItalic";
  if (bold) return "bold";
  if (italic) return "italic";
  return "regular";
}

function styleFromKey(key: FontStyleKey): { bold: boolean; italic: boolean } {
  return {
    bold: key === "bold" || key === "boldItalic",
    italic: key === "italic" || key === "boldItalic",
  };
}

export function FontDialog({
  initial,
  fonts,
  sizes,
  onCancel,
  onApply,
}: {
  initial: FontPayload;
  fonts: string[];
  sizes: string[];
  onCancel: () => void;
  onApply: (payload: FontPayload) => void;
}) {
  const [draft, setDraft] = useState<FontPayload>(() => ({
    ...initial,
    underlineStyle:
      initial.underlineStyle ??
      (initial.underline ? "solid" : "none"),
    underline: initial.underlineStyle
      ? initial.underlineStyle !== "none"
      : !!initial.underline,
  }));
  const fontRef = useRef<HTMLSelectElement>(null);

  const patch = (p: Partial<FontPayload>) =>
    setDraft((prev) => ({ ...prev, ...p }));

  const styleKey = styleKeyOf(draft.bold, draft.italic);

  // 回车确定
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "A"
      ) {
        return;
      }
      e.preventDefault();
      onApply(draft);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [draft, onApply]);

  const previewDecoration = [
    draft.underlineStyle !== "none" ? "underline" : "",
    draft.strikeout ? "line-through" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <Dialog
      open
      modal
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={fontRef}
        className="z-[10000] flex w-[520px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden rounded-[12px] bg-white p-0 text-[#1d1d1f] shadow-[0_24px_64px_rgba(0,0,0,0.28)] ring-1 ring-black/10 sm:max-w-[520px]"
      >
        <DialogHeader className="h-9 shrink-0 flex-row items-center gap-0 pl-4 pr-2">
          <DialogTitle className="text-[13px] font-medium text-[#1d1d1f]">
            字体
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

        <div className="px-4 py-3.5">
          <div className="mb-3 grid grid-cols-[1fr_120px_100px] gap-2">
            <div>
              <div className="mb-1 text-[11px] text-[#8e8e93]">字体</div>
              <select
                ref={fontRef}
                className={SELECT_CLASS}
                value={draft.font}
                onChange={(e) => patch({ font: e.target.value })}
              >
                {fonts.includes(draft.font) ? null : (
                  <option value={draft.font}>{draft.font}</option>
                )}
                {fonts.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-[#8e8e93]">字形</div>
              <select
                className={SELECT_CLASS}
                value={styleKey}
                onChange={(e) =>
                  patch(styleFromKey(e.target.value as FontStyleKey))
                }
              >
                <option value="regular">常规</option>
                <option value="italic">倾斜</option>
                <option value="bold">加粗</option>
                <option value="boldItalic">加粗 倾斜</option>
              </select>
            </div>
            <div>
              <div className="mb-1 text-[11px] text-[#8e8e93]">字号</div>
              <select
                className={SELECT_CLASS}
                value={String(draft.size)}
                onChange={(e) => patch({ size: Number(e.target.value) })}
              >
                {sizes.includes(String(draft.size)) ? null : (
                  <option value={String(draft.size)}>{draft.size}</option>
                )}
                {sizes.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mb-1 text-[11px] font-medium text-[#8e8e93]">
            所有文字
          </div>
          <ColorRow
            label="字体颜色"
            title="字体颜色"
            colors={TEXT_COLORS}
            value={draft.color}
            allowNone
            clearLabel="清除颜色"
            onChange={(v) => patch({ color: v })}
          />
          <Row label="下划线">
            <select
              className={SELECT_CLASS}
              value={draft.underlineStyle}
              onChange={(e) => {
                const underlineStyle = e.target.value as UnderlineStyle;
                patch({
                  underlineStyle,
                  underline: underlineStyle !== "none",
                });
              }}
            >
              {UNDERLINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
          <ColorRow
            label="突出显示"
            title="突出显示"
            colors={HIGHLIGHT_COLORS}
            value={draft.highlight}
            allowNone
            clearLabel="清除高亮"
            onChange={(v) => patch({ highlight: v })}
          />

          <div className="mb-1 mt-2 text-[11px] font-medium text-[#8e8e93]">
            效果
          </div>
          <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1.5 px-0.5">
            <Toggle
              label="删除线"
              checked={draft.strikeout}
              onChange={(v) => patch({ strikeout: v })}
            />
            <Toggle
              label="上标"
              checked={draft.script === "super"}
              onChange={(v) => patch({ script: v ? "super" : "none" })}
            />
            <Toggle
              label="下标"
              checked={draft.script === "sub"}
              onChange={(v) => patch({ script: v ? "sub" : "none" })}
            />
          </div>

          <div className="mt-1 rounded-[6px] border border-black/[0.08] bg-[#fafafa] px-3 py-3">
            <div className="mb-1.5 text-[11px] text-[#8e8e93]">预览</div>
            <div
              className="truncate text-[15px]"
              style={{
                fontFamily: draft.font,
                fontSize: Math.min(22, Math.max(12, draft.size)),
                color: draft.color ?? "#1d1d1f",
                backgroundColor: draft.highlight ?? "transparent",
                fontWeight: draft.bold ? 700 : 400,
                fontStyle: draft.italic ? "italic" : "normal",
                textDecoration: previewDecoration || "none",
                textDecorationStyle:
                  draft.underlineStyle === "none"
                    ? undefined
                    : draft.underlineStyle,
                verticalAlign:
                  draft.script === "super"
                    ? "super"
                    : draft.script === "sub"
                      ? "sub"
                      : undefined,
              }}
            >
              预览效果 Aa Bb Cc 中文 123
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 flex-row items-center justify-end gap-2 rounded-b-[12px] border-t-0 bg-transparent px-4 pb-3.5 pt-1">
          <Button
            variant="outline"
            className="h-7 rounded-[6px] border-black/[0.12] bg-white px-3.5 text-[12px] font-normal text-[#1d1d1f] hover:bg-black/[0.03]"
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            className="h-7 rounded-[6px] bg-[#0165e1] px-3.5 text-[12px] font-medium text-white shadow-none hover:bg-[#0165e1]/90"
            onClick={() => onApply(draft)}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ 段落 ------------------------------ */

export type AlignValue = "left" | "center" | "right" | "justify";

/** 大纲级别：null = 正文；1–6 = 标题 */
export type OutlineLevel = null | 1 | 2 | 3 | 4 | 5 | 6;

export type SpecialIndent = "none" | "firstLine" | "hanging";

export type ParagraphPayload = {
  align: AlignValue;
  outlineLevel: OutlineLevel;
  rowMargin: number;
  spacingBefore: number;
  spacingAfter: number;
  indentLeft: number;
  indentRight: number;
  indentFirstLine: number;
};

const ALIGN_OPTIONS: { v: AlignValue; label: string }[] = [
  { v: "left", label: "左对齐" },
  { v: "center", label: "居中" },
  { v: "right", label: "右对齐" },
  { v: "justify", label: "两端对齐" },
];

const OUTLINE_OPTIONS: { v: string; level: OutlineLevel; label: string }[] = [
  { v: "body", level: null, label: "正文文本" },
  { v: "1", level: 1, label: "1 级" },
  { v: "2", level: 2, label: "2 级" },
  { v: "3", level: 3, label: "3 级" },
  { v: "4", level: 4, label: "4 级" },
  { v: "5", level: 5, label: "5 级" },
  { v: "6", level: 6, label: "6 级" },
];

const LINE_SPACING_PRESETS = [
  { value: 1, label: "单倍行距" },
  { value: 1.15, label: "1.15 倍行距" },
  { value: 1.5, label: "1.5 倍行距" },
  { value: 2, label: "2 倍行距" },
  { value: 2.5, label: "2.5 倍行距" },
  { value: 3, label: "3 倍行距" },
];

function specialFromFirstLine(px: number): SpecialIndent {
  if (px > 0) return "firstLine";
  if (px < 0) return "hanging";
  return "none";
}

export function ParagraphDialog({
  initial,
  size,
  onCancel,
  onApply,
}: {
  initial: ParagraphPayload;
  /** 当前字号，用于字符 ↔ 像素换算 */
  size: number;
  onCancel: () => void;
  onApply: (payload: ParagraphPayload) => void;
}) {
  const [draft, setDraft] = useState<ParagraphPayload>({
    ...initial,
    outlineLevel: initial.outlineLevel ?? null,
  });
  const indentRef = useRef<HTMLInputElement>(null);
  const unit = size > 0 ? size : 16;
  const toChar = (px: number) => Math.round((px / unit) * 100) / 100;
  const toPx = (ch: number) => Math.round(ch * unit);

  const patch = (p: Partial<ParagraphPayload>) =>
    setDraft((prev) => ({ ...prev, ...p }));

  const special = specialFromFirstLine(draft.indentFirstLine);
  const specialMeasure = Math.abs(toChar(draft.indentFirstLine));

  const setSpecial = (kind: SpecialIndent, measureChars: number) => {
    const ch = Math.max(0, measureChars);
    if (kind === "none") {
      patch({ indentFirstLine: 0 });
      return;
    }
    const px = toPx(ch || 2);
    patch({ indentFirstLine: kind === "hanging" ? -px : px });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        tag === "BUTTON" ||
        tag === "A"
      ) {
        return;
      }
      e.preventDefault();
      onApply(draft);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [draft, onApply]);

  const previewPadLeft = Math.max(0, toChar(draft.indentLeft)) * 8;
  const previewFirst =
    special === "firstLine"
      ? specialMeasure * 8
      : special === "hanging"
        ? -specialMeasure * 8
        : 0;

  return (
    <Dialog
      open
      modal
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={indentRef}
        className="z-[10000] flex w-[520px] max-w-[calc(100vw-32px)] flex-col gap-0 overflow-hidden rounded-[12px] bg-white p-0 text-[#1d1d1f] shadow-[0_24px_64px_rgba(0,0,0,0.28)] ring-1 ring-black/10 sm:max-w-[520px]"
      >
        <DialogHeader className="h-9 shrink-0 flex-row items-center gap-0 pl-4 pr-2">
          <DialogTitle className="text-[13px] font-medium text-[#1d1d1f]">
            段落
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

        <div className="px-4 py-3.5">
          <div className="mb-1 text-[11px] font-medium text-[#8e8e93]">常规</div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">对齐方式</span>
              <select
                className={SELECT_CLASS}
                value={draft.align}
                onChange={(e) =>
                  patch({ align: e.target.value as AlignValue })
                }
              >
                {ALIGN_OPTIONS.map((a) => (
                  <option key={a.v} value={a.v}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">大纲级别</span>
              <select
                className={SELECT_CLASS}
                value={
                  draft.outlineLevel == null
                    ? "body"
                    : String(draft.outlineLevel)
                }
                onChange={(e) => {
                  const opt = OUTLINE_OPTIONS.find(
                    (o) => o.v === e.target.value,
                  );
                  patch({ outlineLevel: opt?.level ?? null });
                }}
              >
                {OUTLINE_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mb-1 text-[11px] font-medium text-[#8e8e93]">缩进</div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">文本之前（字符）</span>
              <input
                ref={indentRef}
                type="number"
                step={0.5}
                min={0}
                max={20}
                value={toChar(draft.indentLeft)}
                className={INPUT_CLASS}
                onChange={(e) =>
                  patch({ indentLeft: toPx(Number(e.target.value) || 0) })
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">文本之后（字符）</span>
              <input
                type="number"
                step={0.5}
                min={0}
                max={20}
                value={toChar(draft.indentRight)}
                className={INPUT_CLASS}
                onChange={(e) =>
                  patch({ indentRight: toPx(Number(e.target.value) || 0) })
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">特殊格式</span>
              <select
                className={SELECT_CLASS}
                value={special}
                onChange={(e) => {
                  const kind = e.target.value as SpecialIndent;
                  setSpecial(kind, kind === "none" ? 0 : specialMeasure || 2);
                }}
              >
                <option value="none">(无)</option>
                <option value="firstLine">首行缩进</option>
                <option value="hanging">悬挂缩进</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">度量值（字符）</span>
              <input
                type="number"
                step={0.5}
                min={0}
                max={20}
                disabled={special === "none"}
                value={special === "none" ? "" : specialMeasure}
                className={`${INPUT_CLASS} disabled:bg-[#f5f5f7] disabled:text-[#8e8e93]`}
                onChange={(e) =>
                  setSpecial(special, Number(e.target.value) || 0)
                }
              />
            </label>
          </div>

          <div className="mb-1 text-[11px] font-medium text-[#8e8e93]">间距</div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">段前（px）</span>
              <input
                type="number"
                step={2}
                min={0}
                max={200}
                value={draft.spacingBefore}
                className={INPUT_CLASS}
                onChange={(e) =>
                  patch({
                    spacingBefore: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">段后（px）</span>
              <input
                type="number"
                step={2}
                min={0}
                max={200}
                value={draft.spacingAfter}
                className={INPUT_CLASS}
                onChange={(e) =>
                  patch({
                    spacingAfter: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">行距</span>
              <select
                className={SELECT_CLASS}
                value={
                  LINE_SPACING_PRESETS.some((p) => p.value === draft.rowMargin)
                    ? String(draft.rowMargin)
                    : "custom"
                }
                onChange={(e) => {
                  if (e.target.value === "custom") return;
                  patch({ rowMargin: Number(e.target.value) });
                }}
              >
                {LINE_SPACING_PRESETS.map((p) => (
                  <option key={p.value} value={String(p.value)}>
                    {p.label}
                  </option>
                ))}
                {!LINE_SPACING_PRESETS.some(
                  (p) => p.value === draft.rowMargin,
                ) ? (
                  <option value="custom">
                    多倍行距（{Math.round(draft.rowMargin * 100) / 100}）
                  </option>
                ) : (
                  <option value="custom">多倍行距</option>
                )}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] text-[#8e8e93]">设置值（倍）</span>
              <input
                type="number"
                step={0.05}
                min={0.5}
                max={5}
                value={draft.rowMargin}
                className={INPUT_CLASS}
                onChange={(e) =>
                  patch({
                    rowMargin: Math.max(
                      0.5,
                      Math.min(5, Number(e.target.value) || 1),
                    ),
                  })
                }
              />
            </label>
          </div>

          <div className="rounded-[6px] border border-black/[0.08] bg-[#fafafa] px-3 py-3">
            <div className="mb-1.5 text-[11px] text-[#8e8e93]">预览</div>
            <div
              className="overflow-hidden rounded-[4px] border border-black/[0.06] bg-white px-2 py-2 text-[12px] leading-relaxed text-[#1d1d1f]"
              style={{
                textAlign: draft.align === "justify" ? "justify" : draft.align,
                paddingTop: Math.min(24, draft.spacingBefore / 4),
                paddingBottom: Math.min(24, draft.spacingAfter / 4),
                lineHeight: draft.rowMargin,
                paddingLeft: previewPadLeft,
                paddingRight: Math.max(0, toChar(draft.indentRight)) * 8,
              }}
            >
              <p style={{ textIndent: previewFirst, margin: 0 }}>
                段落预览：对齐、缩进与行距会反映在此。首行或悬挂缩进可在上方「特殊格式」中调整。
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 flex-row items-center justify-end gap-2 rounded-b-[12px] border-t-0 bg-transparent px-4 pb-3.5 pt-1">
          <Button
            variant="outline"
            className="h-7 rounded-[6px] border-black/[0.12] bg-white px-3.5 text-[12px] font-normal text-[#1d1d1f] hover:bg-black/[0.03]"
            onClick={onCancel}
          >
            取消
          </Button>
          <Button
            className="h-7 rounded-[6px] bg-[#0165e1] px-3.5 text-[12px] font-medium text-white shadow-none hover:bg-[#0165e1]/90"
            onClick={() => onApply(draft)}
          >
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ 超链接 ------------------------------ */

export type LinkPayload = { text: string; url: string };

function normalizeUrl(raw: string) {
  const url = raw.trim();
  if (!url) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (/^\/\//.test(url)) return `https:${url}`;
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(url)) return `https://${url}`;
  return url;
}

export function LinkDialog({
  initial,
  editing,
  textLocked,
  onCancel,
  onApply,
}: {
  initial: LinkPayload;
  /** 编辑已有链接：文字不可改（仅改地址） */
  editing?: boolean;
  /** 已有选中文字：文字跟随选区，不可改 */
  textLocked?: boolean;
  onCancel: () => void;
  onApply: (payload: LinkPayload) => void;
}) {
  const [text, setText] = useState(initial.text);
  const [url, setUrl] = useState(initial.url);
  const urlRef = useRef<HTMLInputElement>(null);

  // 首次渲染后（dialog 已把焦点交给 urlRef）再整体选中，方便直接覆盖输入
  useEffect(() => {
    const id = window.setTimeout(() => urlRef.current?.select(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const lockText = editing || textLocked;
  const canConfirm = !!normalizeUrl(url) && (lockText || !!text.trim());

  return (
    <DialogShell
      title={editing ? "编辑超链接" : "插入超链接"}
      confirmText={editing ? "更新" : "插入"}
      confirmDisabled={!canConfirm}
      initialFocus={urlRef}
      onCancel={onCancel}
      onConfirm={() => onApply({ text, url: normalizeUrl(url) })}
    >
      <div className="mb-3 flex items-center gap-2 px-1">
        <Link2 size={14} className="shrink-0 text-[#0165e1]" />
        <span className="truncate text-[12px] text-[#6e6e73]">
          {normalizeUrl(url) || "尚未填写链接地址"}
        </span>
      </div>
      <Row label="显示文字">
        <input
          className={`${INPUT_CLASS} disabled:text-[#8e8e93]`}
          value={text}
          disabled={lockText}
          placeholder="链接文字"
          onChange={(e) => setText(e.target.value)}
        />
      </Row>
      <Row label="链接地址">
        <input
          ref={urlRef}
          className={INPUT_CLASS}
          value={url}
          placeholder="https://"
          onChange={(e) => setUrl(e.target.value)}
        />
      </Row>
      <p className="mt-2 text-[11px] leading-relaxed text-[#8e8e93]">
        支持 https://、mailto: 及本地路径；省略协议时按 https 处理。
      </p>
    </DialogShell>
  );
}
