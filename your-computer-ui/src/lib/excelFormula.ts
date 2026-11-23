/** 公式模板分组（写入由 SpreadJS 原生计算） */

const COL_RE = /^([A-Za-z]+)(\d+)$/;

function colToIndex(col: string): number {
  let n = 0;
  const s = col.toUpperCase();
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

export function a1ToRc(ref: string): { r: number; c: number } | null {
  const m = String(ref).trim().match(COL_RE);
  if (!m) return null;
  return { c: colToIndex(m[1]), r: parseInt(m[2], 10) - 1 };
}

export function rcToA1(r: number, c: number): string {
  let n = c;
  let s = "";
  while (n >= 0) {
    s = String.fromCharCode((n % 26) + 65) + s;
    n = Math.floor(n / 26) - 1;
  }
  return `${s}${r + 1}`;
}

type CellReader = (r: number, c: number) => unknown;

function toNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number(String(v).replace(/,/g, "").replace(/%$/, ""));
  return Number.isFinite(n) ? n : null;
}

function collectRange(
  start: string,
  end: string,
  read: CellReader,
): unknown[] {
  const a = a1ToRc(start);
  const b = a1ToRc(end);
  if (!a || !b) return [];
  const r0 = Math.min(a.r, b.r);
  const r1 = Math.max(a.r, b.r);
  const c0 = Math.min(a.c, b.c);
  const c1 = Math.max(a.c, b.c);
  const out: unknown[] = [];
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) out.push(read(r, c));
  }
  return out;
}

function nums(vals: unknown[]): number[] {
  const out: number[] = [];
  for (const v of vals) {
    const n = toNum(v);
    if (n != null) out.push(n);
  }
  return out;
}

function parseArgs(inside: string): string[] {
  const args: string[] = [];
  let cur = "";
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < inside.length; i++) {
    const ch = inside[i];
    if (ch === '"') {
      inStr = !inStr;
      cur += ch;
      continue;
    }
    if (!inStr) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        args.push(cur.trim());
        cur = "";
        continue;
      }
    }
    cur += ch;
  }
  if (cur.trim()) args.push(cur.trim());
  return args;
}

function resolveArg(arg: string, read: CellReader): unknown[] {
  const a = arg.trim();
  if (/^".*"$/.test(a)) return [a.slice(1, -1)];
  if (/^-?\d+(\.\d+)?$/.test(a)) return [Number(a)];
  const range = a.match(/^([A-Za-z]+\d+):([A-Za-z]+\d+)$/);
  if (range) return collectRange(range[1], range[2], read);
  const one = a1ToRc(a);
  if (one) return [read(one.r, one.c)];
  return [a];
}

function evalCall(name: string, args: string[], read: CellReader): unknown {
  const n = name.toUpperCase();
  const resolved = args.flatMap((a) => resolveArg(a, read));
  const ns = nums(resolved);

  switch (n) {
    case "SUM":
      return ns.reduce((s, x) => s + x, 0);
    case "AVERAGE":
    case "AVG":
      return ns.length ? ns.reduce((s, x) => s + x, 0) / ns.length : 0;
    case "COUNT":
      return ns.length;
    case "COUNTA":
      return resolved.filter((v) => v != null && String(v) !== "").length;
    case "MAX":
      return ns.length ? Math.max(...ns) : 0;
    case "MIN":
      return ns.length ? Math.min(...ns) : 0;
    case "ABS":
      return Math.abs(ns[0] ?? 0);
    case "ROUND": {
      const v = ns[0] ?? 0;
      const d = ns[1] ?? 0;
      const p = 10 ** d;
      return Math.round(v * p) / p;
    }
    case "INT":
      return Math.trunc(ns[0] ?? 0);
    case "MOD":
      return ns.length >= 2 ? ns[0] % ns[1] : 0;
    case "POWER":
    case "POW":
      return ns.length >= 2 ? ns[0] ** ns[1] : 0;
    case "SQRT":
      return Math.sqrt(ns[0] ?? 0);
    case "LEN":
      return String(resolved[0] ?? "").length;
    case "LEFT":
      return String(resolved[0] ?? "").slice(0, ns[1] ?? 1);
    case "RIGHT": {
      const s = String(resolved[0] ?? "");
      const k = ns[1] ?? 1;
      return s.slice(Math.max(0, s.length - k));
    }
    case "MID": {
      const s = String(resolved[0] ?? "");
      const start = Math.max(1, ns[1] ?? 1) - 1;
      const len = ns[2] ?? s.length;
      return s.slice(start, start + len);
    }
    case "UPPER":
      return String(resolved[0] ?? "").toUpperCase();
    case "LOWER":
      return String(resolved[0] ?? "").toLowerCase();
    case "TRIM":
      return String(resolved[0] ?? "").trim();
    case "CONCAT":
    case "CONCATENATE":
      return resolved.map((v) => (v == null ? "" : String(v))).join("");
    case "IF": {
      const cond = resolved[0];
      const truthy =
        cond === true ||
        (typeof cond === "number" && cond !== 0) ||
        (typeof cond === "string" &&
          cond !== "" &&
          cond.toLowerCase() !== "false");
      return truthy ? (resolved[1] ?? true) : (resolved[2] ?? false);
    }
    case "AND":
      return resolved.every((v) => {
        if (typeof v === "boolean") return v;
        const num = toNum(v);
        if (num != null) return num !== 0;
        return v != null && String(v) !== "" && String(v).toLowerCase() !== "false";
      });
    case "OR":
      return resolved.some((v) => {
        if (typeof v === "boolean") return v;
        const num = toNum(v);
        if (num != null) return num !== 0;
        return v != null && String(v) !== "" && String(v).toLowerCase() !== "false";
      });
    case "NOT": {
      const v = resolved[0];
      if (typeof v === "boolean") return !v;
      const num = toNum(v);
      if (num != null) return num === 0;
      return !(v != null && String(v) !== "");
    }
    case "TODAY": {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }
    case "NOW":
      return new Date().toLocaleString();
    default:
      return `#NAME?`;
  }
}

