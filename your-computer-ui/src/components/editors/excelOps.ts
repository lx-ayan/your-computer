import type { WorkbookInstance } from "@fortune-sheet/react";
import type { Cell, CellWithRowAndCol, Sheet } from "@fortune-sheet/core";
import ExcelJS from "exceljs";
import { invoke } from "@tauri-apps/api/core";
import { showAlert } from "../../lib/appDialog";

export type FortuneWorkbook = WorkbookInstance;
export type FortuneSheetData = Sheet[];

export type BorderKind =
  | "all"
  | "outside"
  | "inside"
  | "bottom"
  | "top"
  | "left"
  | "right"
  | "none";

type Sel = { row: number[]; column: number[] };

/** Ribbon 点击时 getSelection() 经常滞后一格，用选区钩子缓存为准 */
let cachedSelection: Sel[] | null = null;

function cloneSels(sels: Sel[]): Sel[] {
  return sels.map((s) => ({
    row: [s.row[0], s.row[1]] as number[],
    column: [s.column[0], s.column[1]] as number[],
  }));
}

export function rememberSelection(
  sels:
    | Sel[]
    | { row: number[]; column: number[] }
    | null
    | undefined,
) {
  if (!sels) return;
  const list = Array.isArray(sels) ? sels : [sels];
  if (!list.length) return;
  const normalized: Sel[] = [];
  for (const s of list) {
    if (!s?.row || !s?.column) continue;
    const r0 = s.row[0] ?? 0;
    const r1 = s.row[1] ?? r0;
    const c0 = s.column[0] ?? 0;
    const c1 = s.column[1] ?? c0;
    normalized.push({ row: [r0, r1], column: [c0, c1] });
  }
  if (normalized.length) cachedSelection = normalized;
}

export function clearSelectionCache() {
  cachedSelection = null;
}

export function blankSheets(): FortuneSheetData {
  return [
    {
      name: "Sheet1",
      celldata: [],
      row: 84,
      column: 26,
      status: 1,
      order: 0,
    },
  ];
}

function selectionRanges(_wb: FortuneWorkbook): Sel[] {
  // 优先缓存：菜单/工具栏点击时 API 选区往往还是「上一格」
  if (cachedSelection?.length) return cloneSels(cachedSelection);
  const sels = _wb.getSelection();
  if (sels?.length) {
    rememberSelection(sels);
    return cloneSels(sels);
  }
  return [{ row: [0, 0], column: [0, 0] }];
}

