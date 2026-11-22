import type { Discovery } from "../engine/discovery.ts";
import type { Handlers } from "./router.ts";

export function discoveryHandlers(discovery: Discovery) {
  return {
    "discovery.settings": () => discovery.status(),
    "discovery.configure": ({ expected, ...patch }) => discovery.configure(patch, expected),
    "discovery.feedback": ({ finding, feedback }) => discovery.feedback(finding, feedback),
  } satisfies Partial<Handlers>;
}
