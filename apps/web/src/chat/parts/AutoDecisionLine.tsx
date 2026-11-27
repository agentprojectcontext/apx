import type { AutoDecisionNote } from "@apx/protocol";
import { ActionGroup, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { modelOf, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { decidedBy, decisionLine } from "./autoDecision.ts";

/** What Auto decided about a step, one line that opens to what it deletes or does and who decided. */
export function AutoDecisionLine({ note, children }: { note: AutoDecisionNote; children?: ReactNode }) {
  const t = useT();
  const name = useModels((s) => (note.model ? modelOf(note.model, s.catalog)?.name : undefined));
  return (
    <ActionGroup
      className="turn__autodel"
      icon={note.kind === "action" ? <Icons.ShieldCheck size={13} /> : <Icons.Trash2 size={13} />}
      title={decisionLine(note, t)}
    >
      <div className="autodel apx-tree">
        {note.items.map((item) => (
          <span key={item} className="autodel__item">
            {item}
          </span>
        ))}
        <span className="autodel__by">{decidedBy(note, t, name)}</span>
        {children}
      </div>
    </ActionGroup>
  );
}
