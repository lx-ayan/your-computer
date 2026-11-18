import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  File,
  FileText,
  Folder,
  HardDrive,
  Image as ImageIcon,
} from "lucide-react";

export type ItemInfo = {
  name: string;
  path: string;
  isDir: boolean;
  kind: string;
  kindLabel: string;
  sizeBytes: number;
  sizeOnDiskBytes: number;
  sizeLabel: string;
  itemCount: number | null;
  location: string;
  createdAt: string;
  modifiedAt: string;
  accessedAt: string;
  readonly: boolean;
  hidden: boolean;
};

function shortSize(bytes: number): string {
  const units = ["字节", "KB", "MB", "GB", "TB"];
  if (bytes < 1024) return `${bytes} 字节`;
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const n = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return `${n} ${units[i]}`;
}

function modifiedHint(modifiedAt: string): string {
  if (!modifiedAt || modifiedAt === "--") return "修改时间：--";
  const m = modifiedAt.match(/(\d{1,2}:\d{2})$/);
  if (m) return `修改时间：今天 ${m[1]}`;
  return `修改时间：${modifiedAt}`;
}

function InfoGlyph({ kind }: { kind: string }) {
  const className = "size-14 text-[var(--finder-accent)]";
  switch (kind) {
    case "folder":
      return <Folder className={className} strokeWidth={1.25} />;
    case "image":
      return <ImageIcon className={className} strokeWidth={1.25} />;
    case "document":
      return <FileText className={className} strokeWidth={1.25} />;
    case "disk":
      return <HardDrive className={className} strokeWidth={1.25} />;
    default:
      return <File className={className} strokeWidth={1.25} />;
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 py-[3px] text-[12px] leading-[16px]">
      <span className="text-right text-[var(--finder-text-secondary)]">
        {label}：
      </span>
      <span className="min-w-0 break-words text-[var(--finder-text)]">
        {value}
      </span>
    </div>
  );
}

export function GetInfoWindow({ path }: { path: string }) {
  const [info, setInfo] = useState<ItemInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readonly, setReadonly] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<ItemInfo>("get_item_info", { path })
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        setReadonly(data.readonly);
        setHidden(data.hidden);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const title = info ? `“${info.name}” 简介` : "简介";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-[12px] bg-[#f2f2f2] text-[var(--finder-text)] shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
      <header
        className="flex h-[44px] shrink-0 items-center gap-3 border-b border-black/8 bg-[#ececec] px-3"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-[7px]">
          <button
            type="button"
            aria-label="关闭"
            className="size-[12px] rounded-full bg-[var(--finder-traffic-close)]"
            onClick={() => void getCurrentWindow().close()}
          />
          <button
            type="button"
            aria-label="最小化"
            className="size-[12px] rounded-full bg-[var(--finder-traffic-minimize)]"
            onClick={() => void getCurrentWindow().minimize()}
          />
          <button
            type="button"
            aria-label="最大化"
            className="size-[12px] rounded-full bg-[var(--finder-traffic-maximize)]"
            onClick={() => void getCurrentWindow().toggleMaximize()}
          />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 pr-10">
          {info?.isDir ? (
            <Folder className="size-3.5 text-[var(--finder-accent)]" />
          ) : (
            <File className="size-3.5 text-[var(--finder-icon)]" />
          )}
          <span className="truncate text-[13px] font-medium">{title}</span>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto bg-white">
        {error ? (
          <p className="px-4 py-8 text-center text-[13px] text-red-500">
            {error}
          </p>
        ) : !info ? (
          <p className="px-4 py-8 text-center text-[13px] text-[var(--finder-text-muted)]">
            正在读取属性…
          </p>
        ) : (
          <>
            <div className="flex items-start gap-3 px-4 pt-4 pb-3">
              <div className="flex size-[72px] shrink-0 items-center justify-center rounded-[12px] bg-[#f4f5f5]">
                <InfoGlyph kind={info.kind} />
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-start justify-between gap-2">
                  <h1 className="truncate text-[15px] font-semibold">
                    {info.name}
                  </h1>
                  <span className="shrink-0 text-[12px] text-[var(--finder-text-secondary)]">
                    {shortSize(info.sizeBytes)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--finder-text-secondary)]">
                  {modifiedHint(info.modifiedAt)}
                </p>
                <div className="mt-2 flex items-center gap-4 text-[12px]">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={readonly}
                      onChange={(e) => setReadonly(e.target.checked)}
                    />
                    只读
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={hidden}
                      onChange={(e) => setHidden(e.target.checked)}
                    />
                    隐藏
                  </label>
                </div>
              </div>
            </div>

            <section className="border-t border-black/10 px-4 py-3">
              <Row label="种类" value={info.kindLabel} />
              <Row label="大小" value={info.sizeLabel} />
              <Row label="位置" value={info.location} />
              <Row label="创建时间" value={info.createdAt} />
              <Row label="修改时间" value={info.modifiedAt} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
