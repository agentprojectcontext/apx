import type { ArtifactBundle } from "@apx/protocol";
import { ARTIFACT_FILE_EXT } from "@apx/protocol/client";
import { Badge, Button, Dialog, Field, Icons, Select, SettingRow, Switch } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { installArtifact } from "../data/artifacts.ts";
import { baseName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { closeInstall, useInstallRequest } from "./installRequest.ts";
import "../styles/artifacts.css";

// Installing an .apxart file: drop or pick it, see what it is and what it asks for, choose where it goes, then install.

const GLOBAL = "";

/** "a, b and c", in the owner's language. */
const listed = (parts: string[], and: string) =>
  parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")}${and}${parts.at(-1)}`;

/** The dialog, mounted once in the shell; it shows while openInstall's request stands. */
export function InstallArtifactDialog() {
  const open = useInstallRequest();
  if (!open) return null;
  return <InstallForm initialProject={open.project ?? GLOBAL} file={open.file} />;
}

function InstallForm({ initialProject, file }: { initialProject: string; file: File | undefined }) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const surfaces = useData((s) => s.surfaces);
  const [bundle, setBundle] = useState<ArtifactBundle>();
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [project, setProject] = useState(initialProject);
  const [pin, setPin] = useState(false);
  const [withMemory, setWithMemory] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const read = async (file: File) => {
    setError("");
    setFileName(file.name);
    try {
      // A light look here; the core checks the whole file when it installs it.
      const raw = JSON.parse(await file.text()) as ArtifactBundle;
      if (raw?.format !== "apx-artifact@1" || typeof raw.html !== "string" || typeof raw.manifest?.name !== "string")
        throw new Error(t("artifact.installNotArtifact"));
      setBundle(raw);
      setPin(raw.manifest.kind === "app");
    } catch (e) {
      setBundle(undefined);
      setError(e instanceof Error && e.message ? e.message : t("artifact.installNotArtifact"));
    }
  };
  const readRef = useRef(read);
  readRef.current = read;
  // A file opened from the system or dropped on the window comes already chosen.
  useEffect(() => {
    if (file) void readRef.current(file);
  }, [file]);
  const drop = useRef<HTMLDivElement>(null);
  // Listened on the element: the drop zone is not a control, the "Choose file" button inside it is.
  useEffect(() => {
    const el = drop.current;
    if (!el) return;
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = () => setDragging(false);
    const dropped = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void readRef.current(file);
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

  const m = bundle?.manifest;
  const memoryParts = bundle ? (["state", "store", "db"] as const).filter((k) => bundle[k] !== undefined) : [];
  const clash = m && Object.values(surfaces).some((s) => s.name === m.name && (s.project_id ?? GLOBAL) === project);
  const install = async () => {
    if (!bundle) return;
    setBusy(true);
    const sent = withMemory ? bundle : { format: bundle.format, manifest: bundle.manifest, html: bundle.html };
    const id = await installArtifact(sent, project || undefined, pin);
    setBusy(false);
    if (!id) return;
    closeInstall();
    go.app(id);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && closeInstall()}
      size="md"
      title={t("artifact.installTitle")}
      description={t("artifact.installHint")}
      closeLabel={t("common.close")}
      footer={
        <>
          <Button variant="secondary" onClick={closeInstall}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!bundle} loading={busy} onClick={() => void install()}>
            {t("artifact.installAction")}
          </Button>
        </>
      }
    >
      <div className="install">
        <div ref={drop} className="install__drop" data-dragging={dragging || undefined}>
          <Icons.Upload size={18} />
          <span>{fileName || t("artifact.installDrop")}</span>
          <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
            {t("artifact.installPick")}
          </Button>
          <input
            ref={input}
            type="file"
            hidden
            accept={`${ARTIFACT_FILE_EXT},.json,application/json`}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void read(file);
            }}
          />
        </div>
        {error && <p className="install__error">{error}</p>}
        {m && (
          <>
            <div className="install__what">
              <div className="install__name">
                <b>{m.title}</b>
                <Badge tone={m.kind === "app" ? "brand" : "neutral"}>
                  {t(m.kind === "app" ? "artifact.kindApp" : "artifact.kindWidget")}
                </Badge>
              </div>
              <ul className="install__facts">
                {m.author || m.agent || m.project ? (
                  <li>
                    {t("artifact.installMadeBy", {
                      who: [m.author, m.agent, m.project].filter(Boolean).join(" · "),
                    })}
                  </li>
                ) : null}
                <li>
                  {m.name} · v{m.version}
                  {m.kit ? ` · APX Kit v${m.kit}` : ""}
                  {m.live ? ` · ${t("artifact.installLive")}` : ""}
                </li>
                {m.connect?.length ? <li>{t("artifact.installConnects", { origins: m.connect.join(", ") })}</li> : null}
                {m.secrets?.length ? <li>{t("artifact.installSecrets", { keys: m.secrets.join(", ") })}</li> : null}
                <li>
                  {memoryParts.length
                    ? t("artifact.installBrings", {
                        parts: listed(
                          memoryParts.map((p) => t(`artifact.part.${p}`)),
                          t("artifact.and"),
                        ),
                      })
                    : t("artifact.installEmpty")}
                </li>
              </ul>
            </div>
            <Field label={t("artifact.installProject")}>
              <Select
                label={t("artifact.installProject")}
                value={project}
                onValueChange={(v) => setProject(String(v))}
                options={[
                  { value: GLOBAL, label: baseName() },
                  ...projects.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
            </Field>
            {clash && <p className="install__note">{t("artifact.installClash", { name: m.name })}</p>}
            <SettingRow title={t("artifact.installPin")} description={t("artifact.installPinHint")}>
              <Switch checked={pin} onCheckedChange={setPin} aria-label={t("artifact.installPin")} />
            </SettingRow>
            {memoryParts.length > 0 && (
              <SettingRow title={t("artifact.installMemory")} description={t("artifact.installMemoryHint")}>
                <Switch checked={withMemory} onCheckedChange={setWithMemory} aria-label={t("artifact.installMemory")} />
              </SettingRow>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
