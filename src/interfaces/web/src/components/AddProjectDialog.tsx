import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSWRConfig } from "swr";
import { Projects } from "../lib/api";
import { Button, Dialog, Field, Switch } from "./ui";
import { DirectoryPicker } from "./common/DirectoryPicker";
import { UiSelect } from "./UiSelect";
import { projectKindOptions } from "./config/projectKinds";
import { useToast } from "./Toast";
import { t } from "../i18n";

export function AddProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const toast = useToast();
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const KINDS = projectKindOptions();
  // What kind of thing this project is. It already existed end to end (the
  // sidebar icon, the topbar, the structure tab that only a company gets) —
  // there was just no moment at which anybody could set it.
  // Company is the default because it is the only type that DOES something —
  // areas, roles, an executive team — so it is the one worth offering first.
  const [kind, setKind] = useState("company");
  const [initIfNeeded, setInitIfNeeded] = useState(true);
  const [withTeam, setWithTeam] = useState(true);

  // Reset everything when the dialog closes so reopening starts fresh. The
  // browser's own state (which folder it is showing) resets with it — it lives
  // inside DirectoryPicker, which unmounts with the dialog.
  useEffect(() => {
    if (open) return;
    setPath("");
    setKind("company");
  }, [open]);

  const submit = async () => {
    const trimmed = path.trim();
    if (!trimmed) { toast.error(t("add_project.path_required")); return; }
    setBusy(true);
    try {
      const out = await Projects.register(trimmed, {
        kind,
        init: initIfNeeded,
        team: kind === "company" && withTeam ? "company" : undefined,
      });
      if (out.team && "error" in out.team) toast.error(String(out.team.error));
      toast.success(t("add_project.registered", { id: out.id }));
      await mutate("/api/projects");
      onClose();
      navigate(`/p/${out.id}`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("add_project.title")}
      description={t("add_project.subtitle")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{t("add_project.register")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label={t("add_project.path_label")} hint={t("add_project.path_hint")}>
          <DirectoryPicker
            value={path}
            onChange={setPath}
            prompt={t("add_project.picker_prompt")}
            autoFocus
            onEnter={submit}
          />
        </Field>

        {/* One description per type, written once and shown twice: greyed under
            each option while choosing, and under the field once chosen. Two
            different sentences for the same thing is how they drift apart.
            "Other" sits last because it is the answer you give when none of the
            others fit, not a first option. */}
        <Field label={t("add_project.kind_label")} hint={KINDS.find((k) => k.value === kind)?.description}>
          <UiSelect value={kind} onChange={setKind} options={KINDS} data-testid="project-kind" />
        </Field>

        {/* A company gets a team offered right here, because the moment you
            declare what the project is, is the moment you know whether it
            needs one. Explained rather than named, so the switch says what
            will happen and not just what it is called. */}
        {kind === "company" && (
          <label className="flex items-start gap-3 rounded-md border border-border bg-muted/20 p-3">
            <Switch checked={withTeam} onChange={setWithTeam} />
            <span className="text-xs">
              <span className="font-medium">{t("add_project.team_label")}</span>
              <span className="block text-muted-fg">{t("add_project.team_hint")}</span>
            </span>
          </label>
        )}

        <label className="flex items-start gap-3">
          <Switch checked={initIfNeeded} onChange={setInitIfNeeded} />
          <span className="text-xs">
            <span className="font-medium">{t("add_project.init_label")}</span>
            <span className="block text-muted-fg">{t("add_project.init_hint")}</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}
