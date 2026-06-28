import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Sessions } from "../../lib/api";
import { Section } from "../../components/Section";
import { PagedList, usePagedQuery } from "../../components/Pager";
import { Badge, Button, Empty, Loading } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { t } from "../../i18n";

const ENGINE_TONE: Record<string, "success" | "info" | "warning" | "muted"> = {
  apx: "success", claude: "info", codex: "warning",
};

export function SessionsTab() {
  const [engine, setEngine] = useState("");
  const paged = usePagedQuery({
    key: `/sessions?engine=${engine}`,
    fetchPage: (limit, offset) => Sessions.page({ engine: engine || undefined, limit, offset }),
    resetKey: engine,
  });

  return (
    <Section
      fullHeight
      title={t("base.sessions_title")}
      description={t("base.sessions_desc")}
      action={
        <div className="flex items-center gap-2">
          <div className="w-40">
            <UiSelect
              value={engine}
              onChange={setEngine}
              options={[
                { value: "", label: t("base.sessions_all") },
                { value: "apx", label: "apx" },
                { value: "claude", label: "claude" },
                { value: "codex", label: "codex" },
              ]}
            />
          </div>
          <Button size="sm" variant="secondary" onClick={() => paged.mutate()}><RefreshCw size={13} /></Button>
        </div>
      }
    >
      {paged.isLoading && <Loading />}
      {paged.error && <Empty>{t("base.sessions_error", { msg: (paged.error as Error).message })}</Empty>}
      {!paged.isLoading && !paged.error && paged.total === 0 && <Empty>{t("base.sessions_empty")}</Empty>}
      <PagedList paged={paged} fullHeight>
        <ul className="space-y-1 text-sm">
          {paged.items.map((s, i) => (
            <li key={`${s.engine}-${s.id}-${i}`} className="flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              <Badge tone={ENGINE_TONE[s.engine] || "muted"}>{s.engine}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate">{s.title || s.id}</div>
                <div className="truncate font-mono text-[10px] text-muted-fg">{s.cwd}</div>
              </div>
              {s.mtime > 0 && <span className="shrink-0 text-[11px] text-muted-fg">{new Date(s.mtime).toLocaleString()}</span>}
            </li>
          ))}
        </ul>
      </PagedList>
    </Section>
  );
}
