import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** A stored secret named in a value. */
const REF = /secret:\/\/([a-zA-Z0-9_.-]+)/g;

export type VarFieldHandle = { insert(name: string): void };

/** The value as typed and stored: text, with each variable as `secret://NAME`. */
function serialize(root: HTMLElement): string {
  let out = "";
  for (const n of root.childNodes) {
    if (n instanceof HTMLElement && n.dataset.var) out += `secret://${n.dataset.var}`;
    else out += n.textContent ?? "";
  }
  return out;
}

/**
 * One line of text where each variable shows as a green chip with only its name (×, or Backspace, takes it out);
 * the value it stands for stays `secret://NAME`, the form the core resolves.
 */
export const VarField = forwardRef<
  VarFieldHandle,
  { value: string; onChange(value: string): void; placeholder?: string; label: string; removeLabel: string }
>(function VarField({ value, onChange, placeholder, label, removeLabel }, ref) {
  const root = useRef<HTMLDivElement>(null);
  /** Where the cursor was last inside the field, so a variable picked from a menu goes there. */
  const caret = useRef<Range | undefined>(undefined);

  const chip = (name: string) => {
    const el = document.createElement("span");
    el.className = "varchip";
    el.contentEditable = "false";
    el.dataset.var = name;
    el.textContent = name;
    const x = document.createElement("button");
    x.type = "button";
    x.className = "varchip__x";
    x.setAttribute("aria-label", `${removeLabel} ${name}`);
    x.textContent = "×";
    x.addEventListener("mousedown", (e) => e.preventDefault());
    x.addEventListener("click", () => {
      el.remove();
      emit();
    });
    el.append(x);
    return el;
  };
  const render = (text: string) => {
    const el = root.current;
    if (!el) return;
    el.replaceChildren();
    let at = 0;
    for (const m of text.matchAll(REF)) {
      if (m.index > at) el.append(document.createTextNode(text.slice(at, m.index)));
      el.append(chip(m[1] as string));
      at = m.index + m[0].length;
    }
    if (at < text.length) el.append(document.createTextNode(text.slice(at)));
  };
  const emit = () => {
    if (root.current) onChange(serialize(root.current));
  };
  const remember = () => {
    const sel = window.getSelection();
    const r = sel?.rangeCount ? sel.getRangeAt(0) : undefined;
    if (r && root.current?.contains(r.startContainer)) caret.current = r.cloneRange();
  };

  // A value changed from outside (a row loaded, a variable inserted) is drawn again; typing is left alone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: render only reads the ref
  useEffect(() => {
    if (root.current && serialize(root.current) !== value) render(value);
  }, [value]);

  useImperativeHandle(ref, () => ({
    insert(name: string) {
      const el = root.current;
      if (!el) return;
      const node = chip(name);
      const r = caret.current;
      if (r && el.contains(r.startContainer)) {
        r.deleteContents();
        r.insertNode(node);
      } else el.append(node);
      // The cursor goes right after the chip.
      const after = document.createRange();
      after.setStartAfter(node);
      after.collapse(true);
      el.focus();
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(after);
      caret.current = after.cloneRange();
      emit();
    },
  }));

  return (
    // biome-ignore lint/a11y/useSemanticElements: an input cannot hold chips; this is a one-line textbox
    <div
      ref={root}
      role="textbox"
      tabIndex={0}
      aria-label={label}
      aria-multiline={false}
      contentEditable
      suppressContentEditableWarning
      className="varfield"
      data-placeholder={placeholder}
      onInput={emit}
      onKeyUp={remember}
      onMouseUp={remember}
      onBlur={remember}
      onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
      onPaste={(e) => {
        // Plain text only: a pasted page must not bring its markup in.
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "));
      }}
    />
  );
});
