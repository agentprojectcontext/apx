import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSWRConfig } from "swr";
import { FolderOpen, Home, Search, X } from "lucide-react";
import { Filesystem, Projects } from "../lib/api";
import { Button, Dialog, Empty, Field, Input, Loading, Switch } from "./ui";
import { UiSelect } from "./UiSelect";
import { useToast } from "./Toast";
import { t } from "../i18n";

export function AddProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mutate } = useSWRConfig();
  const navigate = useNavigate();
  const toast = useToast();
  const [path, setPath] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [entries, setEntries] = useState<string[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState("");
  const [loadingDirs, setLoadingDirs] = useState(false);
  const [busy, setBusy] = useState(false);
  // What kind of thing this project is. It already existed end to end (the
  // sidebar icon, the topbar, the structure tab that only a company gets) —
  // there was just no moment at which anybody could set it.
  const [kind, setKind] = useState("other");
  const [initIfNeeded, setInitIfNeeded] = useState(true);
  const [withTeam, setWithTeam] = useState(true);

  const loadDirs = async (nextPath: string, silent = false) => {
    setLoadingDirs(true);
    setBrowseError("");
    try {
      const out = await Filesystem.dirs(nextPath || "~");
      setBrowsePath(out.path);
      setPath(out.path);
      setParent(out.parent);
      setEntries(out.entries);
    } catch (e) {
      const message = (e as Error).message;
      setBrowseError(message);
      if (!silent) toast.error(message);
    } finally {
      setLoadingDirs(false);
    }
  };

  // Reset everything when the dialog closes so reopening starts fresh.
  useEffect(() => {
    if (open) return;
    setPath("");
    setBrowseOpen(false);
    setBrowsePath("");
    setEntries([]);
    setParent(null);
    setBrowseError("");
  }, [open]);

  const openBrowser = async () => {
    // Try the OS-native folder picker first (osascript / zenity / PowerShell).
    // If the daemon can't open one, fall back to the inline directory list.
    setLoadingDirs(true);
    try {
      const out = await Filesystem.pickDir(t("add_project.picker_prompt"));
      if ("cancelled" in out) return;
      setPath(out.path);
      return;
    } catch {
      setBrowseOpen(true);
      await loadDirs(path || "~");
    } finally {
      setLoadingDirs(false);
    }
  };

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
          <div className="flex gap-2">
            <Input
              autoFocus
              placeholder={t("add_project.path_placeholder")}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
            />
            <Button onClick={openBrowser} disabled={loadingDirs}>
              <Search size={14} /> {t("add_project.search_btn")}
            </Button>
          </div>
        </Field>

        <Field label={t("add_project.kind_label")} hint={t("add_project.kind_hint")}>
          <UiSelect
            value={kind}
            onChange={setKind}
            options={[
              { value: "other", label: t("settings_ui.kind_other") },
              { value: "company", label: t("settings_ui.kind_company") },
              { value: "personal", label: t("settings_ui.kind_personal") },
              { value: "app", label: t("settings_ui.kind_app") },
              { value: "software", label: t("settings_ui.kind_software") },
            ]}
          />
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

        {browseOpen && (
          <div className="rounded-md border border-border bg-muted/20">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="truncate font-mono text-xs text-muted-fg">{browsePath || path || "~"}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => loadDirs("~")} disabled={loadingDirs}>
                  <Home size={13} />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => parent && loadDirs(parent)} disabled={!parent || loadingDirs}>
                  ..
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setBrowseOpen(false)} disabled={loadingDirs}>
                  <X size={13} />
                </Button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              {loadingDirs && <Loading />}
              {!loadingDirs && browseError && (
                <Empty>{t("add_project.browser_unavailable")}</Empty>
              )}
              {!loadingDirs && !browseError && entries.length === 0 && <Empty>{t("add_project.no_folders")}</Empty>}
              {!loadingDirs && !browseError && entries.map((entry) => (
                <button
                  key={entry}
                  type="button"
                  onClick={() => loadDirs(entry)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <FolderOpen size={14} className="text-muted-fg" />
                  <span className="truncate">{entry.split("/").pop()}</span>
                  <span className="ml-auto truncate font-mono text-[10px] text-muted-fg">{entry}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