function colLabel(c: number): string {
  let n = c;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export function readActiveCell(wb: FortuneWorkbook): {
  addr: string;
  text: string;
  row: number;
  col: number;
} {
  const sel = selectionRanges(wb)[0];
  const row = sel.row[0] ?? 0;
  const col = sel.column[0] ?? 0;
  const formula = wb.getCellValue(row, col, { type: "f" });
  const text =
    formula != null && String(formula) !== ""
      ? String(formula).startsWith("=")
        ? String(formula)
        : `=${formula}`
      : (() => {
          const m = wb.getCellValue(row, col, { type: "m" });
          if (m != null && String(m) !== "") return String(m);
          const v = wb.getCellValue(row, col);
          return v == null ? "" : String(v);
        })();
  return { addr: `${colLabel(col)}${row + 1}`, text, row, col };
}

export function writeCellText(
  wb: FortuneWorkbook,
  row: number,
  col: number,
  text: string,
) {
  const t = text.trim();
  if (t === "") {
    wb.clearCell(row, col);
    return;
  }
  if (t.startsWith("=")) {
    wb.setCellValue(row, col, t);
    return;
  }
  const n = Number(t);
  if (Number.isFinite(n) && String(n) === t) wb.setCellValue(row, col, n);
  else wb.setCellValue(row, col, text);
}

export function clearSelection(wb: FortuneWorkbook) {
  for (const s of selectionRanges(wb)) {
    for (let r = s.row[0]; r <= s.row[1]; r++) {
      for (let c = s.column[0]; c <= s.column[1]; c++) {
        wb.clearCell(r, c);
      }
    }
  }
}

export function patchFont(
  wb: FortuneWorkbook,
  patch: {
    fontFamily?: string;
    fontSize?: number;
    bold?: "toggle" | boolean;
    italic?: "toggle" | boolean;
    underline?: "toggle" | boolean;
    strikethrough?: "toggle" | boolean;
  },
) {
  for (const s of selectionRanges(wb)) {
    const range = { row: s.row, column: s.column };
    const r0 = s.row[0];
    const c0 = s.column[0];
    if (patch.fontFamily != null) {
      wb.setCellFormatByRange("ff", patch.fontFamily, range);
    }
    if (patch.fontSize != null) {
      wb.setCellFormatByRange("fs", patch.fontSize, range);
    }
    if (patch.bold != null) {
      const cur = Number(wb.getCellValue(r0, c0, { type: "bl" }) || 0);
      const next =
        patch.bold === "toggle" ? (cur ? 0 : 1) : patch.bold ? 1 : 0;
      wb.setCellFormatByRange("bl", next, range);
    }
    if (patch.italic != null) {
      const cur = Number(wb.getCellValue(r0, c0, { type: "it" }) || 0);
      const next =
        patch.italic === "toggle" ? (cur ? 0 : 1) : patch.italic ? 1 : 0;
      wb.setCellFormatByRange("it", next, range);
    }
    if (patch.underline != null) {
      const cur = Number(wb.getCellValue(r0, c0, { type: "un" }) || 0);
      const next =
        patch.underline === "toggle" ? (cur ? 0 : 1) : patch.underline ? 1 : 0;
      wb.setCellFormatByRange("un", next, range);
    }
    if (patch.strikethrough != null) {
      const cur = Number(wb.getCellValue(r0, c0, { type: "cl" }) || 0);
      const next =
        patch.strikethrough === "toggle"
          ? cur
            ? 0
            : 1
          : patch.strikethrough
            ? 1
            : 0;
      wb.setCellFormatByRange("cl", next, range);
    }
  }
}

export function setForeColor(wb: FortuneWorkbook, color: string) {
  for (const s of selectionRanges(wb)) {
    wb.setCellFormatByRange("fc", color, {
      row: s.row,
      column: s.column,
    });
  }
}

export function setBackColor(wb: FortuneWorkbook, color: string) {
  for (const s of selectionRanges(wb)) {
    wb.setCellFormatByRange("bg", color, {
      row: s.row,
      column: s.column,
    });
  }
}

export function setHAlign(
  wb: FortuneWorkbook,
  align: "left" | "center" | "right" | "justify",
) {
  const map = { left: 1, center: 0, right: 2, justify: 3 } as const;
  for (const s of selectionRanges(wb)) {
    wb.setCellFormatByRange("ht", map[align], {
      row: s.row,
      column: s.column,
    });
  }
}

export function setVAlign(
  wb: FortuneWorkbook,
  align: "top" | "middle" | "bottom",
) {
  const map = { top: 1, middle: 0, bottom: 2 } as const;
  for (const s of selectionRanges(wb)) {
    wb.setCellFormatByRange("vt", map[align], {
      row: s.row,
      column: s.column,
    });
  }
}

export function setVAlignMiddle(wb: FortuneWorkbook) {
  setVAlign(wb, "middle");
}

export function toggleWrap(wb: FortuneWorkbook) {
  for (const s of selectionRanges(wb)) {
    const cur = String(
      wb.getCellValue(s.row[0], s.column[0], { type: "tb" }) ?? "0",
    );
    wb.setCellFormatByRange("tb", cur === "2" ? "0" : "2", {
      row: s.row,
      column: s.column,
    });
  }
}

export function setWrap(wb: FortuneWorkbook, wrap: boolean) {
  for (const s of selectionRanges(wb)) {
    wb.setCellFormatByRange("tb", wrap ? "2" : "0", {
      row: s.row,
      column: s.column,
    });
  }
}

export function mergeSelection(wb: FortuneWorkbook) {
  const sels = selectionRanges(wb);
  wb.mergeCells(sels, "merge-all");
}

export function mergeAndCenter(wb: FortuneWorkbook) {
  mergeSelection(wb);
  setHAlign(wb, "center");
  setVAlign(wb, "middle");
}

/** 清除样式，保留值/公式 */
export function clearFormat(wb: FortuneWorkbook) {
  const styleAttrs = [
    "bg",
    "fc",
    "bl",
    "it",
    "un",
    "cl",
    "ff",
    "fs",
    "ht",
    "vt",
    "tb",
    "tr",
  ] as const;
  for (const s of selectionRanges(wb)) {
    const range = { row: s.row, column: s.column };
    for (const attr of styleAttrs) {
      wb.setCellFormatByRange(attr, null as unknown as never, range);
    }
    wb.setCellFormatByRange("ct", { fa: "General", t: "g" }, range);
  }
}

export function changeDecimalPlaces(wb: FortuneWorkbook, delta: number) {
  for (const s of selectionRanges(wb)) {
    for (let r = s.row[0]; r <= s.row[1]; r++) {
      for (let c = s.column[0]; c <= s.column[1]; c++) {
        const ct = (wb.getCellValue(r, c, { type: "ct" }) as {
          fa?: string;
          t?: string;
        } | null) ?? { fa: "General", t: "n" };
        let fa = ct.fa || "General";
        let decimals = 0;
        const m = fa.match(/0\.(0+)/);
        if (m) decimals = m[1].length;
        else if (fa === "General" || fa === "0") decimals = 0;
        else if (fa.includes("%")) {
          const pm = fa.match(/0\.(0+)%/);
          decimals = pm ? pm[1].length : 0;
        }
        decimals = Math.max(0, Math.min(10, decimals + delta));
        const isPercent = fa.includes("%");
        const isComma = fa.includes("#,##0");
        if (isPercent) {
          fa = decimals > 0 ? `0.${"0".repeat(decimals)}%` : "0%";
        } else if (isComma || fa.includes("#,##")) {
          fa =
            decimals > 0 ? `#,##0.${"0".repeat(decimals)}` : "#,##0";
        } else {
          fa = decimals > 0 ? `0.${"0".repeat(decimals)}` : "0";
        }
        wb.setCellFormat(r, c, "ct", { fa, t: "n" });
      }
    }
  }
}

export function convertSelection(
  wb: FortuneWorkbook,
  to: "number" | "text",
) {
  for (const s of selectionRanges(wb)) {
    for (let r = s.row[0]; r <= s.row[1]; r++) {
      for (let c = s.column[0]; c <= s.column[1]; c++) {
        const raw = wb.getCellValue(r, c);
        if (raw == null || raw === "") continue;
        if (to === "number") {
          const n = Number(String(raw).replace(/,/g, "").replace(/%$/, ""));
          if (Number.isFinite(n)) {
            wb.setCellValue(r, c, n);
            wb.setCellFormat(r, c, "ct", { fa: "General", t: "n" });
          }
        } else {
          wb.setCellValue(r, c, String(raw));
          wb.setCellFormat(r, c, "ct", { fa: "@", t: "s" });
        }
      }
    }
  }
}

export function fillSelection(
  wb: FortuneWorkbook,
  direction: "up" | "down" | "left" | "right",
) {
  const s = selectionRanges(wb)[0];
  if (!s) return;
  const [r0, r1] = s.row;
  const [c0, c1] = s.column;
  if (direction === "down") {
    if (r1 <= r0) return;
    wb.autoFillCell(
      { row: [r0, r0], column: [c0, c1] },
      { row: [r0 + 1, r1], column: [c0, c1] },
      "down",
    );
  } else if (direction === "up") {
    if (r1 <= r0) return;
    wb.autoFillCell(
      { row: [r1, r1], column: [c0, c1] },
      { row: [r0, r1 - 1], column: [c0, c1] },
      "up",
    );
  } else if (direction === "right") {
    if (c1 <= c0) return;
    wb.autoFillCell(
      { row: [r0, r1], column: [c0, c0] },
      { row: [r0, r1], column: [c0 + 1, c1] },
      "right",
    );
  } else {
    if (c1 <= c0) return;
    wb.autoFillCell(
      { row: [r0, r1], column: [c1, c1] },
      { row: [r0, r1], column: [c0, c1 - 1] },
      "left",
    );
  }
}

/** 单格时沿当前行扩到连续非空列（对齐 FortuneSheet createFilter） */
function resolveFilterRange(wb: FortuneWorkbook, sel: Sel): {
  row: [number, number];
  column: [number, number];
} {
  const r0 = Number(sel.row[0]) || 0;
  const r1 = Number(sel.row[1] ?? sel.row[0]) || r0;
  const c0 = Number(sel.column[0]) || 0;
  const c1 = Number(sel.column[1] ?? sel.column[0]) || c0;
  if (r0 !== r1 || c0 !== c1) {
    return { row: [r0, r1], column: [c0, c1] };
  }
  const sheet =
    wb.getAllSheets().find((s) => s.status === 1) ?? wb.getAllSheets()[0];
  const matrix = sheet?.data;
  const row = matrix?.[r0];
  if (!row) return { row: [r0, r0], column: [c0, c0] };
  let st: number | null = null;
  let ed = row.length - 1;
  for (let c = 0; c < row.length; c += 1) {
    const cell = row[c];
    const empty = cell == null || (cell.v == null && cell.m == null && !cell.f);
    if (!empty) {
      if (st == null) st = c;
    } else if (st != null) {
      ed = c - 1;
      break;
    }
  }
  return { row: [r0, r0], column: [st ?? c0, ed] };
}

function activeSheetMeta(wb: FortuneWorkbook) {
  const sheets = wb.getAllSheets();
  const active =
    sheets.find((s) => s.status === 1) ??
    sheets.find((s) => s.order === 0) ??
    sheets[0];
  return { sheets, active, id: active?.id as string | undefined };
}

function sheetHasFilter(active: Sheet | undefined) {
  if (!active) return false;
  return (
    active.filter_select != null ||
    (active.filter != null && Object.keys(active.filter).length > 0)
  );
}

/** 全部显示：清除筛选并恢复隐藏行 */
export function clearFilter(wb: FortuneWorkbook) {
  try {
    const { active, id } = activeSheetMeta(wb);
    if (!id || !sheetHasFilter(active)) return;
    const filter = active!.filter as
      | Record<string, { rowhidden?: Record<string, number> }>
      | undefined;
    if (filter) {
      const hidden = new Set<string>();
      for (const entry of Object.values(filter)) {
        if (!entry?.rowhidden) continue;
        for (const r of Object.keys(entry.rowhidden)) hidden.add(r);
      }
      if (hidden.size) wb.showRowOrColumn([...hidden], "row");
    }
    wb.applyOp([
      { op: "replace", id, path: ["filter_select"], value: undefined },
      { op: "replace", id, path: ["filter"], value: undefined },
    ]);
  } catch (err) {
    console.error("clearFilter failed", err);
  }
}

/**
 * 筛选开关。
 * 禁止 setSelection / updateSheet：前者会对冻结的 selection.row 赋值白屏，
 * 后者会用陈旧 sheet 快照整表覆盖。只通过 applyOp 写 filter_select。
 */
export function toggleFilter(wb: FortuneWorkbook) {
  try {
    const { active, id } = activeSheetMeta(wb);
    if (!id) return;

    if (sheetHasFilter(active)) {
      clearFilter(wb);
      return;
    }

    const filterSelect = resolveFilterRange(wb, selectionRanges(wb)[0]);
    wb.applyOp([
      { op: "replace", id, path: ["filter_select"], value: filterSelect },
      { op: "replace", id, path: ["filter"], value: {} },
    ]);
  } catch (err) {
    console.error("toggleFilter failed", err);
  }
}

function cellKey(v: unknown): string {
  if (v == null || v === "") return "";
  return String(v);
}

/** 删除选区中的重复行（按整行内容判重，保留首次出现） */
export function removeDuplicateRows(wb: FortuneWorkbook): number {
  const s = selectionRanges(wb)[0];
  if (!s) return 0;
  const [r0, r1] = s.row;
  const [c0, c1] = s.column;
  if (r1 <= r0) return 0;

  const seen = new Set<string>();
  const kept: unknown[][] = [];
  for (let r = r0; r <= r1; r++) {
    const row: unknown[] = [];
    for (let c = c0; c <= c1; c++) row.push(wb.getCellValue(r, c) ?? "");
    const key = row.map(cellKey).join("\u0001");
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
  }
  const removed = r1 - r0 + 1 - kept.length;
  if (removed <= 0) return 0;

  const blankRows = r1 - r0 + 1 - kept.length;
  const cleared: unknown[][] = kept.map((row) => [...row]);
  for (let i = 0; i < blankRows; i++) {
    cleared.push(Array.from({ length: c1 - c0 + 1 }, () => ""));
  }
  wb.setCellValuesByRange(cleared, { row: [r0, r1], column: [c0, c1] });
  return removed;
}

/** 标记选区中重复出现的值（非整行，按单元格） */
export function highlightDuplicateCells(
  wb: FortuneWorkbook,
  color = "#fff2cc",
): number {
  const s = selectionRanges(wb)[0];
  if (!s) return 0;
  const [r0, r1] = s.row;
  const [c0, c1] = s.column;
  const counts = new Map<string, number>();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = cellKey(wb.getCellValue(r, c));
      if (!k) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const k = cellKey(wb.getCellValue(r, c));
      if (!k || (counts.get(k) ?? 0) < 2) continue;
      wb.setCellFormat(r, c, "bg", color);
      n += 1;
    }
  }
  return n;
}

