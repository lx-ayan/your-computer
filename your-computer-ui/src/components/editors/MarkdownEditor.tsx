import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import MDEditor from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
import { EditorShell, fileNameFromPath } from "./EditorShell";

type Props = { path: string | null };

export function MarkdownEditor({ path }: Props) {
  const [value, setValue] = useState("");
  const [saved, setSaved] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    if (!path) {
      setValue("");
      setSaved("");
      setHint(null);
      setLoading(false);
      return;
    }
    void invoke<string>("read_text_file", { path })
      .then((text) => {
        if (cancelled) return;
        setValue(text);
        setSaved(text);
        setHint(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setValue("");
        setSaved("");
        setHint(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  async function onSave() {
    if (!path) {
      setHint("请先另存为文件");
      return;
    }
    setSaving(true);
    setHint(null);
    try {
      await invoke("write_text_file", { path, content: value });
      setSaved(value);
      setHint("已保存");
    } catch (err) {
      setHint(String(err));
    } finally {
      setSaving(false);
    }
  }

  const dirty = value !== saved;
  const title = `VMarkdown · ${path ? fileNameFromPath(path) : "未命名.md"}`;

  return (
    <EditorShell
      title={title}
      dirty={dirty}
      saving={saving}
      hint={loading ? "加载中…" : hint}
      onSave={() => void onSave()}
    >
      <div className="h-full w-full" data-color-mode="light">
        {loading ? (
          <div className="flex h-full items-center justify-center text-[13px] text-[#6e6e73]">
            加载中…
          </div>
        ) : (
          <MDEditor
            value={value}
            onChange={(v) => setValue(v ?? "")}
            height="100%"
            visibleDragbar={false}
            preview="live"
          />
        )}
      </div>
    </EditorShell>
  );
}
