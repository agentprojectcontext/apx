import "./NewGroupDialog.css";
import type { Thread } from "@apx/protocol";
import { Button, Checkbox, Dialog, Field, Input, SearchField } from "@apx/ui";
import { useMemo, useState } from "react";
import { useAgentOptions } from "../common/pickers/agentOptions.tsx";
import { client } from "../data/client.ts";
import { realProjectId } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { data } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";

const MAX = 5;

/** Makes the group in the core and keeps it here; says why when it could not. */
async function createGroup(agentIds: string[], title?: string): Promise<Thread | undefined> {
  try {
    const thread = await client.call("threads.group", { agent_ids: agentIds, ...(title ? { title } : {}) });
    data.set((s) => ({
      threads: { ...s.threads, [thread.id]: thread },
      messages: { ...s.messages, [thread.id]: s.messages[thread.id] ?? [] },
      threadLoad: { ...s.threadLoad, [thread.id]: "ready" },
    }));
    return thread;
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), "error");
    return undefined;
  }
}

/**
 * "New group": two to five agents and an optional name. In a project its own agents and the super-agent; from the
 * Inbox every project's, by project.
 */
export function NewGroupDialog({ projectId: navProject, onClose }: { projectId: string | undefined; onClose(): void }) {
  const t = useT();
  const projectId = realProjectId(navProject);
  const options = useAgentOptions(projectId, !projectId, projectId ? "secretary" : "all");
  const [picked, setPicked] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = new Map<string, typeof options>();
    for (const o of options)
      if (!q || `${o.label} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase().includes(q))
        out.set(o.group ?? "", [...(out.get(o.group ?? "") ?? []), o]);
    return [...out];
  }, [options, query]);
  const toggle = (id: string, on: boolean) =>
    setPicked((cur) => (on ? (cur.includes(id) ? cur : [...cur, id]) : cur.filter((x) => x !== id)));
  const create = async () => {
    setBusy(true);
    const made = await createGroup(picked, name.trim() || undefined);
    setBusy(false);
    if (!made) return;
    onClose();
    if (navProject) go.project(navProject, "chats", made.id);
    else go.thread(made.id);
  };
  return (
    <Dialog
      open
      size="md"
      title={t("group.new")}
      description={t("group.newBody")}
      closeLabel={t("common.close")}
      onOpenChange={(open) => !open && onClose()}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" disabled={picked.length < 2 || busy} onClick={() => void create()}>
            {t("group.create")}
          </Button>
        </>
      }
    >
      <div className="newgroup">
        <Field label={t("group.name")} hint={t("group.nameHint")}>
          {(id) => <Input id={id} value={name} maxLength={200} onChange={(e) => setName(e.currentTarget.value)} />}
        </Field>
        <div className="newgroup__head">
          <span className="newgroup__label">{t("group.members")}</span>
          <span className="newgroup__count">{t("group.picked", { count: picked.length })}</span>
        </div>
        {options.length > 6 && (
          <SearchField
            size="sm"
            placeholder={t("group.search")}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
        )}
        <div className="newgroup__list">
          {groups.length === 0 && <p className="newgroup__empty">{t("group.noAgents")}</p>}
          {groups.map(([group, list]) => (
            <section key={group} className="newgroup__group">
              {groups.length > 1 && <h3 className="newgroup__grouplabel">{group}</h3>}
              {list.map((o) => {
                const on = picked.includes(o.value);
                return (
                  <Checkbox
                    key={o.value}
                    className="newgroup__agent"
                    checked={on}
                    disabled={!on && picked.length >= MAX}
                    onCheckedChange={(v) => toggle(o.value, v)}
                    label={
                      <span className="newgroup__who">
                        {o.icon}
                        {o.label}
                      </span>
                    }
                    {...(o.hint ? { description: o.hint } : {})}
                  />
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
