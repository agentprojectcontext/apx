import { useEffect, useState } from "react";
import { Save, RotateCcw, Pencil, Eye, Columns2, FileQuestion, Download } from "lucide-react";
import { cn } from "../../lib/cn";
import { Spinner } from "../ui";
import { t } from "../../i18n";
import type { FileContent } from "../../types/daemon";
import { MarkdownPreview } from "./MarkdownPreview";
import { MarkdownEditor } from "./MarkdownEditor";

function ToolbarButton({
  onClick, active, disabled, children,
}: { onClick: () => void; active?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40",
        active ? "bg-primary/15 text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function CodeView({ content }: { content: string }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-collapse font-mono text-[12px] leading-[1.6]">
        <tbody>
          {content.split("\n").map((line, i) => (
            <tr key={i} className="hover:bg-accent/20">
              <td className="w-12 select-none border-r border-border/30 px-3 text-right align-top text-[10px] text-muted-foreground/40" aria-hidden="true">
                {i + 1}
              </td>
              <td className="whitespace-pre px-4 align-top text-foreground/90">{line || " "}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Type-aware file view/editor. Markdown gets a preview + optional split editor;
// text/code get a line-numbered view + optional textarea; images render inline;
// binaries show metadata only. `onSave` (docs, editable text) turns on editing.
export function FileViewer({
  file, loading, onSave,
}: {
  file: FileContent | null;
  loading?: boolean;
  onSave?: (content: string) => Promise<void> | void;
}) {
  const editable = typeof onSave === "function";
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [saving, setSaving] = useState(false);

  // Reset local state whenever a different file loads.
  useEffect(() => {
    setDraft(file?.content ?? "");
    setEditing(false);
    setShowPreview(true);
  }, [file?.path, file?.content]);

  if (loading) {
    return <div className="flex flex-1 items-center justify-center"><Spinner size={16} /></div>;
  }
  if (!file) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t("files.select_prompt")}
      </div>
    );
  }

  const isMarkdown = file.kind === "markdown";
  const isText = file.kind === "text" || file.kind === "markdown";
  const dirty = editing && draft !== (file.content ?? "");

  const save = async () => {
    if (!onSave || !dirty) return;
    setSaving(true);
    try {
      await onSave(draft);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card/40" data-testid="file-viewer">
      {/* Header / toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {file.path}
          {dirty && <span className="ml-1 text-amber-400">•</span>}
        </span>

        {isMarkdown && editing && (
          <ToolbarButton onClick={() => setShowPreview((v) => !v)} active={showPreview}>
            <Columns2 className="size-3" />{t("files.preview")}
          </ToolbarButton>
        )}

        {editable && isText && (
          editing ? (
            <>
              <ToolbarButton onClick={() => { setDraft(file.content ?? ""); setEditing(false); }} disabled={saving}>
                <RotateCcw className="size-3" />{t("files.discard")}
              </ToolbarButton>
              <ToolbarButton onClick={() => void save()} disabled={!dirty || saving} active={dirty}>
                {saving ? <Spinner size={10} /> : <Save className="size-3" />}{t("files.save")}
              </ToolbarButton>
            </>
          ) : (
            <ToolbarButton onClick={() => setEditing(true)}>
              <Pencil className="size-3" />{t("files.edit")}
            </ToolbarButton>
          )
        )}
      </div>

      {/* Body */}
      {isMarkdown ? (
        editing ? (
          <MarkdownEditor value={draft} onChange={setDraft} showPreview={showPreview} onSave={() => void save()} />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto p-4"><MarkdownPreview content={file.content ?? ""} /></div>
        )
      ) : file.kind === "text" ? (
        editing ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void save(); } }}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none bg-transparent p-4 font-mono text-[12px] leading-[1.6] text-foreground/90 outline-none"
          />
        ) : (
          <CodeView content={file.content ?? ""} />
        )
      ) : file.kind === "image" && file.encoding === "base64" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-4">
          <img
            src={`data:${file.mime};base64,${file.content}`}
            alt={file.name}
            className="max-h-full max-w-full rounded object-contain"
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
          <FileQuestion className="size-8 opacity-50" />
          <span>{file.too_large ? t("files.too_large") : t("files.no_preview")}</span>
          <span className="flex items-center gap-1 text-xs opacity-70">
            <Download className="size-3" />{(file.size / 1024).toFixed(1)} KB
          </span>
        </div>
      )}
    </div>
  );
}
