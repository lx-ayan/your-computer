import { useEffect, useRef, useState } from "react";

type Props = {
  mode: "create" | "rename";
  initialName?: string;
  onClose: () => void;
  onSubmit: (name: string) => void | Promise<void>;
};

export function FavoritesFolderDialog({
  mode,
  initialName = "",
  onClose,
  onSubmit,
}: Props) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  async function submit() {
    const next = name.trim();
    if (!next) {
      setError("名称不能为空");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(next);
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
      <div className="relative z-[1] w-[min(320px,100%)] rounded-[14px] border border-black/10 bg-white p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
        <h2 className="mb-3 text-[14px] font-normal text-[#1d1d1f]">
          {mode === "create" ? "新建收藏夹" : "重新命名收藏夹"}
        </h2>
        <input
          ref={inputRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
            if (e.key === "Escape") onClose();
          }}
          placeholder="收藏夹名称"
          className="mb-2 h-9 w-full rounded-[8px] border border-black/10 px-3 text-[13px] outline-none focus:border-[#0a84ff]"
        />
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
            className="h-9 rounded-full bg-[#0a84ff] px-4 text-[13px] font-normal text-white disabled:opacity-50"
            onClick={() => void submit()}
          >
            {mode === "create" ? "创建" : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
