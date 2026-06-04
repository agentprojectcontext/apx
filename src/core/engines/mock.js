// Mock engine for tests and offline development. No network. Echoes back the
// last user message with a small transformation so it's distinguishable from
// the input. Use model "mock" or "mock:anything".

export default {
  id: "mock",
  needsApiKey: false,

  async health() {
    return { ok: true, soft: true };
  },

  async chat({ system, messages, model = "mock" }) {
    const last = [...messages].reverse().find((m) => m.role === "user");
    const userText = last?.content || "";
    const requestedTool = userText.match(/\[mock:tool:([a-z_]+)\]/)?.[1];
    const finishSummary = userText.match(/\[mock:finish:([^\]]*)\]/)?.[1];
    const hasToolResult = messages.some((m) => m.role === "tool");
    // Completion-contract path: once a tool has run, emit a `finish` call with
    // the requested summary so tests can exercise the loop's graceful exit.
    if (finishSummary != null && hasToolResult) {
      const toolCall = {
        id: "mock-finish-1",
        type: "function",
        function: { name: "finish", arguments: JSON.stringify({ summary: finishSummary }) },
      };
      return {
        text: "",
        tool_calls: [toolCall],
        message: { tool_calls: [toolCall] },
        usage: { input_tokens: userText.length, output_tokens: 4 },
        raw: { model, mock: true },
      };
    }
    if (requestedTool && !hasToolResult) {
      const toolCall = {
        id: "mock-call-1",
        type: "function",
        function: { name: requestedTool, arguments: "{}" },
      };
      return {
        text: "",
        tool_calls: [toolCall],
        message: { tool_calls: [toolCall] },
        usage: { input_tokens: userText.length, output_tokens: 4 },
        raw: { model, mock: true },
      };
    }

    const sysHint = system ? ` (system: ${system.slice(0, 40)}…)` : "";
    return {
      text: `[mock:${model}] received: ${userText}${sysHint}`,
      usage: { input_tokens: userText.length, output_tokens: 32 },
      raw: { model, mock: true },
    };
  },
};
