import type { Result } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, Select, Skeleton, Spinner, Tag, Textarea } from "@apx/ui";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { client } from "../../data/client.ts";
import { notify } from "../../data/notices.ts";
import { useT } from "../../i18n/index.ts";
import { DiffView } from "../../panel/DiffView.tsx";
import { GitBar } from "./GitBar.tsx";
import { type At, FileGroup, FileRow, type FilesView, type Pick } from "./GitFiles.tsx";
import { GitHistory } from "./GitHistory.tsx";

type Status = Result<"git.status">;
type Log = Result<"git.log">;

const PAGE = 50;
/** The history column's state and the files' view, remembered on this browser. */
const HISTORY_KEY = "apx.git.history";
const VIEW_KEY = "apx.git.view";
const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {}
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A project's repositories: its folder's own, or (a folder holding several) a picker of the ones inside it, each shown
 * as a source-control view.
 */
export function GitPane({ projectId }: { projectId: string }) {
  const t = useT();
  const [repos, setRepos] = useState<Result<"git.repos">["repos"]>();
  const [error, setError] = useState<string>();
  const [sub, setSub] = useState<string>();
  // One object per repository, so the views below read it again only when the repository changes.
  const at = useMemo<At>(() => ({ project: projectId, ...(sub ? { repo: sub } : {}) }), [projectId, sub]);
  useEffect(() => {
    let live = true;
    client.call("git.repos", { project: projectId }).then(
      (r) => {
        if (!live) return;
        setRepos(r.repos);
        setSub((current) => (r.repos.some((x) => x.path === current) ? current : r.repos[0]?.path));
      },
      (e: unknown) => live && setError(errText(e)),
    );
    return () => {
      live = false;
    };
  }, [projectId]);
  if (error)
    return (
      <div className="files files--empty">
        <EmptyState variant="dashed" size="lg" icon={<Icons.GitBranch />} title={t("git.failed")}>
          {error}
        </EmptyState>
      </div>
    );
  if (!repos) return <Skeleton height={200} className="git__loading" />;
  if (!repos.length || sub === undefined)
    return (
      <div className="files files--empty">
        <EmptyState variant="dashed" size="lg" icon={<Icons.GitBranch />} title={t("git.noRepo")}>
          {t("git.noRepoBody")}
        </EmptyState>
      </div>
    );
  const picker =
    repos.length > 1 || sub ? (
      <Select
        size="sm"
        label={t("git.repo")}
        className="git__repo"
        value={sub}
        onValueChange={(v) => v != null && setSub(v)}
        options={repos.map((r) => ({
          value: r.path,
          label: r.path || t("git.repoOwn"),
          ...(r.branch ? { description: r.branch } : {}),
        }))}
      />
    ) : undefined;
  return <GitRepo key={sub} at={at} picker={picker} />;
}

/**
 * One repository as a source-control view: the branch bar, what is staged and not (stage, unstage, commit, with a
 * message the auxiliary model can write), the history graph in a column that opens and closes, and the picked diff.
 */
