import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  fileName: string;
  onCancel: () => void;
  onConfirm: () => void;
};

/** 未保存关闭确认（替代 window.confirm） */
export function ConfirmCloseDialog({
  open,
  fileName,
  onCancel,
  onConfirm,
}: Props) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent className="z-[10000]">
        <AlertDialogHeader>
          <AlertDialogTitle>关闭文档</AlertDialogTitle>
          <AlertDialogDescription>
            「{fileName}」尚未保存，确定关闭？
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="border-t-0 bg-transparent">
          <AlertDialogCancel onClick={onCancel}>取消</AlertDialogCancel>
          <Button
            className="bg-[#0165e1] text-white hover:bg-[#0165e1]/90"
            onClick={onConfirm}
          >
            确定
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
