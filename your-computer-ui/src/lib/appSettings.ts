export type AppSettings = {
  /** 双击空白返回上一层，默认开启 */
  doubleClickGoUp: boolean;
  /** 展示收藏栏，默认关闭 */
  showFavoritesBar: boolean;
  /** 开启标签（侧栏 + 右键），默认开启 */
  enableTags: boolean;
  /** 隐藏设置里的赞赏入口，默认关闭（即显示赞赏） */
  hideDonate: boolean;
};

export const APP_SETTINGS_KEY = "yc-app-settings";
export const APP_SETTINGS_EVENT = "app-settings-changed";

export const DEFAULT_APP_SETTINGS: AppSettings = {
  doubleClickGoUp: true,
  showFavoritesBar: false,
  enableTags: true,
  hideDonate: false,
};

function normalize(raw: Partial<AppSettings> | null | undefined): AppSettings {
  return {
    doubleClickGoUp:
      typeof raw?.doubleClickGoUp === "boolean"
        ? raw.doubleClickGoUp
        : DEFAULT_APP_SETTINGS.doubleClickGoUp,
    showFavoritesBar:
      typeof raw?.showFavoritesBar === "boolean"
        ? raw.showFavoritesBar
        : DEFAULT_APP_SETTINGS.showFavoritesBar,
    enableTags:
      typeof raw?.enableTags === "boolean"
        ? raw.enableTags
        : DEFAULT_APP_SETTINGS.enableTags,
    hideDonate:
      typeof raw?.hideDonate === "boolean"
        ? raw.hideDonate
        : DEFAULT_APP_SETTINGS.hideDonate,
  };
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_APP_SETTINGS };
    return normalize(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

export function saveAppSettings(next: AppSettings): AppSettings {
  const value = normalize(next);
  localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(value));
  try {
    window.dispatchEvent(
      new CustomEvent(APP_SETTINGS_EVENT, { detail: value }),
    );
  } catch {
    /* ignore */
  }
  void import("@tauri-apps/api/event")
    .then(({ emit }) => emit(APP_SETTINGS_EVENT, value))
    .catch(() => {
      /* ignore */
    });
  return value;
}

export function patchAppSettings(
  patch: Partial<AppSettings>,
): AppSettings {
  return saveAppSettings({ ...loadAppSettings(), ...patch });
}