/** 分列：按分隔符拆分选区第一列，写入右侧列 */
export function splitTextToColumns(
  wb: FortuneWorkbook,
  delimiter: string,
): number {
  const sep = delimiter.length ? delimiter : ",";
  const s = selectionRanges(wb)[0];
  if (!s) return 0;
  const [r0, r1] = s.row;
  const c0 = s.column[0];
  let maxParts = 1;
  const partsByRow: string[][] = [];
  for (let r = r0; r <= r1; r++) {
    const text = String(wb.getCellValue(r, c0) ?? "");
    const parts = text.split(sep);
    partsByRow.push(parts);
    if (parts.length > maxParts) maxParts = parts.length;
  }
  if (maxParts <= 1) return 0;
  const matrix = partsByRow.map((parts) => {
    const row = Array.from({ length: maxParts }, (_, i) => parts[i] ?? "");
    return row;
  });
  wb.setCellValuesByRange(matrix, {
    row: [r0, r1],
    column: [c0, c0 + maxParts - 1],
  });
  return maxParts;
}

/** 为选区设置下拉列表（FortuneSheet dataVerification） */
export function applyDropdownList(wb: FortuneWorkbook, optionsText: string) {
  const list = optionsText
    .split(/[,，;；\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!list.length) return;
  const { active, id } = activeSheetMeta(wb);
  if (!id || !active) return;
  const s = selectionRanges(wb)[0];
  if (!s) return;
  const [r0, r1] = s.row;
  const [c0, c1] = s.column;
  const next = {
    ...(active.dataVerification || {}),
  } as Record<string, unknown>;
  const value1 = list.join(",");
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      next[`${r}_${c}`] = {
        type: "dropdown",
        type2: null,
        value1,
        value2: "",
        checked: false,
        remote: false,
        prohibitInput: false,
        hintShow: false,
        hintText: "",
      };
    }
  }
  wb.applyOp([{ op: "replace", id, path: ["dataVerification"], value: next }]);
}

