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
    // `[mock:system]` → the whole system prompt comes back as the answer, so a
    // test can assert what the LOOP actually handed the engine rather than what
    // the prompt builder returned in isolation.
    if (/\[mock:system\]/.test(userText)) {
      return {
        text: String(system || ""),
        usage: { input_tokens: userText.length, output_tokens: 0 },
        raw: { model, mock: true },
      };
    }
    // `[mock:empty]` → a dud turn (no text, no tools) to exercise the loop's
    // empty-retry / never-end-silent guard.
    if (/\[mock:empty\]/.test(userText)) {
      return {
        text: "",
        usage: { input_tokens: userText.length, output_tokens: 0 },
        raw: { model, mock: true },
      };
    }
    // `[mock:risk:HIGH]` → the emitted tool call carries a security_risk grade,
    // so the inline security analyzer / confirmation gate can be exercised.
    const riskGrade = userText.match(/\[mock:risk:(LOW|MEDIUM|HIGH|UNKNOWN)\]/)?.[1];
    const mkToolCall = (name, id) => {
      const toolCall = {
        id,
        type: "function",
        function: { name, arguments: riskGrade ? JSON.stringify({ security_risk: riskGrade }) : "{}" },
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

    // `[mock:cutoff]` → prose that hit the output cap: text, no tool calls,
    // finish_reason "length". Models the turn that composed its work instead of
    // doing it and ran out of budget. The SECOND time (once the loop has asked
    // for the action) it calls the tool, so a test can assert the recovery.
    if (/\[mock:cutoff:([a-z_]+)\]/.test(userText) || messages.some((m) => /\[mock:cutoff:/.test(String(m.content || "")))) {
      const tool = messages
        .map((m) => String(m.content || "").match(/\[mock:cutoff:([a-z_]+)\]/)?.[1])
        .find(Boolean);
      const nudged = messages.some((m) => /output limit and was cut off/i.test(String(m.content || "")));
      if (nudged && toolsAvailable) return mkToolCall(tool, "mock-cutoff-1");
      return {
        text: "Idea 1: ... Idea 2: ... Idea 3: ... and then the budget ran ou",
        finish_reason: "length",
        usage: { input_tokens: userText.length, output_tokens: 512 },
        raw: { model, mock: true },
      };
    }

    // `[mock:prose:<tool>]` → the leak of 2026-08-26: a model that WRITES the
    // call instead of making it, copying the shape out of its own history,
    // stale result and all. No tool_calls, so the API considers the turn
    // finished and the loop is one step from delivering a transcript as the
    // answer. Once the recovered call has run it answers normally, so a test
    // can assert both halves: the tool fired, and none of it was spoken.
    const proseTool =
      userText.match(/\[mock:prose:([a-z_]+)\]/)?.[1] ||
      messages.map((m) => String(m.content || "").match(/\[mock:prose:([a-z_]+)\]/)?.[1]).find(Boolean);
    if (proseTool) {
      if (hasToolResult) {
        return {
          text: "Listo, ya lo miré.",
          usage: { input_tokens: userText.length, output_tokens: 8 },
          raw: { model, mock: true },
        };
      }
      return {
        text: `Reviso eso y te confirmo. [tool ${proseTool}] {"project":"acme"} → ya estaba hecho`,
        usage: { input_tokens: userText.length, output_tokens: 48 },
        raw: { model, mock: true },
      };
    }

    // `mock:truncated` → a degenerate answer: non-empty, but far too small to
    // stand in for anything. Models the flaky provider response that used to
    // get written over a whole conversation as its "summary".
    if (model === "truncated" || model === "mock:truncated") {
      return {
        text: "USER_CONTEXT:\n- Manu",
        usage: { input_tokens: userText.length, output_tokens: 6 },
        raw: { model, mock: true },
      };
    }

    // `[mock:reply:<text>]` → the model answers with exactly <text>. For tests
    // about what the LOOP does with an answer rather than about producing one:
    // the abstention marker is only interesting if the reply starts with it,
    // and the default echo prefixes everything with "[mock:…] received:".
    const replyText = userText.match(/\[mock:reply:([^\]]*)\]/)?.[1];
    if (replyText !== undefined) {
      return {
        text: replyText,
        usage: { input_tokens: userText.length, output_tokens: replyText.length },
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
