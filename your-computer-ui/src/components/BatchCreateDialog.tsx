import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

export type BatchCreateKind = "file" | "folder";
export type BatchSeqType = "number" | "alpha" | "chinese";

export type BatchCreateResult = {
  kind: BatchCreateKind;
  extension: string;
  count: number;
  baseName: string;
  seqType: BatchSeqType;
  /** 实际用于连接的字符串（空输入已规范为空格） */
  connector: string;
};

type Props = {
  onClose: () => void;
  onSubmit: (result: BatchCreateResult) => void | Promise<void>;
};

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 0 → a … 25 → z，26 → aa，27 → ab … */
export function toAlphaSeq(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

function cnUnder100(n: number, afterUnit: boolean): string {
  if (n < 10) return CN_DIGITS[n];
  if (!afterUnit && n < 20) {
    return n === 10 ? "十" : `十${CN_DIGITS[n % 10]}`;
  }
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  const head = `${CN_DIGITS[tens]}十`;
  return ones === 0 ? head : `${head}${CN_DIGITS[ones]}`;
}

/** 0 → 一，1 → 二 … 支持到数千 */
export function toChineseSeq(index: number): string {
  const n = index + 1;
  if (n <= 0) return CN_DIGITS[0];
  if (n < 100) return cnUnder100(n, false);
  if (n < 1000) {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    if (rest === 0) return `${CN_DIGITS[hundreds]}百`;
    if (rest < 10) return `${CN_DIGITS[hundreds]}百零${CN_DIGITS[rest]}`;
    return `${CN_DIGITS[hundreds]}百${cnUnder100(rest, true)}`;
  }
  const thousands = Math.floor(n / 1000);
  const rest = n % 1000;
  if (rest === 0) return `${CN_DIGITS[thousands]}千`;
  if (rest < 100) {
    return `${CN_DIGITS[thousands]}千零${cnUnder100(rest, true)}`;
  }
  const hundreds = Math.floor(rest / 100);
  const low = rest % 100;
  const mid = `${CN_DIGITS[hundreds]}百`;
  if (low === 0) return `${CN_DIGITS[thousands]}千${mid}`;
  if (low < 10) {
    return `${CN_DIGITS[thousands]}千${mid}零${CN_DIGITS[low]}`;
  }
  return `${CN_DIGITS[thousands]}千${mid}${cnUnder100(low, true)}`;
}

export function seqLabel(
  index: number,
  seqType: BatchSeqType,
): string {
  if (seqType === "alpha") return toAlphaSeq(index);
  if (seqType === "chinese") return toChineseSeq(index);
  return String(index + 1);
}

/** 用户可输入 txt 或 .txt；创建时统一去掉开头的点 */
export function normalizeExtension(raw: string): string {
  const t = raw.trim();
  if (!t) return "txt";
  return t.startsWith(".") ? t.slice(1).trim() || "txt" : t;
}

export function resolveConnector(raw: string): string {
  return raw === "" ? " " : raw;
}

/**
 * 名称 + 连接符 + 序号；文件时扩展名加在最后。
 * 例：未命名 1.txt / 未命名-a / 未命名 一
 */
export function macOsBatchName(
  baseName: string,
  extension: string | null,
  index: number,
  seqType: BatchSeqType = "number",
  connectorRaw = "",
): string {
  const stem = baseName.trim() || (extension ? "未命名" : "未命名文件夹");
  const joiner = resolveConnector(connectorRaw);
  const seq = seqLabel(index, seqType);
  const body = `${stem}${joiner}${seq}`;
  if (extension != null) {
    const ext = normalizeExtension(extension);
    return `${body}.${ext}`;
  }
  return body;
}

export function BatchCreateDialog({ onClose, onSubmit }: Props) {
  const [kind, setKind] = useState<BatchCreateKind>("folder");
  const [extension, setExtension] = useState("txt");
  const [count, setCount] = useState(3);
  const [baseName, setBaseName] = useState("未命名文件夹");
  const [moreOpen, setMoreOpen] = useState(false);
  const [seqType, setSeqType] = useState<BatchSeqType>("number");
  const [connector, setConnector] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    setBaseName((prev) => {
      if (kind === "folder") {
        if (prev === "未命名" || prev === "untitled") return "未命名文件夹";
        return prev;
      }
      if (prev === "未命名文件夹" || prev === "untitled folder") return "未命名";
      return prev;
    });
  }, [kind]);

  const preview = useMemo(() => {
    const n = Math.min(Math.max(1, count || 1), 5);
    const ext = kind === "file" ? extension : null;
    return Array.from({ length: n }, (_, i) =>
      macOsBatchName(baseName, ext, i, seqType, connector),
    );
  }, [kind, extension, count, baseName, seqType, connector]);

  async function submit() {
    const n = Math.floor(Number(count));
    if (!Number.isFinite(n) || n < 1) {
      setError("请输入至少 1 的创建数量");
      return;
    }
    if (n > 500) {
      setError("单次最多创建 500 项");
      return;
    }
    const name = baseName.trim();
    if (!name) {
      setError("名称不能为空");
      return;
    }
    if (/[/\\:*?"<>|]/.test(name)) {
      setError("名称包含非法字符");
      return;
    }
    if (kind === "file") {
      const ext = normalizeExtension(extension);
      if (!ext) {
        setError("请填写文件后缀");
        return;
      }
      if (/[/\\:*?"<>|]/.test(ext)) {
        setError("后缀包含非法字符");
        return;
      }
    }
    if (/[/\\:*?"<>|]/.test(connector)) {
      setError("连接符包含非法字符");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        kind,
        extension: normalizeExtension(extension),
        count: n,
        baseName: name,
        seqType,
        connector: resolveConnector(connector),
      });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/25" />
      <div className="relative z-[1] max-h-[min(90vh,640px)] w-[min(380px,100%)] overflow-y-auto rounded-[14px] border border-black/10 bg-white p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
        <h2 className="mb-3 text-[14px] font-medium text-[#1d1d1f]">批量创建</h2>

        <fieldset className="mb-3">
          <legend className="mb-1.5 text-[12px] text-[var(--finder-text-secondary)]">
            类型
          </legend>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="radio"
                name="batch-kind"
                checked={kind === "folder"}
                onChange={() => setKind("folder")}
              />
              文件夹
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="radio"
                name="batch-kind"
                checked={kind === "file"}
                onChange={() => setKind("file")}
              />
              文件
            </label>
          </div>
        </fieldset>

        {kind === "file" ? (
          <label className="mb-3 block">
            <span className="mb-1.5 block text-[12px] text-[var(--finder-text-secondary)]">
              后缀
            </span>
            <input
              value={extension}
              onChange={(e) => setExtension(e.target.value)}
              className="h-9 w-full rounded-[8px] border border-black/10 px-3 text-[13px] outline-none focus:border-[#0a84ff]"
              placeholder="txt 或 .txt"
            />
            <span className="mt-1 block text-[11px] text-[var(--finder-text-muted)]">
              可直接输入 txt，或以 . 开头如 .txt
            </span>
          </label>
        ) : null}

        <label className="mb-3 block">
          <span className="mb-1.5 block text-[12px] text-[var(--finder-text-secondary)]">
            名称
          </span>
          <input
            ref={nameRef}
            value={baseName}
            onChange={(e) => setBaseName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
              if (e.key === "Escape") onClose();
            }}
            className="h-9 w-full rounded-[8px] border border-black/10 px-3 text-[13px] outline-none focus:border-[#0a84ff]"
            placeholder={kind === "folder" ? "未命名文件夹" : "未命名"}
          />
        </label>

        <label className="mb-3 block">
          <span className="mb-1.5 block text-[12px] text-[var(--finder-text-secondary)]">
            数量
          </span>
          <input
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
            className="h-9 w-full rounded-[8px] border border-black/10 px-3 text-[13px] outline-none focus:border-[#0a84ff]"
          />
        </label>

        <button
          type="button"
          className="mb-3 flex w-full items-center justify-between rounded-[8px] px-1 py-1.5 text-left text-[13px] text-[var(--finder-accent)] hover:bg-black/[0.03]"
          onClick={() => setMoreOpen((v) => !v)}
        >
          <span>更多</span>
          {moreOpen ? (
            <ChevronUp className="size-4" strokeWidth={2} />
          ) : (
            <ChevronDown className="size-4" strokeWidth={2} />
          )}
        </button>

        {moreOpen ? (
          <div className="mb-3 space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-[12px] text-[var(--finder-text-secondary)]">
                后缀类型
              </span>
              <select
                value={seqType}
                onChange={(e) => setSeqType(e.target.value as BatchSeqType)}
                className="h-9 w-full rounded-[8px] border border-black/10 bg-white px-3 text-[13px] outline-none focus:border-[#0a84ff]"
              >
                <option value="number">数字（1、2、3…）</option>
                <option value="alpha">英文（a…z，之后 aa、ab…）</option>
                <option value="chinese">中文（一、二、三…）</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[12px] text-[var(--finder-text-secondary)]">
                连接符
              </span>
              <input
                value={connector}
                onChange={(e) => setConnector(e.target.value)}
                className="h-9 w-full rounded-[8px] border border-black/10 px-3 text-[13px] outline-none focus:border-[#0a84ff]"
                placeholder="默认空格（不填即为空格）"
              />
              <span className="mt-1 block text-[11px] text-[var(--finder-text-muted)]">
                用于连接名称与序号，例如「-」→ 未命名-1
              </span>
            </label>
          </div>
        ) : null}

        <div className="mb-3 rounded-[8px] bg-[#f5f5f7] px-3 py-2">
          <div className="mb-1 text-[11px] text-[var(--finder-text-secondary)]">
            预览
          </div>
          <ul className="space-y-0.5 text-[12px] text-[var(--finder-text)]">
            {preview.map((name) => (
              <li key={name} className="truncate">
                {name}
              </li>
            ))}
            {count > preview.length ? (
              <li className="text-[var(--finder-text-muted)]">…共 {count} 项</li>
            ) : null}
          </ul>
        </div>

        {error ? (
          <p className="mb-2 text-[12px] text-[#ff3b30]">{error}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="h-9 rounded-full px-4 text-[13px] text-[#1d1d1f] hover:bg-black/5"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            className="h-9 rounded-full bg-[#0a84ff] px-4 text-[13px] text-white disabled:opacity-50"
            onClick={() => void submit()}
          >
            {busy ? "创建中…" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
