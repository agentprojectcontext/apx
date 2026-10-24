import type { ProjectKind } from "@apx/protocol";
import { Button, Dialog, Field, Icons, Input, SegmentedControl, Select, Textarea } from "@apx/ui";
import { type KeyboardEvent, useEffect, useState } from "react";
import { bootstrap } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { createProject } from "../data/setup.ts";
import { useT } from "../i18n/index.ts";
import { kindOptions, NO_KIND } from "../project/projectKind.ts";
import { go } from "./nav.ts";

type Where = "folder" | "apx" | "import";
type Engine = "codex" | "claude";
type Found = { name: string; cwd: string; chats: number };

/** The folder name the core gives a project without one (the same rule as its `slugOf`). */
const slugOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
const baseName = (p: string) =>
  p
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .at(-1) ?? "";

/**
 * A new project: in a folder (typed or picked; made if missing) or, without one, in a folder of its own inside APX's.
 * Its name (the folder's when left empty), kind and description are the ones its settings show. Opens it once made.
 */
export function NewProjectDialog({ onClose }: { onClose(): void }) {
  const t = useT();
  const [where, setWhere] = useState<Where>("folder");
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<string>(NO_KIND);
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [helper, setHelper] = useState(false);
  const enableHelper = async (project: string) => {
    if (!helper) return;
    try {
      await client.call("projects.helper_set", { project, enabled: true });
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), "error");
    }
  };
  const [engine, setEngine] = useState<Engine>("codex");
  const [found, setFound] = useState<Found[] | undefined>();
  const [source, setSource] = useState("");
  useEffect(() => {
    if (where !== "import") return;
    let live = true;
    setFound(undefined);
    client
      .call("sessions.projects", { engine })
      .then(({ projects }) => {
        if (!live) return;
        setFound(projects.map((p) => ({ name: p.name, cwd: p.cwd, chats: p.sessions.length })));
        setSource(projects[0]?.cwd ?? "");
      })
      .catch((err) => {
        if (live) setFound([]);
        notify(String(err instanceof Error ? err.message : err), "error");
      });
    return () => {
      live = false;
    };
  }, [where, engine]);
  const ready = where === "folder" ? Boolean(path.trim()) : where === "import" ? Boolean(source) : Boolean(name.trim());
  const pick = async () => {
    const dir = await window.apxDesktop?.pickFolder?.();
    if (dir) setPath(dir);
  };
  const bring = async () => {
    setBusy(true);
    try {
      const r = await client.call("sessions.import", {
        engine,
        cwd: source,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      await enableHelper(r.project.id);
      notify(t("project.new.imported", { name: r.project.name, count: r.chats.length }), "info");
      await bootstrap().catch(() => {});
      onClose();
      go.project(r.project.id, "overview");
    } catch (err) {
      notify(String(err instanceof Error ? err.message : err), "error");
    } finally {
      setBusy(false);
    }
  };
  const add = async () => {
    if (!ready || busy) return;
    if (where === "import") return bring();
    setBusy(true);
    try {
      const project = await createProject({
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(kind !== NO_KIND ? { kind: kind as ProjectKind } : {}),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(where === "folder" ? { path: path.trim() } : {}),
      });
      if (!project) return;
      await enableHelper(project.id);
      notify(t("setup.project.added", { name: project.name }), "info");
      await bootstrap().catch(() => {});
      onClose();
      go.project(project.id, "overview");
    } finally {
      setBusy(false);
    }
  };
  const submitOnEnter = (e: KeyboardEvent) => e.key === "Enter" && void add();
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      title={t("project.new.title")}
      description={t("project.new.body")}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!ready} loading={busy} onClick={() => void add()}>
            {where === "import" ? t("project.new.importAction") : t("project.new.add")}
          </Button>
        </>
      }
    >
      <div className="newproject">
        <label>
          <input type="checkbox" checked={helper} onChange={(e) => setHelper(e.currentTarget.checked)} />{" "}
          {t("helper.enable")}
        </label>
        <SegmentedControl
          label={t("project.new.where")}
          value={where}
          onValueChange={(v) => setWhere(v as Where)}
          options={[
            { value: "folder", label: t("project.new.inFolder") },
            { value: "apx", label: t("project.new.noFolder") },
            { value: "import", label: t("project.new.import") },
          ]}
        />
        {where === "import" ? (
          <>
            <SegmentedControl
              label={t("project.new.importFrom")}
              value={engine}
              onValueChange={(v) => setEngine(v as Engine)}
              options={[
                { value: "codex", label: "Codex" },
                { value: "claude", label: "Claude Code" },
              ]}
            />
            <Field label={t("project.new.importProject")}>
              <Select
                label={t("project.new.importProject")}
                value={source}
                disabled={!found?.length}
                placeholder={found && !found.length ? t("project.new.importNone") : "…"}
                onValueChange={(v) => setSource(v ?? "")}
                options={(found ?? []).map((p) => ({
                  value: p.cwd,
                  label: `${p.name} · ${t("project.new.importChats", { count: p.chats })}`,
                }))}
              />
            </Field>
            <p className="newproject__hint">{t("project.new.importHint")}</p>
          </>
        ) : where === "folder" ? (
          <Field label={t("project.new.path")}>
            {(id) => (
              <div className="newproject__row">
                <Input
                  id={id}
                  autoFocus
                  className="is-mono"
                  placeholder={t("setup.project.pathPlaceholder")}
                  value={path}
                  onChange={(e) => setPath(e.currentTarget.value)}
                  onKeyDown={submitOnEnter}
                />
                {window.apxDesktop?.pickFolder && (
                  <Button variant="secondary" leadingIcon={<Icons.FolderOpen size={14} />} onClick={() => void pick()}>
                    {t("setup.project.pick")}
                  </Button>
                )}
              </div>
            )}
          </Field>
        ) : (
          <p className="newproject__hint">
            {t("project.new.apxHint")} <code>~/.apx/v2/projects/{slugOf(name.trim() || t("project.new.example"))}</code>
          </p>
        )}
        <Field label={t("project.settings.name")}>
          {(id) => (
            <Input
              id={id}
              {...(where === "apx" ? { autoFocus: true } : {})}
              placeholder={
                where === "import"
                  ? (found?.find((p) => p.cwd === source)?.name ?? "")
                  : where === "folder"
                    ? baseName(path.trim()) || t("project.new.nameFromFolder")
                    : t("project.new.example")
              }
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.currentTarget.value)}
              onKeyDown={submitOnEnter}
            />
          )}
        </Field>
        {where !== "import" && (
          <>
            <Field label={t("project.settings.kind")}>
              <Select
                label={t("project.settings.kind")}
                value={kind}
                onValueChange={(v) => setKind(v ?? NO_KIND)}
                options={kindOptions(t)}
              />
            </Field>
            <Field label={t("project.settings.description")}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={2}
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.currentTarget.value)}
                />
              )}
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