export function findAndSelect(wb: FortuneWorkbook, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const sheet = wb.getSheet();
  const matrix =
    sheet.data ??
    (sheet.celldata
      ? wb.celldataToData(
          sheet.celldata,
          sheet.row ?? 84,
          sheet.column ?? 26,
        )
      : null);
  if (!matrix) return false;
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!cell) continue;
      const text = String(cell.m ?? cell.v ?? "").toLowerCase();
      if (text.includes(q)) {
        wb.setSelection([{ row: [r, r], column: [c, c] }]);
        rememberSelection([{ row: [r, r], column: [c, c] }]);
        wb.scroll({ targetRow: r, targetColumn: c });
        return true;
      }
    }
  }
  return false;
}

export function unfreeze(wb: FortuneWorkbook) {
  // FortuneSheet 取消冻结是 delete file.frozen，不是 freeze(0,0)
  const sheets = wb.getAllSheets();
  const active =
    sheets.find((s) => s.status === 1) ??
    sheets.find((s) => s.order === 0) ??
    sheets[0];
  const id = active?.id;
  if (!id) return;
  if (active.frozen == null) return;
  wb.applyOp([{ op: "remove", id, path: ["frozen"] }]);
}

export function unmergeSelection(wb: FortuneWorkbook) {
  const sels = selectionRanges(wb);
  wb.cancelMerge(sels);
}

const BORDER_TYPE: Record<BorderKind, string> = {
  all: "border-all",
  outside: "border-outside",
  inside: "border-inside",
  bottom: "border-bottom",
  top: "border-top",
  left: "border-left",
  right: "border-right",
  none: "border-none",
};

export function applyBorder(wb: FortuneWorkbook, kind: BorderKind) {
  const selection = selectionRanges(wb);
  const sheets = wb.getAllSheets();
  const active =
    sheets.find((s) => s.status === 1) ??
    sheets.find((s) => s.order === 0) ??
    sheets[0];
  if (!active) return;
  const config = { ...(active.config || {}) };
  const borderInfo = [...(((config as { borderInfo?: unknown[] }).borderInfo as
    | unknown[]
    | undefined) || [])];
  borderInfo.push({
    rangeType: "range",
    borderType: BORDER_TYPE[kind],
    style: "1",
    color: "#000000",
    range: selection.map((s) => ({ row: s.row, column: s.column })),
  });
  (config as { borderInfo: unknown[] }).borderInfo = borderInfo;
  wb.updateSheet(
    sheets.map((s) =>
      s.id === active.id || (!active.id && s === active)
        ? { ...s, config }
        : s,
    ),
  );
}

export function setNumberFormat(wb: FortuneWorkbook, format: string) {
  const map: Record<string, { fa: string; t: string }> = {
    general: { fa: "General", t: "g" },
    number2: { fa: "0.00", t: "n" },
    number0: { fa: "0", t: "n" },
    percent: { fa: "0%", t: "n" },
    percent2: { fa: "0.00%", t: "n" },
    comma: { fa: "#,##0.00", t: "n" },
    comma0: { fa: "#,##0", t: "n" },
    currency: { fa: '¥#,##0.00', t: "n" },
    currency0: { fa: '¥#,##0', t: "n" },
    text: { fa: "@", t: "s" },
    date: { fa: "yyyy-MM-dd", t: "d" },
  };
  const ct = map[format] ?? { fa: format, t: "n" };
  for (const s of selectionRanges(wb)) {
    wb.setCellFormatByRange("ct", ct, { row: s.row, column: s.column });
  }
}

function selectionA1(sel: Sel): string {
  const r0 = sel.row[0];
  const r1 = sel.row[1] ?? r0;
  const c0 = sel.column[0];
  const c1 = sel.column[1] ?? c0;
  const a = `${colLabel(c0)}${r0 + 1}`;
  const b = `${colLabel(c1)}${r1 + 1}`;
  return a === b ? a : `${a}:${b}`;
}

function isNumericCell(wb: FortuneWorkbook, r: number, c: number): boolean {
  const f = wb.getCellValue(r, c, { type: "f" });
  if (typeof f === "string" && f.trim()) return true;
  const v = wb.getCellValue(r, c);
  if (v == null || v === "") return false;
  if (typeof v === "number") return Number.isFinite(v);
  return Number.isFinite(Number(String(v).replace(/,/g, "")));
}

/** 插入函数模板；多选时把选区作为参数写到下方/右侧 */
export function insertFormulaTemplate(wb: FortuneWorkbook, template: string) {
  const sel = selectionRanges(wb)[0];
  const r0 = sel.row[0];
  const r1 = sel.row[1] ?? r0;
  const c0 = sel.column[0];
  const c1 = sel.column[1] ?? c0;
  let f = template.startsWith("=") ? template : `=${template}`;
  if (f.endsWith("(")) {
    const name = f.slice(1, -1);
    if (r0 !== r1 || c0 !== c1) {
      const addr = selectionA1(sel);
      const targetR = r1 > r0 ? r1 + 1 : r0;
      const targetC = r1 > r0 ? c0 : c1 + 1;
      wb.setCellValue(targetR, targetC, `=${name}(${addr})`);
      rememberSelection([{ row: [targetR, targetR], column: [targetC, targetC] }]);
      return;
    }
    f = `${f})`;
  }
  wb.setCellValue(r0, c0, f);
}

/**
 * 自动求和类：优先对当前多选区汇总；单格则向上/向左找连续数值区。
 */
export function insertAutoFormula(
  wb: FortuneWorkbook,
  fn: "SUM" | "AVERAGE" | "COUNT" | "MAX" | "MIN" = "SUM",
) {
  const sel = selectionRanges(wb)[0];
  const r0 = sel.row[0];
  const r1 = sel.row[1] ?? r0;
  const c0 = sel.column[0];
  const c1 = sel.column[1] ?? c0;

  if (r0 !== r1 || c0 !== c1) {
    insertFormulaTemplate(wb, `=${fn}(`);
    return;
  }

  let sr = r0 - 1;
  while (sr >= 0 && isNumericCell(wb, sr, c0)) sr -= 1;
  sr += 1;
  if (sr < r0) {
    const addr = `${colLabel(c0)}${sr + 1}:${colLabel(c0)}${r0}`;
    wb.setCellValue(r0, c0, `=${fn}(${addr})`);
    return;
  }

  let sc = c0 - 1;
  while (sc >= 0 && isNumericCell(wb, r0, sc)) sc -= 1;
  sc += 1;
  if (sc < c0) {
    const addr = `${colLabel(sc)}${r0 + 1}:${colLabel(c0)}${r0 + 1}`;
    wb.setCellValue(r0, c0, `=${fn}(${addr})`);
    return;
  }

  wb.setCellValue(r0, c0, `=${fn}()`);
}

