// Mock engine for tests and offline development. No network. Echoes back the
// last user message with a small transformation so it's distinguishable from
// the input. Use model "mock" or "mock:anything".

export default {
  id: "mock",
  needsApiKey: false,

  async health() {
    return { ok: true, soft: true };
  },

  async chat({ system, messages, model = "mock", tools }) {
    const last = [...messages].reverse().find((m) => m.role === "user");
    const userText = last?.content || "";
    // Mirror real engines: tool calls are only possible when the caller offers
    // tools. The loop withholds them on its tool-free wrap-up step, and we must
    // honor that here — otherwise the mock would keep "calling" tools the model
    // can't actually reach.
    const toolsAvailable = Array.isArray(tools) && tools.length > 0;
    const requestedTool = userText.match(/\[mock:tool:([a-z_]+)\]/)?.[1];
    const loopTool = userText.match(/\[mock:loop:([a-z_]+)\]/)?.[1];
    const finishSummary = userText.match(/\[mock:finish:([^\]]*)\]/)?.[1];
    const hasToolResult = messages.some((m) => m.role === "tool");
    // `[mock:empty]` → a dud turn (no text, no tools) to exercise the loop's
    // empty-retry / never-end-silent guard.
    if (/\[mock:empty\]/.test(userText)) {
      return {
        text: "",
        usage: { input_tokens: userText.length, output_tokens: 0 },
        raw: { model, mock: true },
      };
    }
    const mkToolCall = (name, id) => {
      const toolCall = {
        id,
        type: "function",
        function: { name, arguments: "{}" },
      };
      return {
        text: "",
        tool_calls: [toolCall],
        message: { tool_calls: [toolCall] },
        usage: { input_tokens: userText.length, output_tokens: 4 },
        raw: { model, mock: true },
      };
    };
    // Completion-contract path: once a tool has run, emit a `finish` call with
    // the requested summary so tests can exercise the loop's graceful exit.
    if (finishSummary != null && hasToolResult && toolsAvailable) {
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
    // `[mock:loop:<tool>]` → re-fire the tool every step it's offered, modeling
    // a model that never stops on its own (drives the loop to its cap).
    if (loopTool && toolsAvailable) {
      return mkToolCall(loopTool, "mock-loop-1");
    }
    // `[mock:loopany:<tool>]` → like loop, but sticky: matched against ANY
    // user turn, so the model keeps looping even after the agent loop injects
    // in-band user notes (exercises stuck-detection escalation, which needs a
    // model that ignores the nudge).
    const loopAnyTool = messages
      .filter((m) => m.role === "user")
      .map((m) => String(m.content || "").match(/\[mock:loopany:([a-z_]+)\]/)?.[1])
      .find(Boolean);
    if (loopAnyTool && toolsAvailable) {
      return mkToolCall(loopAnyTool, "mock-loopany-1");
    }
    if (requestedTool && !hasToolResult && toolsAvailable) {
      return mkToolCall(requestedTool, "mock-call-1");
    }

    const sysHint = system ? ` (system: ${system.slice(0, 40)}…)` : "";
    return {
      text: `[mock:${model}] received: ${userText}${sysHint}`,
      usage: { input_tokens: userText.length, output_tokens: 32 },
      raw: { model, mock: true },
    };
  },
};
