import { MarkdownEditor } from "./MarkdownEditor";
import { WordEditor } from "./WordEditor";
import { ExcelEditor } from "./ExcelEditor";

export type BuiltinEditorKind = "word" | "markdown" | "excel";

type Props = {
  kind: BuiltinEditorKind;
  /** 无路径时打开空白文档 */
  path: string | null;
};

export function BuiltinEditorWindow({ kind, path }: Props) {
  if (kind === "markdown") return <MarkdownEditor path={path} />;
  if (kind === "excel") return <ExcelEditor path={path} />;
  return <WordEditor path={path} />;
}
