// The project's folder, as an editable field — and, when that folder is gone,
// the place it gets repaired.
//
// A project is registered by PATH and nothing else: the entry in
// ~/.apx/config.json is {"path": "…"}, with no name and no id. Every other fact
// is derived by reading that path, so renaming the folder in Finder made all of
// them fall back instead of fail — the name became the basename of the dead
// path, the agent count read 0, and nothing anywhere said a word.
//
// So the folder gets a field of its own rather than a grey line in a breadcrumb,
// and it is drawn above the tabs: it is registry-level, not one more key inside
// .apc/project.json, and when it is broken it must be the first thing seen no
// matter which tab you opened.
//
// The repair is a RELINK, never unregister + register: the id is the entry's
// position in the registry and the stored data hangs off the apx_id, so
// re-registering would hand the project a new id and orphan its agents,
// routines, tasks and chats.
import { useEffect, useState } from "react";
import { AlertTriangle, FolderSearch, Wand2 } from "lucide-react";
import { Projects } from "../../lib/api";
import { Section } from "../Section";
import { Button, Field } from "../ui";
import { DirectoryPicker } from "../common/DirectoryPicker";
import { missingReasonText } from "../../lib/projectPresence";
import { useToast } from "../Toast";
import { t } from "../../i18n";
import type { ProjectEntry } from "../../types/daemon";

export function ProjectFolderCard({
  project,
  onRelinked,
}: {
  project: ProjectEntry;
  onRelinked: () => void;
}) {
  const toast = useToast();
  const pid = String(project.id);
  const missing = !!project.missing;
  const [draft, setDraft] = useState(project.path);
  const [busy, setBusy] = useState<"save" | "find" | null>(null);

  // Follow the registry: after a successful relink the row comes back with the
  // new path, and the field must show where the project IS, not what was typed.
  useEffect(() => { setDraft(project.path); }, [project.path]);

  const apply = async (kind: "save" | "find") => {
    setBusy(kind);
    try {
      // "find" sends no path at all — the daemon matches the apx_id among the
      // siblings of the old path, which is an identity match rather than a
      // guess by name, and so is safe to act on in one click.
      const out = await Projects.relink(pid, kind === "find" ? undefined : draft.trim());
      toast.success(
        t(kind === "find" ? "project.folder.found" : "project.folder.relinked",
          { path: out.path, agents: out.agents }),
      );
      // The in-memory move succeeded but the config file did not record it, so
      // the old path returns on the next boot. Said out loud rather than left
      // to be rediscovered after a restart.
      if (!out.persisted) toast.error(t("project.folder.not_persisted"));
      onRelinked();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const trimmed = draft.trim();
  const unchanged = trimmed === project.path;

  return (
    <Section
      title={t("project.folder.title")}
      description={t("project.folder.subtitle")}
      className={missing ? "border-amber-500/50" : undefined}
    >
      <div className="space-y-4">
        {missing && (
          <div
            data-testid="project-folder-missing"
            className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="min-w-0 space-y-2 text-xs">
              <div className="text-sm font-medium">{t("project.folder.missing_title")}</div>
              {/* The daemon's own words: "the folder no longer exists" and "the
                  folder is there but has no .apc/project.json" are different
                  problems with different fixes, so we do not flatten them. */}
              <p className="text-muted-fg">
                {t("project.folder.missing_body", {
                  reason: missingReasonText(project.missing_reason),
                })}
              </p>
              <p className="text-muted-fg">
                <span className="font-medium">{t("project.folder.missing_path")}:</span>{" "}
                <span className="break-all font-mono">{project.path}</span>
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="primary"
                  loading={busy === "find"}
                  disabled={busy !== null}
                  onClick={() => apply("find")}
                  data-testid="project-folder-find"
                >
                  <Wand2 size={13} /> {t("project.folder.find")}
                </Button>
                <span className="text-muted-fg">{t("project.folder.find_hint")}</span>
              </div>
            </div>
          </div>
        )}

        <Field label={t("project.folder.label")} hint={t("project.folder.hint")}>
          <DirectoryPicker
            value={draft}
            onChange={setDraft}
            prompt={t("project.folder.title")}
            disabled={busy !== null}
            onEnter={() => { if (!unchanged && trimmed) apply("save"); }}
            testId="project-folder-path"
          />
        </Field>

        <Button
          variant={missing ? "secondary" : "primary"}
          loading={busy === "save"}
          // Nothing to do when the field still holds the registered path: the
          // daemon would refuse it anyway ("already registered"), and an error
          // toast is a poor way to say "you changed nothing".
          disabled={busy !== null || !trimmed || unchanged}
          onClick={() => apply("save")}
          data-testid="project-folder-save"
        >
          <FolderSearch size={13} /> {t("project.folder.save")}
        </Button>
      </div>
    </Section>
  );
}
