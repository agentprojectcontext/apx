import type { Part } from "@apx/protocol";
import { Button, IconButton, Icons, Tooltip } from "@apx/ui";
import { useState } from "react";
import { useT } from "../../i18n/index.ts";
import { go } from "../../shell/nav.ts";

type Changes = Extract<Part, { type: "changes" }>;

/** Rows shown before the card asks to see the rest. */
const FIRST = 5;

/** A file's git state as one letter: what git says, with a new (untracked) file as an addition. */
const letterOf = (status: string) => (status === "??" ? "A" : status.trim().charAt(0).toUpperCase() || "M");

/**
 * What a code thread's folder has uncommitted after the turn, as git sees it, or the files the agent wrote in it: the
 * lines added and removed in all, then a few files (its folder dim, its name bright) and the rest on demand. Each file
 * opens in the files panel or shows its changes in the changes panel.
 */
export function ChangesPart({ part }: { part: Changes }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const n = part.files.length + (part.more ?? 0);
  const counted = part.files.some((f) => f.added !== undefined);
  const added = part.files.reduce((sum, f) => sum + (f.added ?? 0), 0);
  const removed = part.files.reduce((sum, f) => sum + (f.removed ?? 0), 0);
  const hidden = part.files.length - FIRST;
  const shown = all || hidden <= 0 ? part.files : part.files.slice(0, FIRST);
  return (
    <div className="changes">
      <div className="changes__head">
        <Icons.FileText size={14} className="changes__icon" />
        <span className="changes__title">
          {t(part.scratch ? "changes.scratchEdited" : part.edits ? "changes.edited" : "changes.title", { n })}
        </span>
        <Tooltip content={part.cwd}>
          <span className="changes__cwd">{part.cwd}</span>
        </Tooltip>
        {counted && (
          <span className="changes__stat">
            <span className="is-add">+{added}</span> <span className="is-del">−{removed}</span>
          </span>
        )}
      </div>
      <ul className="changes__list">
        {shown.map((f) => {
          const letter = letterOf(f.status);
          const cut = f.path.lastIndexOf("/") + 1;
          const file = { cwd: part.cwd, path: f.path, scratch: part.scratch === true };
          return (
            <li key={f.path} className="changes__file">
              <span className={`changes__status is-${letter.toLowerCase()}`}>{letter}</span>
              <Tooltip content={f.path}>
                <span className="changes__path">
                  <span className="changes__dir">{f.path.slice(0, cut)}</span>
                  <span className="changes__name">{f.path.slice(cut)}</span>
                </span>
              </Tooltip>
              {f.added !== undefined && (
                <span className="changes__stat">
                  {f.added > 0 && <span className="is-add">+{f.added}</span>}{" "}
                  {(f.removed ?? 0) > 0 && <span className="is-del">−{f.removed}</span>}
                </span>
              )}
              <span className="changes__actions">
                {!f.status.includes("D") && (
                  <IconButton
                    size="sm"
                    label={t("changes.viewFile")}
                    icon={<Icons.Eye size={14} />}
                    onClick={() => go.file(file)}
                  />
                )}
                <IconButton
                  size="sm"
                  label={t("changes.viewChanges")}
                  icon={<Icons.Code size={14} />}
                  onClick={() => go.change(file)}
                />
              </span>
            </li>
          );
        })}
        {part.more && (all || hidden <= 0) ? (
          <li className="changes__more">{t("changes.more", { n: part.more })}</li>
        ) : null}
      </ul>
      {hidden > 0 && (
        <Button size="sm" variant="ghost" className="changes__toggle" onClick={() => setAll((v) => !v)}>
          {all ? t("chat.changes.showLess") : t("chat.changes.showMore", { n: hidden })}
        </Button>
      )}
    </div>
  );
}
