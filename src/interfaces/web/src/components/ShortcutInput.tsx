import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../lib/cn";
import { Kbd } from "./ui/kbd";
import { t } from "../i18n";

// Capture-style field for an Electron global-shortcut accelerator. Instead of
// showing the raw "CommandOrControl+Shift+G" string in a text box (which reads
// like gibberish), it renders the combo as readable key badges (⌘ Cmd + G) and
// lets the user re-record it by clicking and pressing the keys. The stored
// value stays the canonical Electron accelerator string so main.js /
// globalShortcut keep working unchanged.

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");

// Readable label for one accelerator segment. Modifiers get a glyph + word
// (a bare "⌘"/"Ctrl" alone reads oddly), other keys (G, Space, Up, F5) show
// verbatim.
function tokenLabel(seg: string): string {
  const macMap: Record<string, string> = {
    CommandOrControl: "⌘ Cmd", CmdOrCtrl: "⌘ Cmd", Command: "⌘ Cmd", Cmd: "⌘ Cmd", Super: "⌘ Cmd", Meta: "⌘ Cmd",
    Control: "⌃ Ctrl", Ctrl: "⌃ Ctrl", Option: "⌥ Opt", Alt: "⌥ Opt", Shift: "⇧ Shift",
  };
  const winMap: Record<string, string> = {
    CommandOrControl: "Ctrl", CmdOrCtrl: "Ctrl", Control: "Ctrl", Ctrl: "Ctrl",
    Command: "Win", Cmd: "Win", Super: "Win", Meta: "Win", Option: "Alt", Alt: "Alt", Shift: "Shift",
  };
  const map = isMac ? macMap : winMap;
  return map[seg] ?? seg;
}

function splitAccelerator(value: string): string[] {
  return (value || "").split("+").map((s) => s.trim()).filter(Boolean);
}

// Layout-independent main-key name from a KeyboardEvent.code (so Option-dead
// keys on mac don't corrupt the letter). Returns null for pure modifier keys.
function codeToKey(e: KeyboardEvent): string | null {
  const code = e.code;
  if (/^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/.test(code)) return null;
  let m;
  if ((m = code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = code.match(/^Digit(\d)$/))) return m[1];
  if ((m = code.match(/^Numpad(\d)$/))) return m[1];
  if ((m = code.match(/^(F\d{1,2})$/))) return m[1];
  if ((m = code.match(/^Arrow(Up|Down|Left|Right)$/))) return m[1];
  const named: Record<string, string> = {
    Space: "Space", Enter: "Enter", Tab: "Tab", Backspace: "Backspace", Delete: "Delete",
    Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert",
    Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\",
    Semicolon: ";", Quote: "'", Comma: ",", Period: ".", Slash: "/", Backquote: "`",
  };
  if (named[code]) return named[code];
  // Fallback: a single printable char from e.key.
  if (e.key && e.key.length === 1) return e.key.toUpperCase();
  return null;
}

// Build a canonical Electron accelerator from a keydown. Returns null until a
// non-modifier key is pressed alongside ≥1 modifier (or a function key on its
// own), so a lone ⇧ doesn't get committed.
function eventToAccelerator(e: KeyboardEvent): string | null {
  const key = codeToKey(e);
  if (!key) return null;
  const parts: string[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) parts.push("CommandOrControl");
  if (isMac && e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const hasMod = parts.length > 0;
  const isFn = /^F\d{1,2}$/.test(key);
  if (!hasMod && !isFn) return null; // need a modifier for letter/digit keys
  parts.push(key);
  return parts.join("+");
}

export function ShortcutInput({
  value,
  onChange,
  disabled,
  className,
  trailing,
}: {
  value: string;
  onChange: (accelerator: string) => void;
  disabled?: boolean;
  className?: string;
  /** Rendered at the end of the field — e.g. a Save button (input-group style). */
  trailing?: ReactNode;
}) {
  const [recording, setRecording] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") { setRecording(false); return; }
      const accel = eventToAccelerator(e);
      if (accel) { onChange(accel); setRecording(false); }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [recording, onChange]);

  const segments = splitAccelerator(value);

  return (
    <div
      className={cn(
        "flex h-9 w-full max-w-md items-center rounded-md border border-border bg-transparent transition",
        recording && "ring-2 ring-ring",
        disabled && "opacity-50",
        className,
      )}
    >
      {/* Capture area (click → record). Kept borderless so the wrapper reads as
          one input; the trailing slot sits flush at the end. */}
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => setRecording((r) => !r)}
        onBlur={() => setRecording(false)}
        aria-label={t("modules_ui.desktop_shortcut_record")}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-l-md px-3 text-sm outline-none hover:bg-muted/40 focus-visible:bg-muted/40"
      >
        {recording ? (
          <span className="text-muted-fg">{t("modules_ui.desktop_shortcut_recording")}</span>
        ) : segments.length ? (
          <span className="flex min-w-0 flex-wrap items-center gap-1">
            {segments.map((seg, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-xs text-muted-fg">+</span>}
                <Kbd className="h-6 min-w-6 border border-border bg-muted px-1.5 text-[13px] font-semibold text-fg shadow-sm">
                  {tokenLabel(seg)}
                </Kbd>
              </span>
            ))}
          </span>
        ) : (
          <span className="text-muted-fg">{t("modules_ui.desktop_shortcut_record")}</span>
        )}
        <span className="ml-auto whitespace-nowrap pl-2 text-xs text-muted-fg">
          {recording ? t("modules_ui.desktop_shortcut_esc") : t("modules_ui.desktop_shortcut_change")}
        </span>
      </button>

      {trailing ? (
        <div className="flex h-full items-center border-l border-border px-1">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
