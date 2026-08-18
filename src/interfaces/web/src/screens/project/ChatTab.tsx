import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR, { mutate } from "swr";
import { ArrowUpRight, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Agents, Conversations } from "../../lib/api";
import { Button, Dialog, Empty, Field, Input, Loading, Switch, Tip } from "../../components/ui";
import { Composer } from "../../components/chat/Composer";
import { MessageList } from "../../components/chat/MessageList";
import { ContextBar } from "../../components/chat/ContextBar";
import { InlineAskPanel, pendingAskQuestions } from "../../components/chat/InlineAskPanel";
import { ChatList, type ChatKey, type ChatSelectionMeta } from "../../components/chat/ChatList";
import { useChat, type ChatMsg } from "../../hooks/useChat";
import type { UploadedMedia } from "../../lib/api/media";
import { useToast } from "../../components/Toast";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";
import { toneChip } from "../../lib/tone";
import { usePersonaName } from "../../hooks/usePersonaName";
import { AgentAvatar, SUPER_AGENT_ICON, type AgentFace } from "../../components/agents/AgentAvatar";
import type { AgentEntry } from "../../types/daemon";

// Virtual entry slug used in the agent dropdown to address the daemon-level
// super-agent (persona "Roby" for the owner). Picked so it can't collide
// with a real APC agent slug (which must match /^[a-z][a-z0-9_-]*$/).
const ROBY_SLUG = "__super_agent__";

/**
 * `hideSidebar` lets another screen (the agent inbox) supply its own
 * conversation list and embed just the thread. The chat surface is not forked
 * — one implementation, two frames around it.
 */
