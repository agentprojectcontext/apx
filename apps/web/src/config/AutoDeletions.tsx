import type { AutoDeletion } from "@apx/protocol";
import { Button, EmptyState, Icons, SegmentedControl, Skeleton } from "@apx/ui";
import { useEffect, useState } from "react";
import { AutoDeletionLine } from "../chat/parts/AutoDeletionLine.tsx";
import { dayLabel } from "../common/format.ts";
import { client } from "../data/client.ts";
import { useData } from "../data/state.ts";
import { usePack, useT } from "../i18n/index.ts";
import { go, nav } from "../shell/nav.ts";
import { SubHead } from "./SectionHead.tsx";
import "./auto-deletions.css";

const PAGE = 20;
type Filter = "all" | "run" | "ask";

/** Each deletion Auto weighed (DECISIONS.md#d-281): what went or asked, why, who decided; one opens its chat. */
export function AutoDeletions() {
  return usePack("autoDeletions") ? <List /> : <Skeleton height={120} shape="block" />;
}

function List() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const [filter, setFilter] = useState<Filter>("all");
  const [rows, setRows] = useState<AutoDeletion[]>();
  const [next, setNext] = useState<string>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = async (before?: string) => {
    setBusy(true);
    setError(false);
    try {
      const page = await client.call("auto_deletions.list", {
        limit: PAGE,
        ...(before ? { before } : {}),
        ...(filter === "all" ? {} : { verdict: filter }),
      });
      setRows((old) => (before ? [...(old ?? []), ...page.decisions] : page.decisions));
      setNext(page.next);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: load is recreated each render; the filter is the trigger.
  useEffect(() => {
    setRows(undefined);
    void load();
  }, [filter]);
  const open = (thread: string) => {
    nav.set({ config: null });
    go.thread(thread);
  };
  return (
    <section className="autodels" aria-label={t("autoDel.title")}>
      <SubHead>{t("autoDel.title")}</SubHead>
      <p className="config__lead">{t("autoDel.lead")}</p>
      <SegmentedControl
        size="sm"
        label={t("autoDel.filter")}
        value={filter}
        onValueChange={(v) => setFilter(v as Filter)}
        options={[
          { value: "all", label: t("autoDel.all") },
          { value: "run", label: t("autoDel.onlyRan") },
          { value: "ask", label: t("autoDel.onlyAsked") },
        ]}
      />
      {error && (
        <p role="alert" className="config__lead">
          {t("autoDel.error")}{" "}
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            {t("autoDel.retry")}
          </Button>
        </p>
      )}
      {!rows ? (
        !error && <Skeleton height={96} shape="block" />
      ) : !rows.length ? (
        <EmptyState variant="dashed" icon={<Icons.Trash2 />}>
          {t("autoDel.empty")}
        </EmptyState>
      ) : (
        <ol className="autodels__list">
          {rows.map((d) => (
            <li key={d.id} className="autodels__row">
              <div className="autodels__head">
                <span className="autodels__when">{dayLabel(d.at)}</span>
                <span className="autodels__who">
                  {[agents[d.agent_id]?.name, t(d.by === "judge" ? "autoDel.helper" : "autoDel.rule")]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
              <AutoDeletionLine note={d}>
                <Button size="sm" variant="ghost" onClick={() => open(d.thread_id)}>
                  {t("autoDel.openChat")}
                </Button>
              </AutoDeletionLine>
            </li>
          ))}
        </ol>
      )}
      {next && (
        <Button size="sm" variant="ghost" loading={busy} disabled={busy} onClick={() => void load(next)}>
          {t("autoDel.older")}
        </Button>
      )}
    </section>
  );
}