export function recalculateWorkbook(wb: FortuneWorkbook) {
  try {
    wb.calculateFormula();
  } catch (err) {
    console.error("recalculateWorkbook failed", err);
  }
}

/** 返回选区内公式列表，供「显示公式」查看 */
export function listSelectionFormulas(wb: FortuneWorkbook): string[] {
  const s = selectionRanges(wb)[0];
  if (!s) return [];
  const out: string[] = [];
  for (let r = s.row[0]; r <= s.row[1]; r++) {
    for (let c = s.column[0]; c <= s.column[1]; c++) {
      const f = wb.getCellValue(r, c, { type: "f" });
      if (typeof f === "string" && f.trim()) {
        out.push(`${colLabel(c)}${r + 1}: ${f.startsWith("=") ? f : `=${f}`}`);
      }
    }
  }
  return out;
}

/** 跳到选区内第一个含错误值的单元格 */
export function findFirstFormulaError(wb: FortuneWorkbook): boolean {
  const s = selectionRanges(wb)[0];
  const sheets = wb.getAllSheets();
  const sheet = sheets.find((x) => x.status === 1) ?? sheets[0];
  const matrix = sheet?.data;
  if (!matrix) return false;

  const r0 = s?.row[0] ?? 0;
  const r1 = s?.row[1] ?? Math.min(matrix.length - 1, 200);
  const c0 = s?.column[0] ?? 0;
  const c1 = s?.column[1] ?? Math.min((matrix[0]?.length ?? 1) - 1, 50);
  const errRe = /^#(N\/A|VALUE!|REF!|DIV\/0!|NUM!|NAME\?|NULL!|ERROR!)/i;

  for (let r = r0; r <= r1; r++) {
    const row = matrix[r];
    if (!row) continue;
    for (let c = c0; c <= c1; c++) {
      const cell = row[c];
      if (!cell) continue;
      const text = String(cell.m ?? cell.v ?? "");
      if (!errRe.test(text)) continue;
      wb.setSelection([{ row: [r, r], column: [c, c] }]);
      rememberSelection([{ row: [r, r], column: [c, c] }]);
      wb.scroll({ targetRow: r, targetColumn: c });
      return true;
    }
  }
  return false;
}

export function freezeAtActive(wb: FortuneWorkbook) {
  const sel = selectionRanges(wb)[0];
  wb.freeze("both", { row: sel.row[0], column: sel.column[0] });
}

export function insertRows(wb: FortuneWorkbook, count = 1) {
  const sel = selectionRanges(wb)[0];
  wb.insertRowOrColumn("row", sel.row[0], count, "lefttop");
}

export function insertCols(wb: FortuneWorkbook, count = 1) {
  const sel = selectionRanges(wb)[0];
  wb.insertRowOrColumn("column", sel.column[0], count, "lefttop");
}

export function deleteRows(wb: FortuneWorkbook) {
  for (const s of [...selectionRanges(wb)].reverse()) {
    wb.deleteRowOrColumn("row", s.row[0], s.row[1]);
  }
}

export function deleteCols(wb: FortuneWorkbook) {
  for (const s of [...selectionRanges(wb)].reverse()) {
    wb.deleteRowOrColumn("column", s.column[0], s.column[1]);
  }
}

export function sortSelection(wb: FortuneWorkbook, asc: boolean) {
  const s = selectionRanges(wb)[0];
  if (!s) return;
  const [r0, r1] = s.row;
  const [c0, c1] = s.column;
  const rows: unknown[][] = [];
  for (let r = r0; r <= r1; r++) {
    const row: unknown[] = [];
    for (let c = c0; c <= c1; c++) row.push(wb.getCellValue(r, c) ?? "");
    rows.push(row);
  }
  rows.sort((a, b) => {
    const av = a[0];
    const bv = b[0];
    if (av === bv) return 0;
    if (av == null || av === "") return 1;
    if (bv == null || bv === "") return -1;
    const cmp = av < bv ? -1 : 1;
    return asc ? cmp : -cmp;
  });
  wb.setCellValuesByRange(rows, { row: [r0, r1], column: [c0, c1] });
}

/** 运行时单元格在 data 矩阵；celldata 仅初始化用。保存前必须转换。 */
export function snapshotWorkbook(wb: FortuneWorkbook): FortuneSheetData {
  const sheets = wb.getAllSheets();
  return sheets.map((sheet) => {
    const celldata =
      sheet.data && sheet.data.length
        ? wb.dataToCelldata(sheet.data)
        : (sheet.celldata ?? []);
    const { data: _drop, ...rest } = sheet;
    return {
      ...rest,
      celldata,
      row: sheet.row ?? Math.max(60, sheet.data?.length ?? 0),
      column:
        sheet.column ??
        Math.max(26, sheet.data?.[0]?.length ?? 0),
    };
  });
}

export function resetBlankWorkbook(wb: FortuneWorkbook) {
  wb.updateSheet(blankSheets());
}

function toArgb(color: string | undefined | null): string | undefined {
  if (!color) return undefined;
  const c = String(color).trim();
  if (!c || c === "null" || c === "undefined") return undefined;
  if (c.startsWith("#") && c.length === 7) return `FF${c.slice(1).toUpperCase()}`;
  if (c.startsWith("#") && c.length === 4) {
    const [, r, g, b] = c;
    return `FF${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  const rgb = c.match(/^rgba?\((\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    const hex = [rgb[1], rgb[2], rgb[3]]
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("");
    return `FF${hex}`.toUpperCase();
  }
  if (/^[0-9a-fA-F]{6}$/.test(c)) return `FF${c.toUpperCase()}`;
  if (/^[0-9a-fA-F]{8}$/.test(c)) return c.toUpperCase();
  return undefined;
}

function fromArgb(
  color: Partial<ExcelJS.Color> | string | undefined | null,
): string | undefined {
  if (!color) return undefined;
  if (typeof color === "string") {
    if (color.startsWith("#")) return color.length >= 7 ? color.slice(0, 7) : color;
    if (/^[0-9a-fA-F]{8}$/.test(color)) return `#${color.slice(2)}`;
    if (/^[0-9a-fA-F]{6}$/.test(color)) return `#${color}`;
    return undefined;
  }
  const argb = (color as ExcelJS.Color).argb;
  if (argb && argb.length >= 6) {
    const hex = argb.length === 8 ? argb.slice(2) : argb.slice(-6);
    return `#${hex.toLowerCase()}`;
  }
  const theme = (color as { theme?: number }).theme;
  // 主题色无法可靠还原，跳过
  if (theme != null) return undefined;
  return undefined;
}

