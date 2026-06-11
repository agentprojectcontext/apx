import * as React from "react";
import useSWR from "swr";
import { Skills, type SkillEntry } from "../../lib/api";

interface SkillPickerProps {
  /**
   * Current input value. The picker matches against the leading slug after
   * the first "/". When the input does not start with "/" the picker hides
   * itself entirely.
   */
  value: string;
  /** Optional project path so project-scoped skills appear in the catalog. */
  projectPath?: string;
  /** Called with the chosen slug. Caller decides what to do (typically append `<slug> ` and refocus). */
  onPick: (slug: string) => void;
}

/**
 * Drop-up suggester for `/slug ...` shortcuts on the chat composer. Renders
 * a small list of matching skills above the input when the user starts a
 * message with "/". Keyboard navigation (↑/↓/Enter/Esc) is handled by the
 * parent through `useSkillPickerKeyboard` (so the composer keeps owning the
 * focused textarea).
 */
export function SkillPicker({ value, projectPath, onPick }: SkillPickerProps) {
  const open = isSkillPickerOpen(value);
  const query = open ? extractQuery(value) : "";

  const { data } = useSWR(
    open ? ["/skills", projectPath || ""] : null,
    () => Skills.list(projectPath),
  );

  const list: SkillEntry[] = data?.skills || [];
  const filtered = React.useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return list.slice(0, 8);
    return list
      .filter((s) => s.slug.toLowerCase().includes(q))
      .slice(0, 8);
  }, [list, query]);

  if (!open || filtered.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-popover/95 text-sm shadow-md backdrop-blur">
      <ul role="listbox" className="max-h-64 overflow-y-auto py-1">
        {filtered.map((s) => (
          <li key={s.slug}>
            <button
              type="button"
              onClick={() => onPick(s.slug)}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-accent hover:text-accent-foreground"
            >
              <code className="rounded bg-muted px-1.5 py-0.5 text-[11px]">/{s.slug}</code>
              <span className="truncate text-xs text-muted-foreground">{s.description}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        Type a name to filter · click to insert · the skill body will be loaded for this turn.
      </div>
    </div>
  );
}

/** Trigger detection: the picker shows when the input starts with "/" + an identifier (no space yet). */
export function isSkillPickerOpen(value: string): boolean {
  const m = value.match(/^\s*\/([A-Za-z0-9_-]*)$/);
  return Boolean(m);
}

function extractQuery(value: string): string {
  const m = value.match(/^\s*\/([A-Za-z0-9_-]*)$/);
  return m ? m[1] : "";
}
