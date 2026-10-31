import { Check, Copy, Maximize2 } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { cx } from "../cx";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { SegmentedControl } from "./SegmentedControl";

/** Names of a code block's controls; English by default, the app passes its translations. */
export interface CodeFrameLabels {
  preview: string;
  source: string;
  showAs: string;
  copy: string;
  copied: string;
  expand: string;
  close: string;
}

export const CODE_FRAME_LABELS: CodeFrameLabels = {
  preview: "Preview",
  source: "Code",
  showAs: "Show as",
  copy: "Copy",
  copied: "Copied",
  expand: "Expand",
  close: "Close",
};

export interface CodeFrameProps {
  /** What the block is written in, as shown in its header ("HTML", "Mermaid"). */
  language: string;
  /** The block's text, for Copy. */
  code: string;
  /** What the code draws (a page, a diagram): with it, a Preview / Code switch that starts on the preview. */
  preview?: ReactNode;
  /** The code as shown (highlighted, with line numbers). */
  children: ReactNode;
  labels?: Partial<CodeFrameLabels> | undefined;
  className?: string;
}

/**
 * A fenced code block in a frame: its language in the header, Copy and Expand (a larger view in a dialog), and for
 * code that draws something, a switch between what it draws and its code.
 */
export function CodeFrame({ language, code, preview, children, labels, className }: CodeFrameProps) {
  const l = { ...CODE_FRAME_LABELS, ...labels };
  const [view, setView] = useState<"preview" | "source">(preview ? "preview" : "source");
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = () => {
    navigator.clipboard.writeText(code).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  const previewing = preview != null && view === "preview";
  const shown = previewing ? preview : children;
  return (
    <div className={cx("apx-codeframe", className)}>
      <div className="apx-codeframe__bar">
        <span className="apx-codeframe__lang">{language}</span>
        <span className="apx-codeframe__actions">
          {preview ? (
            <SegmentedControl
              size="sm"
              label={l.showAs}
              value={view}
              onValueChange={(v) => setView(v === "preview" ? "preview" : "source")}
              options={[
                { value: "preview", label: l.preview },
                { value: "source", label: l.source },
              ]}
            />
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={copied ? <Check size={13} /> : <Copy size={13} />}
            onClick={copy}
          >
            {copied ? l.copied : l.copy}
          </Button>
          <Button variant="ghost" size="sm" leadingIcon={<Maximize2 size={13} />} onClick={() => setOpen(true)}>
            {l.expand}
          </Button>
        </span>
      </div>
      <div className={cx("apx-codeframe__body", previewing && "apx-codeframe__body--preview")}>{shown}</div>
      {open && (
        <Dialog
          open
          onOpenChange={setOpen}
          size="xl"
          title={language}
          closeLabel={l.close}
          className="apx-codeframe__dialog"
        >
          <div
            className={cx(
              "apx-codeframe__body",
              "apx-codeframe__body--large",
              previewing && "apx-codeframe__body--preview",
            )}
          >
            {shown}
          </div>
        </Dialog>
      )}
    </div>
  );
}
