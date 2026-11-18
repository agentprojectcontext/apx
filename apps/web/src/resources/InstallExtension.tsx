import { EXTENSION_ARCHIVE_EXT, EXTENSION_ARCHIVE_MAX } from "@apx/protocol/client";
import { Button, Icons, Input, SegmentedControl } from "@apx/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/index.ts";
import { type BoxStart, InstallBox } from "../marketplace/InstallBox.tsx";
import { closeExtensionInstall, type InstallMode, useExtensionInstall } from "./extensionInstall.ts";
import "../styles/install-box.css";

// The add box, mounted by the shell while openExtensionInstall's request stands: directly on an extension chosen from
// a catalog, on one already added to connect it, or under the source picker (a file, an address, a folder) when it
// comes from elsewhere. The picker is only the top of the same box.

/** The file as base64, the way it travels to the core. */
const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error(file.name));
    r.readAsDataURL(file);
  });

/** An address of a package (an .apxext or a zip of one); any other https address is an MCP server's. */
const PACKAGE = /\.(apxext|zip)(\?.*)?$/i;

export function InstallExtensionDialog() {
  const open = useExtensionInstall();
  const start = useMemo((): BoxStart | undefined => {
    if (!open) return undefined;
    if (open.connect) return { kind: "installed", id: open.connect, ...(open.look ? { look: open.look } : {}) };
    if (!open.catalog) return undefined;
    if (open.entry)
      return {
        kind: "source",
        source: { entry: { catalog: open.entry.catalog, id: open.entry.id } },
        origin: { kind: "catalog", name: open.entry.name ?? open.entry.catalog },
      };
    if (open.url)
      return {
        kind: "source",
        source: { url: open.url },
        origin: { kind: "apx" },
        ...(open.official ? { official: true } : {}),
      };
    return undefined;
  }, [open]);
  if (!open) return null;
  if (start) return <InstallBox start={start} onClose={closeExtensionInstall} />;
  return <FromElsewhere file={open.file} mode={open.mode ?? (open.url ? "url" : "file")} url={open.url} />;
}

/** What a typed address or folder is: a package to look at, or an MCP server's address. */
function startOf(tab: InstallMode, value: string): BoxStart | undefined {
  if (!value) return undefined;
  if (tab === "folder") return { kind: "source", source: { path: value }, origin: { kind: "folder", path: value } };
  if (!/^https:\/\/[^/\s]+/.test(value)) return undefined;
  return PACKAGE.test(value)
    ? { kind: "source", source: { url: value }, origin: { kind: "url", host: URL.parse(value)?.host ?? value } }
    : { kind: "address", url: value };
}

/** The picker over the box: a file (picked or dropped), an address or a folder, looked at with Review. */
function FromElsewhere({ file, mode, url }: { file?: File | undefined; mode: InstallMode; url?: string | undefined }) {
  const t = useT();
  const [tab, setTab] = useState<InstallMode>(mode);
  const [fileName, setFileName] = useState("");
  const [typed, setTyped] = useState(url ?? "");
  // An address chosen elsewhere is looked at right away.
  const [start, setStart] = useState<BoxStart | undefined>(() => (url ? startOf("url", url) : undefined));
  const [tooBig, setTooBig] = useState("");
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const readFile = useCallback(async (f: File) => {
    setTab("file");
    setFileName(f.name);
    setTooBig("");
    setStart(undefined);
    if (f.size > EXTENSION_ARCHIVE_MAX) return setTooBig(f.name);
    const data = await base64(f);
    setStart({ kind: "source", source: { file: { name: f.name, data } }, origin: { kind: "file", name: f.name } });
  }, []);
  // A file opened from the system or dropped on the window comes already chosen.
  useEffect(() => {
    if (file) void readFile(file);
  }, [file, readFile]);
  const review = (value = typed.trim()) => {
    const next = startOf(tab, value);
    if (next) setStart(next);
  };
  // Listened on the element: the drop zone is not a control, its button is.
  const drop = useCallback(
    (el: HTMLDivElement | null) => {
      if (!el) return;
      const over = (e: DragEvent) => {
        e.preventDefault();
        setDragging(true);
      };
      const leave = () => setDragging(false);
      const dropped = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        const f = e.dataTransfer?.files[0];
        if (f) void readFile(f);
      };
      el.addEventListener("dragover", over);
      el.addEventListener("dragleave", leave);
      el.addEventListener("drop", dropped);
      return () => {
        el.removeEventListener("dragover", over);
        el.removeEventListener("dragleave", leave);
        el.removeEventListener("drop", dropped);
      };
    },
    [readFile],
  );

  const picker = (
    <div className="mkt-pick">
      <SegmentedControl
        size="sm"
        value={tab}
        onValueChange={(v) => {
          setTab(v as InstallMode);
          setStart(undefined);
          setTyped("");
        }}
        options={[
          { value: "file", label: t("box.pick.file") },
          { value: "url", label: t("box.pick.url") },
          { value: "folder", label: t("box.pick.folder") },
        ]}
      />
      {tab === "file" ? (
        <>
          <div ref={drop} className="mkt-pick__drop" data-dragging={dragging || undefined}>
            <Icons.Upload size={16} />
            <span>{fileName || t("extInstall.drop")}</span>
            <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
              {t(fileName ? "box.pick.another" : "extInstall.pick")}
            </Button>
            <input
              ref={input}
              type="file"
              hidden
              accept={`${EXTENSION_ARCHIVE_EXT},.zip,application/zip`}
              onChange={(e) => {
                const f = e.currentTarget.files?.[0];
                if (f) void readFile(f);
              }}
            />
          </div>
          {tooBig && <p className="install__error">{t("extInstall.tooBig", { name: tooBig })}</p>}
        </>
      ) : (
        <>
          <div className="mkt-pick__row">
            <Input
              aria-label={t(tab === "url" ? "box.pick.urlLabel" : "ext.folder")}
              placeholder={tab === "url" ? "https://…" : "~/work/…"}
              inputMode={tab === "url" ? "url" : "text"}
              autoComplete="off"
              value={typed}
              onChange={(e) => {
                setTyped(e.currentTarget.value);
                setStart(undefined);
              }}
              onKeyDown={(e) => e.key === "Enter" && review()}
            />
            <Button size="sm" variant="secondary" disabled={!typed.trim()} onClick={() => review()}>
              {t("ext.inspect")}
            </Button>
          </div>
          <p className="mkt-pick__hint">{t(tab === "url" ? "box.pick.urlHint" : "box.pick.folderHint")}</p>
        </>
      )}
    </div>
  );
  return (
    <InstallBox
      start={start}
      top={picker}
      title={t("box.title.elsewhere")}
      description={t("box.lead.elsewhere")}
      onClose={closeExtensionInstall}
    />
  );
}