export function ChatTab({
  pid,
  hideSidebar = false,
  initialSelection,
  bare = false,
  onOpenInProject,
}: {
  pid: string;
  hideSidebar?: boolean;
  /** Open a specific conversation on mount instead of a fresh live session. */
  initialSelection?: ChatKey;
  /** Drop the card chrome. An embedding screen already draws a panel around
   *  this, and a card inside a card reads as a rendering bug. */
  bare?: boolean;
  /** Structural way out, shown as a header action. Only the inbox passes it:
   *  inside a project you are already where it would take you. */
  onOpenInProject?: () => void;
}) {
  const toast = useToast();
  const [params, setSearchParams] = useSearchParams();
  const agents = useSWR(`/api/projects/${pid}/agents`, () => Agents.list(pid));
  const [creating, setCreating] = useState(false);
  const [model, setModel] = useState("");
  const [dismissedAskKey, setDismissedAskKey] = useState<string | null>(null);
  const { msgs, send: sendChat, stop, clear, load, loadThread, streaming } =
    useChat(pid, (m) => toast.error(m));
  const persona = usePersonaName();

  // Selection state — drives both the sidebar highlight and the right-pane
  // header. Restored from the URL query on mount (so a chat is deep-linkable),
  // defaulting to a live session with the super-agent so the chat works even on
  // a brand-new project with zero agents and zero conversations.
  const [selected, setSelected] = useState<ChatKey>(() => {
    // An embedding screen that already knows which conversation the user
    // picked wins over the URL — otherwise clicking a row in the inbox opens
    // an empty new session and the message you clicked on is nowhere.
    if (initialSelection) return initialSelection;
    const agent = params.get("agent");
    const conv = params.get("conv");
    const channel = params.get("channel");
    const thread = params.get("thread");
    if (channel && thread) return { kind: "thread", channel, threadId: thread };
    if (agent && conv) return { kind: "conv", agentSlug: agent, convId: conv };
    if (agent) return { kind: "live", agentSlug: agent };
    return { kind: "live", agentSlug: ROBY_SLUG };
  });
  // Nobody chose for us — no deep link in the URL, no host-supplied selection —
  // so let the sidebar open this project's most recent chat once its lists land.
  // Read once at mount: selectChat() writes those same params, and re-reading
  // them later would turn every switch back to a live session into an auto-pick.
  const [autoSelectLatest] = useState(
    () =>
      !initialSelection &&
      !params.get("conv") &&
      !params.get("thread") &&
      !params.get("agent"),
  );
  // Display metadata for the current selection (channel/created date/title),
  // carried from the sidebar so the header can show it without a second fetch.
  const [selectedMeta, setSelectedMeta] = useState<ChatSelectionMeta | undefined>(undefined);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Select a chat and mirror its id into the URL query so the current chat is
  // shareable/deep-linkable. `replace` keeps navigation history clean.
  const selectChat = (key: ChatKey, meta?: ChatSelectionMeta) => {
    setSelected(key);
    setSelectedMeta(meta);
    const next = new URLSearchParams();
    if (key.kind === "conv") {
      next.set("agent", key.agentSlug);
      next.set("conv", key.convId);
    } else if (key.kind === "thread") {
      next.set("channel", key.channel);
      next.set("thread", key.threadId);
    } else {
      next.set("agent", key.agentSlug);
    }
    setSearchParams(next, { replace: true });
  };

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
      // Live session selected → always start from a clean slate. (Threads leave
      // conversationId undefined, so an `if (conversationId)` guard would skip
      // clearing and the previous chat's messages would linger under the new
      // header — the "title changes but content stays" bug.)
      clear();
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

  const send = async (text: string, media?: UploadedMedia) => {
    if (activeIsRoby) {
      await sendChat(text, {
        model: model || undefined,
        ...(media ? { attachments: [media] } : {}),
      });
      // The turn just wrote itself into the channel ledger. Revalidate so the
      // new chat shows up in the sidebar now, instead of only after a reload —
      // which read as "the conversation was lost".
      void mutate(`/api/projects/${pid}/super-agent/threads`);
      return;
    }
    if (!activeAgent) return;
    await sendChat(text, { model: model || undefined, agentSlug: activeAgent.slug });
    void mutate(`/api/projects/${pid}/agents/${activeAgent.slug}/conversations`);
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.info(t("project.chat.copied")); }
    catch { /* ignore */ }
  };

  // "+ New" from the sidebar: start a fresh in-memory session with the picked
  // agent (super-agent or a project agent). It materialises in the Web group
  // once the first message is sent.
  const onNewChat = (agentSlug: string) => {
    selectChat({ kind: "live", agentSlug });
    clear();
  };

  // "New session" header button: reset the pane but stay with the current
  // agent (Roby for channel threads / the super-agent, else the project agent).
  const newSession = () => {
    const agentSlug = activeIsRoby ? ROBY_SLUG : activeAgent?.slug ?? selected.agentSlug;
    selectChat({ kind: "live", agentSlug });
    clear();
  };

  // "Delete" header button: permanently remove the persisted conversation
  // (agent `.md` file) or channel thread (ledger day-file), then reset the pane
  // and revalidate the sidebar list so the entry disappears.
  const doDelete = async () => {
    setDeleting(true);
    try {
      if (selected.kind === "conv") {
        await Conversations.remove(pid, selected.agentSlug, selected.convId);
        void mutate(`/api/projects/${pid}/agents/${selected.agentSlug}/conversations`);
      } else if (selected.kind === "thread") {
        await Conversations.removeThread(pid, selected.channel, selected.threadId);
        void mutate(`/api/projects/${pid}/super-agent/threads`);
      }
      toast.success(t("project.chat.deleted"));
      setConfirmDelete(false);
      newSession();
    } catch (e) {
      toast.error((e as Error)?.message || t("shared_ui.err_chat_failed"));
    } finally {
      setDeleting(false);
    }
  };

  // The header answers WHO first and WHICH CONVERSATION second: the agent's
  // face and name on the title line, the thread's own identity (title, date,
  // channel) demoted to the meta line under it. It used to lead with the
  // conversation id — a bare date string — while the agent was a chip off to
  // the right, so a thread looked like it belonged to nobody.
  const agentLabel = activeIsRoby ? persona : activeAgent?.name || activeAgent?.slug || selected.agentSlug;
  const channelLabel =
    selected.kind === "thread" ? selected.channel : selectedMeta?.channel || "web";
  const createdIso =
    selected.kind === "thread" ? selected.threadId : selectedMeta?.createdAt;

  const convLabel =
    selected.kind === "live"
      ? ""
      : selectedMeta?.title ||
        (selected.kind === "thread" ? selected.threadId : selected.convId);
  // Kept as the delete-dialog subject: there the conversation, not the agent,
  // is the thing being destroyed.
  const headerTitle = convLabel || t("project.chat.live_title", { agent: agentLabel });
  const headerSubtitle = [
    convLabel,
    createdIso
      ? t("project.chat.meta_created", { date: formatDate(createdIso), channel: channelLabel })
      : t("project.chat.meta_new", { channel: channelLabel }),
  ].filter(Boolean).join(" · ");

  // One face per speaker, resolved from the same data the inbox uses. Turns a
  // delegated agent produced inside a super-agent thread keep THEIR face, so a
  // multi-agent thread is readable without expanding anything.
  const headerFace: AgentFace = activeIsRoby
    ? { icon: SUPER_AGENT_ICON, name: persona }
    : { icon: activeAgent?.icon, emoji: activeAgent?.emoji, name: agentLabel };

  const faceFor = (msg: ChatMsg): AgentFace => {
    const id = msg.agentId || msg.agent;
    if (!id) return headerFace;
    if (id === "super_agent") return { icon: SUPER_AGENT_ICON, name: msg.agent || persona };
    const hit = agentList.find((a) => a.slug === id || a.name === id);
    if (hit) return { icon: hit.icon, emoji: hit.emoji, name: hit.name || hit.slug };
    return { ...headerFace, name: msg.agent || headerFace.name };
  };

  if (agents.isLoading) return <Loading />;

  return (
    <div className={cn("flex h-full overflow-hidden", !bare && "rounded-xl border border-border bg-card/40")}>
      {hideSidebar ? null : <ChatList
        pid={pid}
        agents={agentList}
        superAgentSlug={ROBY_SLUG}
        superAgentLabel={t("agents_ui.super_agent_label", { persona })}
        selected={selected}
        onSelect={selectChat}
        onNewChat={onNewChat}
        autoSelectLatest={autoSelectLatest}
      />}

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <AgentAvatar {...headerFace} size={30} />
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <h2 className="truncate text-sm font-semibold">{agentLabel}</h2>
                {activeIsRoby && (
                  <span className={cn("shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide", toneChip.emerald)}>
                    {t("agents_ui.super_agent_badge")}
                  </span>
                )}
              </div>
              <p className="truncate text-[11px] text-muted-fg">{headerSubtitle}</p>
            </div>
          </div>
          {/* Labels fold away before the agent's name does: below `lg` these
              are icon buttons with tooltips. Three full-width buttons used to
              eat the identity block down to nothing in the inbox's pane. */}
          <div className="flex shrink-0 items-center gap-1">
            {!agentList.length && !activeIsRoby && (
              <Button variant="primary" size="sm" onClick={() => setCreating(true)}>
                <Plus size={14} /> {t("project.chat.create_agent")}
              </Button>
            )}
            {onOpenInProject && (
              <Tip content={t("inbox.open_in_project")}>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("inbox.open_in_project")}
                  onClick={onOpenInProject}
                >
                  <span className="hidden lg:inline">{t("inbox.open_in_project")}</span>
                  <ArrowUpRight size={13} />
                </Button>
              </Tip>
            )}
            <Tip content={t("project.chat.new_session")}>
              <Button
                variant="ghost"
                size="sm"
                aria-label={t("project.chat.new_session")}
                disabled={streaming || msgs.length === 0}
                onClick={newSession}
              >
                <RotateCcw size={13} />
                <span className="hidden lg:inline">{t("project.chat.new_session")}</span>
              </Button>
            </Tip>
            {(selected.kind === "conv" || selected.kind === "thread") && (
              <Tip content={t("project.chat.delete")}>
                <Button
                  variant="destructive"
                  size="sm"
                  aria-label={t("project.chat.delete")}
                  disabled={streaming}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={13} />
                  <span className="hidden lg:inline">{t("project.chat.delete")}</span>
                </Button>
              </Tip>
            )}
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {msgs.length ? (
            <MessageList msgs={msgs} onCopy={copyToClipboard} faceFor={faceFor} />
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
          allowFiles={activeIsRoby}
        />
      </section>

      <CreateAgentDialog
        open={creating}
        pid={pid}
        onClose={() => setCreating(false)}
        onCreated={() => { setCreating(false); agents.mutate(); }}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={t("project.chat.delete_confirm_title")}
        description={t("project.chat.delete_confirm_desc")}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={doDelete} loading={deleting}>
              <Trash2 size={14} /> {t("project.chat.delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-fg">{headerTitle}</p>
      </Dialog>
    </div>
  );
}

// Localised short date for the header "Created {date}" line. Falls back to the
// raw string for anything Date can't parse.
function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
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
