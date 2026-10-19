import type { Agent } from "@apx/protocol";
import { randomAgentName } from "@apx/protocol/client";
import { Button, Dialog, Field, IconButton, Icons, Input, Textarea } from "@apx/ui";
import { useState } from "react";
import { slugOf } from "../../common/slug.ts";
import { type ProjectEntry, realProjectId } from "../../data/identity.ts";
import { useData } from "../../data/state.ts";
import { archiveAgent, createAgent } from "../../data/team.ts";
import { useT } from "../../i18n/index.ts";

/** Asks before removing an agent: a project agent's file is archived, never deleted; its chats stay. */
export function DeleteAgentDialog({ agent, onClose }: { agent: Agent; onClose(): void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    const ok = await archiveAgent(agent);
    setBusy(false);
    if (ok) onClose();
  };
  const file = agent.source === "apc" && agent.slug ? `.apc/agents/${agent.slug}.md` : undefined;
  return (
    <Dialog
      open
      title={t("team.delete.title", { name: agent.name })}
      description={file ? t("team.delete.bodyFile", { file }) : t("team.delete.body")}
      onOpenChange={(open) => !open && !busy && onClose()}
      footer={
        <>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="danger" loading={busy} onClick={() => void remove()}>
            {t("team.menu.delete")}
          </Button>
        </>
      }
    />
  );
}

/**
 * A new agent: its name (a person's, from APX's generator, none the crew uses), what it does and its instructions;
 * the rest is edited afterwards like any other.
 */
export function NewAgentDialog({
  project,
  onClose,
  onCreated,
}: {
  project: ProjectEntry;
  onClose(): void;
  onCreated(a: Agent): void;
}) {
  const t = useT();
  const taken = Object.values(useData((s) => s.agents)).map((a) => a.name);
  const [name, setName] = useState(() => randomAgentName(taken));
  const [role, setRole] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const slug = slugOf(name);
  const projectId = realProjectId(project.id);
  const create = async () => {
    setBusy(true);
    const made = await createAgent({
      name: name.trim(),
      role: role.trim(),
      prompt,
      ...(description.trim() ? { description: description.trim() } : {}),
      ...(projectId ? { project_id: projectId } : {}),
    });
    setBusy(false);
    if (made) onCreated(made);
  };
  return (
    <Dialog
      open
      size="lg"
      title={t("team.new.title")}
      description={project.isDefault ? t("team.new.global") : t("team.new.project", { project: project.name })}
      onOpenChange={(open) => !open && !busy && onClose()}
      footer={
        <>
          {slug && projectId && (
            <span className="agentedit__file">{t("agent.edit.file", { file: `.apc/agents/${slug}.md` })}</span>
          )}
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button loading={busy} disabled={!slug} onClick={() => void create()}>
            {t("team.new.create")}
          </Button>
        </>
      }
    >
      <div className="taskform">
        <Field label={t("agent.edit.name")}>
          {(id) => (
            <Input
              id={id}
              autoFocus
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              trailing={
                <IconButton
                  size="sm"
                  label={t("team.new.randomName")}
                  icon={<Icons.Dices size={16} />}
                  onClick={() => setName(randomAgentName([...taken, name.trim()]))}
                />
              }
            />
          )}
        </Field>
        <Field label={t("agent.edit.role")} hint={t("agent.edit.roleHint")}>
          {(id) => <Input id={id} value={role} onChange={(e) => setRole(e.currentTarget.value)} />}
        </Field>
        <Field label={t("agent.edit.description")}>
          {(id) => (
            <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
          )}
        </Field>
        <Field label={t("agent.edit.prompt")} hint={t("team.new.promptHint")}>
          {(id) => <Textarea id={id} rows={6} value={prompt} onChange={(e) => setPrompt(e.currentTarget.value)} />}
        </Field>
      </div>
    </Dialog>
  );
}
