import { useEffect, useState } from "react";
import { RefreshCw, Search, X, Terminal, Bot, FolderOpen, Copy } from "lucide-react";
import { Sessions, Deck, type SessionRow } from "../../lib/api";
import { Section } from "../../components/Section";
import { PagedList, usePagedQuery } from "../../components/Pager";
import { Badge, Button, Empty, Input, Loading, Tip } from "../../components/ui";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { usePersonaName } from "../../hooks/usePersonaName";
import { useProject } from "../../hooks/useProjects";
import { t } from "../../i18n";

const ENGINE_TONE: Record<string, "success" | "info" | "warning" | "muted"> = {
  apx: "success", claude: "info", codex: "warning",
};

// `pid` present + not base → scope to that project's local folder. Base (or no
// pid) shows every session across engines and folders.
export function SessionsTab({ pid }: { pid?: string } = {}) {
  const toast = useToast();
  const persona = usePersonaName();
  const isBase = !pid || String(pid) === "0";
  const { project } = useProject(isBase ? "" : pid);
  const cwd = isBase ? undefined : project?.path || undefined;
  const [engine, setEngine] = useState("");
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false);

  // Debounce the raw input so we don't hit the search core on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 350);
    return () => clearTimeout(id);
  }, [input]);

  const paged = usePagedQuery<SessionRow>({
    key: `/sessions?engine=${engine}&q=${query}&deep=${deep ? 1 : 0}&cwd=${cwd || ""}`,
    fetchPage: (limit, offset) =>
      Sessions.page({ engine: engine || undefined, q: query || undefined, deep, cwd, limit, offset }),
    resetKey: `${engine}|${query}|${deep ? 1 : 0}|${cwd || ""}`,
  });

  const clear = () => { setInput(""); setQuery(""); setEngine(""); setDeep(false); };

  // ── per-row actions (all reuse existing system functions) ──────────────────
  const copyCmd = async (s: SessionRow) => {
    // Same command a user would run in the terminal to resume the session.
    try {
      await navigator.clipboard.writeText(`apx session resume ${s.id} --continue`);
      toast.success(t("base.sessions_cmd_copied"));
    } catch { toast.error(t("base.sessions_copy_failed")); }
  };

  const askPersona = (s: SessionRow) => {
    // English on purpose: the super-agent's language is unknown, and the user
    // appends their own instructions after the colon.
    const prompt =
      `Continue this session: ${s.id} ` +
      `(engine: ${s.engine}${s.title ? `, title: "${s.title}"` : ""}${s.cwd ? `, folder: ${s.cwd}` : ""}). ` +
      `With these instructions: `;
    window.dispatchEvent(new CustomEvent("apx:roby-prompt", { detail: { prompt } }));
  };

  const openFolder = async (s: SessionRow) => {
    if (!s.cwd) { toast.error(t("base.sessions_no_folder")); return; }
    try { await Deck.exec({ kind: "open_path", target: s.cwd }); }
    catch (e) { toast.error(t("base.sessions_folder_failed", { msg: (e as Error).message })); }
  };

  const copyPath = async (s: SessionRow) => {
    const p = s.path || s.cwd;
    if (!p) { toast.error(t("base.sessions_no_path")); return; }
    try { await navigator.clipboard.writeText(p); toast.success(t("base.sessions_path_copied")); }
    catch { toast.error(t("base.sessions_copy_failed")); }
  };

  return (
    <Section
      fullHeight
      title={t("base.sessions_title")}
      description={isBase ? t("base.sessions_desc") : t("base.sessions_desc_scoped", { path: cwd || "…" })}
      action={
        <Tip content={t("base.sessions_refresh")}>
          <Button size="sm" variant="secondary" onClick={() => paged.mutate()}><RefreshCw size={13} /></Button>
        </Tip>
      }
    >
      {/* Toolbar: search + deep toggle + engine selector + clear. */}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
          <Input
            className="pl-8"
            placeholder={t("base.sessions_search_ph")}
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <Tip content={t("base.sessions_deep_tip")}>
          <Button size="sm" variant={deep ? "primary" : "secondary"} onClick={() => setDeep((d) => !d)}>
            {t("base.sessions_deep")}
          </Button>
        </Tip>
        <div className="w-36">
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
        <Tip content={t("base.sessions_clear")}>
          <Button size="sm" variant="ghost" onClick={clear}><X size={14} /></Button>
        </Tip>
      </div>

      {paged.isLoading && <Loading />}
      {paged.error && <Empty>{t("base.sessions_error", { msg: (paged.error as Error).message })}</Empty>}
      {!paged.isLoading && !paged.error && paged.total === 0 && (
        <Empty>{query ? t("base.sessions_no_match", { q: query }) : t("base.sessions_empty")}</Empty>
      )}

      <PagedList paged={paged} fullHeight>
        <ul className="space-y-1 text-sm">
          {paged.items.map((s, i) => (
            <li key={`${s.engine}-${s.id}-${i}`} className="group flex items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
              <Badge tone={ENGINE_TONE[s.engine] || "muted"}>{s.engine}</Badge>
              <div className="min-w-0 flex-1">
                <div className="truncate">{s.title || s.id}</div>
                <div className="flex items-center gap-2 font-mono text-[10px] text-muted-fg">
                  <span className="shrink-0">{s.id}</span>
                  {s.cwd && <span className="truncate">· {s.cwd}</span>}
                </div>
              </div>
              {s.mtime > 0 && <span className="shrink-0 text-[11px] text-muted-fg">{new Date(s.mtime).toLocaleString()}</span>}
              <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity group-hover:opacity-100">
                <Tip content={t("base.sessions_act_cmd")}>
                  <Button size="sm" variant="ghost" aria-label={t("base.sessions_act_cmd")} onClick={() => copyCmd(s)}><Terminal size={13} /></Button>
                </Tip>
                <Tip content={t("base.sessions_act_ask", { name: persona })}>
                  <Button size="sm" variant="ghost" aria-label={t("base.sessions_act_ask", { name: persona })} onClick={() => askPersona(s)}><Bot size={13} /></Button>
                </Tip>
                <Tip content={t("base.sessions_act_folder")}>
                  <Button size="sm" variant="ghost" aria-label={t("base.sessions_act_folder")} onClick={() => openFolder(s)}><FolderOpen size={13} /></Button>
                </Tip>
                <Tip content={t("base.sessions_act_path")}>
                  <Button size="sm" variant="ghost" aria-label={t("base.sessions_act_path")} onClick={() => copyPath(s)}><Copy size={13} /></Button>
                </Tip>
              </div>
            </li>
          ))}
        </ul>
      </PagedList>
    </Section>
  );
}
