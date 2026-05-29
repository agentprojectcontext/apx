import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import useSWR from "swr";
import { Bot, Plus, Trash2 } from "lucide-react";
import { Agents } from "../../lib/api";
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Switch } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { Composer } from "../../components/chat/Composer";
import { MessageList } from "../../components/chat/MessageList";
import { useToast } from "../../components/Toast";
import { t } from "../../i18n";
import type { AgentEntry } from "../../types/daemon";
import type { ChatMsg } from "../../hooks/useChat";

export function ChatTab({ pid }: { pid: string }) {
  const toast = useToast();
  const [params] = useSearchParams();
  const agents = useSWR(`/projects/${pid}/agents`, () => Agents.list(pid));
  const [activeSlug, setActiveSlug] = useState(params.get("agent") || "");
  const [creating, setCreating] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const agentList = agents.data || [];
  const activeAgent = useMemo(
    () => agentList.find((a) => a.slug === activeSlug) || agentList[0],
    [agentList, activeSlug],
  );

  useEffect(() => {
    if (!activeSlug && activeAgent?.slug) setActiveSlug(activeAgent.slug);
  }, [activeAgent?.slug, activeSlug]);

  const resetConversation = () => {
    setMsgs([]);
    setConversationId(undefined);
  };

  const send = async (text: string) => {
    const prompt = text.trim();
    if (!prompt || !activeAgent || busy) return;
    const now = new Date().toISOString();
    setMsgs((curr) => [
      ...curr,
      { role: "user", content: prompt, ts: now },
      { role: "assistant", content: "", ts: now, pending: true },
    ]);
    setBusy(true);
    try {
      const out = await Agents.chat(pid, activeAgent.slug, { prompt, conversation_id: conversationId });
      setConversationId(out.conversation_id);
      setMsgs((curr) => {
        const copy = [...curr];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant") {
          copy[copy.length - 1] = { ...last, content: out.text, pending: false };
        }
        return copy;
      });
    } catch (e) {
      toast.error((e as Error).message);
      setMsgs((curr) => curr.filter((_, i) => i !== curr.length - 1));
    } finally {
      setBusy(false);
    }
  };

  const copyToClipboard = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast.info("Copiado."); }
    catch { /* ignore */ }
  };

  if (agents.isLoading) return <Loading />;

  if (!agentList.length) {
    return (
      <>
        <Empty>
          <div className="space-y-3 text-center">
            <Bot className="mx-auto size-8 text-muted-fg" />
            <p>No hay agentes. Chat necesita agente master o subagente.</p>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={14} /> Crear agente
            </Button>
          </div>
        </Empty>
        <CreateAgentDialog
          open={creating}
          pid={pid}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); agents.mutate(); }}
        />
      </>
    );
  }

  return (
    <div className="flex h-[calc(100vh-9rem)] flex-col overflow-hidden rounded-xl border border-border bg-card/40">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("project.chat.title")}</h2>
          <p className="truncate text-[11px] text-muted-fg">{t("project.chat.subtitle", { pid })}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-44">
            <UiSelect
              value={activeAgent?.slug || ""}
              onChange={(v) => { setActiveSlug(v); resetConversation(); }}
              options={agentList.map((a) => ({ value: a.slug, label: a.slug }))}
            />
          </div>
          {activeAgent?.model && <Badge tone="info">{activeAgent.model}</Badge>}
          <Button variant="ghost" size="sm" disabled={busy || msgs.length === 0} onClick={resetConversation}>
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
      <Composer onSend={send} onStop={() => null} streaming={busy} />
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
      title="Crear agente"
      description="Necesario para iniciar chat en proyecto."
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
        <Field label="rol">
          <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="master" />
        </Field>
        <Field label="modelo" hint="ej. openai:gpt-5, groq:llama-3.3-70b-versatile">
          <Input value={model} onChange={(e) => setModel(e.target.value)} />
        </Field>
        <Switch checked={isMaster} onChange={setIsMaster} label="Agente master" />
      </div>
    </Dialog>
  );
}
