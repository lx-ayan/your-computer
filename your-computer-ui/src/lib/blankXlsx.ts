import * as XLSX from "xlsx";

/** 把 SheetJS 写出结果规范成独立 ArrayBuffer（浏览器里 type:"array" 直接就是 ArrayBuffer） */
function toStandaloneArrayBuffer(
  data: ArrayBuffer | ArrayBufferView | number[],
): ArrayBuffer {
  const u8 =
    data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : Uint8Array.from(data);
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy.buffer;
}

/** 生成空白工作簿 ArrayBuffer（含一张 Sheet1） */
export function createBlankXlsxBuffer(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  // 给一点可见区域，避免完全空 sheet 渲染异常
  const rows: string[][] = Array.from({ length: 40 }, () =>
    Array.from({ length: 12 }, () => ""),
  );
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const out = XLSX.write(wb, {
    bookType: "xlsx",
    type: "array",
  });
  const buf = toStandaloneArrayBuffer(out as ArrayBuffer | number[]);
  const head = new Uint8Array(buf, 0, 2);
  if (buf.byteLength < 4 || head[0] !== 0x50 || head[1] !== 0x4b) {
    throw new Error("生成空白表格失败：无效 ZIP 头");
  }
  return buf;
}

/** 把二维表写成 xlsx ArrayBuffer */
export function aoaToXlsxBuffer(rows: string[][], sheetName = "Sheet1"): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  return toStandaloneArrayBuffer(out as ArrayBuffer | number[]);
}

/** 尽量从 xlsx 读出首张表为字符串二维数组；失败则返回空网格 */
export function xlsxBufferToAoa(
  buf: ArrayBuffer,
  rows = 40,
  cols = 12,
): string[][] {
  try {
    const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
    const name = wb.SheetNames[0];
    if (!name) throw new Error("无工作表");
    const ws = wb.Sheets[name];
    const aoa = XLSX.utils.sheet_to_json<string[]>(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as string[][];
    const out: string[][] = Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => {
        const row = aoa[r];
        const v = row?.[c];
        return v == null ? "" : String(v);
      }),
    );
    return out;
  } catch {
    return Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ""),
    );
  }
}
