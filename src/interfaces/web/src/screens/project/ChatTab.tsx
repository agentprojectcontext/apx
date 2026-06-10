import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { Plus, Trash2 } from "lucide-react";
import { Agents } from "../../lib/api";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { Composer } from "../../components/chat/Composer";
import { MessageList } from "../../components/chat/MessageList";
import { ContextBar } from "../../components/chat/ContextBar";
import { InlineAskPanel, pendingAskQuestions } from "../../components/chat/InlineAskPanel";
import { useChat } from "../../hooks/useChat";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import type { AgentEntry } from "../../types/daemon";

// Virtual entry slug used in the agent dropdown to address the daemon-level
// super-agent (persona "Roby" for the owner). Picked so it can't collide
// with a real APC agent slug (which must match /^[a-z][a-z0-9_-]*$/).
const ROBY_SLUG = "__super_agent__";

export function ChatTab({ pid }: { pid: string }) {
  const toast = useToast();
  const [params] = useSearchParams();
  const agents = useSWR(`/projects/${pid}/agents`, () => Agents.list(pid));
  const [activeSlug, setActiveSlug] = useState(params.get("agent") || "");
  const [creating, setCreating] = useState(false);
  const [model, setModel] = useState("");
  const [dismissedAskKey, setDismissedAskKey] = useState<string | null>(null);
  const { msgs, send: sendChat, stop, clear, streaming } = useChat(pid, (m) => toast.error(m));

  const agentList = agents.data || [];
  // Virtual options shown in the dropdown — Roby is always first, then the
  // real project agents. Roby works on every project (calls /projects/:pid
  // /super-agent/chat) so we expose it everywhere, not just /base.
  const isRoby = (slug: string | null | undefined) => slug === ROBY_SLUG;
  const dropdownOptions = useMemo(
    () => [
      { value: ROBY_SLUG, label: "Roby (super-agent)" },
      ...agentList.map((a) => ({ value: a.slug, label: a.slug })),
    ],
    [agentList],
  );
  const activeAgent = useMemo(
    () => agentList.find((a) => a.slug === activeSlug) || agentList[0],
    [agentList, activeSlug],
  );
  // Effective slug we'll send with: Roby if explicitly selected, or the first
  // real agent, or Roby when the project has no agents at all.
  const effectiveSlug = isRoby(activeSlug)
    ? ROBY_SLUG
    : (activeAgent?.slug || ROBY_SLUG);
  const activeIsRoby = effectiveSlug === ROBY_SLUG;

  useEffect(() => {
    if (!activeSlug && activeAgent?.slug) setActiveSlug(activeAgent.slug);
  }, [activeAgent?.slug, activeSlug]);

  const resetConversation = () => clear();

  const send = async (text: string) => {
    // Roby (super-agent) is always available; a real project agent requires
    // that the project actually has one configured.
    if (!activeIsRoby && !activeAgent) return;
    await sendChat(text, {
      model: activeIsRoby ? model : undefined,
      agentSlug: activeIsRoby ? undefined : activeAgent!.slug,
    });
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.info(t("project.chat.copied")); }
    catch { /* ignore */ }
  };

  if (agents.isLoading) return <Loading />;

  // Header subtitle differs: with Roby selected the chat goes through the
  // super-agent (it CAN call tools); a project agent is a direct LLM call.
  const headerSubtitle = activeIsRoby
    ? t("project.chat.roby_subtitle")
    : t("project.chat.subtitle");

  return (
    <div className="flex h-[calc(100vh-11rem)] flex-col overflow-hidden rounded-xl border border-border bg-card/40">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">
            {activeIsRoby ? t("project.chat.roby_title") : t("project.chat.title")}
          </h2>
          <p className="truncate text-[11px] text-muted-fg">{headerSubtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-52">
            <UiSelect
              value={effectiveSlug}
              onChange={(v) => { setActiveSlug(v); resetConversation(); }}
              options={dropdownOptions}
            />
          </div>
          {activeIsRoby
            ? <Badge tone="success">super-agent</Badge>
            : activeAgent?.model && <Badge tone="info">{activeAgent.model}</Badge>}
          {!agentList.length && !activeIsRoby && (
            <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
              <Plus size={14} /> {t("project.chat.create_agent")}
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={streaming || msgs.length === 0} onClick={resetConversation}>
            <Trash2 size={13} /> {t("project.chat.clear")}
          </Button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto">
        {msgs.length ? (
          <MessageList msgs={msgs} onCopy={copyToClipboard} />
        ) : (
          <Empty>{t("project.chat.empty")}</Empty>
        )}
      </div>
      <ContextBar msgs={msgs} />
      {(() => {
        const pending = !streaming ? pendingAskQuestions(msgs) : null;
        if (!pending || pending.turnKey === dismissedAskKey) return null;
        return (
          <InlineAskPanel
            turnKey={pending.turnKey}
            questions={pending.questions}
            onSubmit={(compiled) => void send(compiled)}
            onDismiss={() => setDismissedAskKey(pending.turnKey)}
            disabled={streaming}
          />
        );
      })()}
      <Composer
        onSend={send}
        onStop={stop}
        streaming={streaming}
        model={activeIsRoby ? model : undefined}
        onModelChange={activeIsRoby ? setModel : undefined}
      />
      <CreateAgentDialog
        open={creating}
        pid={pid}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); agents.mutate(); }}
      />
    </div>
  );
}

function CreateAgentDialog({
  open,
  onClose,
  onCreated,
  pid,
}: { open: boolean; onClose: () => void; onCreated: () => void; pid: string }) {
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [role, setRole] = useState("master");
  const [model, setModel] = useState("");
  const [isMaster, setIsMaster] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^[a-z][a-z0-9_-]*$/.test(slug)) {
      toast.error(t("project.agents.slug_invalid"));
      return;
    }
    setBusy(true);
    try {
      await Agents.create(pid, { slug, role, model: model || undefined, is_master: isMaster } as Partial<AgentEntry> & { slug: string });
      toast.success(t("project.agents.created", { slug }));
      setSlug("");
      setRole("master");
      setModel("");
      setIsMaster(true);
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("project.chat.create_agent_title")}
      description={t("project.chat.create_agent_desc")}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>{t("common.cancel")}</Button>
          <Button variant="primary" onClick={submit} loading={busy}>{t("common.create")}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="slug">
          <Input autoFocus value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="master" />
        </Field>
        <Field label={t("project.chat.role_label")}>
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="master" />
        </Field>
        <Field label={t("project.chat.model_label")} hint={t("project.chat.model_hint")}>
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Switch checked={isMaster} onChange={setIsMaster} label={t("project.chat.master_label")} />
      </div>
    </Dialog>
  );
}
