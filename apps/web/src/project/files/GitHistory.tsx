import type { Result } from "@apx/protocol";
import { Button, IconButton, Icons, Tag } from "@apx/ui";
import { shortWhen } from "../../common/format.ts";
import { useT } from "../../i18n/index.ts";

/** The branch's history as a column of its own: one commit per row on a line, with its branches and tags. */
export function GitHistory({
  log,
  picked,
  onPick,
  onMore,
  onClose,
}: {
  log: Result<"git.log"> | undefined;
  picked: string | undefined;
  onPick(sha: string): void;
  onMore(): void;
  onClose(): void;
}) {
  const t = useT();
  return (
    <aside className="git__history" aria-label={t("git.history")}>
      <header className="git__historyhead">
        <Icons.Clock size={14} />
        <span>{t("git.history")}</span>
        <span className="files__spacer" />
        <IconButton size="sm" label={t("git.historyHide")} icon={<Icons.X size={14} />} onClick={onClose} />
      </header>
      <ul className="git__log">
        {log?.commits.map((c) => (
          <li key={c.sha}>
            <button
              type="button"
              className={`git__commitrow${picked === c.sha ? " is-on" : ""}`}
              onClick={() => onPick(c.sha)}
              title={c.subject}
            >
              <span className="git__dot" />
              <span className="git__commitmain">
                <span className="git__subject">{c.subject}</span>
                <span className="git__meta">
                  {c.author} · {shortWhen(c.at)} · <code>{c.sha.slice(0, 7)}</code>
                </span>
                {c.refs.length > 0 && (
                  <span className="git__refs">
                    {c.refs.map((r) => (
                      <Tag key={r}>{r}</Tag>
                    ))}
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
        {log && !log.commits.length && <li className="git__clean">{t("git.noCommits")}</li>}
      </ul>
      {log?.more && (
        <Button size="sm" variant="ghost" onClick={onMore}>
          {t("git.more")}
        </Button>
      )}
    </aside>
  );
}
