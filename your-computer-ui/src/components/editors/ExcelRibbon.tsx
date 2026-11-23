import {
  memo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpToLine,
  Bold,
  Calculator,
  ChevronDown,
  Columns,
  Copy,
  Database,
  Eraser,
  Eye,
  FileText,
  Filter,
  FunctionSquare,
  Grid2x2,
  Italic,
  List,
  Merge,
  PaintBucket,
  Percent,
  Printer,
  RefreshCw,
  Search,
  Sigma,
  SortAsc,
  SortDesc,
  SplitSquareHorizontal,
  Star,
  Strikethrough,
  Type,
  Underline,
  WandSparkles,
  WrapText,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AUTOSUM_ITEMS, FORMULA_GROUPS } from "../../lib/excelFormula";
import { showAlert, showPrompt } from "../../lib/appDialog";
import { ColorPickerPop, TEXT_COLORS, HIGHLIGHT_COLORS } from "./ColorPickerPop";
import type { BorderKind, FortuneWorkbook } from "./excelOps";
import {
  applyBorder,
  applyDropdownList,
  applyThemeToSelection,
  beautifyTableSelection,
  changeDecimalPlaces,
  clearFilter,
  clearFormat,
  clearPrintArea,
  clearPrintTitles,
  convertSelection,
  fillSelection,
  findAndSelect,
  findFirstFormulaError,
  freezeAtActive,
  getPageSetup,
  highlightDuplicateCells,
  insertAutoFormula,
  insertFormulaTemplate,
  listSelectionFormulas,
  listThemePresets,
  mergeAndCenter,
  mergeSelection,
  openPrintPreview,
  patchPageSetup,
  patchFont,
  recalculateWorkbook,
  removeDuplicateRows,
  setBackColor,
  setForeColor,
  setHAlign,
  setNumberFormat,
  setPrintAreaFromSelection,
  setPrintTitlesFirstRow,
  setSheetGridLines,
  setVAlign,
  sortSelection,
  splitTextToColumns,
  toggleFilter,
  toggleWrap,
  unfreeze,
  unmergeSelection,
  type MarginPreset,
  type PageOrientation,
  type PaperSizeId,
} from "./excelOps";

export type ExcelRibbonTab = "home" | "data" | "formula" | "page";

const FONT_FAMILIES = [
  "微软雅黑",
  "宋体",
  "黑体",
  "楷体",
  "仿宋",
  "Arial",
  "Calibri",
  "Times New Roman",
];
const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

function ToolBtn({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={`inline-flex h-7 min-w-7 items-center justify-center rounded-[5px] px-1.5 text-[#1d1d1f] hover:bg-black/[0.06] disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "bg-black/[0.08]" : ""
      }`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/** 左：应用当前色；右：打开色板 */
function ColorSplitBtn({
  title,
  color,
  onApply,
  onOpenPicker,
  children,
}: {
  title: string;
  color: string;
  onApply: () => void;
  onOpenPicker: (anchor: DOMRect) => void;
  children: ReactNode;
}) {
  const dropRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="inline-flex h-7 items-stretch overflow-hidden rounded-[5px] hover:bg-black/[0.06]">
      <button
        type="button"
        title={title}
        className="inline-flex min-w-7 flex-col items-center justify-center px-1.5 text-[#1d1d1f]"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onApply}
      >
        {children}
        <span
          className="mt-0.5 h-[3px] w-3.5 rounded-sm"
          style={{ background: color }}
        />
      </button>
      <button
        ref={dropRef}
        type="button"
        title={`${title} - 更多`}
        className="inline-flex items-center px-0.5 text-[#1d1d1f]"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const el = dropRef.current;
          if (!el) return;
          onOpenPicker(el.getBoundingClientRect());
        }}
      >
        <ChevronDown size={10} className="opacity-55" />
      </button>
    </div>
  );
}

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 w-full text-left text-[12px] leading-none text-[#8e8e93]">
      {children}
    </div>
  );
}

/** 分组：内容单行不换行，宽屏铺开、窄屏由外层横向滚动 */
function RibbonGroup({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 flex-col">
      <GroupLabel>{label}</GroupLabel>
      <div className="flex flex-nowrap items-center gap-0.5">{children}</div>
    </div>
  );
}

