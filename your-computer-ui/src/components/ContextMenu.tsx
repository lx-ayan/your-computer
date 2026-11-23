import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AppWindow,
  Archive,
  ChevronRight,
  Copy,
  FilePlus,
  FolderPlus,
  Info,
  Layers,
  Pencil,
  RefreshCw,
  Scissors,
  Share,
  Star,
  SquareArrowOutUpRight,
  Terminal,
  Trash2,
  RotateCcw,
} from "lucide-react";
import {
  DEFAULT_LIQUID_GLASS_CONFIG,
  LiquidGlass,
} from "./LiquidGlass";

export type ContextMenuKind = "item" | "blank";

export type ContextMenuSurface = "normal" | "favorites" | "trash";

export type ContextMenuState = {
  x: number;
  y: number;
  kind: ContextMenuKind;
  /** 右键命中的文件 id；空白区为 null */
  itemId: string | null;
  itemName: string | null;
  itemPath: string | null;
  /** 是否为文件（非文件夹）；空白区为 false */
  isFile: boolean;
  /** 当前是否多选 */
  multiSelect: boolean;
  showMore: boolean;
  showOpenWith: boolean;
  /** 打开方式 → 内置 子菜单 */
  showBuiltinEditors?: boolean;
  /** 收藏视图专用菜单 */
  surface?: ContextMenuSurface;
  /** 收藏夹节点（非收藏条目） */
  isFavoriteFolder?: boolean;
};

export const BUILTIN_EDITORS = [
  { id: "builtin-word", label: "Word 编辑器" },
  { id: "builtin-markdown", label: "Markdown 编辑器" },
  { id: "builtin-excel", label: "Excel 编辑器" },
] as const;

export type OpenWithApp = {
  id: string;
  name: string;
  isDefault: boolean;
};

type MenuRow =
  | {
      type: "item";
      id: string;
      label: string;
      icon?: LucideIcon;
      chevron?: boolean;
    }
  | { type: "sep" }
  | { type: "tags" }
  | { type: "more-windows"; items: { id: string; label: string }[] };

const TAG_COLORS = [
  "#ff3b30",
  "#ff9500",
  "#ffcc00",
  "#28cd41",
  "#007aff",
  "#af52de",
  "#8e8e93",
];

const WINDOWS_MORE_ITEMS = [
  { id: "win-pin", label: "固定到「快速访问」" },
  { id: "win-zip", label: "压缩为 ZIP 文件" },
  { id: "win-path", label: "复制为路径" },
];

const ITEM_PAD = "px-2.5 py-[4px]";

function buildTrashRows(kind: ContextMenuKind): MenuRow[] {
  if (kind === "blank") {
    return [
      {
        type: "item",
        id: "trash-empty",
        label: "清倒废纸篓",
        icon: Trash2,
      },
    ];
  }
  return [
    { type: "item", id: "trash-restore", label: "还原", icon: RotateCcw },
    { type: "sep" },
    {
      type: "item",
      id: "trash-delete",
      label: "立即删除",
      icon: Trash2,
    },
  ];
}

function buildFavoritesRows(
  kind: ContextMenuKind,
  isFavoriteFolder: boolean,
  isFile = false,
  multiSelect = false,
): MenuRow[] {
  if (kind === "blank") {
    return [
      {
        type: "item",
        id: "fav-new-folder",
        label: "新建收藏夹",
        icon: FolderPlus,
      },
    ];
  }
  if (isFavoriteFolder) {
    return [
      { type: "item", id: "open", label: "打开", icon: SquareArrowOutUpRight },
      { type: "sep" },
      {
        type: "item",
        id: "fav-rename-folder",
        label: "重新命名",
        icon: Pencil,
      },
      {
        type: "item",
        id: "fav-delete-folder",
        label: "删除收藏夹",
        icon: Trash2,
      },
    ];
  }
  const openRows: MenuRow[] = multiSelect
    ? []
    : [
        { type: "item", id: "open", label: "打开", icon: SquareArrowOutUpRight },
        ...(isFile
          ? [
              {
                type: "item" as const,
                id: "open-with",
                label: "打开方式",
                chevron: true,
              },
            ]
          : []),
      ];
  return [
    ...openRows,
    ...(openRows.length ? [{ type: "sep" as const }] : []),
    {
      type: "item",
      id: "fav-remove",
      label: "移除收藏",
      icon: Star,
    },
  ];
}

