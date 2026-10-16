import { SKILL_ZIP_MAX } from "@apx/protocol";
import { Button, Checkbox, Dialog, Input, SegmentedControl, Tag, Textarea } from "@apx/ui";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { notify } from "../data/notices.ts";
import {
  importSkills,
  previewSkillImport,
  type SkillCandidate,
  type SkillImportSource,
  type SkillInfo,
  saveSkill,
} from "../data/resources.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

type Kind = SkillImportSource["kind"];

/** Found this many new skills or fewer, all start ticked. */
const PRESELECT = 3;

/** Opens on Import with this source already read (another app's skill being copied into APX). */
export type ImportStart = { source: SkillImportSource; project: string | undefined };

/**
 * "+ Skill": write a new one, or import skills from a folder, a .zip or a git repository. An import reads the source
 * first and lists what it found (nothing runs); only the skills ticked are copied.
 */
export function AddSkill(props: {
  projectId: string | undefined;
  start?: ImportStart | undefined;
  onClose(): void;
  onDone(s?: SkillInfo): void;
}) {
  const t = useT();
  const [mode, setMode] = useState(props.start ? "import" : "create");
  const create = useCreate(props.projectId, props.onDone);
  const imp = useImport(props.start?.project ?? props.projectId, props.start?.source, props.onDone);
  const creating = mode === "create";
  return (
    <Dialog
      open
      size={creating ? "md" : "lg"}
      onOpenChange={(o) => !o && props.onClose()}
      title={creating ? t("res.newSkill") : props.start ? t("res.copyToApx") : t("res.skill.import")}
      description={
        creating
          ? t(props.projectId ? "res.newSkill.project" : "res.newSkill.global")
          : t(imp.project ? "res.import.project" : "res.import.global")
      }
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          {creating ? (
            <Button disabled={!create.valid} loading={create.busy} onClick={() => void create.run()}>
              {t("res.create")}
            </Button>
          ) : (
            <Button disabled={!imp.chosen.length} loading={imp.busy} onClick={() => void imp.run()}>
              {t("res.import.go", { n: imp.chosen.length })}
            </Button>
          )}
        </>
      }
    >
      <div className="pform">
        {!props.start && (
          <SegmentedControl
            size="sm"
            label={t("res.add.skill")}
            value={mode}
            onValueChange={setMode}
            options={[
              { value: "create", label: t("res.skill.create") },
              { value: "import", label: t("res.skill.import") },
            ]}
          />
        )}
        {creating ? <CreateFields {...create} /> : <ImportFields imp={imp} fixed={Boolean(props.start)} />}
      </div>
    </Dialog>
  );
}

function useCreate(projectId: string | undefined, onDone: (s?: SkillInfo) => void) {
  const t = useT();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(name) && description.trim().length > 0;
  const run = async () => {
    setBusy(true);
    const content = `---\nname: ${name}\ndescription: ${description.trim().replace(/\n/g, " ")}\n---\n\n${t("res.skillStub")}\n`;
    const s = await saveSkill(name, projectId ? "project" : "global", content, projectId);
    setBusy(false);
    if (s) onDone(s);
  };
  return { name, setName, description, setDescription, busy, valid, run };
}

function CreateFields(c: ReturnType<typeof useCreate>) {
  const t = useT();
  return (
    <>
      <div className="pform__field">
        <span className="pform__label">{t("res.skillName")}</span>
        <Input
          aria-label={t("res.skillName")}
          value={c.name}
          placeholder="weekly-report"
          onChange={(e) => c.setName(e.currentTarget.value)}
        />
        <span className="pform__hint">{t("res.skillNameHint")}</span>
      </div>
      <div className="pform__field">
        <span className="pform__label">{t("res.skillDescription")}</span>
        <Textarea
          aria-label={t("res.skillDescription")}
          rows={2}
          value={c.description}
          onChange={(e) => c.setDescription(e.currentTarget.value)}
        />
        <span className="pform__hint">{t("res.skillDescriptionHint")}</span>
      </div>
    </>
  );
}

