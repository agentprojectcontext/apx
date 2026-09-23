import { FilterChips } from "../ui/filter-chips";
import { ENGINE_PRESETS } from "../settings/providers/typeStyles";
import { t } from "../../i18n";

// Reasoning effort is a setting OF a model, not a different model.
//
// The daemon stores it as a suffix on the one model string every place already
// holds (`chatgpt-codex:gpt-5.6-luna@high`) — agent card, routine, router
// chain, the super-agent's own model — and core/engines/codex-plus.js splits it
// off before the call. That suffix is a storage detail: here the model is
// picked as a model and the effort beside it, and it is shown as
// "gpt-5.6-luna · high", never as if `@high` were a model of its own.

// Mirrors CODEX_EFFORTS in core (served in the presets). Used only to recognise
// a suffix, so an id with a stray "@" elsewhere is left alone.
const KNOWN_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];

export function splitEffort(ref: string): { base: string; effort: string } {
  const raw = String(ref || "");
  const at = raw.lastIndexOf("@");
  if (at > 0) {
    const e = raw.slice(at + 1).toLowerCase();
    if (KNOWN_EFFORTS.includes(e)) return { base: raw.slice(0, at), effort: e };
  }
  return { base: raw, effort: "" };
}

export function withEffort(base: string, effort: string): string {
  return effort ? `${base}@${effort}` : base;
}

/** How a stored model id reads on screen: the model, then its effort. */
export function modelLabel(ref: string): string {
  const { base, effort } = splitEffort(ref);
  return effort ? `${base} · ${effort}` : base;
}

/** The efforts an engine accepts; empty when it has no such setting. */
export function effortsForEngine(engine?: string | null): string[] {
  return (engine && ENGINE_PRESETS[engine]?.efforts) || [];
}

/**
 * Keep the effort when switching to another model that accepts it; drop it
 * when the new one does not — a suffix the engine ignores would only mislead.
 */
export function carryEffort(nextBase: string, effort: string, nextEngine?: string | null): string {
  return effort && effortsForEngine(nextEngine).includes(effort) ? withEffort(nextBase, effort) : nextBase;
}

/** The effort control. Renders nothing for an engine without efforts. */
export function EffortChips({
  engine, value, onChange,
}: {
  engine?: string | null;
  value: string;
  onChange: (effort: string) => void;
}) {
  const efforts = effortsForEngine(engine);
  if (!efforts.length) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="effort-chips">
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-fg">{t("shared_ui.effort")}</span>
      <FilterChips
        value={value || ""}
        options={[{ value: "", label: t("shared_ui.effort_default") }, ...efforts.map((e) => ({ value: e, label: e }))]}
        onChange={onChange}
        label={t("shared_ui.effort")}
        testIdPrefix="effort"
      />
    </div>
  );
}
