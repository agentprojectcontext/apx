import { IconButton, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { useT } from "../../i18n/index.ts";
import type { ContextRef } from "./contextRefs.ts";

const ICON: Record<ContextRef["kind"], ReactNode> = {
  project: <Icons.Folder size={12} />,
  chat: <Icons.MessageCircle size={12} />,
  task: <Icons.ListChecks size={12} />,
  file: <Icons.FileText size={12} />,
};

/** What was added as context to the next message, each with a way to take it out. */
export function ContextChips({ refs, onRemove }: { refs: readonly ContextRef[]; onRemove: (r: ContextRef) => void }) {
  const t = useT();
  return (
    <ul className="ctxrefs" aria-label={t("composer.context")}>
      {refs.map((r) => (
        <li key={`${r.kind}:${r.id}`} className="ctxrefs__chip" title={r.kind === "file" ? r.id : r.label}>
          <span className="ctxrefs__icon">{ICON[r.kind]}</span>
          <span className="ctxrefs__label">{r.label}</span>
          <IconButton
            size="sm"
            className="ctxrefs__remove"
            label={t("composer.removeContext", { name: r.label })}
            icon={<Icons.X size={12} />}
            onClick={() => onRemove(r)}
          />
        </li>
      ))}
    </ul>
  );
}
