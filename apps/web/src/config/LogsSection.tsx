import { Badge, Button, EmptyState, IconButton, Icons, SearchField, SegmentedControl, Select, Skeleton } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { type CoreLog, readCoreLog } from "../data/logs.ts";
import { notify } from "../data/notices.ts";
import { isKey, useT } from "../i18n/index.ts";
import { SectionHead } from "./SectionHead.tsx";

type Level = "info" | "warn" | "error";
type Line = CoreLog["lines"][number];

const PAGE = 300;
const MAX = 1000;
const LIVE_MS = 5000;
const LEVEL_TONE = { info: "neutral", warn: "warning", error: "danger" } as const;

/** Logs: the tail of the core's log, newest first, with a level, a source and a text to narrow it. */
export function LogsSection() {
  const t = useT();
  const [level, setLevel] = useState<Level | "all">("all");
  const [scope, setScope] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(PAGE);
  const [log, setLog] = useState<CoreLog>();

  useEffect(() => {
    const id = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]);

  const load = useCallback(async () => {
    const r = await readCoreLog({
      limit,
      ...(level !== "all" ? { level } : {}),
      ...(scope ? { scope } : {}),
      ...(q ? { q } : {}),
    });
    if (r) setLog(r);
  }, [limit, level, scope, q]);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), LIVE_MS);
    return () => clearInterval(id);
  }, [load]);

  const copyPath = () =>
    log &&
    void navigator.clipboard.writeText(log.path).then(
      () => notify(t("logs.pathCopied"), "info"),
      () => {},
    );
  const scopeName = (s: string) => {
    const key = `logs.scope.${s}`;
    return isKey(key) ? t(key) : s;
  };
  const filtered = level !== "all" || scope != null || q !== "";

  return (
    <>
      <SectionHead
        title={t("config.logs")}
        lead={t("logs.lead")}
        actions={
          <Button size="sm" variant="secondary" leadingIcon={<Icons.RefreshCw size={14} />} onClick={() => void load()}>
            {t("common.refresh")}
          </Button>
        }
      />
      {log && (
        <div className="logs__path">
          <span className="logs__pathlabel">{t("logs.file")}</span>
          <code className="kv__mono">{log.path}</code>
          <IconButton size="sm" label={t("logs.copyPath")} icon={<Icons.Copy size={14} />} onClick={copyPath} />
        </div>
      )}
      <div className="logs__filters">
        <SegmentedControl
          size="sm"
          label={t("logs.level")}
          value={level}
          onValueChange={(v) => setLevel(v as Level | "all")}
          options={[
            { value: "all", label: t("logs.level.all") },
            { value: "info", label: t("logs.level.info") },
            { value: "warn", label: t("logs.level.warn") },
            { value: "error", label: t("logs.level.error") },
          ]}
        />
        {(log?.scopes.length ?? 0) > 1 && (
          <Select
            size="sm"
            label={t("logs.scope")}
            value={scope ?? "all"}
            onValueChange={(v) => setScope(!v || v === "all" ? null : v)}
            options={[
              { value: "all", label: t("logs.scope.all") },
              ...(log?.scopes ?? []).map((s) => ({ value: s, label: scopeName(s) })),
            ]}
          />
        )}
        <SearchField
          size="sm"
          className="logs__search"
          placeholder={t("logs.search")}
          aria-label={t("logs.search")}
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
        />
      </div>
      {!log ? (
        <Skeleton shape="block" height={240} />
      ) : !log.exists ? (
        <EmptyState size="sm" icon={<Icons.Activity />} title={t("logs.none")}>
          {t("logs.noneHint")}
        </EmptyState>
      ) : log.lines.length === 0 ? (
        <EmptyState size="sm" icon={<Icons.Search />} title={filtered ? t("logs.noMatch") : t("logs.empty")} />
      ) : (
        <>
          <ul className="logs__list" aria-label={t("config.logs")}>
            {[...log.lines].reverse().map((l, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: log lines have no id and can repeat
              <LogRow key={i} line={l} scopeName={scopeName} />
            ))}
          </ul>
          <div className="logs__foot">
            <span>{t("logs.showing", { n: log.lines.length })}</span>
            {log.more && limit < MAX && (
              <Button size="sm" variant="ghost" onClick={() => setLimit((n) => Math.min(MAX, n + PAGE))}>
                {t("logs.older")}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}

function LogRow({ line, scopeName }: { line: Line; scopeName: (s: string) => string }) {
  const t = useT();
  return (
    <li className={`logs__row logs__row--${line.level}`}>
      <time className="logs__time" dateTime={line.t}>
        {line.t ? when(line.t) : ""}
      </time>
      <Badge tone={LEVEL_TONE[line.level]}>{t(`logs.level.${line.level}`)}</Badge>
      <div className="logs__body">
        <div className="logs__msg">
          {line.scope !== "core" && <span className="logs__scope">{scopeName(line.scope)}</span>}
          {line.msg}
        </div>
        {line.detail && <div className="logs__detail">{line.detail}</div>}
      </div>
    </li>
  );
}

/** Today's lines show the time; older ones the day too. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })} ${time}`;
}
