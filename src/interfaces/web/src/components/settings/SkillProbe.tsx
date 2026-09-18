import { useState } from "react";
import { Wand2, ArrowUpRight, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Section } from "../Section";
import { Button, Badge, Input } from "../ui";
import { cn } from "../../lib/cn";
import { useToast } from "../Toast";
import { Skills, type InspectResult, type SkillVerdict } from "../../lib/api/skills";
import { t } from "../../i18n";

// "Type a message, see which skills it would pull in" — the tester for the
// per-turn skill RAG.
//
// It exists because the decision is otherwise invisible: a prompt that should
// obviously have matched a skill produces an answer with no sign anywhere that
// a skill was even considered, and the only way to tell a bad threshold from a
// dead embedder from a stale index was to read the daemon log. This shows all
// three at once, for a prompt you type, without sending a turn.
//
// Rendered in two places on purpose — Memory (RAG), because the embedder that
// decides this is configured there, and Skills › Config (RAG), because that is
// where the thresholds live. Same component, same answer in both.

const VERDICT_TONE: Record<SkillVerdict, "success" | "info" | "muted"> = {
  loaded: "success",
  hinted: "info",
  unrelated: "muted",
  weak: "muted",
  capped: "muted",
};

function verdictLabel(v: SkillVerdict): string {
  return t(`skill_probe.verdict_${v}`);
}

export function SkillProbe({ projectPath, className }: { projectPath?: string; className?: string }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InspectResult | null>(null);
  const [showAll, setShowAll] = useState(false);

  const run = async () => {
    const text = prompt.trim();
    if (!text) return;
    setBusy(true);
    setResult(null);
    try {
      setResult(await Skills.inspect(text, projectPath));
      setShowAll(false);
    } catch (e) {
      toast.error(t("skill_probe.failed", { msg: (e as Error).message }));
    } finally {
      setBusy(false);
    }
  };

  // Everything that scored, near-misses included. The long tail is what makes a
  // wrong threshold legible, but it is 50 rows on this install — collapsed to
  // the ones that got close, expandable to all.
  const shown = result
    ? (showAll ? result.candidates : result.candidates.slice(0, 8))
    : [];
  const hidden = result ? result.candidates.length - shown.length : 0;

  return (
    <Section
      title={t("skill_probe.title")}
      description={t("skill_probe.desc")}
      className={className}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={prompt}
            placeholder={t("skill_probe.placeholder")}
            disabled={busy}
            onChange={(ev) => setPrompt(ev.target.value)}
            onKeyDown={(ev) => { if (ev.key === "Enter") run(); }}
            className="min-w-[16rem] max-w-xl flex-1"
          />
          <Button variant="primary" onClick={run} loading={busy} disabled={busy || !prompt.trim()}>
            <Wand2 size={14} /> {t("skill_probe.run")}
          </Button>
        </div>

        {result && (
          <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
            {/* Who answered, and whether the answer is worth anything. */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={result.degraded ? "warning" : "success"}>
                {result.embedder || t("skill_probe.no_embedder")}
              </Badge>
              {!result.enabled && <Badge tone="warning">{t("skill_probe.inspector_off")}</Badge>}
              {result.jit && <Badge tone="warning">{t("skill_probe.jit")}</Badge>}
              {result.index_embedder && result.index_embedder !== result.embedder && (
                <Badge tone="warning">
                  {t("skill_probe.index_mismatch", { index: result.index_embedder })}
                </Badge>
              )}
              <span className="text-muted-foreground">
                {t("skill_probe.scored_n", { n: result.candidates.length })}
              </span>
            </div>

            {/* The offline floor matches literal words, so a Spanish prompt and
                an English skill score near zero no matter how well they match.
                Say it here rather than leaving a wall of low numbers to explain
                itself. */}
            {result.degraded && (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="space-y-1">
                  <p className="text-amber-800 dark:text-amber-300">{t("skill_probe.degraded")}</p>
                  <button
                    type="button"
                    onClick={() => navigate("/settings/memory")}
                    className="inline-flex items-center gap-1 font-medium text-sky-700 hover:underline dark:text-sky-400"
                  >
                    {t("skill_probe.fix_embedder")} <ArrowUpRight size={12} />
                  </button>
                </div>
              </div>
            )}

            {/* The verdict in one sentence, before the numbers. */}
            <p className="text-sm">
              {result.loaded.length || result.hinted.length
                ? t("skill_probe.outcome_injected", {
                    loaded: result.loaded.join(", ") || "—",
                    hinted: result.hinted.join(", ") || "—",
                  })
                : t("skill_probe.outcome_nothing")}
            </p>
            {result.load_blocked && (
              <p className="text-xs text-muted-foreground">
                {t(`skill_probe.load_blocked_${result.load_blocked}`, {
                  load_z: String(result.thresholds.load_z),
                  margin_z: String(result.thresholds.margin_z),
                })}
              </p>
            )}

            {/* The ranking. Two numbers per row because two different gates use
                them: `sim` against raw_floor, `rel` against hint_z/load_z. A
                single number here is what made "matched but below the bar"
                unreadable. */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="pb-1 pr-3 font-normal">{t("skill_probe.col_skill")}</th>
                    <th className="pb-1 pr-3 font-normal">
                      {t("skill_probe.col_sim", { floor: String(result.thresholds.raw_floor) })}
                    </th>
                    <th className="pb-1 pr-3 font-normal">
                      {t("skill_probe.col_rel", { hint: String(result.thresholds.hint_z) })}
                    </th>
                    <th className="pb-1 font-normal">{t("skill_probe.col_verdict")}</th>
                  </tr>
                </thead>
                <tbody className="font-mono">
                  {shown.map((c) => (
                    <tr key={c.slug} className="border-t border-border/40">
                      <td className="py-1 pr-3">
                        <span className={cn(
                          c.verdict === "loaded" || c.verdict === "hinted"
                            ? "font-medium text-foreground"
                            : "text-muted-foreground",
                        )}>
                          {c.slug}
                        </span>
                      </td>
                      <td className={cn(
                        "py-1 pr-3 tabular-nums",
                        c.sim < result.thresholds.raw_floor ? "text-muted-foreground" : "text-foreground",
                      )}>
                        {c.sim.toFixed(3)}
                      </td>
                      <td className={cn(
                        "py-1 pr-3 tabular-nums",
                        c.rel < result.thresholds.hint_z ? "text-muted-foreground" : "text-foreground",
                      )}>
                        {c.rel.toFixed(2)}
                      </td>
                      <td className="py-1 font-sans">
                        <Badge tone={VERDICT_TONE[c.verdict]}>{verdictLabel(c.verdict)}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hidden > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="text-xs font-medium text-sky-700 hover:underline dark:text-sky-400"
              >
                {t("skill_probe.show_all", { n: hidden })}
              </button>
            )}

            {/* Tools are not chosen this way, and a tester that stayed silent
                about that would read as "no tool matched either". */}
            <p className="border-t border-border/40 pt-2 text-xs text-muted-foreground">
              {t("skill_probe.tools_note")}
            </p>
          </div>
        )}
      </div>
    </Section>
  );
}
