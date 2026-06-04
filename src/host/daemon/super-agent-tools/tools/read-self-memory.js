import { readSelfMemory } from "../../../../core/agent/self-memory.js";

// Read your OWN full notebook (~/.apx/memory.md). A bounded slice is already in
// your system prompt; call this when you need the complete history beyond it.
export default {
  name: "read_self_memory",
  schema: {
    type: "function",
    function: {
      name: "read_self_memory",
      description:
        "Read your own full notebook (~/.apx/memory.md) — your personal cross-session memory. A short slice is already injected into your prompt; call this only when you need the complete notebook (e.g. the prompt slice was truncated).",
      parameters: { type: "object", properties: {} },
    },
  },
  makeHandler: () => () => {
    const body = readSelfMemory();
    if (!body.trim()) return { empty: true, body: "" };
    return { body };
  },
};