/** 解析 `=SUM(A1:A10)` / `SUM(A1:A10)`；失败返回原文 */
export function evaluateFormula(
  formula: string,
  read: CellReader,
): string | number {
  let f = String(formula ?? "").trim();
  if (f.startsWith("=")) f = f.slice(1).trim();
  if (!f) return "";

  const call = f.match(/^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/s);
  if (call) {
    try {
      const result = evalCall(call[1], parseArgs(call[2]), read);
      if (typeof result === "number" && Number.isFinite(result)) return result;
      if (typeof result === "boolean") return result ? "TRUE" : "FALSE";
      return result == null ? "" : String(result);
    } catch {
      return "#ERROR!";
    }
  }

  const ref = a1ToRc(f);
  if (ref) {
    const v = read(ref.r, ref.c);
    const n = toNum(v);
    return n != null ? n : v == null ? "" : String(v);
  }

  const n = toNum(f);
  return n != null ? n : f;
}

export type FormulaItem = { name: string; template: string; label: string };

export const FORMULA_GROUPS: { id: string; label: string; items: FormulaItem[] }[] =
  [
    {
      id: "common",
      label: "常用函数",
      items: [
        { name: "SUM", label: "求和 SUM", template: "=SUM(" },
        { name: "AVERAGE", label: "平均 AVERAGE", template: "=AVERAGE(" },
        { name: "COUNT", label: "计数 COUNT", template: "=COUNT(" },
        { name: "MAX", label: "最大 MAX", template: "=MAX(" },
        { name: "MIN", label: "最小 MIN", template: "=MIN(" },
        { name: "IF", label: "条件 IF", template: "=IF(" },
      ],
    },
    {
      id: "math",
      label: "数学与三角",
      items: [
        { name: "ABS", label: "ABS", template: "=ABS(" },
        { name: "ROUND", label: "ROUND", template: "=ROUND(" },
        { name: "INT", label: "INT", template: "=INT(" },
        { name: "MOD", label: "MOD", template: "=MOD(" },
        { name: "POWER", label: "POWER", template: "=POWER(" },
        { name: "SQRT", label: "SQRT", template: "=SQRT(" },
      ],
    },
    {
      id: "logic",
      label: "逻辑",
      items: [
        { name: "IF", label: "IF", template: "=IF(" },
        { name: "AND", label: "AND", template: "=AND(" },
        { name: "OR", label: "OR", template: "=OR(" },
        { name: "NOT", label: "NOT", template: "=NOT(" },
      ],
    },
    {
      id: "text",
      label: "文本",
      items: [
        { name: "LEN", label: "LEN", template: "=LEN(" },
        { name: "LEFT", label: "LEFT", template: "=LEFT(" },
        { name: "RIGHT", label: "RIGHT", template: "=RIGHT(" },
        { name: "MID", label: "MID", template: "=MID(" },
        { name: "UPPER", label: "UPPER", template: "=UPPER(" },
        { name: "LOWER", label: "LOWER", template: "=LOWER(" },
        { name: "TRIM", label: "TRIM", template: "=TRIM(" },
        { name: "CONCAT", label: "CONCAT", template: "=CONCAT(" },
      ],
    },
    {
      id: "date",
      label: "日期与时间",
      items: [
        { name: "TODAY", label: "TODAY", template: "=TODAY()" },
        { name: "NOW", label: "NOW", template: "=NOW()" },
      ],
    },
    {
      id: "lookup",
      label: "查找与引用",
      items: [
        { name: "VLOOKUP", label: "VLOOKUP", template: "=VLOOKUP(" },
        { name: "HLOOKUP", label: "HLOOKUP", template: "=HLOOKUP(" },
        { name: "INDEX", label: "INDEX", template: "=INDEX(" },
        { name: "MATCH", label: "MATCH", template: "=MATCH(" },
        { name: "ROW", label: "ROW", template: "=ROW(" },
        { name: "COLUMN", label: "COLUMN", template: "=COLUMN(" },
      ],
    },
    {
      id: "finance",
      label: "财务",
      items: [
        { name: "PMT", label: "PMT", template: "=PMT(" },
        { name: "FV", label: "FV", template: "=FV(" },
        { name: "PV", label: "PV", template: "=PV(" },
        { name: "NPV", label: "NPV", template: "=NPV(" },
        { name: "IRR", label: "IRR", template: "=IRR(" },
        { name: "RATE", label: "RATE", template: "=RATE(" },
      ],
    },
  ];

export const AUTOSUM_ITEMS: FormulaItem[] = [
  { name: "SUM", label: "求和 SUM", template: "=SUM(" },
  { name: "AVERAGE", label: "平均 AVERAGE", template: "=AVERAGE(" },
  { name: "COUNT", label: "计数 COUNT", template: "=COUNT(" },
  { name: "MAX", label: "最大 MAX", template: "=MAX(" },
  { name: "MIN", label: "最小 MIN", template: "=MIN(" },
];
