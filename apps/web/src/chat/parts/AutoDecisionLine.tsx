import type { AutoDecisionNote } from "@apx/protocol";
import { ActionGroup, Icons } from "@apx/ui";
import type { ReactNode } from "react";
import { modelOf, splitRef, useModels } from "../../data/models.ts";
import { useT } from "../../i18n/index.ts";
import { decisionDetail, decisionVerdict } from "./autoDecision.ts";

/**
 * What Auto decided about a step, «Auto lo aprobó», opening to one line: «GPT-6-Luna · lo pediste vos» or «Regla fija».
 * The model by its catalog name, its id when the catalog has none.
 */
export function AutoDecisionLine({ note, children }: { note: AutoDecisionNote; children?: ReactNode }) {
  const t = useT();
  const name = useModels((s) =>
    note.model ? (modelOf(note.model, s.catalog)?.name ?? splitRef(note.model).model) : undefined,
  );
  return (
    <ActionGroup className="turn__autodel" icon={<Icons.ShieldCheck size={13} />} title={decisionVerdict(note, t)}>
      <div className="autodel apx-tree">
        <span className="autodel__by">{decisionDetail(note, t, name)}</span>
        {children}
      </div>
    </ActionGroup>
  );
}
