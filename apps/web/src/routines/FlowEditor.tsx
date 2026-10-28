import { Button, Dialog, Field, Input, Switch } from "@apx/ui";
import { useState } from "react";
import { client } from "../data/client.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { type FlowDraft, parseFlowDraft } from "./flow-form.ts";

export function FlowEditor({
  draft,
  creating,
  onSaved,
  onClose,
}: {
  draft: FlowDraft;
  creating: boolean;
  onSaved: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const projects = useData((s) => s.projects);
  const [d, setD] = useState(draft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<FlowDraft>) => setD((cur) => ({ ...cur, ...patch }));
  const save = async () => {
    const definition = parseFlowDraft(d);
    if (!definition) {
      setError(t("flow.invalid"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await client.call("flows.set", definition);
      notify(t("flow.saved"), "info");
      onSaved();
    } catch (e) {
      setError(t("flow.failed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={creating ? t("flow.new") : d.name}
    >
      <div className="flow-form">
        <Field label={t("flow.project")}>
          {(id) =>
            creating ? (
              <select
                id={id}
                value={d.projectId}
                onChange={(e) => set({ projectId: e.currentTarget.value, binding: "" })}
              >
                <option value="">{t("flow.chooseProject")}</option>
                {projects
                  .filter((p) => p.registered !== false)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            ) : (
              <Input id={id} value={d.projectId} readOnly />
            )
          }
        </Field>
        <Field label={t("flow.id")}>
          {(id) => (
            <Input
              id={id}
              value={d.id}
              readOnly={!creating}
              maxLength={100}
              onChange={(e) => set({ id: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("flow.name")}>
          {(id) => <Input id={id} value={d.name} maxLength={120} onChange={(e) => set({ name: e.target.value })} />}
        </Field>
        <Switch label={t("flow.enabled")} checked={d.enabled} onCheckedChange={(enabled) => set({ enabled })} />
        <Field label={t("flow.filters")} hint={t("flow.filtersHint")}>
          {(id) => <textarea id={id} rows={5} value={d.filters} onChange={(e) => set({ filters: e.target.value })} />}
        </Field>
        <Field label={t("flow.tableKey")} hint={t("flow.tableKeyHint")}>
          {(id) => (
            <Input id={id} value={d.tableKey} maxLength={128} onChange={(e) => set({ tableKey: e.target.value })} />
          )}
        </Field>
        <Field label={t("flow.readKeys")} hint={t("flow.readKeysHint")}>
          {(id) => <Input id={id} value={d.readKeysJson} onChange={(e) => set({ readKeysJson: e.target.value })} />}
        </Field>
        <Field label={t("flow.action")}>
          {(id) => (
            <select
              id={id}
              value={d.actionKind}
              onChange={(e) => set({ actionKind: e.target.value as FlowDraft["actionKind"] })}
            >
              <option value="none">{t("flow.none")}</option>
              <option value="agent">{t("flow.agent")}</option>
              <option value="routine">{t("flow.routine")}</option>
            </select>
          )}
        </Field>
        {d.actionKind !== "none" && (
          <Field label={t("flow.binding")} hint={t("flow.bindingHint")}>
            {(id) => (
              <Input id={id} value={d.binding} maxLength={100} onChange={(e) => set({ binding: e.target.value })} />
            )}
          </Field>
        )}
        {d.actionKind === "agent" && (
          <Field label={t("flow.prompt")}>
            {(id) => (
              <textarea
                id={id}
                rows={4}
                value={d.prompt}
                maxLength={8000}
                onChange={(e) => set({ prompt: e.target.value })}
              />
            )}
          </Field>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="flow-actions">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
