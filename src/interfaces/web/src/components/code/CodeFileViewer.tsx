import { useEffect, useState } from "react";
import { Save, RotateCcw } from "lucide-react";
import { cn } from "../../lib/cn";
import { Spinner } from "../ui";
import { Tip } from "../ui/tip";
import { t } from "../../i18n";

export function CodeFileViewer({
  path,
  content,
  loading,
  onSave,
}: {
  path: string;
  content: string;
  loading?: boolean;
  /** When provided, the viewer becomes an editor: textarea + Save button. */
  onSave?: (content: string) => Promise<void> | void;
}) {
  const editable = typeof onSave === "function";
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);

  // Reset the draft whenever the upstream content changes (e.g. the file
  // finished loading after the tab opened).
  useEffect(() => {
    setDraft(content);
  }, [content]);

  const dirty = editable && draft !== content;

  const save = async () => {
    if (!onSave || !dirty) return;
    setSaving(true);
    try {
      await onSave(draft);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/40" data-testid="code-file-viewer">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {path}
          {dirty && <span className="ml-1 text-amber-400">•</span>}
        </span>
        {editable && (
          <>
            <Tip content={t("code_module.discard_changes")}>
              <button
                type="button"
                onClick={() => setDraft(content)}
                disabled={!dirty || saving}
                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
              >
                <RotateCcw className="size-3" />
                Descartar
              </button>
            </Tip>
            <Tip content={t("code_module.save_shortcut_hint")}>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving}
                className={cn(
                  "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors",
                  dirty && !saving
                    ? "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {saving ? <Spinner size={10} /> : <Save className="size-3" />}
                Guardar
              </button>
            </Tip>
          </>
        )}
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner size={16} />
        </div>
      ) : editable ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              void save();
            }
          }}
          className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-[12px] leading-[1.6] text-foreground/90 outline-none"
          spellCheck={false}
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-collapse font-mono text-[12px] leading-[1.6]">
            <tbody>
              {content.split("\n").map((line, i) => (
                <tr key={i} className="hover:bg-accent/20">
                  <td
                    className="w-12 select-none border-r border-border/30 px-3 py-0 text-right align-top text-[10px] text-muted-foreground/40"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </td>
                  <td className="px-4 py-0 align-top text-foreground/90 whitespace-pre">
                    {line || " "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
