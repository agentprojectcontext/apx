import type { Agent } from "@apx/protocol";
import { randomAgentName } from "@apx/protocol/client";
import { Button, Dialog, Field, IconButton, Icons, Input, Textarea } from "@apx/ui";
import { useEffect, useRef, useState } from "react";
import { slugOf } from "../../common/slug.ts";
import { client } from "../../data/client.ts";
import { type ProjectEntry, realProjectId } from "../../data/identity.ts";
import { notify } from "../../data/notices.ts";
import { useData } from "../../data/state.ts";
import { archiveAgent, createAgent } from "../../data/team.ts";
import { useT } from "../../i18n/index.ts";
import { HelperDialog } from "../ProjectHelper.tsx";
import { applyDraftProposal } from "../prompt-proposal.ts";

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
  const [draft, setDraft] = useState({ role: "", prompt: "" });
  const draftRef = useRef(draft);
  const { role, prompt } = draft;
  const updateDraft = (patch: Partial<typeof draft>) => {
    draftRef.current = { ...draftRef.current, ...patch };
    setDraft(draftRef.current);
  };
  const [description, setDescription] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);
  const slug = slugOf(name);
  const projectId = realProjectId(project.id);
  const [offer, setOffer] = useState(false);
  useEffect(() => {
    let live = true;
    setOffer(false);
    const timer = setTimeout(() => {
      if (!projectId) return;
      client
        .call("projects.helper_review", { project: projectId, draft: { role, prompt } })
        .then((r) => {
          if (live) setOffer(r.offer);
        })
        .catch((err) => {
          if (live) notify(err instanceof Error ? err.message : String(err), "error");
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [projectId, role, prompt]);
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
        {projectId && (
          <Button variant="secondary" onClick={() => setReviewing(true)}>
            {t("helper.agentReview")}
          </Button>
        )}
        {offer && <p>{t("helper.agentOffer")}</p>}
        {reviewing && projectId && (
          <HelperDialog
            project={projectId}
            draft={draft}
            onAccept={(proposed, expected) => {
              const next = applyDraftProposal(draftRef.current, expected, proposed);
              if (!next) {
                notify(t("helper.stale"), "error");
                return false;
              }
              updateDraft(next);
              return true;
            }}
            onChanged={(r) => setOffer(r.offer)}
            onClose={() => setReviewing(false)}
          />
        )}
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
          {(id) => <Input id={id} value={role} onChange={(e) => updateDraft({ role: e.currentTarget.value })} />}
        </Field>
        <Field label={t("agent.edit.description")}>
          {(id) => (
            <Textarea id={id} rows={2} value={description} onChange={(e) => setDescription(e.currentTarget.value)} />
          )}
        </Field>
        <Field label={t("agent.edit.prompt")} hint={t("team.new.promptHint")}>
          {(id) => (
            <Textarea
              id={id}
              rows={6}
              value={prompt}
              onChange={(e) => updateDraft({ prompt: e.currentTarget.value })}
            />
          )}
        </Field>
      </div>
    </Dialog>
  );
}
