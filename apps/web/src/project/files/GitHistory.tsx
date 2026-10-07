import type { Result } from "@apx/protocol";
import { Button, IconButton, Icons } from "@apx/ui";
import { useMemo } from "react";
import { shortWhen } from "../../common/format.ts";
import { useT } from "../../i18n/index.ts";
import { graphRows } from "./git-graph.ts";

/** One color per column, so a branch's line keeps its color down the history. */
const LANE_COLORS = ["#e3b341", "#a371f7", "#58a6ff", "#3fb950", "#f778ba", "#ff7b72", "#39c5cf"];
const laneColor = (i: number) => LANE_COLORS[i % LANE_COLORS.length] as string;
/** Column width and the dot's height in a row (px); the graph shows this many columns at most. */
const LANE = 14;
const DOT_Y = 13;
const MAX_LANES = 8;
const x = (i: number) => LANE / 2 + Math.min(i, MAX_LANES - 1) * LANE;

/** The branch's history as a column of its own: a graph of its lines, each commit with its branches and tags. */
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
  const rows = useMemo(() => graphRows(log?.commits ?? []), [log]);
  const width = Math.min(Math.max(1, ...rows.map((r) => r.width)), MAX_LANES) * LANE;
  return (
    <aside className="git__history" aria-label={t("git.history")}>
      <header className="git__historyhead">
        <Icons.Clock size={14} />
        <span>{t("git.history")}</span>
        <span className="files__spacer" />
        <IconButton size="sm" label={t("git.historyHide")} icon={<Icons.X size={14} />} onClick={onClose} />
      </header>
      <ul className="git__log">
        {log?.commits.map((c, i) => {
          const row = rows[i];
          const color = laneColor(row?.col ?? 0);
          return (
            <li key={c.sha}>
              <button
                type="button"
                className={`git__commitrow${picked === c.sha ? " is-on" : ""}`}
                onClick={() => onPick(c.sha)}
                title={c.subject}
                style={{ paddingLeft: width + 10 }}
              >
                {row && (
                  <svg className="git__graph" width={width} aria-hidden="true">
                    {row.through.map((l) => (
                      <line key={`t${l}`} x1={x(l)} y1="0" x2={x(l)} y2="100%" stroke={laneColor(l)} />
                    ))}
                    {row.into.map((l) => (
                      <line key={`i${l}`} x1={x(l)} y1="0" x2={x(row.col)} y2={DOT_Y} stroke={laneColor(l)} />
                    ))}
                    {row.out.map((l) => (
                      <line key={`o${l}`} x1={x(row.col)} y1={DOT_Y} x2={x(l)} y2="100%" stroke={laneColor(l)} />
                    ))}
                    <circle
                      cx={x(row.col)}
                      cy={DOT_Y}
                      r={c.parents.length > 1 ? 3 : 4}
                      fill={c.parents.length > 1 ? color : "var(--apx-bg)"}
                      stroke={color}
                    />
                  </svg>
                )}
                <span className="git__commitmain">
                  <span className="git__subject">{c.subject}</span>
                  <span className="git__meta">
                    {c.author} · {shortWhen(c.at)} · <code>{c.sha.slice(0, 7)}</code>
                  </span>
                  {c.refs.length > 0 && (
                    <span className="git__refs">
                      {c.refs.map((r) => (
                        <span
                          key={r}
                          className={`git__ref${r.startsWith("tag: ") ? " is-tag" : ""}`}
                          style={{ color, borderColor: color }}
                        >
                          {r.startsWith("tag: ") ? <Icons.Tag size={10} /> : <Icons.GitBranch size={10} />}
                          {r.replace(/^tag: /, "")}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
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
