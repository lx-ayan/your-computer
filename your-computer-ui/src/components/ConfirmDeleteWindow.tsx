import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LiquidGlassPanel } from "./LiquidGlassPanel";

export type ConfirmDeletePayload = {
  paths: string[];
  names: string[];
};

function FinderMark() {
  return (
    <div className="relative mx-auto size-[72px] overflow-hidden rounded-[16px] bg-gradient-to-b from-[#7ec8f5] to-[#2f7de1] shadow-[0_8px_24px_rgba(0,0,0,0.35)]">
      <div className="absolute inset-[10%] rounded-full border-[3px] border-white/90" />
      <div className="absolute top-[38%] left-[28%] size-[10px] rounded-full bg-white/95" />
      <div className="absolute top-[38%] right-[28%] size-[10px] rounded-full bg-white/95" />
      <div className="absolute bottom-[28%] left-1/2 h-[10px] w-[28px] -translate-x-1/2 rounded-full border-[3px] border-white/95 border-t-transparent" />
    </div>
  );
}

function useAcrylic(
  alpha = 130,
  tint: { r: number; g: number; b: number } = { r: 245, g: 246, b: 250 },
) {
  const [focused, setFocused] = useState(true);

  useEffect(() => {
    void invoke("apply_window_acrylic", {
      alpha,
      r: tint.r,
      g: tint.g,
      b: tint.b,
    }).catch((err) => {
      console.warn("apply_window_acrylic failed", err);
    });
  }, [alpha, tint.r, tint.g, tint.b]);

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  return focused;
}

/** 主窗口内浮层（无系统 Acrylic 时的回退） */
export function ConfirmDeleteDialog({
  payload,
  onCancel,
  onConfirm,
}: {
  payload: ConfirmDeletePayload;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const count = Math.max(1, payload.paths.length);
  const title =
    count === 1
      ? `您确定要删除“${payload.names[0] ?? "此项目"}”吗？`
      : `您确定要删除所选择的 ${count} 个项目吗？`;
  const detail =
    count === 1
      ? "此项目将被立即删除。您不能撤销此操作。"
      : `${count} 个项目将被立即删除。您不能撤销此操作。`;

  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/20" />
      <LiquidGlassPanel
        className="relative z-[1] h-[260px] w-[min(400px,100%)]"
        contentClassName="flex h-full min-h-0 w-full flex-col items-center px-6 pb-5 pt-5 text-white"
        radius={22}
        config={{
          refraction: 48,
          frost: 4.5,
          opacity: 0.22,
          aberration: 10,
          bevelDepth: 2,
          tint: 0.18,
          dark: true,
        }}
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        <DialogBody
          title={title}
          detail={detail}
          dragRef={dragRef}
          offset={offset}
          setOffset={setOffset}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      </LiquidGlassPanel>
    </div>
  );
}

function DialogBody({
  title,
  detail,
  dragRef,
  offset,
  setOffset,
  onCancel,
  onConfirm,
  dragWindow,
  tone = "dark",
}: {
  title: string;
  detail: string;
  dragRef: React.MutableRefObject<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>;
  offset: { x: number; y: number };
  setOffset: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  onCancel: () => void;
  onConfirm: () => void;
  /** 独立窗：用系统拖拽；浮层：用 offset */
  dragWindow?: boolean;
  tone?: "light" | "dark";
}) {
  return (
    <>
      <div
        className={`w-full flex-1 ${dragWindow ? "" : "cursor-grab active:cursor-grabbing"}`}
        {...(dragWindow ? { "data-tauri-drag-region": true } : {})}
        onPointerDown={
          dragWindow
            ? undefined
            : (e) => {
                e.stopPropagation();
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                dragRef.current = {
                  pointerId: e.pointerId,
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: offset.x,
                  origY: offset.y,
                };
              }
        }
        onPointerMove={
          dragWindow
            ? undefined
            : (e) => {
                const d = dragRef.current;
                if (!d || d.pointerId !== e.pointerId) return;
                setOffset({
                  x: d.origX + (e.clientX - d.startX),
                  y: d.origY + (e.clientY - d.startY),
                });
              }
        }
        onPointerUp={
          dragWindow
            ? undefined
            : (e) => {
                if (dragRef.current?.pointerId === e.pointerId) {
                  dragRef.current = null;
                }
              }
        }
        onPointerCancel={
          dragWindow
            ? undefined
            : () => {
                dragRef.current = null;
              }
        }
      >
        <FinderMark />
        <h1
          className={`mt-4 text-center text-[15px] font-normal leading-snug tracking-tight ${
            tone === "light" ? "text-[#1d1d1f]" : "text-white"
          }`}
        >
          {title}
        </h1>
        <p
          className={`mt-2 text-center text-[12px] font-normal leading-relaxed ${
            tone === "light" ? "text-[#3a3a3c]" : "text-white/85"
          }`}
        >
          {detail}
        </p>
      </div>

      <div className="mt-5 flex w-full gap-3">
        <button
          type="button"
          className="h-10 flex-1 rounded-full bg-[#0a84ff] text-[14px] font-normal text-white outline-none hover:brightness-110"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="h-10 flex-1 rounded-full bg-[#ff3b30] text-[14px] font-normal text-white outline-none hover:brightness-110"
          onClick={onConfirm}
        >
          删除
        </button>
      </div>
    </>
  );
}

/** 独立透明窗 + Windows Acrylic（亮色磨砂，直角铺满） */
export function ConfirmDeleteWindow({
  payload,
}: {
  payload: ConfirmDeletePayload;
}) {
  const focused = useAcrylic(140, { r: 248, g: 249, b: 252 });
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const count = Math.max(1, payload.paths.length);
  const title =
    count === 1
      ? `您确定要删除“${payload.names[0] ?? "此项目"}”吗？`
      : `您确定要删除所选择的 ${count} 个项目吗？`;
  const detail =
    count === 1
      ? "此项目将被立即删除。您不能撤销此操作。"
      : `${count} 个项目将被立即删除。您不能撤销此操作。`;

  async function close() {
    try {
      await getCurrentWindow().close();
    } catch (err) {
      console.error("close confirm window failed", err);
    }
  }

  async function onConfirm() {
    try {
      await emit("finder-delete-confirmed", { paths: payload.paths });
    } catch (err) {
      console.error("emit delete confirm failed", err);
    }
    await close();
  }

  return (
    <div
      className="flex h-full w-full items-center justify-center p-0"
      style={{
        background: focused ? "transparent" : "rgb(245, 246, 250)",
      }}
    >
      <LiquidGlassPanel
        className="h-full w-full"
        contentClassName="flex h-full min-h-0 w-full flex-col items-center px-6 pb-5 pt-5 text-[#1d1d1f]"
        radius={0}
        config={{
          refraction: 28,
          frost: 2.8,
          opacity: focused ? 0.22 : 0.9,
          aberration: 8,
          bevelDepth: 1.5,
          tint: 0.18,
          dark: false,
        }}
        style={{
          background: focused
            ? "rgba(255, 255, 255, 0.28)"
            : "rgb(245, 246, 250)",
          backdropFilter: "none",
          WebkitBackdropFilter: "none",
          borderRadius: 0,
          border: "none",
          boxShadow: "none",
        }}
      >
        <DialogBody
          title={title}
          detail={detail}
          dragRef={dragRef}
          offset={offset}
          setOffset={setOffset}
          onCancel={() => void close()}
          onConfirm={() => void onConfirm()}
          dragWindow
          tone="light"
        />
      </LiquidGlassPanel>
    </div>
  );
}
