import { AgentAvatar, Button, EmptyState, IconButton, Icons, SearchField, Skeleton } from "@apx/ui";
import { useMemo, useState } from "react";
import { createThread } from "../data/actions.ts";
import { blobOf, projectName, secretary, threadAgent } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { go, useNav } from "../shell/nav.ts";
import { groupByProject } from "./groupThreads.ts";
import { ThreadRow } from "./ThreadRow.tsx";

export function InboxList() {
  const projectId = useNav((s) => s.projectId);
  const threadId = useNav((s) => s.threadId);
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const ready = useData((s) => s.ready);
  const offline = useData((s) => s.connection === "offline");
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [creating, setCreating] = useState(false);

  const groups = useMemo(
    () => groupByProject(threads, projects, { projectId, query }),
    [threads, projects, projectId, query],
  );
  const title = projectId ? `Chats de ${projectName(projects, projectId)}` : "Inbox";

  const newChat = async () => {
    const sec = secretary(agents);
    if (!sec) return notify("No hay un super-agente configurado.");
    setCreating(true);
    try {
      const t = await createThread({ agentId: sec.id, projectId, title: "Nuevo chat" });
      go.thread(t.id);
    } catch (e) {
      notify(`No se pudo crear el chat: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="inbox" aria-label={title}>
      <div className="inbox__head">
        <div className="inbox__titlerow">
          <h1 className="inbox__title">{title}</h1>
          <IconButton
            label="Nuevo chat"
            icon={<Icons.SquarePen size={16} />}
            onClick={newChat}
            disabled={creating || !ready}
          />
        </div>
        <SearchField
          size="sm"
          placeholder="Buscar chats"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      <div className="inbox__list">
        {!ready && offline ? (
          <EmptyState icon={<Icons.WifiOff />} title="Sin conexión">
            Los chats aparecen cuando vuelva el core.
          </EmptyState>
        ) : !ready ? (
          <InboxSkeleton />
        ) : groups.length === 0 ? (
          <EmptyState
            icon={<Icons.Inbox />}
            title={query ? "Sin resultados" : "No hay chats todavía"}
            action={
              !query && (
                <Button size="sm" onClick={newChat} loading={creating}>
                  Nuevo chat
                </Button>
              )
            }
          >
            {query ? `Nada coincide con “${query}”.` : "Escribile a tu super-agente para empezar."}
          </EmptyState>
        ) : (
          groups.map((g) => {
            const isCollapsed = collapsed[g.key] ?? false;
            return (
              <div key={g.key} className="inbox__group">
                <button
                  type="button"
                  className="inbox__grouphead"
                  aria-expanded={!isCollapsed}
                  onClick={() => setCollapsed((c) => ({ ...c, [g.key]: !isCollapsed }))}
                >
                  <AgentAvatar
                    name={g.name}
                    blob={g.project ? blobOf(g.project) : "menta"}
                    size={16}
                    animated={false}
                  />
                  <span className="inbox__groupname">{g.name}</span>
                  <span className="inbox__groupcount">{g.threads.length}</span>
                  {g.running > 0 && <span className="inbox__grouprun">· {g.running} en curso</span>}
                  <span className="inbox__groupspacer" />
                  {isCollapsed ? <Icons.ChevronRight size={14} /> : <Icons.ChevronDown size={14} />}
                </button>
                {!isCollapsed &&
                  g.threads.map((t) => (
                    <ThreadRow
                      key={t.id}
                      thread={t}
                      agent={threadAgent(t, agents)}
                      selected={t.id === threadId}
                      onOpen={() => go.thread(t.id)}
                    />
                  ))}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function InboxSkeleton() {
  return (
    <div className="inbox__skeleton" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="inbox__skelrow">
          <Skeleton shape="circle" width={36} />
          <div className="inbox__skeltext">
            <Skeleton width="60%" />
            <Skeleton width="85%" />
          </div>
        </div>
      ))}
    </div>
  );
}
