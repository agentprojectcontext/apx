import type { ExtensionEvents } from "../extensions/events.ts";
import type { Handlers } from "./router.ts";

export function extensionEventHandlers(events: ExtensionEvents) {
  return {
    "extensions.events_get": ({ id }) => events.get(id),
    "extensions.events_set": ({ id, config }) => events.configure(id, config),
    "extensions.events_emit": ({ extension, input }) => events.emit(extension, input),
  } satisfies Pick<Handlers, "extensions.events_get" | "extensions.events_set" | "extensions.events_emit">;
}