function buildRows(
  kind: ContextMenuKind,
  itemName: string | null,
  isFile: boolean,
  showMore: boolean,
  canPaste: boolean,
  multiSelect: boolean,
  surface: ContextMenuSurface = "normal",
  isFavoriteFolder = false,
  enableTags = true,
): MenuRow[] {
  if (surface === "favorites") {
    return buildFavoritesRows(kind, isFavoriteFolder, isFile, multiSelect);
  }
  if (surface === "trash") {
    return buildTrashRows(kind);
  }

  const compressLabel = itemName ? `压缩 “${itemName}”` : "压缩";
  const customizeLabel =
    kind === "item" ? "自定义标签…" : "自定义文件夹…";

  const openWithRow: MenuRow = {
    type: "item",
    id: "open-with",
    label: "打开方式",
    chevron: true,
  };

  const pasteRow: MenuRow[] = canPaste
    ? [{ type: "item", id: "paste", label: "粘贴", icon: Copy }]
    : [];

  const tagRows: MenuRow[] = enableTags
    ? [
        { type: "sep" },
        { type: "tags" },
        { type: "item", id: "customize-tags", label: customizeLabel },
      ]
    : [];

  // 多选时隐藏「打开」相关项
  const openRows: MenuRow[] = multiSelect
    ? []
    : [
        { type: "item", id: "open", label: "打开", icon: SquareArrowOutUpRight },
        ...(isFile ? [openWithRow] : []),
        {
          type: "item",
          id: "open-window",
          label: "新窗口打开",
          icon: AppWindow,
        },
      ];

  const head: MenuRow[] =
    kind === "blank"
      ? [
          { type: "item", id: "refresh", label: "刷新", icon: RefreshCw },
          { type: "sep" },
          { type: "item", id: "new-folder", label: "新建文件夹", icon: FolderPlus },
          { type: "item", id: "new-file", label: "新建文件", icon: FilePlus },
          {
            type: "item",
            id: "batch-create",
            label: "批量创建…",
            icon: Layers,
          },
          { type: "item", id: "open", label: "打开", icon: SquareArrowOutUpRight },
          {
            type: "item",
            id: "open-window",
            label: "新窗口打开",
            icon: AppWindow,
          },
          ...pasteRow,
          { type: "sep" },
          { type: "item", id: "get-info", label: "显示简介", icon: Info },
          { type: "sep" },
          { type: "item", id: "share", label: "共享…", icon: Share },
          ...tagRows,
          { type: "sep" },
          { type: "item", id: "open-terminal", label: "在终端打开", icon: Terminal },
          {
            type: "item",
            id: "show-more",
            label: "显示更多",
            chevron: !showMore,
          },
        ]
      : [
          ...openRows,
          { type: "item", id: "favorite", label: "收藏", icon: Star },
          { type: "sep" },
          { type: "item", id: "trash", label: "移到废纸篓", icon: Trash2 },
          { type: "sep" },
          { type: "item", id: "get-info", label: "显示简介", icon: Info },
          { type: "item", id: "rename", label: "重新命名", icon: Pencil },
          { type: "item", id: "compress", label: compressLabel, icon: Archive },
          { type: "item", id: "duplicate", label: "复制", icon: Copy },
          { type: "sep" },
          { type: "item", id: "cut", label: "剪切", icon: Scissors },
          ...pasteRow,
          { type: "item", id: "share", label: "共享…", icon: Share },
          ...tagRows,
          { type: "sep" },
          { type: "item", id: "open-terminal", label: "在终端打开", icon: Terminal },
          {
            type: "item",
            id: "show-more",
            label: "显示更多",
            chevron: !showMore,
          },
        ];

  if (showMore) {
    head.push({ type: "more-windows", items: WINDOWS_MORE_ITEMS });
  }
  return head;
}

