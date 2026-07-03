import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { Plus, Trash2 } from "lucide-react";
import { Agents } from "../../lib/api";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch } from "../../components/ui";
import { Composer } from "../../components/chat/Composer";
import { MessageList } from "../../components/chat/MessageList";
import { ContextBar } from "../../components/chat/ContextBar";
import { InlineAskPanel, pendingAskQuestions } from "../../components/chat/InlineAskPanel";
import { ChatList, type ChatKey } from "../../components/chat/ChatList";
import { useChat } from "../../hooks/useChat";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import { usePersonaName } from "../../hooks/usePersonaName";
import type { AgentEntry } from "../../types/daemon";

// Virtual entry slug used in the agent dropdown to address the daemon-level
// super-agent (persona "Roby" for the owner). Picked so it can't collide
// with a real APC agent slug (which must match /^[a-z][a-z0-9_-]*$/).
const ROBY_SLUG = "__super_agent__";

export function ChatTab({ pid }: { pid: string }) {
  const toast = useToast();
  const [params] = useSearchParams();
  const agents = useSWR(`/projects/${pid}/agents`, () => Agents.list(pid));
  const [creating, setCreating] = useState(false);
  const [model, setModel] = useState("");
  const [dismissedAskKey, setDismissedAskKey] = useState<string | null>(null);
  const { msgs, send: sendChat, stop, clear, load, loadThread, streaming, conversationId } =
    useChat(pid, (m) => toast.error(m));
  const persona = usePersonaName();

  // Selection state — drives both the sidebar highlight and the right-pane
  // header. Defaults to a live session with the super-agent so the chat works
  // even on a brand-new project with zero agents and zero conversations.
  const initialFromUrl = params.get("agent");
  const [selected, setSelected] = useState<ChatKey>(
    initialFromUrl
      ? { kind: "live", agentSlug: initialFromUrl }
      : { kind: "live", agentSlug: ROBY_SLUG },
  );

  const agentList = agents.data || [];
  const isRoby = (slug: string | null | undefined) => slug === ROBY_SLUG;

  // The agent whose dropdown badge / model we show on the right header.
  // Channel threads always belong to the super-agent, so no project agent.
  const activeAgent = useMemo(
    () =>
      selected.kind === "thread"
        ? undefined
        : agentList.find((a) => a.slug === selected.agentSlug),
    [agentList, selected],
  );
  const activeIsRoby = selected.kind === "thread" || isRoby(selected.agentSlug);

  // Whenever the user picks a stored conversation or a channel thread, reload
  // the in-memory chat with its persisted history. Conversations bind the
  // conversation_id (sends append to the file); threads stay unbound —
  // continuing sends fresh web turns with the thread as context.
  useEffect(() => {
    if (selected.kind === "conv") {
      void load(selected.agentSlug, selected.convId);
    } else if (selected.kind === "thread") {
      void loadThread(selected.channel, selected.threadId);
    } else {
      // Switching to a live session = drop any previously bound conversation.
      if (conversationId) clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected.kind,
    selected.kind === "conv"
      ? selected.convId
      : selected.kind === "thread"
        ? `${selected.channel}:${selected.threadId}`
        : selected.agentSlug,
  ]);

  const send = async (text: string) => {
    if (activeIsRoby) {
      await sendChat(text, { model: model || undefined });
      return;
    }
    if (!activeAgent) return;
    await sendChat(text, { model: model || undefined, agentSlug: activeAgent.slug });
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.info(t("project.chat.copied")); }
    catch { /* ignore */ }
  };

  const onNewChat = () => {
    setSelected({ kind: "live", agentSlug: ROBY_SLUG });
    clear();
  };

  const headerTitle =
    selected.kind === "thread"
      ? `${selected.channel} · ${selected.threadId}`
      : activeIsRoby
        ? t("project.chat.superagent_title", { persona })
        : selected.kind === "conv"
          ? selected.convId
          : t("project.chat.title");
  const headerSubtitle =
    selected.kind === "thread"
      ? t("project.chat.thread_subtitle", { channel: selected.channel, persona })
      : activeIsRoby
        ? t("project.chat.superagent_subtitle", { persona })
        : selected.kind === "conv"
          ? t("project.chat.loaded_subtitle", { slug: selected.agentSlug })
          : t("project.chat.subtitle");

  if (agents.isLoading) return <Loading />;

  return (
    <div className="flex h-full overflow-hidden rounded-xl border border-border bg-card/40">
      <ChatList
        pid={pid}
        agents={agentList}
        superAgentSlug={ROBY_SLUG}
        superAgentLabel={t("agents_ui.super_agent_label", { persona })}
        selected={selected}
        onSelect={setSelected}
        onNewChat={onNewChat}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{headerTitle}</h2>
            <p className="truncate text-[11px] text-muted-fg">{headerSubtitle}</p>
          </div>
          <div className="flex items-center gap-2">
            {activeIsRoby ? (
              <Badge tone="success">{t("agents_ui.super_agent_badge")}</Badge>
            ) : (
              activeAgent?.model && <Badge tone="info">{activeAgent.model}</Badge>
            )}
            {selected.kind === "conv" && <Badge tone="info">{conversationId || "…"}</Badge>}
            {!agentList.length && !activeIsRoby && (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> {t("project.chat.create_agent")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={streaming || msgs.length === 0}
              onClick={onNewChat}
            >
              <Trash2 size={13} /> {t("project.chat.clear")}
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {msgs.length ? (
            <MessageList msgs={msgs} onCopy={copyToClipboard} />
          ) : (
            <div className="flex h-full items-center justify-center p-8">
              <p className="text-sm text-muted-fg">{t("project.chat.empty")}</p>
            </div>
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
          model={model}
          onModelChange={setModel}
        />
      </section>

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
