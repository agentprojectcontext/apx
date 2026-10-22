import { useEffect } from "react";
import { notify } from "../data/notices.ts";
import { t } from "../i18n/index.ts";
import { openInstall } from "./installRequest.ts";

// APX files reaching the panel from outside: opened from the system (desktop app) or dropped anywhere on the window.

const kindOf = (name: string) => /\.(apxart|apxapp|apxext)$/i.exec(name)?.[1]?.toLowerCase();

/** An .apxart opens the install dialog with it; .apxapp and .apxext do not install from a file yet. */
export function openApxFile(file: File): void {
  const kind = kindOf(file.name);
  if (kind === "apxart") openInstall(undefined, file);
  else if (kind) notify(t("artifact.fileNotYet", { name: file.name }), "info");
}

export function useApxFiles(): void {
  useEffect(() => {
    const desktop = window.apxDesktop;
    const take = async () => {
      for (const f of (await desktop?.takeOpenedFiles?.()) ?? []) {
        if (f.text !== undefined) openApxFile(new File([f.text], f.name, { type: "application/json" }));
        else notify(t(f.error === "too-big" ? "artifact.fileTooBig" : "artifact.fileUnreadable", { name: f.name }));
      }
    };
    void take();
    const off = desktop?.onFileOpened?.(() => void take());
    // Captured first: an APX file dropped on the chat installs instead of becoming an attachment.
    const drop = (e: DragEvent) => {
      const file = [...(e.dataTransfer?.files ?? [])].find((f) => kindOf(f.name));
      if (!file) return;
      e.preventDefault();
      e.stopPropagation();
      openApxFile(file);
    };
    // Anywhere else accepts a drop too, so a file let go outside a drop zone never replaces the page.
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const missed = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("drop", drop, true);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", missed);
    return () => {
      off?.();
      window.removeEventListener("drop", drop, true);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", missed);
    };
  }, []);
}
