import "../styles/screens.css";
import type { Result, Thread } from "@apx/protocol";
import { Button, Dialog, EmptyState, EngineIcon, Field, IconButton, Icons, SearchField, Skeleton } from "@apx/ui";
import { useEffect, useMemo, useState } from "react";
import { shortWhen } from "../common/format.ts";
import { ProjectSelect } from "../common/pickers/ProjectSelect.tsx";
import { client } from "../data/client.ts";
import { secretary, threadAgent } from "../data/identity.ts";
import { newChatId } from "../data/newChat.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { ThreadRow } from "../inbox/ThreadRow.tsx";
import { go, useNav } from "../shell/nav.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
type Native = Result<"sessions.native">["sessions"][number];
/** Engines whose own sessions on this machine APX can read and go on with. */
const NATIVE = new Set(["claude", "codex"]);

/**
 * An outside engine's sessions (Claude Code, Codex, an ACP agent), the engine itself: those started in APX, newest
 * first, and below them the owner's own sessions on this Mac, to go on with here. "New session" asks for the project
 * it works in.
 */
export function EngineSessions() {
  const t = useT();
  const engineId = useNav((s) => s.engineId) ?? "";
  const threadId = useNav((s) => s.threadId);
  const engine = useData((s) => s.engines.find((e) => e.id === engineId));
  const threads = useData((s) => s.threads);
  const agents = useData((s) => s.agents);
  const [ids, setIds] = useState<string[]>();
  const [native, setNative] = useState<Native[]>();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [resuming, setResuming] = useState<string>();
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: one gone on with in APX leaves this list: read again.
  useEffect(() => {
    let live = true;
    setNative(undefined);
    if (engineId !== "claude" && engineId !== "codex") return;
    client.call("sessions.native", { engine: engineId, limit: 100 }).then(
      (r) => live && setNative(r.sessions),
      () => live && setNative([]),
    );
    return () => {
      live = false;
    };
  }, [engineId, count]);

  const q = query.trim().toLowerCase();
  const list = useMemo(
    () =>
      (ids ?? [])
        .map((id) => threads[id])
        .filter((x): x is Thread => Boolean(x))
        .filter((x) => !q || `${x.title} ${x.preview ?? ""}`.toLowerCase().includes(q))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [ids, threads, q],
  );
  const mine = (native ?? []).filter((s) => !q || `${s.title} ${s.cwd}`.toLowerCase().includes(q));

  const resume = async (s: Native) => {
    if (engineId !== "claude" && engineId !== "codex") return;
    setResuming(s.id);
    try {
      const th = await client.call("sessions.resume", { engine: engineId, id: s.id });
      setIds((cur) => [th.id, ...(cur ?? [])]);
      go.engine(engineId, th.id);
    } catch (e) {
      notify(t("error.load", { error: errText(e) }));
    } finally {
      setResuming(undefined);
    }
  };
  const ready = Boolean(engine?.installed && engine.logged_in);
  const label = engine?.label ?? engineId;

  return (
    <section className="inbox" aria-label={label}>
      <div className="inbox__head">
        <div className="inbox__titlerow">
          <EngineIcon engine={engineId} tile size={24} />
          <h1 className="inbox__title">{label}</h1>
          <IconButton
            label={t("engine.settings")}
            icon={<Icons.Settings size={15} />}
            onClick={() => go.config("external")}
          />
          <IconButton
            label={t("engine.new")}
            icon={<Icons.SquarePen size={16} />}
            disabled={!ready}
            onClick={() => setCreating(true)}
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
            title={t(engine?.installed ? "engine.signIn" : "engine.install", { engine: label })}
            action={
              <Button size="sm" variant="secondary" onClick={() => go.config("external")}>
                {t("engine.settings")}
              </Button>
            }
          >
            {engine?.detail ?? t("engine.notReadyBody")}
          </EmptyState>
        ) : (
          <>
            {list.map((th) => (
              <ThreadRow
                key={th.id}
                thread={th}
                agent={threadAgent(th, agents)}
                selected={th.id === threadId}
                onOpen={() => go.engine(engineId, th.id)}
              />
            ))}
            {!list.length && !mine.length && (
              <EmptyState
                icon={<Icons.MessageCircle />}
                title={query ? t("inbox.noResults") : t("engine.empty", { engine: label })}
                action={
                  !query && (
                    <Button size="sm" onClick={() => setCreating(true)}>
                      {t("engine.new")}
                    </Button>
                  )
                }
              >
                {query ? t("inbox.noMatch", { query }) : t("engine.emptyBody", { engine: label })}
              </EmptyState>
            )}
          </>
        )}
        {NATIVE.has(engineId) && (mine.length > 0 || native === undefined) && (
          <div className="engine__native">
            <div className="engine__nativehead">
              <Icons.Monitor size={13} />
              <span>{t("engine.onMac")}</span>
              <span className="engine__nativecount">{native ? mine.length : ""}</span>
            </div>
            {native === undefined ? (
              <Skeleton height={48} />
            ) : (
              mine.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className="engine__session"
                  disabled={!ready || resuming !== undefined}
                  title={t("engine.resumeHint", { engine: label })}
                  onClick={() => void resume(s)}
                >
                  <span className="engine__sessiontop">
                    <span className="engine__sessiontitle">{s.title}</span>
                    <span className="engine__sessiontime">{shortWhen(s.updated_at)}</span>
                  </span>
                  <span className="engine__sessioncwd">
                    {resuming === s.id ? t("engine.resuming") : s.cwd.split("/").slice(-2).join("/")}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      {creating && <NewSession engineId={engineId} label={label} onClose={() => setCreating(false)} />}
    </section>
  );
}

/** A new session with the engine itself, in a project's folder: made with its first message (see newChat.ts). */
function NewSession(props: { engineId: string; label: string; onClose(): void }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const projects = useData((s) => s.projects);
  const [project, setProject] = useState<string | undefined>(
    () => projects.find((p) => p.path && p.registered !== false)?.id,
  );
  const folder = projects.find((p) => p.id === project)?.path;
  const start = () => {
    const agent = secretary(agents);
    if (!agent || !project) return;
    go.engine(props.engineId, newChatId({ agent: agent.id, project, engine: props.engineId }));
    props.onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && props.onClose()}
      title={t("engine.newWith", { engine: props.label })}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>
            {t("common.cancel")}
          </Button>
          <Button disabled={!folder} onClick={start}>
            {t("engine.start")}
          </Button>
        </>
      }
    >
      <Field label={t("engine.project")} hint={folder ?? t("engine.projectHint")}>
        <ProjectSelect value={project} onChange={setProject} />
      </Field>
    </Dialog>
  );
}
