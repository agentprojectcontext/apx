// Shared helpers for the Routines screen + its components.
// Kept framework-free (pure functions + i18n) so list/detail/editor reuse them.
import { Bot, Crown, Heart, Send, Terminal } from "lucide-react";
import type { RoutineEntry } from "../../lib/api";
import { t } from "../../i18n";

export type Kind = RoutineEntry["kind"];

export function splitLines(v: string): string[] {
  return v.split("\n").map((s) => s.trim()).filter(Boolean);
}

// Friendly action types (maps to routines.js kinds).
export function kindMeta(): Record<Kind, { label: string; desc: string; icon: typeof Bot }> {
  return {
    exec_agent:  { label: t("agents_ui.kind_exec_agent"),  desc: t("agents_ui.kind_exec_agent_desc"), icon: Bot },
    super_agent: { label: t("agents_ui.kind_super_agent"), desc: t("agents_ui.kind_super_agent_desc"), icon: Crown },
    telegram:    { label: t("agents_ui.kind_telegram"),    desc: t("agents_ui.kind_telegram_desc"), icon: Send },
    shell:       { label: t("agents_ui.kind_shell"),       desc: t("agents_ui.kind_shell_desc"), icon: Terminal },
    heartbeat:   { label: t("agents_ui.kind_heartbeat"),   desc: t("agents_ui.kind_heartbeat_desc"), icon: Heart },
  };
}

export function kindOptions(includeKind?: Kind) {
  const meta = kindMeta();
  // Heartbeat is no longer offered for new routines (the runner already logs a
  // per-run line — see AGENTS.md). Keep it only when editing an existing one.
  return (Object.keys(meta) as Kind[])
    .filter((k) => k !== "heartbeat" || includeKind === "heartbeat")
    .map((k) => ({ value: k, label: meta[k].label, description: meta[k].desc, icon: meta[k].icon }));
}

// "every:10m" → "cada 10 minutos", cron/once → legible.
export function scheduleHuman(s?: string): string {
  if (!s) return "—";
  if (s.startsWith("every:")) {
    const v = s.slice(6);
    const m = v.match(/^(\d+)(s|m|h|d)$/);
    if (m) {
      const n = m[1];
      const unit = {
        s: t("agents_ui.unit_seconds"),
        m: t("agents_ui.unit_minutes"),
        h: t("agents_ui.unit_hours"),
        d: t("agents_ui.unit_days"),
      }[m[2]] || m[2];
      return t("agents_ui.every_n_unit", { n, unit });
    }
    return t("agents_ui.every_v", { v });
  }
  if (s.startsWith("once:")) return `once · ${new Date(s.slice(5)).toLocaleString()}`;
  if (s.startsWith("cron ")) return `cron · ${s.slice(5)}`;
  return s;
}

export function schedPresets() {
  return [
    { label: t("agents_ui.preset_every_10m"), value: "every:10m" },
    { label: t("agents_ui.preset_hourly"), value: "every:1h" },
    { label: t("agents_ui.preset_daily_9am"), value: "cron 0 9 * * *" },
    { label: t("agents_ui.preset_weekdays_9am"), value: "cron 0 9 * * 1-5" },
  ];
}

// Template/env vars the routine runner exposes (src/core/routines/runner.js).
export function routineVars() {
  return [
    { v: "{{pre_output}}", where: "prompt", desc: t("agents_ui.var_pre_output_prompt") },
    { v: "$APX_LLM_OUTPUT", where: "post", desc: t("agents_ui.var_llm_output") },
    { v: "$APX_STATUS", where: "post", desc: t("agents_ui.var_status") },
    { v: "$APX_SKIPPED", where: "post", desc: t("agents_ui.var_skipped") },
    { v: "$APX_PRE_OUTPUT", where: "post", desc: t("agents_ui.var_pre_output") },
    { v: "$APX_PRE_OUTPUT_FILE", where: "post", desc: t("agents_ui.var_pre_output_file") },
    { v: "$APX_PRE_EXIT", where: "post", desc: t("agents_ui.var_pre_exit") },
    { v: "$APX_ROUTINE", where: "pre/post", desc: t("agents_ui.var_routine") },
  ];
}

// Which variables belong under which textarea:
//   pre    → vars usable in pre-commands ($APX_ROUTINE)
//   prompt → template vars for the prompt / telegram text ({{pre_output}})
//   post   → env vars for post-commands ($APX_*)
export function varsFor(ctx: "pre" | "prompt" | "post") {
  return routineVars().filter((v) => {
    if (ctx === "pre") return v.where.includes("pre");
    if (ctx === "prompt") return v.where === "prompt";
    return v.where === "post" || v.where === "pre/post";
  });
}