function VSep() {
  return <div className="mx-1 h-8 w-px shrink-0 bg-black/[0.08]" />;
}

type Props = {
  tab: ExcelRibbonTab;
  onTabChange: (t: ExcelRibbonTab) => void;
  /** 点击时再取，避免 memo 住过期的 WorkbookInstance（闭包里的 context 会空/旧） */
  getWorkbook: () => FortuneWorkbook | null;
  onDirty: () => void;
  onImport: () => void;
  fontFamily: string;
  fontSize: number;
  foreColor: string;
  fillColor: string;
  onFontFamily: (v: string) => void;
  onFontSize: (v: number) => void;
  onForeColor: (v: string) => void;
  onFillColor: (v: string) => void;
};

export const ExcelRibbon = memo(function ExcelRibbon({
  tab,
  onTabChange,
  getWorkbook,
  onDirty,
  onImport,
  fontFamily,
  fontSize,
  foreColor,
  fillColor,
  onFontFamily,
  onFontSize,
  onForeColor,
  onFillColor,
}: Props) {
  const [colorPop, setColorPop] = useState<"fore" | "fill" | null>(null);
  const [colorAnchor, setColorAnchor] = useState<DOMRect | null>(null);
  const [numLabel, setNumLabel] = useState("常规");
  const [pageSetup, setPageSetup] = useState(() => getPageSetup());

  const run = (fn: (wb: FortuneWorkbook) => void) => {
    const workbook = getWorkbook();
    if (!workbook) return;
    fn(workbook);
    onDirty();
  };

  const updatePage = (patch: Parameters<typeof patchPageSetup>[0]) => {
    setPageSetup(patchPageSetup(patch));
    onDirty();
  };

  const tabs: { id: ExcelRibbonTab; label: string }[] = [
    { id: "home", label: "开始" },
    { id: "data", label: "数据" },
    { id: "formula", label: "公式" },
    { id: "page", label: "页面" },
  ];

  const borderItems: { label: string; type: BorderKind }[] = [
    { label: "所有框线", type: "all" },
    { label: "外侧框线", type: "outside" },
    { label: "内侧框线", type: "inside" },
    { label: "下框线", type: "bottom" },
    { label: "上框线", type: "top" },
    { label: "左框线", type: "left" },
    { label: "右框线", type: "right" },
    { label: "无框线", type: "none" },
  ];

  const numberFormats: { label: string; key: string }[] = [
    { label: "常规", key: "general" },
    { label: "数值", key: "number2" },
    { label: "货币", key: "currency" },
    { label: "会计专用", key: "currency0" },
    { label: "百分比", key: "percent" },
    { label: "千分位", key: "comma" },
    { label: "日期", key: "date" },
    { label: "文本", key: "text" },
  ];

  return (
    <div className="shrink-0 border-b border-black/[0.06] bg-white">
      <div
        className="flex items-center gap-0.5 px-2 pt-1"
        onMouseDown={(e) => e.preventDefault()}
      >
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`rounded-t-[6px] px-3 py-1 text-[12px] ${
              tab === t.id
                ? "bg-[#f5f5f7] font-medium text-[#1d1d1f]"
                : "text-[#6e6e73] hover:text-[#1d1d1f]"
            }`}
            onClick={() => onTabChange(t.id)}
          >
            {t.label}
          </div>
        ))}
      </div>

      <div
        className="flex flex-nowrap items-end gap-1 overflow-x-auto border-t border-black/[0.04] bg-[#f5f5f7] px-2 py-1.5 [scrollbar-width:thin]"
        onMouseDown={(e) => {
          const tag = (e.target as HTMLElement).tagName;
          if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") {
            e.preventDefault();
          }
        }}
      >
        {tab === "home" ? (
          <>
            {/* 字体 */}
            <RibbonGroup label="字体">
                <select
                  className="h-7 max-w-[110px] rounded-[5px] border border-black/[0.08] bg-white px-1.5 text-[14px] outline-none"
                  value={fontFamily}
                  onChange={(e) => {
                    const v = e.target.value;
                    onFontFamily(v);
                    run((wb) => patchFont(wb, { fontFamily: v }));
                  }}
                >
                  {FONT_FAMILIES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <select
                  className="h-7 w-[56px] rounded-[5px] border border-black/[0.08] bg-white px-1 text-[12px] outline-none"
                  value={fontSize}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    onFontSize(v);
                    run((wb) => patchFont(wb, { fontSize: v }));
                  }}
                >
                  {FONT_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <ToolBtn
                  title="增大字号"
                  onClick={() => {
                    const v = Math.min(72, fontSize + 2);
                    onFontSize(v);
                    run((wb) => patchFont(wb, { fontSize: v }));
                  }}
                >
                  <span className="text-[11px] font-semibold">A+</span>
                </ToolBtn>
                <ToolBtn
                  title="减小字号"
                  onClick={() => {
                    const v = Math.max(8, fontSize - 2);
                    onFontSize(v);
                    run((wb) => patchFont(wb, { fontSize: v }));
                  }}
                >
                  <span className="text-[11px] font-semibold">A-</span>
                </ToolBtn>
                <ToolBtn
                  title="加粗"
                  onClick={() => run((wb) => patchFont(wb, { bold: "toggle" }))}
                >
                  <Bold size={14} />
                </ToolBtn>
                <ToolBtn
                  title="斜体"
                  onClick={() =>
                    run((wb) => patchFont(wb, { italic: "toggle" }))
                  }
                >
                  <Italic size={14} />
                </ToolBtn>
                <ToolBtn
                  title="下划线"
                  onClick={() =>
                    run((wb) => patchFont(wb, { underline: "toggle" }))
                  }
                >
                  <Underline size={14} />
                </ToolBtn>
                <ToolBtn
                  title="删除线"
                  onClick={() =>
                    run((wb) => patchFont(wb, { strikethrough: "toggle" }))
                  }
                >
                  <Strikethrough size={14} />
                </ToolBtn>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    title="边框"
                    className="inline-flex h-7 min-w-7 items-center justify-center rounded-[5px] px-1.5 text-[#1d1d1f] outline-none hover:bg-black/[0.06]"
                  >
                    <Grid2x2 size={14} />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-36">
                    {borderItems.map((it) => (
                      <DropdownMenuItem
                        key={it.label}
                        onClick={() => run((wb) => applyBorder(wb, it.type))}
                      >
                        {it.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <ColorSplitBtn
                  title="填充颜色"
                  color={fillColor}
                  onApply={() => run((wb) => setBackColor(wb, fillColor))}
                  onOpenPicker={(rect) => {
                    setColorAnchor(rect);
                    setColorPop("fill");
                  }}
                >
                  <PaintBucket size={13} />
                </ColorSplitBtn>
                <ColorSplitBtn
                  title="字体颜色"
                  color={foreColor}
                  onApply={() => run((wb) => setForeColor(wb, foreColor))}
                  onOpenPicker={(rect) => {
                    setColorAnchor(rect);
                    setColorPop("fore");
                  }}
                >
                  <Type size={13} />
                </ColorSplitBtn>
                <ToolBtn
                  title="清除格式"
                  onClick={() => run(clearFormat)}
                >
                  <Eraser size={14} />
                </ToolBtn>
            </RibbonGroup>

            <VSep />

            {/* 对齐：宽屏单行，不再强制两行 */}
            <RibbonGroup label="对齐">
                  <ToolBtn
                    title="顶端对齐"
                    onClick={() => run((wb) => setVAlign(wb, "top"))}
                  >
                    <ArrowUpToLine size={14} />
                  </ToolBtn>
                  <ToolBtn
                    title="垂直居中"
                    onClick={() => run((wb) => setVAlign(wb, "middle"))}
                  >
                    <span className="text-[14px] font-medium leading-none">
                      中
                    </span>
                  </ToolBtn>
                  <ToolBtn
                    title="底端对齐"
                    onClick={() => run((wb) => setVAlign(wb, "bottom"))}
                  >
                    <ArrowDownToLine size={14} />
                  </ToolBtn>
                  <ToolBtn
                    title="自动换行"
                    onClick={() => run(toggleWrap)}
                  >
                    <WrapText size={14} />
                    <span className="ml-0.5 text-[14px]">换行</span>
                  </ToolBtn>
                  <ToolBtn
                    title="左对齐"
                    onClick={() => run((wb) => setHAlign(wb, "left"))}
                  >
                    <AlignLeft size={14} />
                  </ToolBtn>
                  <ToolBtn
                    title="居中"
                    onClick={() => run((wb) => setHAlign(wb, "center"))}
                  >
                    <AlignCenter size={14} />
                  </ToolBtn>
                  <ToolBtn
                    title="右对齐"
                    onClick={() => run((wb) => setHAlign(wb, "right"))}
                  >
                    <AlignRight size={14} />
                  </ToolBtn>
                  <ToolBtn
                    title="两端对齐"
                    onClick={() => run((wb) => setHAlign(wb, "justify"))}
                  >
                    <AlignJustify size={14} />
                  </ToolBtn>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-1.5 text-[12px] outline-none hover:bg-black/[0.06]">
                      <Merge size={14} />
                      <span className="text-[14px]">合并</span>
                      <ChevronDown size={11} className="opacity-50" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() => run(mergeAndCenter)}
                      >
                        合并后居中
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => run(mergeSelection)}
                      >
                        合并单元格
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => run(unmergeSelection)}
                      >
                        取消合并
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
            </RibbonGroup>

            <VSep />

            {/* 数字：宽屏单行 */}
            <RibbonGroup label="数字">
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-7 min-w-[72px] items-center justify-between gap-0.5 rounded-[5px] border border-black/[0.08] bg-white px-2 text-[12px] outline-none hover:bg-black/[0.04]">
                      <span className="truncate text-[14px]">{numLabel}</span>
                      <ChevronDown size={12} className="opacity-50" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {numberFormats.map((it) => (
                        <DropdownMenuItem
                          key={it.key}
                          onClick={() => {
                            setNumLabel(it.label);
                            run((wb) => setNumberFormat(wb, it.key));
                          }}
                        >
                          {it.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                      <span className="text-[14px]">转换</span>
                      <ChevronDown size={11} className="opacity-50" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onClick={() =>
                          run((wb) => convertSelection(wb, "number"))
                        }
                      >
                        转为数值
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          run((wb) => convertSelection(wb, "text"))
                        }
                      >
                        转为文本
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <ToolBtn
                    title="货币"
                    onClick={() => {
                      setNumLabel("货币");
                      run((wb) => setNumberFormat(wb, "currency"));
                    }}
                  >
                    <span className="text-[12px] font-medium">¥</span>
                  </ToolBtn>
                  <ToolBtn
                    title="百分比"
                    onClick={() => {
                      setNumLabel("百分比");
                      run((wb) => setNumberFormat(wb, "percent"));
                    }}
                  >
                    <Percent size={14} />
                  </ToolBtn>
                  <ToolBtn
                    title="千分位"
                    onClick={() => {
                      setNumLabel("千分位");
                      run((wb) => setNumberFormat(wb, "comma"));
                    }}
                  >
                    <span className="text-[11px] font-medium">000</span>
                  </ToolBtn>
                  <ToolBtn
                    title="增加小数位数"
                    onClick={() => run((wb) => changeDecimalPlaces(wb, 1))}
                  >
                    <span className="text-[14px] font-medium">.0↑</span>
                  </ToolBtn>
                  <ToolBtn
                    title="减少小数位数"
                    onClick={() => run((wb) => changeDecimalPlaces(wb, -1))}
                  >
                    <span className="text-[14px] font-medium">.0↓</span>
                  </ToolBtn>
            </RibbonGroup>

            <VSep />

            {/* 编辑 */}
            <RibbonGroup label="编辑">
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <span className="text-[14px]">填充</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => run((wb) => fillSelection(wb, "down"))}
                    >
                      向下填充
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => run((wb) => fillSelection(wb, "right"))}
                    >
                      向右填充
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => run((wb) => fillSelection(wb, "up"))}
                    >
                      向上填充
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => run((wb) => fillSelection(wb, "left"))}
                    >
                      向左填充
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-1 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <Sigma size={14} />
                    <span className="text-[14px]">求和</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {AUTOSUM_ITEMS.map((it) => (
                      <DropdownMenuItem
                        key={it.name}
                        onClick={() =>
                          run((wb) =>
                            insertAutoFormula(
                              wb,
                              it.name as
                                | "SUM"
                                | "AVERAGE"
                                | "COUNT"
                                | "MAX"
                                | "MIN",
                            ),
                          )
                        }
                      >
                        {it.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <SortAsc size={14} />
                    <span className="text-[14px]">排序</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => run((wb) => sortSelection(wb, true))}
                    >
                      <SortAsc size={14} /> 升序
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => run((wb) => sortSelection(wb, false))}
                    >
                      <SortDesc size={14} /> 降序
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <ToolBtn
                  title="筛选"
                  onClick={() => run(toggleFilter)}
                >
                  <Filter size={14} />
                  <span className="ml-0.5 text-[14px]">筛选</span>
                </ToolBtn>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <Columns size={14} />
                    <span className="text-[14px]">冻结</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onClick={() => run(freezeAtActive)}>
                      冻结窗格
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        run((wb) =>
                          wb.freeze("row", { row: 0, column: 0 }),
                        )
                      }
                    >
                      冻结首行
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        run((wb) =>
                          wb.freeze("column", { row: 0, column: 0 }),
                        )
                      }
                    >
                      冻结首列
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => run(unfreeze)}>
                      取消冻结
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <ToolBtn
                  title="查找"
                  onClick={() => {
                    void (async () => {
                      const q = await showPrompt("查找内容");
                      if (q == null || !q.trim()) return;
                      const workbook = getWorkbook();
                      if (!workbook) return;
                      const ok = findAndSelect(workbook, q);
                      if (!ok) await showAlert("未找到匹配内容");
                      else onDirty();
                    })();
                  }}
                >
                  <Search size={14} />
                  <span className="ml-0.5 text-[14px]">查找</span>
                </ToolBtn>
            </RibbonGroup>
          </>
        ) : null}

        {tab === "data" ? (
          <>
            <RibbonGroup label="排序和筛选">
                <ToolBtn title="筛选" onClick={() => run(toggleFilter)}>
                  <Filter className="mt-[0.135rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">筛选</span>
                </ToolBtn>
                <ToolBtn title="全部显示" onClick={() => run(clearFilter)}>
                  <Eye className="mt-[0.135rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">全部显示</span>
                </ToolBtn>
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <SortAsc className="mt-[0.135rem]" size={14} />
                    <span className="text-[12px]">排序</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => run((wb) => sortSelection(wb, true))}
                    >
                      <SortAsc size={14} className="mr-1.5 mt-[0.135rem]" />
                      升序
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => run((wb) => sortSelection(wb, false))}
                    >
                      <SortDesc size={14} className="mr-1.5 mt-[0.135rem]" />
                      降序
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
            </RibbonGroup>

            <VSep />

            <RibbonGroup label="数据工具">
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <Copy className="mt-[0.135rem] mr-0.5" size={14} />
                    <span className="text-[12px]">重复项</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() =>
                        run((wb) => {
                          const n = removeDuplicateRows(wb);
                          void showAlert(
                            n > 0 ? `已删除 ${n} 行重复项` : "未发现重复行",
                          );
                        })
                      }
                    >
                      删除重复项
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() =>
                        run((wb) => {
                          const n = highlightDuplicateCells(wb);
                          void showAlert(
                            n > 0 ? `已标记 ${n} 个重复单元格` : "未发现重复值",
                          );
                        })
                      }
                    >
                      标记重复值
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <ToolBtn
                  title="分列"
                  onClick={() => {
                    void (async () => {
                      const sep = await showPrompt(
                        "分列",
                        ",",
                        "请输入分隔符（如 , 或 空格 或 Tab）",
                      );
                      if (sep == null) return;
                      run((wb) => {
                        const n = splitTextToColumns(
                          wb,
                          sep === "\\t" || sep.toLowerCase() === "tab"
                            ? "\t"
                            : sep,
                        );
                        if (n <= 1) {
                          void showAlert("未能分列，请检查选区与分隔符");
                        }
                      });
                    })();
                  }}
                >
                  <SplitSquareHorizontal className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">分列</span>
                </ToolBtn>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <ArrowDownToLine className="mt-[0.1rem]" size={14} />
                    <span className="text-[12px]">填充</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(
                      [
                        ["向下填充", "down"],
                        ["向右填充", "right"],
                        ["向上填充", "up"],
                        ["向左填充", "left"],
                      ] as const
                    ).map(([label, dir]) => (
                      <DropdownMenuItem
                        key={dir}
                        onClick={() =>
                          run((wb) => fillSelection(wb, dir))
                        }
                      >
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <ToolBtn
                  title="下拉列表"
                  onClick={() => {
                    void (async () => {
                      const raw = await showPrompt(
                        "下拉列表",
                        "选项1,选项2,选项3",
                        "下拉选项（用逗号分隔）",
                      );
                      if (raw == null || !raw.trim()) return;
                      run((wb) => applyDropdownList(wb, raw));
                    })();
                  }}
                >
                  <List className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">下拉列表</span>
                </ToolBtn>

                <ToolBtn
                  title="查找"
                  onClick={() => {
                    void (async () => {
                      const q = await showPrompt("查找内容");
                      if (q == null || !q.trim()) return;
                      const workbook = getWorkbook();
                      if (!workbook) return;
                      const ok = findAndSelect(workbook, q);
                      if (!ok) await showAlert("未找到匹配内容");
                      else onDirty();
                    })();
                  }}
                >
                  <Search className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">查找</span>
                </ToolBtn>
            </RibbonGroup>

            <VSep />

            <RibbonGroup label="获取数据">
                <ToolBtn title="导入文件" onClick={onImport}>
                  <Database  size={14} />
                  <span className="ml-0.5 text-[12px]">导入文件</span>
                </ToolBtn>
            </RibbonGroup>
          </>
        ) : null}

        {tab === "formula" ? (
          <>
            <RibbonGroup label="函数">
                <ToolBtn
                  title="插入函数"
                  onClick={() => {
                    void (async () => {
                      const all = FORMULA_GROUPS.flatMap((g) =>
                        g.items.map((it) => it.name),
                      );
                      const name = await showPrompt(
                        "插入函数",
                        "SUM",
                        `输入函数名（如 SUM）\n可用: ${all.slice(0, 20).join(", ")}…`,
                      );
                      if (!name?.trim()) return;
                      const upper = name.trim().toUpperCase();
                      const hit = FORMULA_GROUPS.flatMap((g) => g.items).find(
                        (it) => it.name === upper,
                      );
                      run((wb) =>
                        insertFormulaTemplate(
                          wb,
                          hit?.template ?? `=${upper}(`,
                        ),
                      );
                    })();
                  }}
                >
                  <FunctionSquare className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[14px]">插入</span>
                </ToolBtn>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <Sigma  size={14} />
                    <span className="text-[14px]">求和</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {AUTOSUM_ITEMS.map((it) => (
                      <DropdownMenuItem
                        key={it.name}
                        onClick={() =>
                          run((wb) =>
                            insertAutoFormula(
                              wb,
                              it.name as
                                | "SUM"
                                | "AVERAGE"
                                | "COUNT"
                                | "MAX"
                                | "MIN",
                            ),
                          )
                        }
                      >
                        {it.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <Star className="mt-[0.1rem]" size={14} />
                    <span className="text-[14px]">常用</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="max-h-64 overflow-y-auto"
                  >
                    {FORMULA_GROUPS[0].items.map((it) => (
                      <DropdownMenuItem
                        key={it.name}
                        onClick={() =>
                          run((wb) => insertFormulaTemplate(wb, it.template))
                        }
                      >
                        {it.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
            </RibbonGroup>

            <VSep />

            <RibbonGroup label="函数库">
                {FORMULA_GROUPS.filter((g) => g.id !== "common").map((g) => (
                  <DropdownMenu key={g.id}>
                    <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                      <span className="text-[12px]">{g.label}</span>
                      <ChevronDown size={11} className="opacity-50" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="max-h-64 overflow-y-auto"
                    >
                      {g.items.map((it) => (
                        <DropdownMenuItem
                          key={`${g.id}-${it.name}`}
                          onClick={() =>
                            run((wb) =>
                              insertFormulaTemplate(wb, it.template),
                            )
                          }
                        >
                          {it.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ))}
            </RibbonGroup>

            <VSep />

            <RibbonGroup label="公式审核">
                <ToolBtn
                  title="显示公式"
                  onClick={() => {
                    const workbook = getWorkbook();
                    if (!workbook) return;
                    const list = listSelectionFormulas(workbook);
                    void showAlert(
                      list.length
                        ? list.join("\n")
                        : "选区内没有公式（请先选中含公式的单元格）",
                      "显示公式",
                    );
                  }}
                >
                  <FunctionSquare className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">显示公式</span>
                </ToolBtn>
                <ToolBtn
                  title="错误检查"
                  onClick={() => {
                    const workbook = getWorkbook();
                    if (!workbook) return;
                    const ok = findFirstFormulaError(workbook);
                    if (!ok) void showAlert("未发现错误值");
                    else onDirty();
                  }}
                >
                  <AlertTriangle className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">错误检查</span>
                </ToolBtn>
            </RibbonGroup>

            <VSep />

            <RibbonGroup label="计算">
                <ToolBtn
                  title="重算工作簿"
                  onClick={() => run(recalculateWorkbook)}
                >
                  <RefreshCw className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">重算工作簿</span>
                </ToolBtn>
                <ToolBtn
                  title="计算工作表"
                  onClick={() => run(recalculateWorkbook)}
                >
                  <Calculator className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">计算工作表</span>
                </ToolBtn>
            </RibbonGroup>
          </>
        ) : null}

        {tab === "page" ? (
          <>
            <RibbonGroup label="页面设置">
                <ToolBtn
                  title="打印预览"
                  onClick={() => {
                    const wb = getWorkbook();
                    if (!wb) return;
                    openPrintPreview(wb);
                  }}
                >
                  <Printer className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">打印预览</span>
                </ToolBtn>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <span className="text-[12px]">页边距</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(
                      [
                        ["normal", "常规"],
                        ["wide", "宽"],
                        ["narrow", "窄"],
                        ["none", "无"],
                      ] as const
                    ).map(([id, label]) => (
                      <DropdownMenuItem
                        key={id}
                        onClick={() =>
                          updatePage({ margin: id as MarginPreset })
                        }
                      >
                        <span className="text-[14px]">{label}</span>
                        {pageSetup.margin === id ? " ✓" : ""}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <span className="text-[12px]">纸张方向</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(
                      [
                        ["portrait", "纵向"],
                        ["landscape", "横向"],
                      ] as const
                    ).map(([id, label]) => (
                      <DropdownMenuItem
                        key={id}
                        onClick={() =>
                          updatePage({
                            orientation: id as PageOrientation,
                          })
                        }
                      >
                        {label}
                        {pageSetup.orientation === id ? " ✓" : ""}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <span className="text-[12px]">纸张大小</span> 
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {(
                      [
                        ["A4", "A4"],
                        ["A3", "A3"],
                        ["Letter", "Letter"],
                        ["Legal", "Legal"],
                      ] as const
                    ).map(([id, label]) => (
                      <DropdownMenuItem
                        key={id}
                        onClick={() =>
                          updatePage({ paperSize: id as PaperSizeId })
                        }
                      >
                        {label}
                        {pageSetup.paperSize === id ? " ✓" : ""}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <span className="text-[12px]">打印区域</span>   
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() =>
                        run((wb) => {
                          setPrintAreaFromSelection(wb);
                          setPageSetup(getPageSetup());
                        })
                      }
                    >
                      设置打印区域
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        clearPrintArea();
                        setPageSetup(getPageSetup());
                        onDirty();
                      }}
                    >
                      取消打印区域
                    </DropdownMenuItem>
                    {pageSetup.printArea ? (
                      <DropdownMenuItem disabled>
                        当前：{pageSetup.printArea}
                      </DropdownMenuItem>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <span className="text-[12px]">打印缩放</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {[50, 75, 100, 125, 150].map((n) => (
                      <DropdownMenuItem
                        key={n}
                        onClick={() =>
                          updatePage({ scale: n, fitToPage: false })
                        }
                      >
                        {n}%{pageSetup.scale === n && !pageSetup.fitToPage ? " ✓" : ""}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => updatePage({ fitToPage: true })}
                    >
                      调整为1页宽
                      {pageSetup.fitToPage ? " ✓" : ""}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <span className="text-[12px]">打印标题</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      onClick={() => {
                        setPrintTitlesFirstRow();
                        setPageSetup(getPageSetup());
                        onDirty();
                      }}
                    >
                      重复打印首行
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        clearPrintTitles();
                        setPageSetup(getPageSetup());
                        onDirty();
                      }}
                    >
                      取消打印标题
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <ToolBtn
                  title="页眉页脚"
                  onClick={() => {
                    void (async () => {
                      const header = await showPrompt(
                        "页眉",
                        pageSetup.header,
                      );
                      if (header == null) return;
                      const footer = await showPrompt(
                        "页脚",
                        pageSetup.footer,
                        "可用 &P 表示页码",
                      );
                      if (footer == null) return;
                      updatePage({ header, footer });
                    })();
                  }}
                >
                  <FileText className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">页眉页脚</span>
                </ToolBtn>

                <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-2 text-[12px] hover:bg-black/[0.06]">
                  <input
                    type="checkbox"
                    className="accent-[#0071e3]"
                    checked={pageSetup.printGridlines}
                    onChange={(e) =>
                      updatePage({ printGridlines: e.target.checked })
                    }
                  />
                  <span className="text-[12px]">打印网格线</span>
                </label>
                <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-2 text-[12px] hover:bg-black/[0.06]">
                  <input
                    type="checkbox"
                    className="accent-[#0071e3]"
                    checked={pageSetup.printHeadings}
                    onChange={(e) =>
                      updatePage({ printHeadings: e.target.checked })
                    }
                  />
                  <span className="text-[12px]">打印行号列标</span>
                </label>
                <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-[5px] px-2 text-[12px] hover:bg-black/[0.06]">
                  <input
                    type="checkbox"
                    className="accent-[#0071e3]"
                    checked={pageSetup.showGridLines}
                    onChange={(e) => {
                      const show = e.target.checked;
                      run((wb) => setSheetGridLines(wb, show));
                      setPageSetup(getPageSetup());
                    }}
                  />
                  <span className="text-[12px]">显示网格线</span>
                </label>
            </RibbonGroup>

            <VSep />

            <RibbonGroup label="主题">
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex h-7 items-center gap-0.5 rounded-[5px] px-2 text-[12px] outline-none hover:bg-black/[0.06]">
                    <span className="text-[12px]">主题</span>
                    <ChevronDown size={11} className="opacity-50" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {listThemePresets().map((t) => (
                      <DropdownMenuItem
                        key={t.id}
                        onClick={() =>
                          run((wb) => applyThemeToSelection(wb, t.id))
                        }
                      >
                        {t.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <ToolBtn
                  title="表格美化"
                  onClick={() => run(beautifyTableSelection)}
                >
                  <WandSparkles className="mt-[0.1rem]" size={14} />
                  <span className="ml-0.5 text-[12px]">表格美化</span>
                </ToolBtn>
            </RibbonGroup>
          </>
        ) : null}
      </div>

      {colorPop && colorAnchor ? (
        <ColorPickerPop
          anchor={colorAnchor}
          value={colorPop === "fore" ? foreColor : fillColor}
          colors={colorPop === "fore" ? TEXT_COLORS : HIGHLIGHT_COLORS}
          clearLabel={colorPop === "fore" ? "自动" : "无填充"}
          title={colorPop === "fore" ? "字体颜色" : "填充颜色"}
          onPick={(hex) => {
            if (!hex) {
              if (colorPop === "fore") {
                onForeColor("#1d1d1f");
                run((wb) => setForeColor(wb, "#1d1d1f"));
              } else {
                onFillColor("#ffffff");
                run((wb) => setBackColor(wb, "#ffffff"));
              }
            } else if (colorPop === "fore") {
              onForeColor(hex);
              run((wb) => setForeColor(wb, hex));
            } else {
              onFillColor(hex);
              run((wb) => setBackColor(wb, hex));
            }
            setColorPop(null);
          }}
          onClose={() => setColorPop(null)}
        />
      ) : null}
    </div>
  );
});
