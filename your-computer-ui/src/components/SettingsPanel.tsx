import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Download,
  Folder,
  Heart,
  Image as ImageIcon,
  Info,
  Music,
  Network,
  Plus,
  Search,
  Settings,
  Video,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_LIQUID_GLASS_CONFIG,
  LiquidGlass,
} from "./LiquidGlass";
import {
  loadAppSettings,
  patchAppSettings,
  type AppSettings,
} from "../lib/appSettings";
import {
  GLOBAL_ICON_LABELS,
  decodePickTarget,
  encodePickTarget,
  loadIconSettings,
  migrateIconBlackBackgrounds,
  normalizeExt,
  removeCustomIcon,
  setGlobalIcon,
  takePendingAvatar,
  takePendingCustomIcon,
  updateCustomIconImage,
  upsertCustomIcon,
  type GlobalIconKey,
  type IconSettings,
  type PickTargetPayload,
} from "../lib/iconSettings";
import {
  avatarFromLocalPath,
  iconFromLocalPath,
  loadProfile,
  profileInitial,
  saveProfile,
  type UserProfile,
} from "../lib/profile";
import payWx from "../assets/pay/wx.jpg";
import payZfb from "../assets/pay/zfb.jpg";

type PickTarget = PickTargetPayload;

const GLOBAL_ICON_ROWS: {
  key: GlobalIconKey;
  icon: LucideIcon;
}[] = [
  { key: "folder", icon: Folder },
  { key: "video", icon: Video },
  { key: "audio", icon: Music },
];

type SectionId =
  | "basic"
  | "general"
  | "icons"
  | "lan"
  | "apps"
  | "donate";

const SIDEBAR: {
  id: SectionId;
  label: string;
  icon: LucideIcon;
  color: string;
}[] = [
  { id: "basic", label: "基本信息", icon: Info, color: "#007aff" },
  { id: "general", label: "通用设置", icon: Settings, color: "#8e8e93" },
  { id: "icons", label: "图标设置", icon: ImageIcon, color: "#af52de" },
  { id: "lan", label: "局域网", icon: Network, color: "#34c759" },
  { id: "apps", label: "APP 下载", icon: Download, color: "#ff9500" },
  { id: "donate", label: "赞赏", icon: Heart, color: "#ff2d55" },
];

const SECTION_META: Record<
  SectionId,
  { title: string; desc: string; icon: LucideIcon; color: string }
> = {
  basic: {
    title: "基本信息",
    desc: "本机名称、头像与网络地址等基础信息",
    icon: Info,
    color: "#007aff",
  },
  general: {
    title: "通用设置",
    desc: "启动、语言、默认行为等通用偏好",
    icon: Settings,
    color: "#8e8e93",
  },
  icons: {
    title: "图标设置",
    desc: "全局类型图标与按后缀自定义图标",
    icon: ImageIcon,
    color: "#af52de",
  },
  lan: {
    title: "局域网",
    desc: "本机 IP、发现与共享相关选项",
    icon: Network,
    color: "#34c759",
  },
  apps: {
    title: "APP 下载",
    desc: "获取客户端与相关应用",
    icon: Download,
    color: "#ff9500",
  },
  donate: {
    title: "赞赏",
    desc: "支持项目持续开发",
    icon: Heart,
    color: "#ff2d55",
  },
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-3.5 py-[10px] text-[13px]">
      <span className="shrink-0 text-[#6e6e73]">{label}</span>
      <span className="min-w-0 truncate text-right text-[#1d1d1f]" title={value}>
        {value}
      </span>
    </div>
  );
}

function GrayPanel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[10px] bg-[#F7F7F7] ${className}`.trim()}>
      {children}
    </div>
  );
}

function PlaceholderCard({ text }: { text: string }) {
  return (
    <GrayPanel className="px-4 py-8 text-center text-[13px] text-[#6e6e73]">
      {text}
    </GrayPanel>
  );
}

function SettingToggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center justify-between gap-4 px-3.5 py-[12px] text-left"
      onClick={() => onChange(!checked)}
    >
      <span className="min-w-0">
        <span className="block text-[13px] text-[#1d1d1f]">{label}</span>
        {desc ? (
          <span className="mt-0.5 block text-[11px] leading-[14px] text-[#6e6e73]">
            {desc}
          </span>
        ) : null}
      </span>
      <span
        className={`relative h-[22px] w-[40px] shrink-0 rounded-full transition-colors ${
          checked ? "bg-[#34c759]" : "bg-[#d1d1d6]"
        }`}
        aria-hidden
      >
        <span
          className={`absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-[20px]" : "translate-x-[2px]"
          }`}
        />
      </span>
    </button>
  );
}

function AvatarBadge({
  name,
  avatarDataUrl,
  sizeClass = "size-9",
  textClass = "text-[13px]",
}: {
  name: string;
  avatarDataUrl: string | null;
  sizeClass?: string;
  textClass?: string;
}) {
  if (avatarDataUrl) {
    return (
      <img
        src={avatarDataUrl}
        alt=""
        className={`${sizeClass} rounded-full object-cover`}
        draggable={false}
      />
    );
  }
  return (
    <div
      className={`flex ${sizeClass} items-center justify-center rounded-full bg-gradient-to-b from-[#a8d5ff] to-[#5a9fd4] font-medium text-white ${textClass}`}
    >
      {profileInitial(name)}
    </div>
  );
}

