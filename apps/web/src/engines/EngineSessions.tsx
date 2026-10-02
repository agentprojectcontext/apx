import type { Thread } from "@apx/protocol";
import { Button, EmptyState, EngineIcon, IconButton, Icons, SearchField, Skeleton } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { createThread } from "../data/actions.ts";
import { client } from "../data/client.ts";
import { setThreadModel } from "../data/composer.ts";
import { secretary, threadAgent } from "../data/identity.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ThreadRow } from "../inbox/ThreadRow.tsx";
import { go, useNav } from "../shell/nav.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * An outside engine's sessions (Claude Code, Codex, an ACP agent): every chat it answered in or is set to, newest
 * first, opening beside it like the Inbox; "New session" starts a chat that runs on it.
 */
export function EngineSessions() {
  const t = useT();
  const engineId = useNav((s) => s.engineId) ?? "";
  const threadId = useNav((s) => s.threadId);
  const engine = useData((s) => s.engines.find((e) => e.id === engineId));
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const [ids, setIds] = useState<string[]>();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const count = Object.keys(threads).length;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new chat anywhere may be one of its sessions: read again.
  useEffect(() => {
    let live = true;
    client.call("threads.list", { engine: engineId }).then(
      (r) => live && setIds(r.threads.map((x) => x.id)),
      (e: unknown) => live && notify(t("error.load", { error: errText(e) })),
    );
    return () => {
      live = false;
    };
  }, [engineId, count, t]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (ids ?? [])
      .map((id) => threads[id])
      .filter((x): x is Thread => Boolean(x))
      .filter((x) => !q || `${x.title} ${x.preview ?? ""}`.toLowerCase().includes(q))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }, [ids, threads, query]);

  const start = async () => {
    const agent = secretary(agents);
    if (!agent) return;
    setCreating(true);
    try {
      const th = await createThread({
        agentId: agent.id,
        title: t("engine.newTitle", { engine: engine?.label ?? engineId }),
      });
      await setThreadModel(th.id, { model: engineId, router: false });
      setIds((cur) => [th.id, ...(cur ?? [])]);
      go.engine(engineId, th.id);
    } catch (e) {
      notify(t("error.load", { error: errText(e) }));
    } finally {
      setCreating(false);
    }
  };
  const ready = Boolean(engine?.installed && engine.logged_in);

  return (
    <section className="inbox" aria-label={engine?.label ?? engineId}>
      <div className="inbox__head">
        <div className="inbox__titlerow">
          <EngineIcon engine={engineId} tile size={24} />
          <h1 className="inbox__title">{engine?.label ?? engineId}</h1>
          <IconButton
            label={t("engine.settings")}
            icon={<Icons.Settings size={15} />}
            onClick={() => go.config("engines")}
          />
          <IconButton
            label={t("engine.new")}
            icon={<Icons.SquarePen size={16} />}
            disabled={!ready || creating}
            onClick={() => void start()}
          />
        </div>
        <SearchField
          size="sm"
          placeholder={t("engine.search")}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      <div className="inbox__list">
        {!ids ? (
          <Skeleton shape="block" height={120} />
        ) : !engine?.installed || !engine.logged_in ? (
          <EmptyState
            icon={<Icons.Plug />}
            title={t(engine?.installed ? "engine.signIn" : "engine.install", { engine: engine?.label ?? engineId })}
            action={
              <Button size="sm" variant="secondary" onClick={() => go.config("engines")}>
                {t("engine.settings")}
              </Button>
            }
          >
            {engine?.detail ?? t("engine.notReadyBody")}
          </EmptyState>
        ) : !list.length ? (
          <EmptyState
            icon={<Icons.MessageCircle />}
            title={query ? t("inbox.noResults") : t("engine.empty", { engine: engine.label })}
            action={
              !query && (
                <Button size="sm" loading={creating} onClick={() => void start()}>
                  {t("engine.new")}
                </Button>
              )
            }
          >
            {query ? t("inbox.noMatch", { query }) : t("engine.emptyBody", { engine: engine.label })}
          </EmptyState>
        ) : (
          list.map((th) => (
            <ThreadRow
              key={th.id}
              thread={th}
              agent={threadAgent(th, agents)}
              selected={th.id === threadId}
              onOpen={() => go.engine(engineId, th.id)}
            />
          ))
        )}
      </div>
    </section>
  );
}
