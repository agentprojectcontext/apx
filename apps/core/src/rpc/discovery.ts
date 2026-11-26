import type { Discovery } from "../engine/discovery.ts";
import { unauthorized } from "../errors.ts";
import type { Handlers } from "./router.ts";

export function discoveryHandlers(discovery: Discovery) {
  return {
    "discovery.settings": () => discovery.status(),
    "discovery.configure": ({ expected, ...patch }) => discovery.configure(patch, expected),
    // An agent only through its own tool call; an outside app with a token never (it names no agent).
    "discovery.add": (items, ctx) => {
      if (ctx.actor !== "human" && !ctx.agent) throw unauthorized("Research is the super-agent's");
      return discovery.add(items, ctx.actor === "human" ? undefined : ctx.agent?.id);
    },
    "discovery.feedback": ({ finding, feedback }) => discovery.feedback(finding, feedback),
  } satisfies Partial<Handlers>;
}