export function SettingsPanel() {
  const [section, setSection] = useState<SectionId>("basic");
  const [localIp, setLocalIp] = useState("…");
  const [profile, setProfile] = useState<UserProfile>(() => loadProfile());
  const [draftName, setDraftName] = useState(() => loadProfile().name);
  const [draftAvatar, setDraftAvatar] = useState<string | null>(
    () => loadProfile().avatarDataUrl,
  );
  const [saving, setSaving] = useState(false);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>(() =>
    loadAppSettings(),
  );
  const [iconSettings, setIconSettings] = useState<IconSettings>(() =>
    loadIconSettings(),
  );
  const [draftExt, setDraftExt] = useState("");
  const [draftExtIcon, setDraftExtIcon] = useState<string | null>(null);
  const pickTargetRef = useRef<PickTarget>({ type: "avatar" });

  const dirty =
    draftName.trim() !== profile.name || draftAvatar !== profile.avatarDataUrl;

  const sidebarItems = SIDEBAR.filter(
    (item) => !(item.id === "donate" && appSettings.hideDonate),
  );

  useEffect(() => {
    if (appSettings.hideDonate && section === "donate") {
      setSection("basic");
    }
  }, [appSettings.hideDonate, section]);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("get_local_ip")
      .then((ip) => {
        if (!cancelled) setLocalIp(ip);
      })
      .catch(() => {
        if (!cancelled) setLocalIp("--");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void migrateIconBlackBackgrounds().then((next) => {
      if (!cancelled) setIconSettings(next ?? loadIconSettings());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function refreshAfterPick() {
    setPicking(false);
    setIconSettings(loadIconSettings());
    const pendingAvatar = takePendingAvatar();
    if (pendingAvatar) {
      setDraftAvatar(pendingAvatar);
      setSaveHint(null);
    }
    const pendingCustom = takePendingCustomIcon();
    if (pendingCustom) {
      setDraftExtIcon(pendingCustom);
      setSaveHint(null);
    }
  }

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => {
      void listen<{ path: string; pickTarget?: string | null }>(
        "settings-file-picked",
        (ev) => {
          const path = ev.payload?.path;
          if (!path) return;
          setPicking(false);
          setSaveHint("正在读取图片…");
          const target =
            decodePickTarget(ev.payload?.pickTarget) ?? pickTargetRef.current;
          const load =
            target.type === "avatar"
              ? avatarFromLocalPath(path)
              : iconFromLocalPath(path);
          void load
            .then((dataUrl) => {
              if (target.type === "avatar") {
                setDraftAvatar(dataUrl);
              } else if (target.type === "global") {
                setIconSettings(setGlobalIcon(target.key, dataUrl));
              } else if (target.type === "custom-new") {
                setDraftExtIcon(dataUrl);
              } else if (target.type === "custom-edit") {
                setIconSettings(updateCustomIconImage(target.id, dataUrl));
              }
              // 再对齐一遍选图窗口可能已写入的结果
              setIconSettings(loadIconSettings());
              const pendingAvatar = takePendingAvatar();
              if (pendingAvatar) setDraftAvatar(pendingAvatar);
              const pendingCustom = takePendingCustomIcon();
              if (pendingCustom) setDraftExtIcon(pendingCustom);
              setSaveHint(null);
            })
            .catch((err) => {
              console.error("pick image failed", err);
              // 选图窗口可能已写好，仍尝试刷新
              refreshAfterPick();
              setSaveHint("已尝试同步选图结果");
            });
        },
      ).then((fn) => {
        unlisten = fn;
      });
    });
    return () => {
      unlisten?.();
    };
  }, []);

  async function openImagePicker(target: PickTarget = { type: "avatar" }) {
    try {
      pickTargetRef.current = target;
      setPicking(true);
      setSaveHint(null);
      const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
      const label = "pick-avatar";
      // 每次重建，避免旧窗口缺少 pickTarget
      const existing = await WebviewWindow.getByLabel(label);
      if (existing) {
        try {
          await existing.close();
        } catch {
          /* ignore */
        }
      }
      let startPath = "";
      try {
        startPath = await invoke<string>("get_special_folder", {
          name: "desktop",
        });
      } catch {
        startPath = "";
      }
      const params = new URLSearchParams({
        pick: "image",
        pickTarget: encodePickTarget(target),
      });
      if (startPath) params.set("path", startPath);
      const win = new WebviewWindow(label, {
        url: `/?${params.toString()}`,
        title: "选择图片",
        width: 980,
        height: 640,
        minWidth: 720,
        minHeight: 480,
        decorations: false,
        transparent: true,
        shadow: false,
        center: true,
        resizable: true,
        focus: true,
      });
      win.once("tauri://destroyed", () => {
        // 选图窗关闭后从 storage 拉结果（不依赖跨窗口事件）
        refreshAfterPick();
      });
      win.once("tauri://error", (e) => {
        console.error("pick window error", e);
        setPicking(false);
        setSaveHint("无法打开文件选择窗口");
      });
    } catch {
      setPicking(false);
      setSaveHint("无法打开文件选择窗口");
    }
  }

  function addCustomIconRule() {
    const ext = normalizeExt(draftExt);
    if (!ext || !draftExtIcon) return;
    setIconSettings(upsertCustomIcon(ext, draftExtIcon));
    setDraftExt("");
    setDraftExtIcon(null);
  }

  function onSave() {
    setSaving(true);
    try {
      const next = saveProfile({
        name: draftName,
        avatarDataUrl: draftAvatar,
      });
      setProfile(next);
      setDraftName(next.name);
      setDraftAvatar(next.avatarDataUrl);
      setSaveHint("已保存");
    } catch {
      setSaveHint("保存失败");
    } finally {
      setSaving(false);
    }
  }

  const meta = SECTION_META[section];
  const HeaderIcon = meta.icon;

  return (
    <div
      className="flex h-full w-full overflow-hidden rounded-[12px] text-[13px] text-[#1d1d1f]"
      role="dialog"
      aria-label="系统设置"
      style={{
        background:
          "linear-gradient(to right, var(--finder-sidebar-rail) 0%, #ffffff 30%, #ffffff 100%)",
      }}
    >
      <div className="relative z-20 flex h-full shrink-0 flex-col py-2 pl-2 pr-0">
        <LiquidGlass
          className="flex min-h-0 w-[220px] flex-1 flex-col shadow-[0_0_8px_rgba(0,0,0,0.06),0_2px_6px_rgba(0,0,0,0.05)]"
          config={DEFAULT_LIQUID_GLASS_CONFIG}
          radius={16}
        >
          <div
            className="flex h-[52px] shrink-0 items-center gap-[8px] px-[16px]"
            data-tauri-drag-region
          >
            <div className="flex items-center gap-[8px]">
              <button
                type="button"
                aria-label="关闭"
                className="size-[12px] rounded-full bg-[#ff5f57] outline-none hover:brightness-95"
                onClick={() => void getCurrentWindow().close()}
              />
              <button
                type="button"
                aria-label="最小化"
                className="size-[12px] rounded-full bg-[#febc2e] outline-none hover:brightness-95"
                onClick={() => void getCurrentWindow().minimize()}
              />
              <button
                type="button"
                aria-label="最大化"
                className="size-[12px] rounded-full bg-[#28c840] outline-none hover:brightness-95"
                onClick={() => void getCurrentWindow().toggleMaximize()}
              />
            </div>
          </div>

          <div className="px-3 pb-2">
            <div className="flex h-[28px] items-center gap-2 rounded-[6px] bg-black/[0.06] px-2 text-[13px] text-[#6e6e73]">
              <Search className="size-3.5 shrink-0" strokeWidth={2} />
              <span>搜索</span>
            </div>
          </div>

          <div className="mx-3 mb-2 flex items-center gap-2.5 rounded-[8px] px-2 py-1.5">
            <AvatarBadge name={profile.name} avatarDataUrl={profile.avatarDataUrl} />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-[#1d1d1f]">
                {profile.name}
              </div>
              <div className="truncate text-[11px] text-[#6e6e73]" title={localIp}>
                {localIp}
              </div>
            </div>
          </div>

          <nav className="min-h-0 flex-1 space-y-[1px] overflow-y-auto px-2 pb-3">
            {sidebarItems.map((item) => {
              const Icon = item.icon;
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-[6px] px-2 py-[5px] text-left text-[13px] ${
                    active
                      ? "bg-[#0165E1] text-white"
                      : "text-[#1d1d1f] hover:bg-black/[0.05]"
                  }`}
                  onClick={() => setSection(item.id)}
                >
                  <span
                    className={`flex size-[22px] items-center justify-center rounded-[5px] ${
                      active ? "bg-white/20" : ""
                    }`}
                    style={active ? undefined : { backgroundColor: item.color }}
                  >
                    <Icon className="size-3 text-white" strokeWidth={2.25} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </LiquidGlass>
      </div>

      <section className="relative z-10 flex min-w-0 flex-1 flex-col">
        <div className="h-10 shrink-0" data-tauri-drag-region />
        <div className="px-8 pb-4">
          <GrayPanel className="flex items-start gap-4 px-4 py-3.5">
            <div
              className="flex size-[56px] shrink-0 items-center justify-center rounded-[12px]"
              style={{
                background: `linear-gradient(to bottom, ${meta.color}cc, ${meta.color})`,
              }}
            >
              <HeaderIcon className="size-8 text-white" strokeWidth={1.75} />
            </div>
            <div className="min-w-0 pt-0.5">
              <h1 className="text-[22px] font-semibold tracking-tight text-[#1d1d1f]">
                {meta.title}
              </h1>
              <p className="mt-1 max-w-[420px] text-[12px] leading-[16px] text-[#6e6e73]">
                {meta.desc}
              </p>
            </div>
          </GrayPanel>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
          {section === "basic" ? (
            <div className="space-y-3">
              <GrayPanel className="px-4 py-4">
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    className="group relative shrink-0 outline-none"
                    onClick={() => void openImagePicker({ type: "avatar" })}
                    title="选择头像"
                  >
                    <AvatarBadge
                      name={draftName}
                      avatarDataUrl={draftAvatar}
                      sizeClass="size-16"
                      textClass="text-[20px]"
                    />
                    <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-[11px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                      更换
                    </span>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] text-[#6e6e73]">头像</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={picking}
                        className="rounded-[6px] bg-white px-2.5 py-1 text-[12px] text-[#1d1d1f] hover:bg-black/[0.04] disabled:opacity-50"
                        onClick={() => void openImagePicker({ type: "avatar" })}
                      >
                        {picking ? "选择中…" : "选择图片"}
                      </button>
                      {draftAvatar ? (
                        <button
                          type="button"
                          className="rounded-[6px] px-2.5 py-1 text-[12px] text-[#6e6e73] hover:bg-black/[0.04]"
                          onClick={() => {
                            setDraftAvatar(null);
                            setSaveHint(null);
                          }}
                        >
                          清除
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </GrayPanel>

              <GrayPanel className="overflow-hidden divide-y divide-black/[0.06]">
                <label className="flex items-center justify-between gap-4 px-3.5 py-[10px] text-[13px]">
                  <span className="shrink-0 text-[#6e6e73]">名称</span>
                  <input
                    value={draftName}
                    onChange={(e) => {
                      setDraftName(e.target.value);
                      setSaveHint(null);
                    }}
                    maxLength={40}
                    className="min-w-0 flex-1 rounded-[6px] border border-transparent bg-white px-2 py-1 text-right text-[#1d1d1f] outline-none focus:border-[#0a84ff]/40"
                    placeholder="Your Computer"
                  />
                </label>
                <InfoRow label="本机 IP" value={localIp} />
                <InfoRow label="版本" value="1.0.0" />
              </GrayPanel>

              <div className="flex items-center justify-end gap-3 pt-1">
                {saveHint ? (
                  <span className="text-[12px] text-[#6e6e73]">{saveHint}</span>
                ) : null}
                <button
                  type="button"
                  disabled={!dirty || saving || !draftName.trim()}
                  className="rounded-[8px] bg-[#0a84ff] px-4 py-1.5 text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                  onClick={onSave}
                >
                  保存
                </button>
              </div>
            </div>
          ) : null}

          {section === "general" ? (
            <GrayPanel className="overflow-hidden divide-y divide-black/[0.06]">
              <SettingToggle
                label="双击返回上一层"
                desc="在内容区空白处双击返回上一级目录"
                checked={appSettings.doubleClickGoUp}
                onChange={(v) =>
                  setAppSettings(patchAppSettings({ doubleClickGoUp: v }))
                }
              />
              <SettingToggle
                label="展示收藏栏"
                desc="在路径栏下方显示收藏夹快捷栏"
                checked={appSettings.showFavoritesBar}
                onChange={(v) =>
                  setAppSettings(patchAppSettings({ showFavoritesBar: v }))
                }
              />
              <SettingToggle
                label="开启标签"
                desc="显示侧栏标签与右键菜单中的标签选项"
                checked={appSettings.enableTags}
                onChange={(v) =>
                  setAppSettings(patchAppSettings({ enableTags: v }))
                }
              />
              <SettingToggle
                label="隐藏赞赏"
                desc="开启后设置侧栏不再显示赞赏入口"
                checked={appSettings.hideDonate}
                onChange={(v) =>
                  setAppSettings(patchAppSettings({ hideDonate: v }))
                }
              />
            </GrayPanel>
          ) : null}

          {section === "icons" ? (
            <div className="space-y-4">
              <div>
                <div className="mb-2 px-0.5 text-[12px] font-medium text-[#6e6e73]">
                  全局设置
                </div>
                <GrayPanel className="overflow-hidden divide-y divide-black/[0.06]">
                  {GLOBAL_ICON_ROWS.map(({ key, icon: RowIcon }) => {
                    const src = iconSettings.global[key];
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-3 px-3.5 py-[10px]"
                      >
                        <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-white">
                          {src ? (
                            <img
                              src={src}
                              alt=""
                              className="size-10 object-contain"
                              draggable={false}
                            />
                          ) : (
                            <RowIcon
                              className="size-5 text-[#8e8e93]"
                              strokeWidth={1.75}
                            />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] text-[#1d1d1f]">
                            {GLOBAL_ICON_LABELS[key]}
                          </div>
                          <div className="text-[11px] text-[#6e6e73]">
                            {src ? "已设置自定义图标" : "使用默认图标"}
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={picking}
                          className="rounded-[6px] bg-white px-2.5 py-1 text-[12px] text-[#1d1d1f] hover:bg-black/[0.04] disabled:opacity-50"
                          onClick={() =>
                            void openImagePicker({ type: "global", key })
                          }
                        >
                          选择图片
                        </button>
                        {src ? (
                          <button
                            type="button"
                            className="rounded-[6px] px-2 py-1 text-[12px] text-[#6e6e73] hover:bg-black/[0.04]"
                            onClick={() =>
                              setIconSettings(setGlobalIcon(key, null))
                            }
                          >
                            清除
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </GrayPanel>
              </div>

              <div>
                <div className="mb-2 px-0.5 text-[12px] font-medium text-[#6e6e73]">
                  自定义设置
                </div>
                <GrayPanel className="px-3.5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-9 min-w-0 flex-1 items-center rounded-[6px] bg-white px-2">
                      <span className="text-[13px] text-[#6e6e73]">.</span>
                      <input
                        value={draftExt}
                        onChange={(e) => setDraftExt(e.target.value)}
                        placeholder="后缀，如 mp4"
                        className="min-w-0 flex-1 border-0 bg-transparent px-1 text-[13px] outline-none"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addCustomIconRule();
                          }
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      disabled={picking}
                      className="flex h-9 shrink-0 items-center gap-1.5 rounded-[6px] bg-white px-2.5 text-[12px] text-[#1d1d1f] hover:bg-black/[0.04] disabled:opacity-50"
                      onClick={() =>
                        void openImagePicker({ type: "custom-new" })
                      }
                    >
                      {draftExtIcon ? (
                        <img
                          src={draftExtIcon}
                          alt=""
                          className="size-5 rounded object-contain"
                          draggable={false}
                        />
                      ) : (
                        <ImageIcon className="size-3.5 text-[#8e8e93]" />
                      )}
                      {draftExtIcon ? "已选图标" : "选择图标"}
                    </button>
                  </div>
                  <button
                    type="button"
                    disabled={!normalizeExt(draftExt) || !draftExtIcon}
                    className="mt-2 flex h-9 w-full items-center justify-center gap-1 rounded-[6px] bg-[#0165E1] text-[13px] font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
                    onClick={addCustomIconRule}
                  >
                    <Plus className="size-3.5" strokeWidth={2.5} />
                    添加
                  </button>
                </GrayPanel>

                {iconSettings.custom.length > 0 ? (
                  <GrayPanel className="mt-2 overflow-hidden divide-y divide-black/[0.06]">
                    {iconSettings.custom.map((rule) => (
                      <div
                        key={rule.id}
                        className="flex items-center gap-3 px-3.5 py-[10px]"
                      >
                        <img
                          src={rule.iconDataUrl}
                          alt=""
                          className="size-10 shrink-0 rounded-[8px] bg-white object-contain"
                          draggable={false}
                        />
                        <div className="min-w-0 flex-1 truncate text-[13px] text-[#1d1d1f]">
                          .{rule.ext}
                        </div>
                        <button
                          type="button"
                          disabled={picking}
                          className="rounded-[6px] bg-white px-2.5 py-1 text-[12px] text-[#1d1d1f] hover:bg-black/[0.04] disabled:opacity-50"
                          onClick={() =>
                            void openImagePicker({
                              type: "custom-edit",
                              id: rule.id,
                            })
                          }
                        >
                          更换
                        </button>
                        <button
                          type="button"
                          className="rounded-[6px] px-2.5 py-1 text-[12px] text-[#ff3b30] hover:bg-[#ff3b30]/10"
                          onClick={() =>
                            setIconSettings(removeCustomIcon(rule.id))
                          }
                        >
                          删除
                        </button>
                      </div>
                    ))}
                  </GrayPanel>
                ) : (
                  <p className="mt-2 px-1 text-[12px] text-[#6e6e73]">
                    添加后缀与图标后，对应文件将显示该图标
                  </p>
                )}
              </div>
            </div>
          ) : null}

          {section === "lan" ? (
            <GrayPanel className="overflow-hidden divide-y divide-black/[0.06]">
              <InfoRow label="本机 IP" value={localIp} />
              <InfoRow label="状态" value="未启用局域网发现" />
            </GrayPanel>
          ) : null}

          {section === "apps" ? (
            <PlaceholderCard text="暂无可用下载" />
          ) : null}

          {section === "donate" ? (
            <div className="flex flex-col items-center gap-5 px-2 py-2">
              <div className="flex w-full flex-wrap items-start justify-center gap-8">
                <figure className="flex w-[240px] flex-col items-center gap-2">
                  <img
                    src={payWx}
                    alt="微信赞赏"
                    className="h-auto w-[240px] rounded-[10px] object-contain"
                    draggable={false}
                  />
                  <figcaption className="text-[12px] text-[#6e6e73]">
                    微信
                  </figcaption>
                </figure>
                <figure className="flex w-[240px] flex-col items-center gap-2">
                  <img
                    src={payZfb}
                    alt="支付宝赞赏"
                    className="h-auto w-[240px] rounded-[10px] object-contain"
                    draggable={false}
                  />
                  <figcaption className="text-[12px] text-[#6e6e73]">
                    支付宝
                  </figcaption>
                </figure>
              </div>
              <p className="text-center text-[13px] text-[#1d1d1f]">
                喜欢可以送杯奶茶哦
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
