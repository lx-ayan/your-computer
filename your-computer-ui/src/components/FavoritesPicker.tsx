import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FolderPlus, Star } from "lucide-react";

export type FavoriteFolder = {
  id: number;
  name: string;
  sortOrder: number;
};

export type FavoritePickTarget = {
  path: string;
  name: string;
  kind: string;
  kindLabel: string;
};

type Props = {
  target: FavoritePickTarget;
  onClose: () => void;
  onSaved: () => void;
};

export function FavoritesPicker({ target, onClose, onSaved }: Props) {
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void invoke<FavoriteFolder[]>("list_favorite_folders")
      .then((list) => {
        setFolders(list);
        setSelectedId(list[0]?.id ?? null);
      })
      .catch((err) => {
        console.error(err);
        setError("无法加载收藏夹");
      });
  }, []);

  async function createFolder() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const folder = await invoke<FavoriteFolder>("create_favorite_folder", {
        name,
      });
      setFolders((prev) => [...prev, folder]);
      setSelectedId(folder.id);
      setCreating(false);
      setNewName("");
    } catch (err) {
      console.error(err);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (selectedId == null) {
      setError("请选择收藏夹");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await invoke("add_favorite", {
        folderId: selectedId,
        path: target.path,
        name: target.name,
        kind: target.kind,
        kindLabel: target.kindLabel,
      });
      onSaved();
      onClose();
    } catch (err) {
      console.error(err);
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/25" />
      <div className="relative z-[1] w-[min(360px,100%)] rounded-[14px] border border-black/10 bg-white p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
        <div className="mb-3 flex items-center gap-2 text-[14px] font-normal text-[#1d1d1f]">
          <Star className="size-4 text-[#f5a524]" strokeWidth={2} />
          <span>添加到收藏</span>
        </div>
        <p className="mb-3 truncate text-[12px] text-[#6e6e73]" title={target.path}>
          {target.name}
        </p>

        <div className="mb-3 max-h-[200px] space-y-1 overflow-y-auto rounded-[10px] bg-[#f5f5f7] p-2">
          {folders.length === 0 ? (
            <div className="px-2 py-3 text-center text-[12px] text-[#6e6e73]">
              暂无收藏夹
            </div>
          ) : (
            folders.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`flex w-full items-center rounded-[8px] px-3 py-2 text-left text-[13px] ${
                  selectedId === f.id
                    ? "bg-[#0a84ff] text-white"
                    : "text-[#1d1d1f] hover:bg-black/5"
                }`}
                onClick={() => setSelectedId(f.id)}
              >
                {f.name}
              </button>
            ))
          )}
        </div>

        {creating ? (
          <div className="mb-3 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void createFolder();
                if (e.key === "Escape") {
                  setCreating(false);
                  setNewName("");
                }
              }}
              placeholder="新收藏夹名称"
              className="h-9 min-w-0 flex-1 rounded-[8px] border border-black/10 px-3 text-[13px] outline-none focus:border-[#0a84ff]"
              autoFocus
            />
            <button
              type="button"
              disabled={busy}
              className="h-9 rounded-[8px] bg-[#0a84ff] px-3 text-[13px] font-normal text-white disabled:opacity-50"
              onClick={() => void createFolder()}
            >
              创建
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="mb-3 flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left text-[13px] text-[#0a84ff] hover:bg-[#0a84ff]/8"
            onClick={() => setCreating(true)}
          >
            <FolderPlus className="size-4" strokeWidth={2} />
            新建收藏夹
          </button>
        )}

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
            disabled={busy || selectedId == null}
            className="h-9 rounded-full bg-[#0a84ff] px-4 text-[13px] font-normal text-white disabled:opacity-50"
            onClick={() => void confirm()}
          >
            收藏
          </button>
        </div>
      </div>
    </div>
  );
}
