import {
  useCallback,
  useEffect,
  useId,
  useState,
  type ReactNode,
} from "react";
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
import { Input } from "@/components/ui/input";

type AlertReq = {
  kind: "alert";
  title: string;
  message: string;
  resolve: () => void;
};

type PromptReq = {
  kind: "prompt";
  title: string;
  message?: string;
  defaultValue: string;
  resolve: (value: string | null) => void;
};

type DialogReq = AlertReq | PromptReq;

type Listener = (req: DialogReq | null) => void;

let listener: Listener | null = null;
const queue: DialogReq[] = [];
let active: DialogReq | null = null;

function pump() {
  if (active) {
    listener?.(active);
    return;
  }
  const next = queue.shift() ?? null;
  active = next;
  listener?.(next);
}

function enqueue(req: DialogReq) {
  if (!listener) {
    if (req.kind === "alert") {
      console.warn("[appDialog]", req.message);
      req.resolve();
    } else {
      req.resolve(null);
    }
    return;
  }
  queue.push(req);
  if (!active) pump();
}

function finishActive() {
  active = null;
  pump();
}

/** 提示弹框（替代 window.alert） */
export function showAlert(
  message: string,
  title = "提示",
): Promise<void> {
  return new Promise((resolve) => {
    enqueue({ kind: "alert", title, message, resolve });
  });
}

/** 输入弹框（替代 window.prompt）；取消返回 null */
export function showPrompt(
  title: string,
  defaultValue = "",
  message?: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    enqueue({ kind: "prompt", title, message, defaultValue, resolve });
  });
}

function AlertBody({
  req,
  onDone,
}: {
  req: AlertReq;
  onDone: () => void;
}) {
  const finish = useCallback(() => {
    req.resolve();
    onDone();
  }, [onDone, req]);

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) finish();
      }}
    >
      <AlertDialogContent className="z-[10000] max-w-[min(420px,calc(100vw-32px))] sm:max-w-[420px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{req.title}</AlertDialogTitle>
          <AlertDialogDescription className="max-h-[min(360px,50vh)] whitespace-pre-wrap break-words text-left">
            {req.message}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="border-t-0 bg-transparent">
          <Button
            className="bg-[#0165e1] text-white hover:bg-[#0165e1]/90"
            onClick={finish}
          >
            确定
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PromptBody({
  req,
  onDone,
}: {
  req: PromptReq;
  onDone: () => void;
}) {
  const [value, setValue] = useState(req.defaultValue);
  const inputId = useId();

  const cancel = useCallback(() => {
    req.resolve(null);
    onDone();
  }, [onDone, req]);

  const confirm = useCallback(() => {
    req.resolve(value);
    onDone();
  }, [onDone, req, value]);

  return (
    <AlertDialog
      open
      onOpenChange={(next) => {
        if (!next) cancel();
      }}
    >
      <AlertDialogContent className="z-[10000] max-w-[min(420px,calc(100vw-32px))] sm:max-w-[420px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{req.title}</AlertDialogTitle>
          {req.message ? (
            <AlertDialogDescription className="whitespace-pre-wrap break-words text-left">
              {req.message}
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription className="sr-only">
              请输入
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <Input
          id={inputId}
          autoFocus
          value={value}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              confirm();
            }
          }}
          className="mt-1"
        />
        <AlertDialogFooter className="border-t-0 bg-transparent">
          <AlertDialogCancel onClick={cancel}>取消</AlertDialogCancel>
          <Button
            className="bg-[#0165e1] text-white hover:bg-[#0165e1]/90"
            onClick={confirm}
          >
            确定
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 挂在每个窗口根节点；提供 showAlert / showPrompt */
export function AppDialogHost({ children }: { children?: ReactNode }) {
  const [req, setReq] = useState<DialogReq | null>(null);

  useEffect(() => {
    listener = setReq;
    if (active) setReq(active);
    return () => {
      if (listener === setReq) listener = null;
    };
  }, []);

  const onDone = useCallback(() => {
    finishActive();
  }, []);

  return (
    <>
      {children}
      {req?.kind === "alert" ? (
        <AlertBody key={`a-${req.title}-${req.message}`} req={req} onDone={onDone} />
      ) : null}
      {req?.kind === "prompt" ? (
        <PromptBody
          key={`p-${req.title}-${req.defaultValue}`}
          req={req}
          onDone={onDone}
        />
      ) : null}
    </>
  );
}