function fortuneCellHasPayload(v: Cell | null | undefined): boolean {
  if (v == null) return false;
  if (typeof v !== "object") return String(v) !== "";
  if (v.v != null && v.v !== "") return true;
  if (v.m != null && v.m !== "") return true;
  if (v.f) return true;
  if (v.bg || v.fc) return true;
  if (v.bl || v.it || v.un || v.cl) return true;
  if (v.ff != null || v.fs != null) return true;
  if (v.ht != null || v.vt != null || v.tb != null) return true;
  if (v.ct?.fa && v.ct.fa !== "General") return true;
  return false;
}

function applyFortuneStyleToExcel(
  excelCell: ExcelJS.Cell,
  fortune: Cell,
) {
  const font: Partial<ExcelJS.Font> = {};
  if (fortune.bl) font.bold = true;
  if (fortune.it) font.italic = true;
  if (fortune.un) font.underline = true;
  if (fortune.cl) font.strike = true;
  if (fortune.fs != null) font.size = Number(fortune.fs);
  if (fortune.ff != null && String(fortune.ff) !== "") {
    font.name = String(fortune.ff);
  }
  const fc = toArgb(fortune.fc);
  if (fc) font.color = { argb: fc };
  if (Object.keys(font).length) excelCell.font = { ...excelCell.font, ...font };

  const bg = toArgb(fortune.bg);
  if (bg) {
    excelCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: bg },
    };
  }

  const align: Partial<ExcelJS.Alignment> = {};
  if (fortune.ht === 0) align.horizontal = "center";
  else if (fortune.ht === 1) align.horizontal = "left";
  else if (fortune.ht === 2) align.horizontal = "right";
  if (fortune.vt === 0) align.vertical = "middle";
  else if (fortune.vt === 1) align.vertical = "top";
  else if (fortune.vt === 2) align.vertical = "bottom";
  if (String(fortune.tb) === "2") align.wrapText = true;
  if (Object.keys(align).length) {
    excelCell.alignment = { ...excelCell.alignment, ...align };
  }

  if (fortune.ct?.fa && fortune.ct.fa !== "General") {
    excelCell.numFmt = fortune.ct.fa;
  }
}

function excelCellToFortune(excelCell: ExcelJS.Cell): Cell | null {
  const fortune: Cell = {};
  let has = false;

  if (excelCell.formula) {
    fortune.f = excelCell.formula.startsWith("=")
      ? excelCell.formula
      : `=${excelCell.formula}`;
    has = true;
    if (excelCell.value != null && typeof excelCell.value !== "object") {
      fortune.v = excelCell.value as string | number | boolean;
      fortune.m = String(excelCell.value);
    } else if (
      excelCell.value &&
      typeof excelCell.value === "object" &&
      "result" in (excelCell.value as object)
    ) {
      const result = (excelCell.value as { result?: unknown }).result;
      if (result != null) {
        fortune.v = result as string | number | boolean;
        fortune.m = String(result);
      }
    }
  } else if (excelCell.value != null && excelCell.value !== "") {
    if (typeof excelCell.value === "object" && "richText" in excelCell.value) {
      const text = (excelCell.value as ExcelJS.CellRichTextValue).richText
        .map((t) => t.text)
        .join("");
      fortune.v = text;
      fortune.m = text;
    } else if (excelCell.value instanceof Date) {
      fortune.v = excelCell.value.toISOString();
      fortune.m = excelCell.value.toLocaleString();
      fortune.ct = { fa: "yyyy-MM-dd", t: "d" };
    } else if (typeof excelCell.value !== "object") {
      fortune.v = excelCell.value as string | number | boolean;
      fortune.m = String(excelCell.value);
    }
    has = true;
  }

  const font = excelCell.font;
  if (font) {
    if (font.bold) {
      fortune.bl = 1;
      has = true;
    }
    if (font.italic) {
      fortune.it = 1;
      has = true;
    }
    if (font.underline) {
      fortune.un = 1;
      has = true;
    }
    if (font.strike) {
      fortune.cl = 1;
      has = true;
    }
    if (font.size != null) {
      fortune.fs = font.size;
      has = true;
    }
    if (font.name) {
      fortune.ff = font.name;
      has = true;
    }
    const fc = fromArgb(font.color);
    if (fc) {
      fortune.fc = fc;
      has = true;
    }
  }

  const fill = excelCell.fill;
  if (fill && fill.type === "pattern" && fill.pattern !== "none") {
    const bg = fromArgb(fill.fgColor) || fromArgb(fill.bgColor);
    if (bg) {
      fortune.bg = bg;
      has = true;
    }
  }

  const align = excelCell.alignment;
  if (align) {
    if (align.horizontal === "center") fortune.ht = 0;
    else if (align.horizontal === "left") fortune.ht = 1;
    else if (align.horizontal === "right") fortune.ht = 2;
    if (align.vertical === "middle") fortune.vt = 0;
    else if (align.vertical === "top") fortune.vt = 1;
    else if (align.vertical === "bottom") fortune.vt = 2;
    if (align.wrapText) fortune.tb = "2";
    if (
      align.horizontal != null ||
      align.vertical != null ||
      align.wrapText
    ) {
      has = true;
    }
  }

  if (excelCell.numFmt && excelCell.numFmt !== "General") {
    fortune.ct = {
      fa: excelCell.numFmt,
      t: typeof fortune.v === "number" ? "n" : "g",
    };
    has = true;
  } else if (fortune.v != null && !fortune.ct) {
    fortune.ct = {
      fa: "General",
      t: typeof fortune.v === "number" ? "n" : "g",
    };
  }

  return has ? fortune : null;
}

function collectSheetCells(sheet: Sheet): CellWithRowAndCol[] {
  if (sheet.celldata?.length) {
    return sheet.celldata.filter((item) => fortuneCellHasPayload(item.v));
  }
  const out: CellWithRowAndCol[] = [];
  const matrix = sheet.data;
  if (!matrix?.length) return out;
  for (let r = 0; r < matrix.length; r++) {
    const row = matrix[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      if (!fortuneCellHasPayload(cell)) continue;
      out.push({ r, c, v: cell });
    }
  }
  return out;
}

