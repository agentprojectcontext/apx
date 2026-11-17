import type { ExtensionInfo } from "@apx/protocol";
import { EXTENSION_ARCHIVE_EXT, EXTENSION_ARCHIVE_MAX } from "@apx/protocol/client";
import { Button, Dialog, Icons, Input, SegmentedControl } from "@apx/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { ExtensionSummary, usePowerText } from "./ExtensionSummary.tsx";
import {
  closeExtensionInstall,
  extensionInstalled,
  type InstallMode,
  useExtensionInstall,
} from "./extensionInstall.ts";
import "../styles/artifacts.css";
import "../styles/config.css";

// Installing an extension: from an .apxext file (picked, dropped or opened from the system), an https address or a
// folder. It shows what it is, whether APX publishes these exact files and what it brings, then installs it off.

type Mode = InstallMode;
type Source = { file: { name: string; data: string } } | { url: string } | { path: string };

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The file as base64, the way it travels to the core. */
const base64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error ?? new Error(file.name));
    r.readAsDataURL(file);
  });

/** The dialog, mounted by the shell while openExtensionInstall's request stands. */
export function InstallExtensionDialog() {
  const open = useExtensionInstall();
  return open ? (
    <InstallExtension file={open.file} url={open.url} initial={open.url ? "url" : (open.mode ?? "file")} />
  ) : null;
}

function InstallExtension({ file, url, initial }: { file: File | undefined; url: string | undefined; initial: Mode }) {
  const t = useT();
  const [mode, setMode] = useState<Mode>(initial);
  const [fileName, setFileName] = useState("");
  const [address, setAddress] = useState(url ?? "");
  const [source, setSource] = useState<Source>();
  const [seen, setSeen] = useState<ExtensionInfo>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const look = async (s: Source) => {
    setError("");
    setSeen(undefined);
    setSource(s);
    setBusy(true);
    try {
      setSeen(await client.call("extensions.inspect", s));
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };
  const readFile = async (f: File) => {
    setMode("file");
    setFileName(f.name);
    if (f.size > EXTENSION_ARCHIVE_MAX) {
      setSeen(undefined);
      setError(t("extInstall.tooBig", { name: f.name }));
      return;
    }
    await look({ file: { name: f.name, data: await base64(f) } });
  };
  const readRef = useRef(readFile);
  readRef.current = readFile;
  // A file opened from the system or dropped on the window comes already chosen.
  useEffect(() => {
    if (file) void readRef.current(file);
  }, [file]);
  const lookRef = useRef(look);
  lookRef.current = look;
  // An address chosen from the catalog is looked at right away.
  useEffect(() => {
    if (url) void lookRef.current({ url });
  }, [url]);
  // Listened on the element: the drop zone is not a control, the "Choose file" button inside it is. A ref callback, as
  // the zone comes and goes with the mode.
  const drop = useCallback((el: HTMLDivElement | null) => {
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
      if (f) void readRef.current(f);
    };
    el.addEventListener("dragover", over);
    el.addEventListener("dragleave", leave);
    el.addEventListener("drop", dropped);
    return () => {
      el.removeEventListener("dragover", over);
      el.removeEventListener("dragleave", leave);
      el.removeEventListener("drop", dropped);
    };
  }, []);

  const install = async () => {
    if (!seen || !source) return;
    setBusy(true);
    try {
      const done = await client.call("extensions.install", { ...source, hash: seen.hash });
      notify(
        done.enabled
          ? t("extInstall.updated", { name: done.name, version: done.version })
          : t("extInstall.done", { name: done.name }),
        "info",
      );
      extensionInstalled();
      closeExtensionInstall();
      go.resources("extensions", true);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const switchTo = (m: Mode) => {
    setMode(m);
    setSeen(undefined);
    setError("");
  };
  const typed = address.trim();
  const lookTyped = () => typed && void look(mode === "url" ? { url: typed } : { path: typed });

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && closeExtensionInstall()}
      size="md"
      title={t("extInstall.title")}
      description={t("extInstall.hint")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={closeExtensionInstall}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!seen} loading={busy && Boolean(seen)} onClick={() => void install()}>
            {seen?.update ? t("extInstall.update") : t("extInstall.installOff")}
          </Button>
        </>
      }
    >
      <div className="install">
        {!file && (
          <SegmentedControl
            size="sm"
            value={mode}
            onValueChange={(v) => switchTo(v as Mode)}
            options={[
              { value: "file", label: t("extInstall.fromFile") },
              { value: "url", label: t("extInstall.fromUrl") },
              { value: "folder", label: t("extInstall.fromFolder") },
            ]}
          />
        )}
        {mode === "file" ? (
          <div ref={drop} className="install__drop" data-dragging={dragging || undefined}>
            <Icons.Upload size={18} />
            <span>{fileName || t("extInstall.drop")}</span>
            <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
              {t("extInstall.pick")}
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
        ) : (
          <div className="tgtoken">
            <Input
              aria-label={mode === "url" ? t("extInstall.url") : t("ext.folder")}
              placeholder={mode === "url" ? t("extInstall.urlHint") : t("ext.folderHint")}
              value={address}
              onChange={(e) => {
                setAddress(e.currentTarget.value);
                setSeen(undefined);
              }}
              onKeyDown={(e) => e.key === "Enter" && lookTyped()}
            />
            <Button size="sm" variant="secondary" disabled={!typed} loading={busy && !seen} onClick={() => lookTyped()}>
              {t("ext.inspect")}
            </Button>
          </div>
        )}
        {error && <p className="install__error">{error}</p>}
        {seen && <Seen e={seen} />}
      </div>
    </Dialog>
  );
}

/** What the inspected extension is: where it comes from by its files, what it brings, what an update changes. */
function Seen({ e }: { e: ExtensionInfo }) {
  const t = useT();
  const power = usePowerText();
  const u = e.update;
  return (
    <>
      <div className="pcard install__card">
        <ExtensionSummary e={e} />
      </div>
      <p className="install__note">
        {e.catalog === "unreachable"
          ? t("extInstall.unreachable")
          : e.catalog === "needs_update"
            ? t("extInstall.needsUpdate")
            : t(e.provenance === "official" ? "extInstall.officialHint" : "extInstall.thirdPartyHint")}
      </p>
      {u && (
        <div className="install__what">
          <div className="install__name">
            <b>{t("extInstall.updateFrom", { from: u.from })}</b>
          </div>
          {u.adds.length || u.removes.length ? (
            <ul className="install__facts">
              {u.adds.map((p) => (
                <li key={`+${p.kind}${p.name}`}>
                  {t("extInstall.adds")}: {power(p)}
                </li>
              ))}
              {u.removes.map((p) => (
                <li key={`-${p.kind}${p.name}`}>
                  {t("extInstall.removes")}: {power(p)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="install__note">{t("extInstall.nothingNew")}</p>
          )}
          <p className="install__note">
            {u.keeps_on ? t("extInstall.staysOn") : t("extInstall.waits")}{" "}
            {t("extInstall.keepsBefore", { from: u.from })}
          </p>
        </div>
      )}
    </>
  );
}
