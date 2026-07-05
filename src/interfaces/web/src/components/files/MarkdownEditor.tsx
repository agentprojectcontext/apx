import { cn } from "../../lib/cn";
import { MarkdownPreview } from "./MarkdownPreview";

// A plain-textarea markdown editor with an optional live side-by-side preview.
// Deliberately not a heavyweight editor (Monaco/CodeMirror) — a styled textarea
// is fast, dependency-free, and enough for docs/specs. The parent owns the
// toolbar (save / preview toggle) and passes `showPreview`.
export function MarkdownEditor({
  value,
  onChange,
  showPreview = false,
  placeholder,
  onSave,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  showPreview?: boolean;
  placeholder?: string;
  onSave?: () => void;
  className?: string;
}) {
  return (
    <div className={cn("flex min-h-0 flex-1", className)}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (onSave && (e.metaKey || e.ctrlKey) && e.key === "s") {
            e.preventDefault();
            onSave();
          }
        }}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(
          "min-h-0 resize-none bg-transparent p-4 font-mono text-[13px] leading-[1.7] text-foreground/90 outline-none",
          showPreview ? "w-1/2 border-r border-border" : "w-full",
        )}
      />
      {showPreview && (
        <div className="min-h-0 w-1/2 overflow-y-auto p-4">
          <MarkdownPreview content={value} />
        </div>
      )}
    </div>
  );
}
