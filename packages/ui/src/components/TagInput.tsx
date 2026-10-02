import { X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { cx } from "../cx";

export interface TagInputProps {
  value: readonly string[];
  onValueChange: (tags: string[]) => void;
  placeholder?: string;
  /** Accessible name of the text box. */
  label: string;
  /** Accessible name of each chip's remove button; `{tag}` is replaced. */
  removeLabel?: string;
  max?: number;
  className?: string;
}

/** Free tags as chips: Enter or comma adds, Backspace on an empty box removes the last one. */
export function TagInput({
  value,
  onValueChange,
  placeholder,
  label,
  removeLabel = "Remove {tag}",
  max = 12,
  className,
}: TagInputProps) {
  const [draft, setDraft] = useState("");
  /** Adds every comma-separated tag in `raw` (typed, pasted or left on blur). */
  const add = (raw: string) => {
    const next = [...value];
    for (const part of raw.split(",")) {
      const tag = part.trim().slice(0, 32);
      if (tag && !next.some((t) => t.toLowerCase() === tag.toLowerCase()) && next.length < max) next.push(tag);
    }
    if (next.length !== value.length) onValueChange(next);
    setDraft("");
  };
  const type = (text: string) => {
    // Everything before the last comma becomes tags; what follows stays as the draft.
    const cut = text.lastIndexOf(",");
    if (cut < 0) return setDraft(text);
    add(text.slice(0, cut));
    setDraft(text.slice(cut + 1));
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === "Enter" || e.key === ",") && draft.trim()) {
      e.preventDefault();
      add(draft);
    } else if (e.key === "Backspace" && !draft && value.length) onValueChange(value.slice(0, -1));
  };
  return (
    <div className={cx("apx-field", "apx-field--md", "apx-taginput", className)}>
      {value.map((t) => (
        <span key={t} className="apx-taginput__chip">
          {t}
          <button
            type="button"
            className="apx-taginput__remove"
            aria-label={removeLabel.replace("{tag}", t)}
            onClick={() => onValueChange(value.filter((x) => x !== t))}
          >
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        className="apx-field__input apx-taginput__input"
        aria-label={label}
        placeholder={value.length ? undefined : placeholder}
        value={draft}
        onChange={(e) => type(e.target.value)}
        onKeyDown={onKey}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}
