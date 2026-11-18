import type { Part } from "@apx/protocol";
import { Button } from "@apx/ui";
import { useState } from "react";
import { respond } from "../data/actions.ts";
import { useT } from "../i18n/index.ts";
import { openPublicCopy } from "./publicRequest.ts";

export function PublicCopyInput({ part }: { part: Extract<Part, { type: "input" }> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  return (
    <div className="inputcard is-pending" role="alert">
      <p>{t("input.confirmTitle")}</p>
      <div className="inputcard__actions">
        <Button onClick={() => openPublicCopy({ action: "publish", draft: part.artifact_draft, input: part.input_id })}>
          {t("input.reviewCopy")}
        </Button>
        <Button
          variant="secondary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await respond(part.input_id, { decision: "deny" });
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