function GitRepo({ at, picker }: { at: At; picker: ReactNode }) {
  const t = useT();
  const [status, setStatus] = useState<Status>();
  const [log, setLog] = useState<Log>();
  const [error, setError] = useState<string>();
  const [pick, setPick] = useState<Pick>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [history, setHistory] = useState(() => stored(HISTORY_KEY) !== "0");
  const [view, setView] = useState<FilesView>(() => (stored(VIEW_KEY) === "tree" ? "tree" : "list"));
  const showHistory = (open: boolean) => {
    setHistory(open);
    store(HISTORY_KEY, open ? "1" : "0");
  };
  const showView = (v: FilesView) => {
    setView(v);
    store(VIEW_KEY, v);
  };

  const refresh = useCallback(async () => {
    try {
      const s = await client.call("git.status", at);
      setStatus(s);
      setError(undefined);
      // The open file follows where it went (staged or not), and closes once committed or reverted.
      setPick((p) => {
        if (p?.kind !== "file") return p;
        const inGroup = (staged: boolean) => (staged ? s.staged : s.unstaged).some((f) => f.path === p.path);
        if (inGroup(p.staged)) return p;
        return inGroup(!p.staged) ? { ...p, staged: !p.staged } : undefined;
      });
      if (s.repo) setLog(await client.call("git.log", { ...at, limit: PAGE }));
    } catch (e) {
      setError(errText(e));
    }
  }, [at]);
  useEffect(() => {
    void refresh();
    // Agents change files while the owner looks: coming back to the window reads them again.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  /** Runs a change and reads the repository again; a refusal shows git's reason. */
  const act = async (run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    }
    setBusy(false);
    await refresh();
  };
  const stage = (paths: string[]) => act(() => client.call("git.stage", { ...at, paths }));
  const unstage = (paths: string[]) => act(() => client.call("git.unstage", { ...at, paths }));
  /** Commits with the message box's words: what is staged, or (`all`) every change; `amend` rewrites the last one. */
  const commit = (opts: { all?: boolean; amend?: boolean } = {}) => {
    if (!message.trim()) return notify(t("git.needMessage"));
    return act(async () => {
      const { sha } = await client.call("git.commit", { ...at, message: message.trim(), ...opts });
      setMessage("");
      notify(t("git.committed", { sha: sha.slice(0, 7) }), "info");
      setPick({ kind: "commit", sha });
    });
  };
  /** A message for what is staged, from the auxiliary model; the owner reads and edits it before committing. */
  const suggest = async () => {
    setSuggesting(true);
    try {
      const { message: m } = await client.call("git.suggest_message", at);
      if (m) setMessage(m);
      else notify(t("git.suggestNone"));
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    }
    setSuggesting(false);
  };
  const more = async () => {
    if (!log) return;
    const next = await client.call("git.log", { ...at, limit: PAGE, skip: log.commits.length });
    setLog({ commits: [...log.commits, ...next.commits], more: next.more });
  };

  if (error)
    return (
      <div className="files files--empty">
        <EmptyState variant="dashed" size="lg" icon={<Icons.GitBranch />} title={t("git.failed")}>
          {error}
        </EmptyState>
      </div>
    );
  if (!status) return <Skeleton height={200} className="git__loading" />;
  if (!status.repo)
    return (
      <div className="files files--empty">
        <EmptyState variant="dashed" size="lg" icon={<Icons.GitBranch />} title={t("git.noRepo")}>
          {t("git.noRepoBody")}
        </EmptyState>
      </div>
    );
  const canCommit = status.staged.length > 0 && message.trim().length > 0 && !busy;
  return (
    <div className={history ? "git has-history" : "git"}>
      <nav className="git__side" aria-label={t("git.title")}>
        {picker}
        <GitBar
          at={at}
          status={status}
          view={view}
          onView={showView}
          onCommit={(opts) => void commit(opts)}
          history={history}
          onHistory={() => showHistory(!history)}
          onRefresh={() => void refresh()}
          act={act}
        />
        <div className="git__commit">
          <div className="git__message">
            <Textarea
              aria-label={t("git.message")}
              placeholder={t("git.message")}
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canCommit) void commit();
              }}
            />
            <IconButton
              size="sm"
              className="git__magic"
              label={t("git.suggest")}
              icon={suggesting ? <Spinner size={12} /> : <Icons.Sparkles size={14} />}
              disabled={suggesting || (!status.staged.length && !status.unstaged.length)}
              onClick={() => void suggest()}
            />
          </div>
          <Button
            size="sm"
            disabled={!canCommit}
            loading={busy}
            leadingIcon={<Icons.Check size={14} />}
            onClick={() => void commit()}
          >
            {t("git.commit")}
          </Button>
        </div>
        <FileGroup
          title={t("git.staged")}
          files={status.staged}
          staged
          view={view}
          pick={pick}
          onPick={setPick}
          onMove={unstage}
        />
        <FileGroup
          title={t("git.changes")}
          files={status.unstaged}
          staged={false}
          view={view}
          pick={pick}
          onPick={setPick}
          onMove={stage}
        />
        {!status.staged.length && !status.unstaged.length && <p className="git__clean">{t("git.clean")}</p>}
      </nav>
      {history && (
        <GitHistory
          log={log}
          picked={pick?.kind === "commit" ? pick.sha : undefined}
          onPick={(sha) => setPick({ kind: "commit", sha })}
          onMore={() => void more()}
          onClose={() => showHistory(false)}
        />
      )}
      <section className="git__view" aria-label={t("git.detail")}>
        {!pick ? (
          <EmptyState icon={<Icons.GitBranch />} title={t("git.pick")}>
            {t("git.pickBody")}
          </EmptyState>
        ) : pick.kind === "file" ? (
          <FileDiff key={`${pick.staged}:${pick.path}`} at={at} path={pick.path} staged={pick.staged} />
        ) : (
          <CommitView
            key={pick.sha}
            at={at}
            sha={pick.sha}
            path={pick.path}
            onPath={(path) => setPick({ kind: "commit", sha: pick.sha, ...(path ? { path } : {}) })}
          />
        )}
      </section>
    </div>
  );
}

