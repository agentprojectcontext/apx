import { ARTIFACT_FILE_EXT, ArtifactBundle } from "@apx/protocol";
import { Badge, Button, Dialog, Field, Icons, Select, SettingRow, Switch } from "@apx/ui";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { installArtifact } from "../data/artifacts.ts";
import { baseName } from "../data/identity.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

// Installing an .apxart file: drop or pick it, see what it is and what it asks for, choose where it goes, then install.

let request: { project?: string } | undefined;
const subs = new Set<() => void>();
const changed = () => {
  for (const f of subs) f();
};

/** Opens the install dialog, with `project` chosen as the destination. */
export function openInstall(project?: string): void {
  request = project ? { project } : {};
  changed();
}

function closeInstall(): void {
  request = undefined;
  changed();
}

const GLOBAL = "";

/** The dialog, mounted once in the shell; it shows while openInstall's request stands. */
export function InstallArtifactDialog() {
  const open = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => request,
  );
  if (!open) return null;
  return <InstallForm initialProject={open.project ?? GLOBAL} />;
}

function InstallForm({ initialProject }: { initialProject: string }) {
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
      const parsed = ArtifactBundle.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error(t("artifact.installNotArtifact"));
      setBundle(parsed.data);
      setPin(parsed.data.manifest.kind === "app");
    } catch (e) {
      setBundle(undefined);
      setError(e instanceof Error && e.message ? e.message : t("artifact.installNotArtifact"));
    }
  };
  const readRef = useRef(read);
  readRef.current = read;
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
                <li>
                  {m.name} · v{m.version}
                  {m.kit ? ` · APX Kit ${m.kit}` : ""}
                  {m.live ? ` · ${t("artifact.installLive")}` : ""}
                </li>
                {m.connect?.length ? <li>{t("artifact.installConnects", { origins: m.connect.join(", ") })}</li> : null}
                {m.secrets?.length ? <li>{t("artifact.installSecrets", { keys: m.secrets.join(", ") })}</li> : null}
                <li>
                  {memoryParts.length
                    ? t("artifact.installBrings", {
                        parts: memoryParts.map((p) => t(`artifact.part.${p}`)).join(", "),
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
