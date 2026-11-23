import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  ConfirmDeleteWindow,
  type ConfirmDeletePayload,
} from "./components/ConfirmDeleteWindow";
import { GetInfoWindow } from "./components/GetInfoWindow";
import { SearchWindow } from "./components/SearchWindow";
import { SettingsPanel } from "./components/SettingsPanel";
import {
  BuiltinEditorWindow,
  type BuiltinEditorKind,
} from "./components/editors/BuiltinEditorWindow";
import { AppDialogHost } from "./lib/appDialog";
import "./index.css";

const params = new URLSearchParams(window.location.search);
const infoPath = params.get("info");
const browsePath = params.get("path");
const zoomIn = params.get("zoom") === "1";
const isSearchWindow = params.get("search") === "1";
const isSettingsWindow = params.get("settings") === "1";
const pickMode = params.get("pick") === "image" ? ("image" as const) : null;
const pickTarget = params.get("pickTarget");
const editorKindRaw = params.get("editor");
const editorFileRaw = params.get("file");
const editorFile =
  editorFileRaw && editorFileRaw.length > 0 ? editorFileRaw : null;
const editorKind: BuiltinEditorKind | null =
  editorKindRaw === "word" ||
  editorKindRaw === "markdown" ||
  editorKindRaw === "excel"
    ? editorKindRaw
    : null;
const confirmRaw = params.get("confirmDelete");

let confirmPayload: ConfirmDeletePayload | null = null;
if (confirmRaw) {
  try {
    const parsed = JSON.parse(confirmRaw) as ConfirmDeletePayload;
    if (Array.isArray(parsed?.paths) && parsed.paths.length) {
      confirmPayload = {
        paths: parsed.paths,
        names: Array.isArray(parsed.names) ? parsed.names : [],
      };
    }
  } catch {
    confirmPayload = null;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppDialogHost>
      {confirmPayload ? (
        <ConfirmDeleteWindow payload={confirmPayload} />
      ) : editorKind ? (
        <BuiltinEditorWindow kind={editorKind} path={editorFile} />
      ) : infoPath ? (
        <GetInfoWindow path={infoPath} />
      ) : isSearchWindow ? (
        <SearchWindow />
      ) : isSettingsWindow ? (
        <SettingsPanel />
      ) : (
        <App
          initialPath={browsePath}
          zoomIn={zoomIn}
          pickMode={pickMode}
          pickTarget={pickTarget}
        />
      )}
    </AppDialogHost>
  </React.StrictMode>,
);
