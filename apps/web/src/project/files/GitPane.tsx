import type { GitFile, Result } from "@apx/protocol";
import { Button, EmptyState, IconButton, Icons, SectionLabel, Skeleton, Spinner, Tag, Textarea } from "@apx/ui";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { client } from "../../data/client.ts";
import { notify } from "../../data/notices.ts";
import { useT } from "../../i18n/index.ts";
import { DiffView } from "../../panel/DiffView.tsx";
import { GitBar } from "./GitBar.tsx";
import { GitHistory } from "./GitHistory.tsx";

type Status = Result<"git.status">;
type Log = Result<"git.log">;
/** What the right side shows: a file's change (staged or not), or a commit and maybe one of its files. */
type Pick = { kind: "file"; path: string; staged: boolean } | { kind: "commit"; sha: string; path?: string };

const PAGE = 50;
/** Whether the history column is open, remembered on this browser. */
const HISTORY_KEY = "apx.git.history";
const readHistoryOpen = () => {
  try {
    return localStorage.getItem(HISTORY_KEY) !== "0";
  } catch {
    return true;
  }
};
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * A project's repository as a source-control view: the branch bar, what is staged and not (stage, unstage, commit, with
 * a message the auxiliary model can write), the history in a column that opens and closes, and the picked diff.
 */
export function GitPane({ projectId }: { projectId: string }) {
  const t = useT();
  const [status, setStatus] = useState<Status>();
  const [log, setLog] = useState<Log>();
  const [error, setError] = useState<string>();
  const [pick, setPick] = useState<Pick>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [history, setHistory] = useState(readHistoryOpen);
  const showHistory = (open: boolean) => {
    setHistory(open);
    try {
      localStorage.setItem(HISTORY_KEY, open ? "1" : "0");
    } catch {}
  };

  const refresh = useCallback(async () => {
    try {
      const s = await client.call("git.status", { project: projectId });
      setStatus(s);
      setError(undefined);
      // The open file follows where it went (staged or not), and closes once committed or reverted.
      setPick((p) => {
        if (p?.kind !== "file") return p;
        const inGroup = (staged: boolean) => (staged ? s.staged : s.unstaged).some((f) => f.path === p.path);
        if (inGroup(p.staged)) return p;
        return inGroup(!p.staged) ? { ...p, staged: !p.staged } : undefined;
      });
      if (s.repo) setLog(await client.call("git.log", { project: projectId, limit: PAGE }));
    } catch (e) {
      setError(errText(e));
    }
  }, [projectId]);
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
  const stage = (paths: string[]) => act(() => client.call("git.stage", { project: projectId, paths }));
  const unstage = (paths: string[]) => act(() => client.call("git.unstage", { project: projectId, paths }));
  const commit = () =>
    act(async () => {
      const { sha } = await client.call("git.commit", { project: projectId, message: message.trim() });
      setMessage("");
      notify(t("git.committed", { sha: sha.slice(0, 7) }), "info");
      setPick({ kind: "commit", sha });
    });
  /** A message for what is staged, from the auxiliary model; the owner reads and edits it before committing. */
  const suggest = async () => {
    setSuggesting(true);
    try {
      const { message: m } = await client.call("git.suggest_message", { project: projectId });
      if (m) setMessage(m);
      else notify(t("git.suggestNone"));
    } catch (e) {
      notify(t("error.change", { error: errText(e) }));
    }
    setSuggesting(false);
  };
  const more = async () => {
    if (!log) return;
    const next = await client.call("git.log", { project: projectId, limit: PAGE, skip: log.commits.length });
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
        <GitBar
          projectId={projectId}
          status={status}
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
        <FileGroup title={t("git.staged")} files={status.staged} staged pick={pick} onPick={setPick} onMove={unstage} />
        <FileGroup
          title={t("git.changes")}
          files={status.unstaged}
          staged={false}
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
          <FileDiff key={`${pick.staged}:${pick.path}`} projectId={projectId} path={pick.path} staged={pick.staged} />
        ) : (
          <CommitView
            key={pick.sha}
            projectId={projectId}
            sha={pick.sha}
            path={pick.path}
            onPath={(path) => setPick({ kind: "commit", sha: pick.sha, ...(path ? { path } : {}) })}
          />
        )}
      </section>
    </div>
  );
}

