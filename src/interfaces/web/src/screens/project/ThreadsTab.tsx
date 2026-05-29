import { useState } from "react";
import useSWR from "swr";
import { Agents, Conversations } from "../../lib/api";
import { Section } from "../../components/Section";
import { Badge, Dialog, Empty, Loading } from "../../components/ui";
import { cn } from "../../lib/cn";
import { t } from "../../i18n";

export function ThreadsTab({ pid }: { pid: string }) {
  const agents = useSWR(`/projects/${pid}/agents`, () => Agents.list(pid));
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <Section
      title={t("project.threads.title")}
      description={t("project.threads.subtitle")}
    >
      {agents.isLoading && <Loading />}
      {!agents.isLoading && (agents.data?.length ?? 0) === 0 && (
        <Empty>No hay agents. Las conversaciones requieren un agent configurado.</Empty>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <ul className="space-y-1 md:col-span-1">
          {(agents.data || []).map((a) => (
            <li key={a.slug}>
              <button
                type="button"
                onClick={() => setActiveSlug(a.slug)}
                className={cn(
                  "flex w-full items-center justify-between rounded-md px-2.5 py-1.5 text-sm",
                  activeSlug === a.slug ? "bg-accent text-accent-fg" : "text-foreground hover:bg-accent/60"
                )}
              >
                <span>{a.slug}</span>
                {a.model && <Badge tone="info">{a.model}</Badge>}
              </button>
            </li>
          ))}
        </ul>
        <div className="md:col-span-2">
          {activeSlug ? <ConvList pid={pid} slug={activeSlug} onOpen={setOpenId} /> :
            <Empty>Elegí un agent para ver sus conversaciones.</Empty>}
        </div>
      </div>

      {activeSlug && openId && (
        <ConvDialog pid={pid} slug={activeSlug} id={openId} onClose={() => setOpenId(null)} />
      )}
    </Section>
  );
}

function ConvList({ pid, slug, onOpen }: { pid: string; slug: string; onOpen: (id: string) => void }) {
  const list = useSWR(`/projects/${pid}/agents/${slug}/conversations`, () => Conversations.list(pid, slug));
  if (list.isLoading) return <Loading />;
  if (!list.data?.length) return <Empty>No hay conversaciones para <code>{slug}</code>.</Empty>;
  return (
    <ul className="space-y-1 text-sm">
      {list.data.map((c) => (
        <li
          key={c.id}
          className="cursor-pointer rounded-md border border-border bg-muted/30 px-3 py-2 hover:bg-accent/40"
          onClick={() => onOpen(c.id)}
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{c.title || c.filename}</span>
            <span className="text-xs text-muted-fg">{new Date(c.started_at).toLocaleString()}</span>
          </div>
          <div className="mt-0.5 text-xs text-muted-fg">
            {c.channel && <>via {c.channel} · </>}
            {(c.messages ?? 0)} mensajes
          </div>
        </li>
      ))}
    </ul>
  );
}

function ConvDialog({ pid, slug, id, onClose }: { pid: string; slug: string; id: string; onClose: () => void }) {
  const data = useSWR(`/projects/${pid}/agents/${slug}/conversations/${id}`, () => Conversations.get(pid, slug, id));
  return (
    <Dialog open onClose={onClose} title={`Conversación ${id}`} size="lg">
      {data.isLoading && <Loading />}
      {data.data && (
        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-2">
          {data.data.messages.map((m, i) => (
            <div key={i} className="rounded-md border border-border bg-muted/30 p-3 text-sm">
              <div className="mb-1 flex items-center justify-between text-xs text-muted-fg">
                <span className="uppercase tracking-wide">{m.role}{m.name ? ` (${m.name})` : ""}</span>
                {m.ts && <span>{new Date(m.ts).toLocaleString()}</span>}
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
          ))}
        </div>
      )}
    </Dialog>
  );
}
