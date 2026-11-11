import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

/** A stored secret named in a value. */
const REF = /secret:\/\/([a-zA-Z0-9_.-]+)/g;
/** A zero-width space beside a chip: the browser has no place for the cursor next to an uneditable node otherwise. */
const ANCHOR = "\u200b";

const isChip = (n: Node | null): n is HTMLElement => n instanceof HTMLElement && Boolean(n.dataset.var);

/** A text node before a leading chip and after every chip, so text can be typed on either side. */
function padChips(root: HTMLElement): void {
  if (isChip(root.firstChild)) root.prepend(document.createTextNode(ANCHOR));
  for (const n of [...root.childNodes]) {
    if (!isChip(n)) continue;
    const next = n.nextSibling;
    // An empty text node (left by splitting at its end) holds no cursor either.
    if (!(next instanceof Text)) n.after(document.createTextNode(ANCHOR));
    else if (!next.data) next.data = ANCHOR;
  }
}

/** Puts the cursor in a text node, at `offset`. */
function caretAt(text: Text, offset: number): Range {
  const r = document.createRange();
  r.setStart(text, offset);
  r.collapse(true);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
  return r;
}

export type VarFieldHandle = { insert(name: string): void };

/** The value as typed and stored: text, with each variable as `secret://NAME`. */
function serialize(root: HTMLElement): string {
  let out = "";
  for (const n of root.childNodes) {
    if (isChip(n)) out += `secret://${n.dataset.var}`;
    // Contenteditable inserts non-breaking spaces at the caret; connection values need ordinary spaces.
    else out += (n.textContent ?? "").replaceAll("\u00a0", " ").replaceAll(ANCHOR, "");
  }
  return out;
}

/**
 * One line of text where each variable shows as a green chip with only its name (×, or Backspace, takes it out);
 * the value it stands for stays `secret://NAME`, the form the core resolves.
 */
export const VarField = forwardRef<
  VarFieldHandle,
  {
    value: string;
    onChange(value: string): void;
    onSuggest?(): void;
    placeholder?: string;
    label: string;
    removeLabel: string;
  }
>(function VarField({ value, onChange, onSuggest, placeholder, label, removeLabel }, ref) {
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
    padChips(el);
  };
  const emit = () => {
    const el = root.current;
    if (!el) return;
    const value = serialize(el);
    // Nothing left but cursor anchors: empty, so the placeholder shows again.
    if (!value && el.childNodes.length) el.replaceChildren();
    onChange(value);
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
      padChips(el);
      const after = node.nextSibling as Text;
      emit();
      // The cursor goes right after the chip, once the menu it was picked from has closed and given focus back.
      const place = () => {
        if (!after.isConnected) return;
        el.focus();
        // Past its anchor, or at the start of the text that follows it.
        caret.current = caretAt(after, after.data.startsWith(ANCHOR) ? 1 : 0).cloneRange();
      };
      place();
      // Only if the menu took the cursor away: typing may already have started after the chip.
      requestAnimationFrame(() => {
        const sel = window.getSelection();
        const inside =
          document.activeElement === el && sel?.rangeCount && el.contains(sel.getRangeAt(0).startContainer);
        if (!inside) place();
      });
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
      onFocus={() => {
        // Focus without a cursor inside (a menu gave it back): the cursor goes where it was, else at the end.
        const el = root.current;
        const sel = window.getSelection();
        if (!el || (sel?.rangeCount && el.contains(sel.getRangeAt(0).startContainer))) return;
        const r = caret.current;
        if (r && el.contains(r.startContainer)) {
          sel?.removeAllRanges();
          sel?.addRange(r);
        } else if (el.lastChild instanceof Text) caretAt(el.lastChild, el.lastChild.length);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
        if (e.code === "Space" && e.ctrlKey && onSuggest) {
          e.preventDefault();
          remember();
          onSuggest();
        }
      }}
      onPaste={(e) => {
        // Plain text only: a pasted page must not bring its markup in.
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "));
      }}
    />
  );
});