const STATUS_KEY = {
  M: "git.status.M",
  A: "git.status.A",
  D: "git.status.D",
  R: "git.status.R",
  C: "git.status.C",
  U: "git.status.U",
  "?": "git.status.untracked",
} as const;

/** A file row: its status letter, name and folder, lines added and removed, and the stage or unstage button. */
function FileRow({ file, on, onPick, action }: { file: GitFile; on: boolean; onPick(): void; action?: ReactNode }) {
  const t = useT();
  const slash = file.path.lastIndexOf("/");
  const name = file.path.slice(slash + 1);
  const dir = slash > 0 ? file.path.slice(0, slash) : "";
  const key = STATUS_KEY[file.status as keyof typeof STATUS_KEY];
  return (
    <li className={`git__file${on ? " is-on" : ""}`}>
      <button type="button" className="git__filebtn" onClick={onPick} title={file.from ?? file.path}>
        <span className={`git__letter is-${file.status === "?" ? "U" : file.status}`} title={key ? t(key) : undefined}>
          {file.status === "?" ? "U" : file.status}
        </span>
        <span className="git__name">{name}</span>
        {dir && <span className="git__dir">{dir}</span>}
        {(file.added != null || file.removed != null) && (
          <span className="git__counts">
            {file.added ? <span className="is-add">+{file.added}</span> : null}
            {file.removed ? <span className="is-del">−{file.removed}</span> : null}
          </span>
        )}
      </button>
      {action}
    </li>
  );
}

function FileGroup({
  title,
  files,
  staged,
  pick,
  onPick,
  onMove,
}: {
  title: string;
  files: GitFile[];
  staged: boolean;
  pick: Pick | undefined;
  onPick(p: Pick): void;
  onMove(paths: string[]): void;
}) {
  const t = useT();
  if (!files.length) return null;
  const moveLabel = staged ? t("git.unstage") : t("git.stage");
  const moveIcon = staged ? <Icons.Minus size={12} /> : <Icons.Plus size={12} />;
  return (
    <>
      <SectionLabel
        className="git__label"
        action={
          <span className="git__labelend">
            <span className="git__count">{files.length}</span>
            <IconButton
              size="sm"
              label={staged ? t("git.unstageAll") : t("git.stageAll")}
              icon={moveIcon}
              onClick={() => onMove(files.map((f) => f.path))}
            />
          </span>
        }
      >
        {title}
      </SectionLabel>
      <ul className="git__files">
        {files.map((f) => (
          <FileRow
            key={f.path}
            file={f}
            on={pick?.kind === "file" && pick.staged === staged && pick.path === f.path}
            onPick={() => onPick({ kind: "file", path: f.path, staged })}
            action={
              <IconButton
                size="sm"
                className="git__move"
                label={`${moveLabel}: ${f.path}`}
                tooltip={moveLabel}
                icon={moveIcon}
                onClick={() => onMove([f.path])}
              />
            }
          />
        ))}
      </ul>
    </>
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

function FileDiff({ projectId, path, staged }: { projectId: string; path: string; staged: boolean }) {
  const t = useT();
  const diff = useDiff(() => client.call("git.diff", { project: projectId, path, staged }), `${staged}:${path}`);
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
  projectId,
  sha,
  path,
  onPath,
}: {
  projectId: string;
  sha: string;
  path: string | undefined;
  onPath(path: string | undefined): void;
}) {
  const t = useT();
  const [shown, setShown] = useState<Result<"git.show"> | { error: string }>();
  useEffect(() => {
    let live = true;
    client.call("git.show", { project: projectId, sha }).then(
      (s) => live && setShown(s),
      (e: unknown) => live && setShown({ error: errText(e) }),
    );
    return () => {
      live = false;
    };
  }, [projectId, sha]);
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
      {path && <CommitFileDiff projectId={projectId} sha={sha} path={path} />}
    </div>
  );
}

function CommitFileDiff({ projectId, sha, path }: { projectId: string; sha: string; path: string }) {
  const diff = useDiff(() => client.call("git.commit_diff", { project: projectId, sha, path }), `${sha}:${path}`);
  return (
    <div className="git__diff">
      <DiffBody diff={diff} />
    </div>
  );
}
