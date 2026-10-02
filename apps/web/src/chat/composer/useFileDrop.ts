import { type RefObject, useEffect, useRef, useState } from "react";

/** Files dropped on or pasted into an element go to `onFiles`; `over` is true while files are dragged above it. */
export function useFileDrop(ref: RefObject<HTMLElement | null>, onFiles: (files: FileList) => void): boolean {
  const [over, setOver] = useState(false);
  const deliver = useRef(onFiles);
  deliver.current = onFiles;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const dragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) setOver(false);
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.files.length) return;
      e.preventDefault();
      setOver(false);
      deliver.current(e.dataTransfer.files);
    };
    // Pasted text stays text; only pasted files (a screenshot) become attachments.
    const paste = (e: ClipboardEvent) => {
      if (!e.clipboardData?.files.length) return;
      e.preventDefault();
      deliver.current(e.clipboardData.files);
    };
    el.addEventListener("dragover", dragOver);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", drop);
    el.addEventListener("paste", paste);
    return () => {
      el.removeEventListener("dragover", dragOver);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", drop);
      el.removeEventListener("paste", paste);
    };
  }, [ref]);
  return over;
}