export async function arrayBufferToSheets(
  buf: ArrayBuffer,
): Promise<FortuneSheetData> {
  if (!buf.byteLength) return blankSheets();
  const u8 = new Uint8Array(buf);
  const looksZip = u8.length >= 2 && u8[0] === 0x50 && u8[1] === 0x4b;
  if (!looksZip) return blankSheets();

  const book = new ExcelJS.Workbook();
  // ExcelJS 类型接受 Buffer；浏览器里用 Uint8Array 即可
  await book.xlsx.load(buf as unknown as ExcelJS.Buffer);
  if (!book.worksheets.length) return blankSheets();

  return book.worksheets.map((ws, order) => {
    const celldata: CellWithRowAndCol[] = [];
    let maxR = 0;
    let maxC = 0;
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        const fortune = excelCellToFortune(cell);
        if (!fortune) return;
        const r = rowNumber - 1;
        const c = colNumber - 1;
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
        celldata.push({ r, c, v: fortune });
      });
    });

    // 合并单元格（ExcelJS model.merges 形如 "A1:B2"）
    const merge: Record<
      string,
      { r: number; c: number; rs: number; cs: number }
    > = {};
    const mergeStrings = (ws.model.merges ?? []) as string[];
    for (const ref of mergeStrings) {
      try {
        const [a, b] = ref.split(":");
        if (!a) continue;
        const start = ws.getCell(a);
        const end = b ? ws.getCell(b) : start;
        const r = Number(start.row) - 1;
        const c = Number(start.col) - 1;
        const rs = Number(end.row) - Number(start.row) + 1;
        const cs = Number(end.col) - Number(start.col) + 1;
        merge[`${r}_${c}`] = { r, c, rs, cs };
      } catch {
        // ignore bad merge
      }
    }

    return {
      name: ws.name || `Sheet${order + 1}`,
      order,
      celldata,
      row: Math.max(84, maxR + 20),
      column: Math.max(26, maxC + 5),
      status: order === 0 ? 1 : 0,
      config: Object.keys(merge).length ? { merge } : {},
    };
  });
}

export type PaperSizeId = "A4" | "A3" | "Letter" | "Legal";
export type PageOrientation = "portrait" | "landscape";
export type MarginPreset = "normal" | "wide" | "narrow" | "none";

export type ExcelPageSetup = {
  orientation: PageOrientation;
  paperSize: PaperSizeId;
  margin: MarginPreset;
  scale: number;
  fitToPage: boolean;
  printArea: string | null;
  printTitlesRow: string | null;
  header: string;
  footer: string;
  printGridlines: boolean;
  printHeadings: boolean;
  showGridLines: boolean;
};

const PAPER_SIZE_CODE: Record<PaperSizeId, number> = {
  Letter: 1,
  Legal: 5,
  A3: 8,
  A4: 9,
};

const MARGIN_INCH: Record<
  MarginPreset,
  { left: number; right: number; top: number; bottom: number; header: number; footer: number }