function useImport(project: string | undefined, start: SkillImportSource | undefined, onDone: (s?: SkillInfo) => void) {
  const t = useT();
  const [kind, setKind] = useState<Kind>(start?.kind ?? "folder");
  const [folder, setFolder] = useState(start?.kind === "folder" ? start.path : "");
  const [url, setUrl] = useState("");
  const [zip, setZip] = useState<{ name: string; data: string }>();
  const [found, setFound] = useState<SkillCandidate[]>();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const source: SkillImportSource | undefined =
    kind === "folder"
      ? folder.trim()
        ? { kind, path: folder.trim() }
        : undefined
      : kind === "repo"
        ? url.trim()
          ? { kind, url: url.trim() }
          : undefined
        : zip && { kind, ...zip };
  const read = async (from = source) => {
    if (!from) return;
    setBusy(true);
    const list = await previewSkillImport(from, project);
    setBusy(false);
    setFound(list);
    // A few are ticked at once; from a big collection the owner picks.
    const fresh = (list ?? []).filter((c) => c.status === "new");
    setPicked(new Set(fresh.length <= PRESELECT ? fresh.map((c) => c.id) : []));
  };
  // Copying another app's skill: it is read at once, there is nothing to choose.
  // biome-ignore lint/correctness/useExhaustiveDependencies: read once when the dialog opens.
  useEffect(() => {
    if (start) void read(start);
  }, []);
  // Only what can land counts: a taken folder only while replacing.
  const usable = (c: SkillCandidate) => c.status === "new" || (c.status === "exists" && replace);
  const chosen = (found ?? []).filter((c) => usable(c) && picked.has(c.id)).map((c) => c.id);
  const setReplacing = (on: boolean) => {
    setReplace(on);
    if (on)
      setPicked((now) => new Set([...now, ...(found ?? []).filter((c) => c.status === "exists").map((c) => c.id)]));
  };
  const pickAll = (on: boolean) => setPicked(new Set(on ? (found ?? []).filter(usable).map((c) => c.id) : []));
  const toggle = (id: string, on: boolean) =>
    setPicked((now) => {
      const next = new Set(now);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const run = async () => {
    if (!source) return;
    setBusy(true);
    const r = await importSkills(source, chosen, replace, project);
    setBusy(false);
    if (!r) return;
    if (r.skipped.length)
      notify(t("res.import.skipped", { list: r.skipped.map((s) => `${s.id} (${s.reason})`).join(", ") }));
    if (r.imported.length) notify(t("res.import.done", { names: r.imported.map((s) => s.name).join(", ") }));
    onDone(r.imported[0]);
  };
  const changeKind = (k: Kind) => {
    setKind(k);
    setFound(undefined);
    setPicked(new Set());
  };
  return {
    project,
    kind,
    changeKind,
    folder,
    setFolder,
    url,
    setUrl,
    zip,
    setZip,
    source,
    read,
    found,
    picked,
    chosen,
    usable,
    pickAll,
    toggle,
    replace,
    setReplace: setReplacing,
    busy,
    run,
  };
}

const STATUS: Record<SkillCandidate["status"], MessageKey> = {
  new: "res.import.status.new",
  exists: "res.import.status.exists",
  reserved: "res.import.status.reserved",
  invalid: "res.import.status.invalid",
};

const NOTE: Record<SkillCandidate["notes"][number]["kind"], MessageKey> = {
  scripts: "res.import.note.scripts",
  app_only: "res.import.note.app_only",
  skipped: "res.import.note.skipped",
};

/** A list said in one line, the first few and how many more. */
const few = (items: string[]) =>
  items.length > 4 ? `${items.slice(0, 4).join(", ")} +${items.length - 4}` : items.join(", ");

function ImportFields({ imp, fixed }: { imp: ReturnType<typeof useImport>; fixed: boolean }) {
  const t = useT();
  const file = useRef<HTMLInputElement>(null);
  const pickZip = (f: File | undefined) => {
    if (!f) return;
    if (f.size > SKILL_ZIP_MAX) {
      notify(t("res.import.zipTooBig", { mb: SKILL_ZIP_MAX / 1024 / 1024 }));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      imp.setZip({ name: f.name, data: String(reader.result) });
      void imp.read({ kind: "zip", name: f.name, data: String(reader.result) });
    };
    reader.readAsDataURL(f);
  };
  let input: ReactNode;
  if (imp.kind === "zip")
    input = (
      <>
        <input
          ref={file}
          type="file"
          accept=".zip,application/zip"
          hidden
          onChange={(e) => pickZip(e.currentTarget.files?.[0])}
        />
        <Button size="sm" variant="secondary" onClick={() => file.current?.click()}>
          {imp.zip?.name ?? t("res.import.zipPick")}
        </Button>
      </>
    );
  else
    input = (
      <>
        <Input
          aria-label={t(imp.kind === "folder" ? "res.import.folder" : "res.import.repo")}
          className="skimp__input"
          value={imp.kind === "folder" ? imp.folder : imp.url}
          readOnly={fixed}
          placeholder={imp.kind === "folder" ? "~/work/skills" : "https://github.com/acme/skills"}
          onChange={(e) => (imp.kind === "folder" ? imp.setFolder : imp.setUrl)(e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && void imp.read()}
        />
        {!fixed && (
          <Button
            size="sm"
            variant="secondary"
            disabled={!imp.source}
            loading={imp.busy}
            onClick={() => void imp.read()}
          >
            {t("res.import.read")}
          </Button>
        )}
      </>
    );
  return (
    <>
      {!fixed && (
        <div className="pform__field">
          <span className="pform__label">{t("res.import.from")}</span>
          <SegmentedControl
            size="sm"
            label={t("res.import.from")}
            value={imp.kind}
            onValueChange={(v) => imp.changeKind(v as Kind)}
            options={[
              { value: "folder", label: t("res.import.folder") },
              { value: "zip", label: t("res.import.zip") },
              { value: "repo", label: t("res.import.repo") },
            ]}
          />
        </div>
      )}
      <div className="pform__field">
        <div className="skimp__row">{input}</div>
        <span className="pform__hint">
          {imp.kind === "repo" ? t("res.import.repoHint") : imp.kind === "folder" ? t("res.import.folderHint") : ""}{" "}
          {t("res.import.safe")}
        </span>
      </div>
      {imp.found && (
        <div className="pform__field">
          <div className="skimp__found">
            <span className="pform__label">{t("res.import.found", { n: imp.found.length })}</span>
            {imp.found.filter(imp.usable).length > 1 && (
              <Checkbox
                checked={imp.chosen.length === imp.found.filter(imp.usable).length}
                label={t("res.import.all")}
                onCheckedChange={imp.pickAll}
              />
            )}
          </div>
          <ul className="skimp__list">
            {imp.found.map((c) => {
              const usable = imp.usable(c);
              return (
                <li key={c.id} className="skimp__item">
                  <div className="skimp__head">
                    <Checkbox
                      checked={usable && imp.picked.has(c.id)}
                      disabled={!usable}
                      label={<span className="skimp__name">{c.name}</span>}
                      onCheckedChange={(on) => imp.toggle(c.id, on)}
                    />
                    <Tag>{t(STATUS[c.status])}</Tag>
                    <span className="skimp__meta">{t("res.import.files", { n: c.files.length })}</span>
                  </div>
                  {c.description && <p className="skimp__desc">{c.description}</p>}
                  {c.notes.map((n) => (
                    <p key={n.kind} className={n.kind === "scripts" ? "skimp__note is-warn" : "skimp__note"}>
                      {t(NOTE[n.kind], { items: few(n.items) })}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
          {imp.found.some((c) => c.status === "exists") && (
            <Checkbox checked={imp.replace} label={t("res.import.replace")} onCheckedChange={imp.setReplace} />
          )}
        </div>
      )}
    </>
  );
}
