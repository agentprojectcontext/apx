import { Button, Dialog, Field, Textarea } from "@apx/ui";
import { useState } from "react";
import { useT } from "../i18n/index.ts";
import type { AgentDraft } from "./prompt-proposal.ts";

export type AcceptProposal = (prompt: string, expected: AgentDraft) => boolean;

export function PromptProposal({
  proposed,
  expected,
  disabled,
  onAccept,
  onApplied,
}: {
  proposed: string;
  expected: AgentDraft;
  disabled: boolean;
  onAccept: AcceptProposal;
  onApplied(): void;
}) {
  const t = useT();
  const [confirmation, setConfirmation] = useState<{ after: string; before: AgentDraft }>();
  return (
    <>
      <Field label={t("helper.proposal")}>{(id) => <Textarea id={id} readOnly value={proposed} rows={6} />}</Field>
      <Button disabled={disabled} onClick={() => setConfirmation({ after: proposed, before: { ...expected } })}>
        {t("helper.reviewChange")}
      </Button>
      {confirmation && (
        <Dialog
          open
          title={t("helper.confirm")}
          description={t("helper.confirmBody")}
          onOpenChange={(open) => !open && setConfirmation(undefined)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setConfirmation(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => {
                  if (!onAccept(confirmation.after, confirmation.before)) return;
                  setConfirmation(undefined);
                  onApplied();
                }}
              >
                {t("helper.accept")}
              </Button>
            </>
          }
        >
          <Field label={t("helper.before")}>
            {(id) => <Textarea id={id} readOnly value={confirmation.before.prompt} rows={4} />}
          </Field>
          <Field label={t("helper.after")}>
            {(id) => <Textarea id={id} readOnly value={confirmation.after} rows={8} />}
          </Field>
        </Dialog>
      )}
    </>
  );
}
