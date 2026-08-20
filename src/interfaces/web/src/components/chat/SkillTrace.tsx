import useSWR from "swr";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Tip } from "../ui/tip";
import { Badge } from "../ui";
import { Skills } from "../../lib/api";
import { useProject } from "../../hooks/useProjects";
import { t } from "../../i18n";

export type InspectorTrace = {
  embedder?: string;
  /** Bodies inlined into this turn's system prompt. */
  loaded?: string[];
  /** Only the slug + one-line description made it in. */
  hinted?: string[];
  /** Top matches with their cosine similarity, when the stream carried them. */
  scored?: { slug: string; sim: number }[];
};

/**
 * The row of skill badges under an assistant turn: what the per-turn RAG put
 * in the prompt. Each badge opens a card explaining what it cost the context
 * (whole body vs. one line) and links to the skill itself — the badge names a
 * thing you own, so it has to be reachable from where it is named.
 */
// How much of a near-miss is worth showing as "considered". The offline `tf`
// fallback embedder scores everything low and compressed — an on-topic postbean
// query lands around 0.18-0.28 — so the calibrated 0.40 hint bar hides even a
// clearly relevant match. This low floor keeps those visible; it can't fully
// separate signal from noise on `tf` (that needs a real embedder — ollama/
// gemini), but it makes each round's top matches legible instead of silent.
const CONSIDERED_MIN_SIM = 0.15;
const MAX_CONSIDERED = 3;

type BadgeVariant = "loaded" | "hint" | "considered";

export function SkillTrace({ inspector }: { inspector: InspectorTrace }) {
  const loaded = inspector.loaded || [];
  const hinted = inspector.hinted || [];
  // Near-misses: top scored matches that were neither loaded nor hinted. Shown
  // dimmer so the per-turn RAG is legible every round — you can see what it
  // weighed, not only what it injected.
  const injected = new Set([...loaded, ...hinted]);
  const considered = (inspector.scored || [])
    .filter((s) => !injected.has(s.slug) && s.sim >= CONSIDERED_MIN_SIM)
    .slice(0, MAX_CONSIDERED)
    .map((s) => s.slug);

  if (loaded.length === 0 && hinted.length === 0 && considered.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1 text-[10px] text-sky-700 dark:text-sky-400/90">
      <Tip content={t("shared_ui.skill_inspector_title", { embedder: inspector.embedder || "RAG" })}>
        <span className="grid size-3.5 place-items-center">
          <Sparkles size={10} />
        </span>
      </Tip>
      {loaded.map((slug) => (
        <SkillBadge key={`l-${slug}`} slug={slug} variant="loaded" inspector={inspector} />
      ))}
      {hinted.map((slug) => (
        <SkillBadge key={`h-${slug}`} slug={slug} variant="hint" inspector={inspector} />
      ))}
      {considered.map((slug) => (
        <SkillBadge key={`c-${slug}`} slug={slug} variant="considered" inspector={inspector} />
      ))}
    </div>
  );
}

const BADGE_CLASS: Record<BadgeVariant, string> = {
  loaded: "cursor-pointer rounded bg-sky-500/15 px-1 py-0.5 font-mono hover:bg-sky-500/25",
  hint: "cursor-pointer rounded border border-sky-500/30 px-1 py-0.5 font-mono opacity-70 hover:opacity-100",
  considered:
    "cursor-pointer rounded border border-dashed border-sky-500/25 px-1 py-0.5 font-mono opacity-50 hover:opacity-90",
};

function SkillBadge({
  slug,
  variant,
  inspector,
}: {
  slug: string;
  variant: BadgeVariant;
  inspector: InspectorTrace;
}) {
  const label = variant === "loaded" ? slug : variant === "hint" ? `${slug}?` : `~${slug}`;
  return (
    <Popover>
      <PopoverTrigger className={BADGE_CLASS[variant]}>{label}</PopoverTrigger>
      <PopoverContent>
        <SkillCard slug={slug} variant={variant} inspector={inspector} />
      </PopoverContent>
    </Popover>
  );
}

// Rendered only once the popover opens (Base UI mounts the portal on demand),
// so the catalog is fetched on the first click, not on every message painted.
function SkillCard({
  slug,
  variant,
  inspector,
}: {
  slug: string;
  variant: BadgeVariant;
  inspector: InspectorTrace;
}) {
  const navigate = useNavigate();
  const pid = usePidFromRoute();
  const { project } = useProject(pid);
  const projectPath = pid === "0" ? undefined : project?.path;
  const ready = pid === "0" || !!projectPath;

  // Same SWR key the composer's `/slug` picker uses — usually a cache hit.
  const { data } = useSWR(ready ? ["/api/skills", projectPath || ""] : null, () =>
    Skills.list(projectPath),
  );
  const entry = data?.skills.find((s) => s.slug === slug);
  const sim = inspector.scored?.find((s) => s.slug === slug)?.sim;

  const open = () => {
    // Inside the Roby sheet the chat sits on top of the router: navigating
    // alone would land behind it. The sheet closes itself on this event.
    window.dispatchEvent(new CustomEvent("apx:roby-close"));
    navigate(`/p/${pid}/skills?skill=${encodeURIComponent(slug)}`);
  };

  return (
    <div className="flex flex-col gap-2 text-foreground">
      <div className="flex items-start justify-between gap-2">
        <code className="font-mono text-xs font-semibold">{slug}</code>
        {entry && <Badge tone={sourceTone(entry.source)}>{sourceLabel(entry.source)}</Badge>}
      </div>

      <p className="text-[11px] text-muted-foreground">
        {variant === "loaded"
          ? t("shared_ui.skill_trace_loaded")
          : variant === "hint"
            ? t("shared_ui.skill_trace_hinted")
            : t("shared_ui.skill_trace_considered")}
        {typeof sim === "number" && ` · ${t("shared_ui.skill_trace_sim", { sim: sim.toFixed(2) })}`}
      </p>

      <p className="text-xs leading-relaxed">
        {entry?.description || t("shared_ui.skill_trace_no_desc")}
      </p>

      <button
        type="button"
        onClick={open}
        className="flex items-center gap-1 self-start text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
      >
        {t("shared_ui.skill_trace_open")} <ArrowUpRight size={12} />
      </button>
    </div>
  );
}

/** Which project's skills screen the badge should open: the one you are in,
 *  the base project (the super-agent's own scope) anywhere else. */
function usePidFromRoute(): string {
  const { pathname } = useLocation();
  return pathname.match(/^\/p\/([^/]+)/)?.[1] ?? "0";
}

function sourceLabel(source: string, origin?: string | null): string {
  const host = origin || source;
  if (source === "builtin" || host === "apx" || host === "builtin") return t("skills_page.source_builtin");
  if (source === "project" || host === "project") return t("skills_page.source_project");
  if (host === "claude") return t("skills_page.origin_claude");
  if (host === "cursor") return t("skills_page.origin_cursor");
  if (host === "codex") return t("skills_page.origin_codex");
  if (host === "agents") return t("skills_page.origin_agents");
  return t("skills_page.source_global");
}

function sourceTone(source: string): "info" | "success" | "muted" {
  if (source === "builtin") return "info";
  if (source === "project") return "success";
  return "muted";
}