type Props = {
  menu: ContextMenuState;
  openWithApps: OpenWithApp[];
  canPaste: boolean;
  enableTags?: boolean;
  onClose: () => void;
  onToggleMore: () => void;
  onToggleOpenWith: () => void;
  onToggleBuiltinEditors: () => void;
  onAction: (id: string) => void;
};

export function ContextMenu({
  menu,
  openWithApps,
  canPaste,
  enableTags = true,
  onClose,
  onToggleMore,
  onToggleOpenWith,
  onToggleBuiltinEditors,
  onAction,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(280);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y });
  const [openWithTop, setOpenWithTop] = useState(0);

  const rows = useMemo(
    () =>
      buildRows(
        menu.kind,
        menu.itemName,
        menu.isFile,
        menu.showMore,
        canPaste,
        menu.multiSelect,
        menu.surface ?? "normal",
        Boolean(menu.isFavoriteFolder),
        enableTags,
      ),
    [
      menu.kind,
      menu.itemName,
      menu.isFile,
      menu.showMore,
      menu.multiSelect,
      canPaste,
      menu.surface,
      menu.isFavoriteFolder,
      enableTags,
    ],
  );

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const next = Math.max(120, Math.ceil(el.scrollHeight));
    setHeight(next);

    const pad = 8;
    const width = 248;
    const subW =
      (menu.showOpenWith ? 200 : 0) + (menu.showBuiltinEditors ? 180 : 0);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = menu.x;
    let top = menu.y;
    if (left + width + subW + pad > vw) {
      left = Math.max(pad, vw - width - subW - pad);
    }
    if (top + next + pad > vh) top = Math.max(pad, vh - next - pad);
    setPos({ left, top });

    const openWithBtn = el.querySelector<HTMLElement>('[data-menu-id="open-with"]');
    if (openWithBtn) {
      setOpenWithTop(openWithBtn.offsetTop);
    }
  }, [
    menu.x,
    menu.y,
    rows,
    menu.showMore,
    menu.showOpenWith,
    menu.showBuiltinEditors,
  ]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const onScroll = () => onClose();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [onClose]);

  const glassConfig = {
    ...DEFAULT_LIQUID_GLASS_CONFIG,
    frost: 3.2,
    tint: 0.28,
    scale: 28,
  };

  return (
    <div
      ref={rootRef}
      className="fixed z-[80]"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="relative" style={{ width: 248 }}>
        <LiquidGlass
          className="w-[248px] shadow-[0_0_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)]"
          style={{ height }}
          contentClassName="flex h-full min-h-0 w-full flex-col overflow-hidden pt-1 pb-2"
          config={glassConfig}
          radius={12}
        >
          <div ref={measureRef} className="w-full pb-1.5">
            {rows.map((row, idx) => {
              if (row.type === "sep") {
                return (
                  <div
                    key={`sep-${idx}`}
                    className="mx-3 my-1 h-px bg-black/10"
                  />
                );
              }
              if (row.type === "tags") {
                return (
                  <div
                    key={`tags-${idx}`}
                    className="flex items-center gap-[7px] px-3.5 py-1"
                  >
                    {TAG_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className="size-[14px] rounded-full outline-none ring-offset-1 hover:ring-2 hover:ring-black/15"
                        style={{ backgroundColor: color }}
                        aria-label="标签颜色"
                        onClick={() => {
                          onAction(`tag-${color}`);
                          onClose();
                        }}
                      />
                    ))}
                  </div>
                );
              }
              if (row.type === "more-windows") {
                return (
                  <ul key={`win-${idx}`} className="px-1.5 pb-0.5">
                    {row.items.map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className={`flex w-full items-center rounded-[6px] ${ITEM_PAD} pl-9 text-left text-[13px] text-[var(--finder-text)] hover:bg-black/[0.06]`}
                          onClick={() => {
                            onAction(item.id);
                            onClose();
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {item.label}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                );
              }

              const Icon = row.icon;
              const activeOpenWith =
                row.id === "open-with" && menu.showOpenWith;
              return (
                <div key={row.id} className="px-1.5">
                  <button
                    type="button"
                    data-menu-id={row.id}
                    className={`flex w-full items-center gap-2.5 rounded-[6px] ${ITEM_PAD} text-left text-[13px] text-[var(--finder-text)] hover:bg-black/[0.06] ${
                      activeOpenWith ? "bg-black/[0.06]" : ""
                    }`}
                    onClick={() => {
                      if (row.id === "show-more") {
                        onToggleMore();
                        return;
                      }
                      if (row.id === "open-with") {
                        onToggleOpenWith();
                        return;
                      }
                      onAction(row.id);
                      onClose();
                    }}
                  >
                    {Icon ? (
                      <Icon
                        className="size-[15px] shrink-0 opacity-70"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <span className="size-[15px] shrink-0" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                    {row.chevron ? (
                      <ChevronRight
                        className="size-3.5 shrink-0 opacity-50"
                        strokeWidth={2}
                      />
                    ) : null}
                  </button>
                </div>
              );
            })}
          </div>
        </LiquidGlass>

        {menu.showOpenWith ? (
          <div
            className="absolute top-0 left-[calc(100%+4px)] w-[200px]"
            style={{ top: openWithTop }}
          >
            <LiquidGlass
              className="w-[200px] shadow-[0_0_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)]"
              style={{
                height: Math.max(
                  112,
                  8 +
                    28 + // 内置
                    8 + // sep
                    (openWithApps.length ? openWithApps.length : 1) * 28,
                ),
              }}
              contentClassName="flex h-full min-h-0 w-full flex-col overflow-hidden py-1"
              config={glassConfig}
              radius={12}
            >
              <ul className="px-1.5">
                <li>
                  <button
                    type="button"
                    data-menu-id="builtin-editors"
                    className={`flex w-full items-center rounded-[6px] ${ITEM_PAD} text-left text-[13px] text-[var(--finder-text)] hover:bg-black/[0.06] ${
                      menu.showBuiltinEditors ? "bg-black/[0.06]" : ""
                    }`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleBuiltinEditors();
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">内置</span>
                    <ChevronRight
                      className="size-3.5 shrink-0 opacity-50"
                      strokeWidth={2}
                    />
                  </button>
                </li>
                <li className="my-1 border-t border-black/[0.08]" />
                {openWithApps.length === 0 ? (
                  <li className={`${ITEM_PAD} text-[12px] text-[var(--finder-text-muted)]`}>
                    加载中…
                  </li>
                ) : (
                  openWithApps.map((app) => (
                    <li key={app.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center rounded-[6px] ${ITEM_PAD} text-left text-[13px] text-[var(--finder-text)] hover:bg-black/[0.06]`}
                        onClick={() => {
                          onAction(`open-with:${app.id}`);
                          onClose();
                        }}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {app.name}
                          {app.isDefault ? "（默认）" : ""}
                        </span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </LiquidGlass>

            {menu.showBuiltinEditors ? (
              <div className="absolute top-0 left-[calc(100%+4px)] w-[180px]">
                <LiquidGlass
                  className="w-[180px] shadow-[0_0_8px_rgba(0,0,0,0.06),0_8px_24px_rgba(0,0,0,0.12)]"
                  style={{ height: 8 + BUILTIN_EDITORS.length * 28 }}
                  contentClassName="flex h-full min-h-0 w-full flex-col overflow-hidden py-1"
                  config={glassConfig}
                  radius={12}
                >
                  <ul className="px-1.5">
                    {BUILTIN_EDITORS.map((ed) => (
                      <li key={ed.id}>
                        <button
                          type="button"
                          className={`flex w-full items-center rounded-[6px] ${ITEM_PAD} text-left text-[13px] text-[var(--finder-text)] hover:bg-black/[0.06]`}
                          onClick={() => {
                            onAction(ed.id);
                            onClose();
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {ed.label}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </LiquidGlass>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