> = {
  normal: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  wide: { left: 1, right: 1, top: 1, bottom: 1, header: 0.5, footer: 0.5 },
  narrow: { left: 0.25, right: 0.25, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  none: { left: 0, right: 0, top: 0, bottom: 0, header: 0, footer: 0 },
};

let pageSetupState: ExcelPageSetup = {
  orientation: "portrait",
  paperSize: "A4",
  margin: "normal",
  scale: 100,
  fitToPage: false,
  printArea: null,
  printTitlesRow: null,
  header: "",
  footer: "&C第 &P 页",
  printGridlines: false,
  printHeadings: false,
  showGridLines: true,
};

export function getPageSetup(): ExcelPageSetup {
  return { ...pageSetupState };
}

export function patchPageSetup(patch: Partial<ExcelPageSetup>): ExcelPageSetup {
  pageSetupState = { ...pageSetupState, ...patch };
  return getPageSetup();
}

export function setPrintAreaFromSelection(wb: FortuneWorkbook) {
  const s = selectionRanges(wb)[0];
  if (!s) return;
  const a = `${colLabel(s.column[0])}${s.row[0] + 1}`;
  const b = `${colLabel(s.column[1])}${s.row[1] + 1}`;
  patchPageSetup({ printArea: a === b ? a : `${a}:${b}` });
}

export function clearPrintArea() {
  patchPageSetup({ printArea: null });
}

export function setPrintTitlesFirstRow() {
  patchPageSetup({ printTitlesRow: "1:1" });
}

export function clearPrintTitles() {
  patchPageSetup({ printTitlesRow: null });
}

export function setSheetGridLines(wb: FortuneWorkbook, show: boolean) {
  const { active, id } = activeSheetMeta(wb);
  if (!id || !active) return;
  patchPageSetup({ showGridLines: show });
  wb.applyOp([
    { op: "replace", id, path: ["showGridLines"], value: show ? 1 : 0 },
  ]);
}

/** 简易打印：生成 HTML，经 Tauri 调系统打印（不用 window.open，WebView 会拦弹窗） */
export function openPrintPreview(wb: FortuneWorkbook) {
  const sheet = wb.getAllSheets().find((s) => s.status === 1) ?? wb.getAllSheets()[0];
  if (!sheet) return;
  const setup = getPageSetup();
  let r0 = 0;
  let r1 = Math.min((sheet.row ?? 40) - 1, 60);
  let c0 = 0;
  let c1 = Math.min((sheet.column ?? 12) - 1, 15);
  if (setup.printArea) {
    const m = setup.printArea.match(/^([A-Za-z]+)(\d+)(?::([A-Za-z]+)(\d+))?$/);
    if (m) {
      const a = { c: colLabelToIndex(m[1]), r: Number(m[2]) - 1 };
      const b = m[3]
        ? { c: colLabelToIndex(m[3]), r: Number(m[4]) - 1 }
        : a;
      r0 = Math.min(a.r, b.r);
      r1 = Math.max(a.r, b.r);
      c0 = Math.min(a.c, b.c);
      c1 = Math.max(a.c, b.c);
    }
  }
  const rows: string[] = [];
  for (let r = r0; r <= r1; r++) {
    const cells: string[] = [];
    for (let c = c0; c <= c1; c++) {
      const v = wb.getCellValue(r, c);
      const t = v == null ? "" : String(v);
      cells.push(`<td>${escapeHtml(t)}</td>`);
    }
    rows.push(`<tr>${cells.join("")}</tr>`);
  }
  const html = `<!doctype html><html><head><meta charset="utf-8"/><title>打印预览</title>
<style>
  @page { size: ${setup.paperSize} ${setup.orientation}; margin: ${MARGIN_INCH[setup.margin].top}in ${MARGIN_INCH[setup.margin].right}in ${MARGIN_INCH[setup.margin].bottom}in ${MARGIN_INCH[setup.margin].left}in; }
  body{font:12px/1.4 "Microsoft YaHei",sans-serif;color:#111;margin:16px}
  h1{font-size:14px;margin:0 0 8px}
  .meta{color:#666;font-size:11px;margin-bottom:12px}
  table{border-collapse:collapse;width:100%}
  td{border:${setup.printGridlines ? "1px solid #999" : "1px solid #ddd"};padding:4px 6px;min-width:48px}
</style></head><body>
<h1>${escapeHtml(sheet.name || "Sheet")}</h1>
<div class="meta">${setup.paperSize} · ${setup.orientation === "portrait" ? "纵向" : "横向"} · 缩放 ${setup.scale}%${setup.printArea ? ` · 区域 ${setup.printArea}` : ""}</div>
${setup.header ? `<div style="text-align:center;margin-bottom:8px">${escapeHtml(setup.header)}</div>` : ""}
<table>${rows.join("")}</table>
${setup.footer ? `<div style="text-align:center;margin-top:8px">${escapeHtml(setup.footer)}</div>` : ""}
</body></html>`;

  void (async () => {
    try {
      const tip = await invoke<string>("print_html_document", { html });
      if (tip) await showAlert(tip, "打印");
    } catch (err) {
      await showAlert(
        err instanceof Error ? err.message : String(err),
        "打印失败",
      );
    }
  })();
}

function colLabelToIndex(col: string): number {
  let n = 0;
  const s = col.toUpperCase();
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applyPageSetupToWorksheet(ws: ExcelJS.Worksheet) {
  const setup = getPageSetup();
  const margins = MARGIN_INCH[setup.margin];
  ws.pageSetup = {
    ...ws.pageSetup,
    paperSize: PAPER_SIZE_CODE[setup.paperSize],
    orientation: setup.orientation,
    scale: setup.fitToPage ? undefined : setup.scale,
    fitToPage: setup.fitToPage,
    fitToWidth: setup.fitToPage ? 1 : undefined,
    fitToHeight: setup.fitToPage ? 0 : undefined,
    margins: { ...margins },
    printArea: setup.printArea || undefined,
    printTitlesRow: setup.printTitlesRow || undefined,
  };
  ws.headerFooter = {
    oddHeader: setup.header || undefined,
    oddFooter: setup.footer || undefined,
  };
  ws.views = [
    {
      showGridLines: setup.showGridLines,
    },
  ];
  // ExcelJS 打印网格线/行列号
  (ws.pageSetup as { printGridLines?: boolean; showRowColHeaders?: boolean }).printGridLines =
    setup.printGridlines;
  (ws as { properties?: { outlineProperties?: unknown } } & ExcelJS.Worksheet).properties = {
    ...(ws.properties || {}),
  };
}

const THEME_PRESETS: { id: string; label: string; header: string; band: string; text: string }[] =
  [
    { id: "blue", label: "蓝色", header: "#2f5496", band: "#d6e3f0", text: "#ffffff" },
    { id: "green", label: "绿色", header: "#548235", band: "#e2efda", text: "#ffffff" },
    { id: "orange", label: "橙色", header: "#c65911", band: "#fce4d6", text: "#ffffff" },
    { id: "gray", label: "灰色", header: "#5b5b5b", band: "#f2f2f2", text: "#ffffff" },
  ];

export function listThemePresets() {
  return THEME_PRESETS.map(({ id, label }) => ({ id, label }));
}

/** 主题：给选区首行着色 + 斑马纹 */
export function applyThemeToSelection(wb: FortuneWorkbook, themeId: string) {
  const theme = THEME_PRESETS.find((t) => t.id === themeId) ?? THEME_PRESETS[0];
  const s = selectionRanges(wb)[0];
  if (!s) return;
  const [r0, r1] = s.row;
  const [c0, c1] = s.column;
  for (let c = c0; c <= c1; c++) {
    wb.setCellFormat(r0, c, "bg", theme.header);
    wb.setCellFormat(r0, c, "fc", theme.text);
    wb.setCellFormat(r0, c, "bl", 1);
  }
  for (let r = r0 + 1; r <= r1; r++) {
    if ((r - r0) % 2 === 0) continue;
    for (let c = c0; c <= c1; c++) {
      wb.setCellFormat(r, c, "bg", theme.band);
    }
  }
}

/** 表格美化：表头加粗底色 + 隔行底色 + 外边框 */
export function beautifyTableSelection(wb: FortuneWorkbook) {
  applyThemeToSelection(wb, "blue");
  applyBorder(wb, "outside");
  applyBorder(wb, "inside");
}

export async function sheetsToXlsxBlob(
  sheets: FortuneSheetData,
): Promise<Blob> {
  const book = new ExcelJS.Workbook();
  const list = sheets.length ? sheets : blankSheets();
  const usedNames = new Set<string>();

  for (const sheet of list) {
    let safeName = (sheet.name || "Sheet").slice(0, 31) || "Sheet";
    let i = 1;
    while (usedNames.has(safeName)) {
      const suffix = `_${i++}`;
      safeName = `${(sheet.name || "Sheet").slice(0, 31 - suffix.length)}${suffix}`;
    }
    usedNames.add(safeName);
    const ws = book.addWorksheet(safeName);
    applyPageSetupToWorksheet(ws);
    const cells = collectSheetCells(sheet);

    for (const item of cells) {
      const excelCell = ws.getCell(item.r + 1, item.c + 1);
      const fortune = item.v;
      if (!fortune || typeof fortune !== "object") {
        if (fortune != null && fortune !== "") excelCell.value = fortune as never;
        continue;
      }
      if (fortune.f) {
        const f = String(fortune.f).replace(/^=/, "");
        excelCell.value = { formula: f, result: fortune.v as never };
      } else if (fortune.v != null && fortune.v !== "") {
        excelCell.value = fortune.v as ExcelJS.CellValue;
      } else if (fortune.m != null && fortune.m !== "") {
        excelCell.value = String(fortune.m);
      }
      applyFortuneStyleToExcel(excelCell, fortune);
    }

    // 合并单元格
    const merges = sheet.config?.merge;
    if (merges) {
      for (const key of Object.keys(merges)) {
        const m = merges[key];
        if (!m) continue;
        const r1 = m.r + 1;
        const c1 = m.c + 1;
        const r2 = m.r + (m.rs || 1);
        const c2 = m.c + (m.cs || 1);
        if (r2 > r1 || c2 > c1) {
          try {
            ws.mergeCells(r1, c1, r2, c2);
          } catch {
            // ignore overlap
          }
        }
      }
    }

    // 列宽
    const columnlen = sheet.config?.columnlen;
    if (columnlen) {
      for (const [idx, width] of Object.entries(columnlen)) {
        const col = ws.getColumn(Number(idx) + 1);
        // luckysheet px ≈ excel width / 8
        col.width = Math.max(4, Number(width) / 8);
      }
    }
  }

  const buf = await book.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportExcelBlob(wb: FortuneWorkbook): Promise<Blob> {
  return sheetsToXlsxBlob(snapshotWorkbook(wb));
}
