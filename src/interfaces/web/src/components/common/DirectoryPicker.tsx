// Pick a folder on the machine the daemon runs on: a path input, a Browse
// button, and an inline directory list for when the OS picker is unavailable.
//
// Two screens need exactly this — registering a project and repairing one whose
// folder was renamed — and they were never going to stay in sync as two copies.
// The OS-native picker (osascript / zenity / PowerShell) is tried first because
// it is the one people already know how to use; the inline list is the fallback
// for a headless daemon or a panel opened from another machine, where no native
// dialog can be shown.
import { useState } from "react";
import { FolderOpen, Home, Search, X } from "lucide-react";
import { Filesystem } from "../../lib/api";
import { Button, Empty, Input, Loading } from "../ui";
import { useToast } from "../Toast";
import { t } from "../../i18n";

export function DirectoryPicker({
  value,
  onChange,
  prompt,
  placeholder,
  autoFocus,
  onEnter,
  disabled,
  testId,
}: {
  value: string;
  onChange: (path: string) => void;
  /** Title for the OS-native dialog. */
  prompt?: string;
  placeholder?: string;
  autoFocus?: boolean;
  /** Enter in the path field — lets a dialog keep its submit-on-Enter. */
  onEnter?: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  const toast = useToast();
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [entries, setEntries] = useState<string[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [browseError, setBrowseError] = useState("");
  const [loadingDirs, setLoadingDirs] = useState(false);

  const loadDirs = async (nextPath: string, silent = false) => {
    setLoadingDirs(true);
    setBrowseError("");
    try {
      const out = await Filesystem.dirs(nextPath || "~");
      setBrowsePath(out.path);
      // Walking into a folder selects it: the folder you are looking inside is
      // the one you are choosing, and there is no separate "pick this" button.
      onChange(out.path);
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

  const openBrowser = async () => {
    // Native first; the inline list is what we fall back to when the daemon
    // cannot open a dialog (headless, or a panel driven from another machine).
    setLoadingDirs(true);
    try {
      const out = await Filesystem.pickDir(prompt ?? t("add_project.picker_prompt"));
      if ("cancelled" in out) return;
      onChange(out.path);
      return;
    } catch {
      setBrowseOpen(true);
      await loadDirs(value || "~");
    } finally {
      setLoadingDirs(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          autoFocus={autoFocus}
          data-testid={testId}
          placeholder={placeholder ?? t("add_project.path_placeholder")}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && onEnter) onEnter(); }}
        />
        <Button
          onClick={openBrowser}
          disabled={loadingDirs || disabled}
          data-testid={testId ? `${testId}-browse` : undefined}
        >
          <Search size={14} /> {t("add_project.search_btn")}
        </Button>
      </div>

      {browseOpen && (
        <div className="rounded-md border border-border bg-muted/20">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="truncate font-mono text-xs text-muted-fg">{browsePath || value || "~"}</span>
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
            {!loadingDirs && browseError && <Empty>{t("add_project.browser_unavailable")}</Empty>}
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
  );
}
