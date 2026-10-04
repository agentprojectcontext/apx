import type { Agent } from "@apx/protocol";
import { AgentAvatar, BLOB_NAMES, Button, Dialog, Field, Input, Skeleton, Tabs, Textarea } from "@apx/ui";
import { useEffect, useState } from "react";
import { blobOf } from "../../data/identity.ts";
import { getAgent, updateAgent } from "../../data/team.ts";
import { useT } from "../../i18n/index.ts";

type Draft = {
  name: string;
  role: string;
  area: string;
  description: string;
  personality: string;
  blob: string;
  prompt: string;
};

/**
 * The whole agent in one dialog: who it is (name, role, area, what it does, its personality, avatar) and its system
 * prompt. A project
 * agent's changes are written to its `.apc/agents/<slug>.md`.
 */
export function AgentEditor({
  agent,
  onClose,
  start = "identity",
}: {
  agent: Agent;
  onClose: () => void;
  /** The tab it opens on. */
  start?: "identity" | "prompt";
}) {
  const t = useT();
  const [base, setBase] = useState<Draft>();
  const [d, setD] = useState<Draft>();
  const [tab, setTab] = useState<string>(start);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let current = true;
    void getAgent(agent.id).then((r) => {
      if (!current || !r) return;
      const start = {
        name: r.agent.name,
        role: r.agent.role,
        area: r.agent.area ?? "",
        description: r.agent.description ?? "",
        personality: r.agent.personality ?? "",
        blob: blobOf(r.agent) ?? "",
        prompt: r.prompt,
      };
      setBase(start);
      setD(start);
    });
    return () => {
      current = false;
    };
  }, [agent.id]);

  const changed = base && d ? (Object.keys(d) as (keyof Draft)[]).filter((k) => d[k] !== base[k]) : [];
  const save = async () => {
    if (!d || !changed.length) return onClose();
    setSaving(true);
    const ok = await updateAgent(agent.id, Object.fromEntries(changed.map((k) => [k, d[k]])));
    setSaving(false);
    if (ok) onClose();
  };
  const set = (k: keyof Draft) => (v: string) => setD((cur) => (cur ? { ...cur, [k]: v } : cur));

  return (
    <Dialog
      open
      size="lg"
      onOpenChange={(o) => !o && onClose()}
      title={t("agent.edit.title", { name: agent.name })}
      footer={
        <>
          {agent.source === "apc" && agent.slug && (
            <span className="agentedit__file">{t("agent.edit.file", { file: `.apc/agents/${agent.slug}.md` })}</span>
          )}
          <Button variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={saving} disabled={!d?.name.trim() || !changed.length} onClick={() => void save()}>
            {t("common.save")}
          </Button>
        </>
      }
    >
      {!d ? (
        <Skeleton shape="block" height={240} />
      ) : (
        <Tabs
          variant="pill"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              value: "identity",
              label: t("agent.edit.identity"),
              content: (
                <div className="taskform">
                  <div className="taskform__row">
                    <Field label={t("agent.edit.name")}>
                      {(id) => <Input id={id} value={d.name} onChange={(e) => set("name")(e.currentTarget.value)} />}
                    </Field>
                    <Field label={t("team.area")} hint={t("agent.edit.areaHint")}>
                      {(id) => <Input id={id} value={d.area} onChange={(e) => set("area")(e.currentTarget.value)} />}
                    </Field>
                  </div>
                  <Field label={t("agent.edit.role")} hint={t("agent.edit.roleHint")}>
                    {(id) => <Input id={id} value={d.role} onChange={(e) => set("role")(e.currentTarget.value)} />}
                  </Field>
                  <Field label={t("agent.edit.description")}>
                    {(id) => (
                      <Textarea
                        id={id}
                        rows={3}
                        value={d.description}
                        onChange={(e) => set("description")(e.currentTarget.value)}
                      />
                    )}
                  </Field>
                  <Field label={t("agent.edit.personality")} hint={t("agent.edit.personalityHint")}>
                    {(id) => (
                      <Textarea
                        id={id}
                        rows={2}
                        value={d.personality}
                        placeholder={t("agent.edit.personalityPlaceholder")}
                        onChange={(e) => set("personality")(e.currentTarget.value)}
                      />
                    )}
                  </Field>
                  <Field label={t("agent.edit.avatar")}>
                    <div className="agentedit__blobs">
                      {BLOB_NAMES.map((b) => (
                        <button
                          key={b}
                          type="button"
                          aria-pressed={d.blob === b}
                          aria-label={b}
                          className={`agentedit__blob${d.blob === b ? " is-on" : ""}`}
                          onClick={() => set("blob")(b)}
                        >
                          <AgentAvatar name={d.name} blob={b} size={32} animated={false} />
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>
              ),
            },
            {
              value: "prompt",
              label: t("agent.edit.prompt"),
              content: (
                <Field label={t("agent.edit.prompt")} hint={t("agent.edit.promptHint")}>
                  {(id) => (
                    <Textarea
                      id={id}
                      className="agentedit__prompt"
                      rows={16}
                      value={d.prompt}
                      onChange={(e) => set("prompt")(e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          void save();
                        }
                      }}
                    />
                  )}
                </Field>
              ),
            },
          ]}
        />
      )}
    </Dialog>
  );
}
