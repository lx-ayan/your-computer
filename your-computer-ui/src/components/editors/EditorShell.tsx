import { getCurrentWindow } from "@tauri-apps/api/window";
import type { ReactNode } from "react";

type Props = {
  title: string;
  dirty?: boolean;
  saving?: boolean;
  hint?: string | null;
  onSave?: () => void;
  children: ReactNode;
};

export function EditorShell({
  title,
  dirty,
  saving,
  hint,
  onSave,
  children,
}: Props) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#f5f5f7] text-[#1d1d1f]">
      <div
        className="flex h-11 shrink-0 items-center gap-3 border-b border-black/[0.06] bg-white/90 px-3"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2" data-tauri-drag-region="false">
          <button
            type="button"
            aria-label="关闭"
            className="size-[12px] rounded-full bg-[#ff5f57] outline-none hover:brightness-95"
            onClick={() => void getCurrentWindow().close()}
          />
          <button
            type="button"
            aria-label="最小化"
            className="size-[12px] rounded-full bg-[#febc2e] outline-none hover:brightness-95"
            onClick={() => void getCurrentWindow().minimize()}
          />
          <button
            type="button"
            aria-label="最大化"
            className="size-[12px] rounded-full bg-[#28c840] outline-none hover:brightness-95"
            onClick={() => void getCurrentWindow().toggleMaximize()}
          />
        </div>
        <div className="min-w-0 flex-1 truncate text-center text-[13px] font-medium">
          {title}
          {dirty ? " •" : ""}
        </div>
        <div className="flex items-center gap-2" data-tauri-drag-region="false">
          {hint ? (
            <span className="max-w-[160px] truncate text-[11px] text-[#6e6e73]">
              {hint}
            </span>
          ) : null}
          {onSave ? (
            <button
              type="button"
              disabled={saving || !dirty}
              className="rounded-[6px] bg-[#0a84ff] px-3 py-1 text-[12px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onSave}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function fileNameFromPath(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;
}
