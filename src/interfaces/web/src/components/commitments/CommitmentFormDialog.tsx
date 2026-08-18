import { useEffect, useState } from "react";
import { Commitments, type CommitmentEntry } from "../../lib/api/commitments";
import { Button, Dialog, Field, Input } from "../ui";
import { UiSelect } from "../UiSelect";
import { useToast } from "../Toast";
import { t } from "../../i18n";

/**
 * The one form for a promise — recording and correcting.
 *
 * Editing matters more here than on tasks: a promise is written down from
 * something you half-heard in a conversation, so the name and the date are
 * exactly the fields that come out wrong.
 *
 * Moving the date of an OPEN promise goes through `renegotiate`, never a
 * silent patch: the previous date is the record of what you told the person,
 * and quietly overwriting it is how "I moved it three times" disappears.
 */
export function CommitmentFormDialog({
  open,
  onClose,
  fixedPid,
  projects,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** Project the screen is pinned to. Omitted on the cross-project screen. */
  fixedPid?: string;
  projects?: { id: string | number; name?: string | null; path?: string }[];
  editing?: { pid: string; commitment: CommitmentEntry } | null;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [who, setWho] = useState("");
  const [what, setWhat] = useState("");
  const [due, setDue] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);

  const pid = editing?.pid ?? fixedPid ?? target;
  const current = editing?.commitment;

  useEffect(() => {
    if (!open) return;
    setWho(current?.counterparty ?? "");
    setWhat(current?.body ?? "");
    setDue(current?.due ? String(current.due).slice(0, 10) : "");
    setTarget(fixedPid ?? String(projects?.[0]?.id ?? ""));
  }, [open, current, fixedPid, projects]);

  const save = async () => {
    if (!who.trim() || !what.trim() || !pid) return;
    setBusy(true);
    try {
      if (current) {
        const patch: Partial<CommitmentEntry> = {};
        if (who.trim() !== current.counterparty) patch.counterparty = who.trim();
        if (what.trim() !== current.body) patch.body = what.trim();
        const wasDue = current.due ? String(current.due).slice(0, 10) : "";
        // MOVING a date on a live promise is a renegotiation, and it keeps the
        // old one in `history`. Setting the first date, clearing it, or
        // touching an already-closed promise is a plain correction — recording
        // "moved ×1" for a promise that never had a date is a lie about the
        // relationship.
        if (due && wasDue && due !== wasDue && current.state === "open") {
          await Commitments.renegotiate(pid, current.id, new Date(due).toISOString());
        } else if (due !== wasDue) {
          patch.due = due ? new Date(due).toISOString() : null;
        }
        if (Object.keys(patch).length) await Commitments.patch(pid, current.id, patch);
        toast.success(t("common.saved"));
      } else {
        await Commitments.add(String(pid), {
          counterparty: who.trim(),
          body: what.trim(),
          // Optional even though it is the useful part — refusing "I promised
          // Ana the quote, no date yet" means the promise goes unrecorded,
          // which is strictly worse.
          due: due ? new Date(due).toISOString() : null,
        });
        toast.success(t("project.commitments.created"));
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={current ? t("project.commitments.edit_title") : t("project.commitments.add_title")}
      description={current ? undefined : t("project.commitments.add_hint")}
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            data-testid="commitment-submit"
            loading={busy}
            disabled={!who.trim() || !what.trim() || !pid}
            onClick={save}
          >
            {current ? t("common.save") : t("project.commitments.add")}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* Counterparty first — it is what makes this a commitment and not a
            task, so the form asks for it before anything else. */}
        <Field label={t("project.commitments.field_who")} hint={t("project.commitments.field_who_hint")}>
          <Input
            data-testid="commitment-who"
            value={who}
            onChange={(e) => setWho(e.target.value)}
            placeholder="Ana"
            autoFocus
          />
        </Field>
        <Field label={t("project.commitments.field_what")}>
          <Input
            data-testid="commitment-what"
            value={what}
            onChange={(e) => setWhat(e.target.value)}
            placeholder={t("project.commitments.field_what_ph")}
            onKeyDown={(e) => { if (e.key === "Enter" && who.trim() && what.trim()) save(); }}
          />
        </Field>
        <Field
          label={t("project.commitments.field_due")}
          hint={
            current?.state === "open" && current?.due
              ? t("project.commitments.field_due_move_hint")
              : t("project.commitments.field_due_hint")
          }
        >
          <Input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        {!fixedPid && !current ? (
          <Field label={t("project.commitments.field_project")}>
            <UiSelect
              value={String(target)}
              onChange={setTarget}
              options={(projects ?? []).map((p) => ({ value: String(p.id), label: p.name || p.path || String(p.id) }))}
            />
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
