import { ArrowUp, Mic, Plus, Square } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { cx } from "../cx";

/** Accessible names of the icon buttons; English by default. */
export interface ComposerLabels {
  attach: string;
  stop: string;
  send: string;
  voice: string;
}

const DEFAULT_LABELS: ComposerLabels = { attach: "Attach", stop: "Stop", send: "Send", voice: "Voice" };

export interface ComposerProps {
  placeholder?: string;
  /** Override any icon button name (translations). */
  labels?: Partial<ComposerLabels>;
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  /** Enter sends, Shift+Enter adds a line. */
  onSubmit?: (value: string) => void;
  /** Called by the mic button (shown while the field is empty). */
  onVoice?: () => void;
  /** Called by the + button (attach files, insert skill). Omit to hide it. */
  onAttach?: () => void;
  /** Row of controls under the text (model picker, send mode). Present = the tall "box" layout. */
  toolbar?: ReactNode;
  /** Strip above the field (context usage, tool count, attachments). */
  header?: ReactNode;
  /** Agent is answering: the send button becomes stop. */
  busy?: boolean;
  onStop?: () => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Chat input. Without `toolbar` it's a single-line pill (+ · text · mic/send);
 * with `toolbar` it becomes a box with the controls row underneath. Auto-grows.
 */
export function Composer({
  placeholder = "Message",
  labels,
  value,
  defaultValue = "",
  onValueChange,
  onSubmit,
  onVoice,
  onAttach,
  toolbar,
  header,
  busy = false,
  onStop,
  disabled,
  className,
}: ComposerProps) {
  const l = { ...DEFAULT_LABELS, ...labels };
  const [inner, setInner] = useState(defaultValue);
  const text = value ?? inner;
  const set = (v: string) => {
    setInner(v);
    onValueChange?.(v);
  };
  const submit = () => {
    if (!text.trim()) return;
    onSubmit?.(text);
    if (value == null) setInner("");
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };
  const boxed = toolbar != null;
  const attach = onAttach && (
    <button type="button" className="apx-composer__btn" aria-label={l.attach} onClick={onAttach} disabled={disabled}>
      <Plus size={18} />
    </button>
  );
  const primary = busy ? (
    <button type="button" className="apx-composer__send" aria-label={l.stop} onClick={onStop}>
      <Square size={12} fill="currentColor" />
    </button>
  ) : text.trim() ? (
    <button type="button" className="apx-composer__send" aria-label={l.send} onClick={submit} disabled={disabled}>
      <ArrowUp size={16} strokeWidth={2.5} />
    </button>
  ) : (
    <button
      type="button"
      className={cx("apx-composer__send", boxed && "is-quiet")}
      aria-label={l.voice}
      onClick={onVoice}
      disabled={disabled}
    >
      <Mic size={16} />
    </button>
  );
  return (
    <div
      className={cx(
        "apx-composer",
        boxed ? "apx-composer--box" : "apx-composer--pill",
        disabled && "is-disabled",
        className,
      )}
    >
      {header && <div className="apx-composer__header">{header}</div>}
      <div className="apx-composer__row">
        {!boxed && attach}
        <textarea
          className="apx-composer__input"
          rows={boxed ? 2 : 1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => set(e.target.value)}
          onKeyDown={onKey}
          disabled={disabled}
        />
        {!boxed && primary}
      </div>
      {boxed && (
        <div className="apx-composer__toolbar">
          {attach}
          {toolbar}
          <span className="apx-composer__spacer" />
          {primary}
        </div>
      )}
    </div>
  );
}
