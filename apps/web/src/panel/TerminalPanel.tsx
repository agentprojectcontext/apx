import type { Job, TerminalInfo, Thread } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, Skeleton } from "@apx/ui";
import { Suspense, useCallback, useEffect, useState } from "react";
import { client } from "../data/client.ts";
import { watchEvents } from "../data/live.ts";
import { notify } from "../data/notices.ts";
import { useT } from "../i18n/index.ts";
import { TerminalView } from "../lazy.ts";
import { useNav } from "../shell/nav.ts";
import { LIST_TAB, PanelTabs } from "./PanelTabs.tsx";
import { plain } from "./terminalText.ts";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The chat's terminals: the list shows the commands the agent ran here (and the ones still running in the background)
 * with what they printed; each tab is the owner's own shell in the chat's folder.
 */
export function TerminalPanel({ thread }: { thread: Thread }) {
  const t = useT();
  const threadId = thread.id;
  const [terms, setTerms] = useState<TerminalInfo[]>([]);
  const [tab, setTab] = useState<string>("agent");
  const wanted = useNav((s) => s.panelTerminal);
  const load = useCallback(async () => {
    const r = await client.call("terminal.list", { thread: threadId }).catch(() => ({ terminals: [] }));
    setTerms(r.terminals);
    return r.terminals;
  }, [threadId]);
  useEffect(() => {
    void load();
    return watchEvents((ev) => {
      if (ev.type === "terminal.exited") void load();
    });
  }, [load]);
  // A terminal opened elsewhere (a run button in the chat) comes forward once the list knows it.
  useEffect(() => {
    if (wanted) void load().then((list) => list.some((x) => x.id === wanted) && setTab(wanted));
  }, [wanted, load]);
  const open = async () => {
    try {
      const term = await client.call("terminal.open", { thread: threadId, cols: 80, rows: 24 });
      await load();
      setTab(term.id);
    } catch (e) {
      notify(t("terminal.openFailed", { error: errText(e) }));
    }
  };
  const close = async (id: string) => {
    await client.call("terminal.close", { terminal: id }).catch(() => {});
    const left = await load();
    if (tab === id) setTab(left.at(-1)?.id ?? "agent");
  };
  const jobs = useAgentJobs(threadId);
  const current = terms.find((x) => x.id === tab);
  return (
    <div className="sidepanel__body term">
      <PanelTabs
        label={t("panel.terminal")}
        list={t("panelTabs.ran", { n: jobs?.length ?? 0 })}
        tabs={terms.map((x) => ({
          id: x.id,
          label: x.title,
          icon: <Icons.Terminal size={12} />,
          ...(!x.alive && { note: t("terminal.ended") }),
        }))}
        value={current ? current.id : LIST_TAB}
        onSelect={(id) => setTab(id === LIST_TAB ? "agent" : id)}
        onClose={(id) => void close(id)}
        onNew={() => void open()}
        newLabel={t("terminal.new")}
      />
      {current ? (
        <Suspense fallback={<Skeleton className="term__loading" />}>
          <TerminalView key={current.id} terminal={current} />
        </Suspense>
      ) : (
        <AgentCommands jobs={jobs} onNew={() => void open()} />
      )}
    </div>
  );
}

/** What the agent ran in this chat, newest first; undefined while loading. */
function useAgentJobs(threadId: string): Job[] | undefined {
  const [jobs, setJobs] = useState<Job[]>();
  const load = useCallback(async () => {
    const r = await client.call("jobs.list", { thread: threadId, finished: 50 }).catch(() => undefined);
    if (r) setJobs([...r.running, ...r.finished]);
  }, [threadId]);
  useEffect(() => {
    void load();
    return watchEvents((ev) => {
      if (ev.type === "job.updated" && ev.job.thread_id === threadId) void load();
    });
  }, [load, threadId]);
  return jobs;
}

/** What the agent ran in this chat; a row unfolds into its output (live while it runs). */
function AgentCommands({ jobs, onNew }: { jobs: Job[] | undefined; onNew?: () => void }) {
  const t = useT();
  if (!jobs) return <Skeleton className="term__loading" />;
  if (!jobs.length)
    return (
      <EmptyState
        icon={<Icons.Terminal />}
        title={t("terminal.agentEmpty")}
        action={
          onNew && (
            <Button size="sm" variant="secondary" onClick={onNew}>
              {t("terminal.openOwn")}
            </Button>
          )
        }
      >
        {t("terminal.agentEmptyBody")}
      </EmptyState>
    );
  return (
    <ul className="term__jobs">
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </ul>
  );
}

function JobRow({ job }: { job: Job }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState<string>();
  const running = job.state === "working";
  useEffect(() => {
    if (!open) return;
    let stop = false;
    const read = async () => {
      const r = await client.call("jobs.get", { job: job.id, max_chars: 20_000 }).catch(() => undefined);
      if (!stop && r) setOutput(plain(r.output));
    };
    void read();
    // While it runs, its output keeps coming.
    const timer = running ? setInterval(() => void read(), 1500) : undefined;
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [open, running, job.id]);
  const status = running
    ? t("terminal.running")
    : job.state === "canceled"
      ? t("terminal.stopped")
      : job.exit_code != null
        ? t("terminal.exit", { code: job.exit_code })
        : t("terminal.done");
  return (
    <li className={open ? "term__job is-open" : "term__job"}>
      <div className="term__jobrow">
        <button type="button" className="term__jobtoggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? <Icons.ChevronDown size={14} /> : <Icons.ChevronRight size={14} />}
          <code className="term__cmd">{job.title.replace(/^Ran\s+/, "")}</code>
          {job.background && <span className="term__chip">{t("terminal.background")}</span>}
          <span
            className={`term__status${running ? " is-running" : job.exit_code ? " is-failed" : ""}`}
            title={job.cwd}
          >
            {status}
          </span>
        </button>
        {running && (
          <IconButton
            size="sm"
            label={t("terminal.stop")}
            icon={<Icons.Square size={12} />}
            onClick={() => void client.call("jobs.cancel", { job: job.id })}
          />
        )}
      </div>
      {open && <pre className="term__out">{output ?? "…"}</pre>}
    </li>
  );
}
