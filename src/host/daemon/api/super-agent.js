// "super-agent" here is the *default APX agent* — the tool-using loop that
// runs when no project agent is named (Telegram, overlay, TUI without
// --agent). It is NOT a persona with that name; it is the system-level
// dispatcher described in core/agent/run-agent.js.
//
//   POST /projects/:pid/super-agent/chat/stream    NDJSON event stream
//   POST /projects/:pid/super-agent/chat            blocking JSON response
import { runSuperAgent } from "../super-agent.js";
import {
  resolveSuperAgentContext,
  appendSuperAgentErrorTrace,
} from "./shared.js";

export function register(app, { projects, registries, plugins, project, config }) {
  app.post("/projects/:pid/super-agent/chat/stream", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { prompt, previousMessages, model } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const ctx = resolveSuperAgentContext(req, p);

    res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
    res.setHeader("cache-control", "no-cache, no-transform");
    res.setHeader("x-accel-buffering", "no");
    res.flushHeaders?.();

    const send = (event) => {
      res.write(JSON.stringify(event) + "\n");
    };

    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt,
        channel: ctx.channel,
        channelMeta: ctx.channelMeta,
        contextNote: ctx.contextNote,
        previousMessages: previousMessages || [],
        overrideModel: model,
        onEvent: send,
      });
      projects.rebuild(p.id);
      send({
        type: "final",
        result: {
          text: saResult.text,
          usage: saResult.usage,
          name: saResult.name,
          trace: saResult.trace,
        },
      });
      res.end();
    } catch (e) {
      appendSuperAgentErrorTrace(req, e, {
        prompt,
        channel: ctx.channel,
        previousMessages,
        model,
        stream: true,
      });
      send({
        type: "error",
        trace_id: req.apxTraceId,
        error: `${e.message} (trace: ${req.apxTraceId})`,
      });
      res.end();
    }
  });

  app.post("/projects/:pid/super-agent/chat", async (req, res) => {
    const p = project(req, res);
    if (!p) return;
    const { prompt, previousMessages, model } = req.body || {};
    if (!prompt) return res.status(400).json({ error: "prompt required" });
    const ctx = resolveSuperAgentContext(req, p);
    try {
      const saResult = await runSuperAgent({
        globalConfig: config,
        projects,
        plugins,
        registries,
        prompt,
        channel: ctx.channel,
        channelMeta: ctx.channelMeta,
        contextNote: ctx.contextNote,
        previousMessages: previousMessages || [],
        overrideModel: model,
      });
      projects.rebuild(p.id);
      res.json({
        text: saResult.text,
        usage: saResult.usage,
        name: saResult.name,
        trace: saResult.trace,
      });
    } catch (e) {
      appendSuperAgentErrorTrace(req, e, {
        prompt,
        channel: ctx.channel,
        previousMessages,
        model,
        stream: false,
      });
      res.status(500).json({ error: e.message, trace_id: req.apxTraceId });
    }
  });
}