/** Loads a diff and shows it, or why it could not. */
function useDiff(load: () => Promise<{ diff: string; truncated: boolean }>, key: string) {
  const [diff, setDiff] = useState<{ diff: string; truncated: boolean } | { error: string }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names what is loaded; `load` is new each render.
  useEffect(() => {
    let live = true;
    setDiff(undefined);
    load().then(
      (d) => live && setDiff(d),
      (e: unknown) => live && setDiff({ error: errText(e) }),
    );
    return () => {
      live = false;
    };
  }, [key]);
  return diff;
}

function DiffBody({ diff }: { diff: ReturnType<typeof useDiff> }) {
  const t = useT();
  if (!diff) return <Skeleton height={200} />;
  if ("error" in diff) return <p className="files__error">{diff.error}</p>;
  if (!diff.diff.trim()) return <p className="git__clean">{t("git.noDiff")}</p>;
  return <DiffView text={diff.diff} truncated={diff.truncated} />;
}

function FileDiff({ at, path, staged }: { at: At; path: string; staged: boolean }) {
  const t = useT();
  const diff = useDiff(() => client.call("git.diff", { ...at, path, staged }), `${staged}:${path}`);
  return (
    <>
      <header className="files__head">
        <span className="files__path">{path}</span>
        <Tag>{staged ? t("git.staged") : t("git.changes")}</Tag>
      </header>
      <div className="git__diff">
        <DiffBody diff={diff} />
      </div>
    </>
  );
}

function CommitView({
  at,
  sha,
  path,
  onPath,
}: {
  at: At;
  sha: string;
  path: string | undefined;
  onPath(path: string | undefined): void;
}) {
  const t = useT();
  const [shown, setShown] = useState<Result<"git.show"> | { error: string }>();
  useEffect(() => {
    let live = true;
    client.call("git.show", { ...at, sha }).then(
      (s) => live && setShown(s),
      (e: unknown) => live && setShown({ error: errText(e) }),
    );
    return () => {
      live = false;
    };
  }, [at, sha]);
  if (!shown) return <Skeleton height={200} />;
  if ("error" in shown) return <p className="files__error">{shown.error}</p>;
  const { commit, body, files } = shown;
  return (
    <div className="git__commitview">
      <header className="git__commithead">
        <h3>{commit.subject}</h3>
        {body && <pre className="git__body">{body}</pre>}
        <p className="git__meta">
          {commit.author} · {new Date(commit.at).toLocaleString()} · <code>{commit.sha.slice(0, 12)}</code>
        </p>
      </header>
      <ul className="git__files">
        {files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            on={path === f.path}
            onPick={() => onPath(path === f.path ? undefined : f.path)}
          />
        ))}
      </ul>
      {!files.length && <p className="git__clean">{t("git.noDiff")}</p>}
      {path && <CommitFileDiff at={at} sha={sha} path={path} />}
    </div>
  );
}

function CommitFileDiff({ at, sha, path }: { at: At; sha: string; path: string }) {
  const diff = useDiff(() => client.call("git.commit_diff", { ...at, sha, path }), `${sha}:${path}`);
  return (
    <div className="git__diff">
      <DiffBody diff={diff} />
    </div>
  );
}
