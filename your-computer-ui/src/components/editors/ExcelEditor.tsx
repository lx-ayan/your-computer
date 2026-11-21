import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  aoaToXlsxBuffer,
  createBlankXlsxBuffer,
  xlsxBufferToAoa,
} from "../../lib/blankXlsx";
import { readLocalArrayBuffer, uint8ToBase64 } from "../../lib/localFile";
import { EditorShell, fileNameFromPath } from "./EditorShell";

type Props = { path: string | null };

const ROWS = 40;
const COLS = 12;

function colLabel(i: number): string {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

function looksLikeZip(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 4) return false;
  const u = new Uint8Array(buf);
  return u[0] === 0x50 && u[1] === 0x4b;
}

function emptyGrid(): string[][] {
  return Array.from({ length: ROWS }, () =>
    Array.from({ length: COLS }, () => ""),
  );
}

function SimpleSheet({
  data,
  onChange,
}: {
  data: string[][];
  onChange: (next: string[][]) => void;
}) {
  const tableRef = useRef<HTMLTableElement>(null);

  const setCell = (r: number, c: number, value: string) => {
    const next = data.map((row, ri) =>
      ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row.slice(),
    );
    onChange(next);
  };

  return (
    <div className="h-full w-full overflow-auto bg-white">
      <table
        ref={tableRef}
        className="border-collapse text-[12px] leading-none text-[#1d1d1f]"
      >
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-20 h-7 min-w-10 border border-[#e5e5ea] bg-[#f5f5f7] font-medium text-[#6e6e73]" />
            {Array.from({ length: COLS }, (_, c) => (
              <th
                key={c}
                className="sticky top-0 z-10 h-7 min-w-[96px] border border-[#e5e5ea] bg-[#f5f5f7] px-1 text-center font-medium text-[#6e6e73]"
              >
                {colLabel(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, r) => (
            <tr key={r}>
              <th className="sticky left-0 z-10 h-7 min-w-10 border border-[#e5e5ea] bg-[#f5f5f7] text-center font-medium text-[#6e6e73]">
                {r + 1}
              </th>
              {row.map((cell, c) => (
                <td key={c} className="h-7 min-w-[96px] border border-[#e5e5ea] p-0">
                  <input
                    className="box-border h-7 w-full min-w-[96px] bg-transparent px-1.5 outline-none focus:bg-[#0a84ff]/[0.08]"
                    value={cell}
                    onChange={(e) => setCell(r, c, e.target.value)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ExcelEditor({ path }: Props) {
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileName = useMemo(
    () => (path ? fileNameFromPath(path) : "未命名.xlsx"),
    [path],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHint(null);
    void (async () => {
      try {
        let usedBlank = false;
        let aoa = emptyGrid();
        if (!path) {
          usedBlank = true;
          createBlankXlsxBuffer();
          aoa = emptyGrid();
        } else {
          try {
            const raw = await readLocalArrayBuffer(path);
            if (raw.byteLength > 0 && looksLikeZip(raw)) {
              aoa = xlsxBufferToAoa(raw, ROWS, COLS);
            } else {
              usedBlank = true;
              createBlankXlsxBuffer();
              aoa = emptyGrid();
            }
          } catch {
            usedBlank = true;
            aoa = emptyGrid();
          }
        }
        if (cancelled) return;
        setGrid(aoa);
        setDirty(usedBlank);
        if (usedBlank) setHint("空表格，可直接编辑后保存");
      } catch (err) {
        if (cancelled) return;
        console.error("Excel load failed", err);
        setGrid(emptyGrid());
        setDirty(true);
        setHint("已打开空白表格");
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  const onSave = useCallback(() => {
    if (!grid) return;
    if (!path) {
      setHint("请先另存为文件");
      return;
    }
    setSaving(true);
    try {
      const buf = aoaToXlsxBuffer(grid);
      const bytes = new Uint8Array(buf);
      void invoke("write_file_base64", {
        path,
        dataBase64: uint8ToBase64(bytes),
      })
        .then(() => {
          setDirty(false);
          setHint("已保存");
          setError(null);
        })
        .catch((e) => setHint(`保存失败: ${String(e)}`))
        .finally(() => setSaving(false));
    } catch (e) {
      setHint(`保存失败: ${String(e)}`);
      setSaving(false);
    }
  }, [grid, path]);

  const title = `VExcel · ${fileName}`;

  return (
    <EditorShell
      title={title}
      dirty={dirty}
      saving={saving}
      hint={loading ? "加载中…" : hint}
      onSave={onSave}
    >
      {loading ? (
        <div className="flex h-full items-center justify-center text-[13px] text-[#6e6e73]">
          加载中…
        </div>
      ) : grid ? (
        <SimpleSheet
          data={grid}
          onChange={(next) => {
            setGrid(next);
            setDirty(true);
            if (hint) setHint(null);
          }}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[13px] text-[#6e6e73]">
          <div>无法打开该表格文件</div>
          {error ? (
            <div className="max-w-[480px] break-all text-[#ff3b30]">{error}</div>
          ) : null}
        </div>
      )}
    </EditorShell>
  );
}
