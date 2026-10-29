import type { Agent, Routine } from "@apx/protocol";
import { flowCases } from "@apx/protocol/flow-cases";
import { AgentAvatar } from "@apx/ui";
import type { ReactNode } from "react";
import { blobOf } from "../data/identity.ts";
import type { MessageKey } from "../i18n/index.ts";
import { rulesText } from "./compare.ts";
import { agentOf, type Known, whoOf } from "./data.ts";
import { dotted, type FlowNode, hookPath, hookVerbs, literal, scheduleName } from "./steps.tsx";

/** The one line under a step's name that tells it apart from others of its kind. */
export function stepDetail(
  n: FlowNode,
  /** The Flow's path, for the webhook's address. */
  path: string | undefined,
  agents: Record<string, Agent>,
  routines: Routine[],
  t?: (key: MessageKey, vars?: Record<string, string | number>) => string,
  known?: Known,
): { detail?: ReactNode; detailPlain?: boolean } {
  switch (n.kind) {
    case "webhook":
      return { detail: path ? `${hookVerbs(n)} ${hookPath(path)}` : hookVerbs(n) };
    case "schedule": {
      const named = t ? scheduleName(n.cron, t) : n.cron;
      return named !== n.cron ? { detail: named, detailPlain: true } : { detail: n.cron };
    }
    case "condition": {
      const cases = flowCases(n);
      const first = cases[0];
      if (cases.length > 1 && t) return { detail: t("flow.d.cases", { count: cases.length }), detailPlain: true };
      if (first?.match.kind === "expr") return first.match.expr ? { detail: first.match.expr } : {};
      if (first?.match.kind === "all" || first?.match.kind === "any")
        return t && first.match.rules.some((r) => r.left.trim()) ? { detail: rulesText(first.match, t) } : {};
      return first && n.input.kind === "event" && n.input.path.length
        ? { detail: `${dotted(n.input.path)} = ${literal(first.match.value)}` }
        : {};
    }
    case "vars":
      return { detail: n.vars.map((v) => v.name).join(", ") };
    case "js":
      return {
        detail:
          n.code
            .split("\n")
            .find((l) => l.trim())
            ?.trim()
            .slice(0, 60) ?? "",
      };
    case "sql":
      return n.database ? { detail: `${n.database} · ${n.query.trim().split(/\s+/)[0]?.toUpperCase() ?? ""}` } : {};
    case "cmd":
      return n.command ? { detail: `$ ${n.command.split("\n")[0]?.slice(0, 60)}` } : {};
    case "table_read": {
      const what = n.latest ? `${n.latest} ↓` : n.keys.filter(Boolean).join(", ");
      return { detail: [n.table, what].filter(Boolean).join(" · ") };
    }
    case "table_write":
      return n.key || n.table ? { detail: [n.table, n.key].filter(Boolean).join(" · ") } : {};
    case "agent":
    case "routine": {
      const who = whoOf(n, agents, routines);
      if (!who) return {};
      const agent = agentOf(n, agents, routines);
      return {
        detailPlain: true,
        detail: (
          <>
            <AgentAvatar name={agent?.name ?? who} blob={blobOf(agent)} size={16} animated={false} />
            {who}
          </>
        ),
      };
    }
    case "llm":
      return { detail: n.model };
    case "notify": {
      const to = whoOf(n, agents, routines, t, known);
      return to ? { detail: to, detailPlain: true } : {};
    }
    case "http":
      return n.url.length > 8 ? { detail: whoOf(n, agents, routines) } : {};
  }
}
