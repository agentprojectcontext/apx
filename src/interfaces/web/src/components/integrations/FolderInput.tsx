import { useState } from "react";
import { FolderOpen, Home, Loader2, Search, X } from "lucide-react";
import { Filesystem } from "../../lib/api";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

// Text input for a filesystem folder plus a "browse" button. Tries the OS-native
// folder picker first (osascript / zenity / PowerShell via the daemon); if that's
// unavailable (headless / remote daemon) it falls back to an inline directory
// list. Mirrors AddProjectDialog's picker so path fields feel consistent.
export function FolderInput({
  value,
  onChange,
  onEnter,
  placeholder,
  ringClassName,
  btnClassName,
}: {
  value: string;
  onChange: (next: string) => void;
  onEnter?: () => void;
  placeholder?: string;
  ringClassName?: string;
  btnClassName?: string;
}) {
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState("");
  const [entries, setEntries] = useState<string[]>([]);
  const [parent, setParent] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadDirs = async (nextPath: string) => {
    setLoading(true);
    setError("");
    try {
      const out = await Filesystem.dirs(nextPath || "~");
      setBrowsePath(out.path);
      onChange(out.path);
      setParent(out.parent);
      setEntries(out.entries);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const openBrowser = async () => {
    setLoading(true);
    try {
      const out = await Filesystem.pickDir(t("add_project.picker_prompt"));
      if ("cancelled" in out) return;
      onChange(out.path);
    } catch {
      // Native picker unavailable — reveal the inline browser instead.
      setBrowseOpen(true);
      await loadDirs(value || "~");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
          className={cn(
            "w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground/60",
            ringClassName,
          )}
        />
        <button
          type="button"
          onClick={openBrowser}
          disabled={loading}
          className={cn(
            "flex flex-shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all disabled:cursor-not-allowed disabled:opacity-50",
            btnClassName,
          )}
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          {t("add_project.search_btn")}
        </button>
      </div>

      {browseOpen && (
        <div className="rounded-lg border border-border bg-muted/20">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="truncate font-mono text-[10px] text-muted-foreground">{browsePath || value || "~"}</span>
            <div className="flex gap-1">
              <button type="button" onClick={() => loadDirs("~")} disabled={loading} className="rounded p-1 hover:bg-accent disabled:opacity-50">
                <Home className="h-3 w-3" />
              </button>
              <button type="button" onClick={() => parent && loadDirs(parent)} disabled={!parent || loading} className="rounded px-1.5 py-0.5 text-[10px] hover:bg-accent disabled:opacity-50">
                ..
              </button>
              <button type="button" onClick={() => setBrowseOpen(false)} disabled={loading} className="rounded p-1 hover:bg-accent disabled:opacity-50">
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-2">
            {loading && (
              <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("common.loading")}
              </div>
            )}
            {!loading && error && (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{t("add_project.browser_unavailable")}</p>
            )}
            {!loading && !error && entries.length === 0 && (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">{t("add_project.no_folders")}</p>
            )}
            {!loading && !error && entries.map((entry) => (
              <button
                key={entry}
                type="button"
                onClick={() => loadDirs(entry)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              >
                <FolderOpen className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                <span className="truncate">{entry.split("/").pop()}</span>
                <span className="ml-auto truncate font-mono text-[10px] text-muted-foreground">{entry}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
