import { convertFileSrc } from "@tauri-apps/api/core";
import { isImageFilePath } from "./profile";

/** 图片文件返回本地预览 URL；其它返回 undefined（走外壳图标） */
export function localImagePreviewSrc(
  path: string | undefined | null,
  kind?: string,
): string | undefined {
  if (!path) return undefined;
  if (kind === "folder") return undefined;
  if (kind !== "image" && !isImageFilePath(path)) return undefined;
  try {
    return convertFileSrc(path);
  } catch {
    return undefined;
  }
}
