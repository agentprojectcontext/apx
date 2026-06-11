// Accumulate super-agent stream events into the rich ChatPart shape so a
// persisted assistant turn matches exactly what the UI rendered live.
// Mirrors the front-end reducer in hooks/useChat.ts (applyStreamEvent) — keep
// the two in sync if you add a new event type.
//
// Pure: no I/O, no globals. Caller drives it event-by-event and finally calls
// build() to snapshot the resulting parts/notes/model/usage.
export function makeTurnAccumulator() {
  const parts = [];
  const notes = [];
  let model = null;
  let usage = null;
  const findTool = (id) => parts.find((p) => p.kind === "tool" && p.id === id);
  return {
    apply(ev) {
      switch (ev?.type) {
        case "model_start":
          if (ev.model) model = ev.model;
          break;
        case "model_routed":
          if (ev.model) model = ev.model;
          if (ev.from_fallback) notes.push(`routing fell back → ${ev.model}`);
          break;
        case "engine_failed":
          notes.push(`engine ${ev.model || "?"} failed → ${ev.retry_with || "retry"}`);
          break;
        case "model_retry":
          notes.push(`retry (${ev.reason || "?"})`);
          break;
        case "tools_suppressed":
          notes.push(`tools suppressed: ${(ev.tools || []).join(", ")}`);
          break;
        case "assistant_text":
          if (ev.text) parts.push({ kind: "text", text: ev.text });
          break;
        case "tool_start":
          if (ev.trace)
            parts.push({
              kind: "tool",
              id: ev.trace.id,
              tool: ev.trace.tool,
              args: ev.trace.args,
              status: "running",
            });
          break;
        case "tool_deduped": {
          const t = ev.trace && findTool(ev.trace.id);
          if (t) t.status = "deduped";
          break;
        }
        case "tool_result": {
          const t = ev.trace && findTool(ev.trace.id);
          if (t) {
            t.result = ev.trace.result;
            const errored =
              ev.trace.result && typeof ev.trace.result === "object" && ev.trace.result.error;
            t.status = errored ? "error" : t.status === "deduped" ? "deduped" : "done";
          }
          break;
        }
        case "final":
          usage = ev.result?.usage ?? usage;
          if (!model) model = ev.result?.name || null;
          break;
        default:
          break;
      }
    },
    build() {
      return { parts, notes, model, usage };
    },
  };
}
