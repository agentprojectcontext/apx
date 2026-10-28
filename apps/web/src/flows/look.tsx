import type { Agent, Routine } from "@apx/protocol";
import { AgentAvatar } from "@apx/ui";
import type { ReactNode } from "react";
import { blobOf } from "../data/identity.ts";
import type { MessageKey } from "../i18n/index.ts";
import { agentOf, type Known, whoOf } from "./data.ts";
import { dotted, type FlowNode, hookPath, literal, presetOf } from "./steps.tsx";

/** The one line under a step's name that tells it apart from others of its kind. */
export function stepDetail(
  n: FlowNode,
  flow: string | undefined,
  agents: Record<string, Agent>,
  routines: Routine[],
  t?: (key: MessageKey, vars?: Record<string, string | number>) => string,
  known?: Known,
): { detail?: ReactNode; detailPlain?: boolean } {
  switch (n.kind) {
    case "webhook":
      return { detail: flow ? `POST ${hookPath(flow)}` : "POST" };
    case "schedule": {
      const preset = presetOf(n.cron);
      return preset && t ? { detail: t(preset.label), detailPlain: true } : { detail: n.cron };
    }
    case "condition":
      return n.input.kind === "event" && n.input.path.length
        ? { detail: `${dotted(n.input.path)} = ${literal(n.equals)}` }
        : {};
    case "table_read":
      return { detail: n.keys.filter(Boolean).join(", ") };
    case "table_write":
      return n.key ? { detail: n.key } : {};
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
