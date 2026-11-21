import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { DRAG_ICON_PNG_DATA_URL } from "./dragIcon";

function toPngDataUrl(icon: string | null | undefined): string {
  if (icon?.startsWith("data:image/png;base64,")) return icon;
  return DRAG_ICON_PNG_DATA_URL;
}

/** 防止并发 / 重入 startDrag（Windows 上 DoDragDrop 占主线程，重入会卡死） */
let dragging = false;

/**
 * 原生拖出文件到桌面 / 其它应用（Explorer、关联程序等）。
 * 须在鼠标左键仍按住时调用；调用后由系统接管，直到放下或取消。
 * Windows 上期间主线程会进入 DoDragDrop，标题栏可能短暂显示「未响应」，属预期；
 * 松手后应立即恢复。若按钮已松开则不要调用，否则可能永久卡住。
 */
export async function startOsFileDrag(
  paths: string[],
  previewIcon?: string | null,
): Promise<"Dropped" | "Cancelled" | "Error"> {
  const item = paths.filter(Boolean);
  if (!item.length) return "Cancelled";
  if (dragging) return "Cancelled";
  dragging = true;
  try {
    let result: "Dropped" | "Cancelled" = "Cancelled";
    await startDrag(
      {
        item,
        icon: toPngDataUrl(previewIcon),
        mode: "copy",
      },
      (ev) => {
        result = ev.result === "Dropped" ? "Dropped" : "Cancelled";
      },
    );
    return result;
  } catch (err) {
    console.error("startOsFileDrag failed", err);
    return "Error";
  } finally {
    dragging = false;
  }
}
