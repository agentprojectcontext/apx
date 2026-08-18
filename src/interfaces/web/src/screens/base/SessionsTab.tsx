import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { RefreshCw, Search, X, Terminal, Bot, FolderOpen, Copy, History, SearchX, TriangleAlert, MousePointerClick } from "lucide-react";
import { Sessions, Deck, type SessionRow } from "../../lib/api";
import { Section } from "../../components/Section";
import { PagedList, usePagedQuery } from "../../components/Pager";
import { Badge, Button, Empty, Input, Loading, Tip } from "../../components/ui";
import { DropdownMenuItem } from "../../components/ui/dropdown-menu";
import { RowMenu } from "../../components/RowMenu";
import { SessionDetail } from "../../components/sessions/SessionDetail";
import { UiSelect } from "../../components/UiSelect";
import { useToast } from "../../components/Toast";
import { usePersonaName } from "../../hooks/usePersonaName";
import { useProject } from "../../hooks/useProjects";
import { t } from "../../i18n";

const ENGINE_TONE: Record<string, "success" | "info" | "warning" | "muted"> = {
  apx: "success", claude: "info", codex: "warning", opencode: "info",
};

// `pid` present + not base → scope to that project's local folder. Base (or no
// pid) shows every session across engines and folders.
export function SessionsTab({ pid }: { pid?: string } = {}) {
  const toast = useToast();
  const persona = usePersonaName();
  const isBase = !pid || String(pid) === "0";
  const { project } = useProject(isBase ? "" : pid);
  const cwd = isBase ? undefined : project?.path || undefined;
  const [params, setParams] = useSearchParams();
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
    key: `/api/sessions?engine=${engine}&q=${query}&deep=${deep ? 1 : 0}&cwd=${cwd || ""}`,
    fetchPage: (limit, offset) =>
      Sessions.page({ engine: engine || undefined, q: query || undefined, deep, cwd, limit, offset }),
    resetKey: `${engine}|${query}|${deep ? 1 : 0}|${cwd || ""}`,
  });

  const clear = () => { setInput(""); setQuery(""); setEngine(""); setDeep(false); };

  // Selection lives in the URL (?s), same as Routines (?r_id) and Tasks
  // (?task), so a session can be linked to and survives a reload. The engine
  // rides along because two engines can mint the same id.
  const selectedId = params.get("s");
  const selectedEngine = params.get("s_engine") || "";
  const selected =
    paged.items.find((r) => r.id === selectedId && (!selectedEngine || r.engine === selectedEngine)) || null;

  const selectSession = (s: SessionRow | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (s) { next.set("s", s.id); next.set("s_engine", s.engine); }
      else { next.delete("s"); next.delete("s_engine"); }
      return next;
    }, { replace: true });

  // Keep one session open by default, and heal a stale ?s left by a filter
  // change — an empty pane next to a full list reads as a broken screen.
  useEffect(() => {
    if (paged.items.length === 0) return;
    if (selected) return;
    selectSession(paged.items[0]);
  }, [paged.items, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── per-row actions (all reuse existing system functions) ──────────────────
  const copyCmd = async (s: SessionRow) => {
    // The engine's own resume command, asked of the daemon rather than guessed
    // here: each CLI re-enters a conversation differently, and a wrong command
    // fails silently by starting a NEW session.
    try {
      const d = await Sessions.detail(s.id, s.engine);
      if (!d.resume_command) { toast.error(t("base.sessions_no_command")); return; }
      await navigator.clipboard.writeText(d.resume_command);
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
              { value: "opencode", label: "opencode" },
            ]}
          />
        </div>
        <Tip content={t("base.sessions_clear")}>
          <Button size="sm" variant="ghost" onClick={clear}><X size={14} /></Button>
        </Tip>
      </div>

      {paged.isLoading && <Loading />}
      {paged.error && (
        <Empty icon={TriangleAlert}>{t("base.sessions_error", { msg: (paged.error as Error).message })}</Empty>
      )}
      {!paged.isLoading && !paged.error && paged.total === 0 && (
        query
          ? <Empty icon={SearchX}>{t("base.sessions_no_match", { q: query })}</Empty>
          : <Empty icon={History}>{t("base.sessions_empty")}</Empty>
      )}

      {/* Master-detail, like Routines and Tasks: the list picks, the pane on
          the right is where the session is read and continued. Hidden while
          there is nothing to pick — an empty list next to an empty pane, under
          a message that already said "no sessions", is three empty states for
          one fact. */}
      {paged.items.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-col border-border lg:w-[380px] lg:shrink-0 lg:border-r">
            <PagedList paged={paged} fullHeight>
              <ul className="space-y-1 p-1 text-sm">
                {paged.items.map((s, i) => {
                  const active = selected?.id === s.id && selected?.engine === s.engine;
                  return (
                    <li
                      key={`${s.engine}-${s.id}-${i}`}
                      onClick={() => selectSession(s)}
                      className={
                        "group flex cursor-pointer items-center gap-2 rounded-md border px-2 py-2 " +
                        (active ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted/50")
                      }
                    >
                      <Badge tone={ENGINE_TONE[s.engine] || "muted"}>{s.engine}</Badge>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{s.title || s.id}</div>
                        <div className="truncate font-mono text-[10px] text-muted-fg">
                          {s.mtime > 0 ? new Date(s.mtime).toLocaleString() : s.id}
                        </div>
                      </div>
                      <RowMenu label={t("base.sessions_act_menu")}>
                        <DropdownMenuItem onClick={() => copyCmd(s)}>
                          <Terminal size={13} /> {t("base.sessions_act_cmd")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => askPersona(s)}>
                          <Bot size={13} /> {t("base.sessions_act_ask", { name: persona })}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => openFolder(s)}>
                          <FolderOpen size={13} /> {t("base.sessions_act_folder")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => copyPath(s)}>
                          <Copy size={13} /> {t("base.sessions_act_path")}
                        </DropdownMenuItem>
                      </RowMenu>
                    </li>
                  );
                })}
              </ul>
            </PagedList>
          </div>
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
            {selected
              ? <SessionDetail row={selected} onAskPersona={askPersona} />
              : <Empty fill icon={MousePointerClick}>{t("base.sessions_pick")}</Empty>}
          </div>
        </div>
      )}
    </Section>
  );
}
