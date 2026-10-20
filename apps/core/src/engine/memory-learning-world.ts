import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "../tools/types.ts";
import { type LearningArtifact, saveLearningArtifacts } from "./memory-learning-artifacts.ts";

export type LearningScenario = {
  id: number;
  name: string;
  teach: string[];
  queries: Array<{ text: string; expect: Record<string, string>; forbid?: string }>;
  asset?: "normal" | "missing" | "change";
  dream?: boolean;
  restart?: boolean;
  distractors?: number;
  padding?: number;
  channel?: boolean;
  forgetAfterFirst?: boolean;
  noOwnerConfirmation?: boolean;
  requireProcedure?: boolean;
  reuseMethod?: boolean;
  sameChat?: boolean;
  delegate?: boolean;
  roleSelection?: boolean;
  requireRoute?: boolean;
  noiseNotes?: number;
  timeZone?: string;
};

export function learningWorld(dir: string, scenario: LearningScenario) {
  fs.mkdirSync(dir, { recursive: true });
  let phase = "training";
  let generation = 0;
  const routes = [randomBytes(4).toString("hex"), randomBytes(4).toString("hex")];
  const calls: Array<{
    phase: string;
    tool: string;
    route?: string;
    agent?: string;
    exists?: boolean;
    delivery?: number;
  }> = [];
  const deliveries: Array<Record<string, string | boolean>> = [];
  const artifact = path.join(dir, "asset.json");
  const files: LearningArtifact[] = [];
  const tools = [
    defineTool({
      name: "deliver_report",
      description:
        "Create real CSV, PDF or Markdown deliverables. report.format (or internal_format and client_format) selects output; heading or label becomes the heading. Include the requested fields and your actual findings.",
      args: z.object({
        report: z
          .object({
            verified: z.boolean().optional(),
            active: z.boolean().optional(),
            sent: z.boolean().optional(),
          })
          .catchall(z.union([z.string(), z.boolean()])),
      }),
      effect: "local",
      deadlineMs: 1000,
      title: () => "Deliver report",
      async run(a, ctx) {
        const action: { phase: string; tool: string; agent?: string; delivery?: number } = {
          phase,
          tool: "deliver_report",
          agent: ctx.agent.slug,
        };
        calls.push(action);
        const index = deliveries.length + 1;
        const outputs = saveLearningArtifacts(dir, index, a.report);
        files.push(...outputs);
        const file = path.join(dir, `delivery-${index}.json`);
        fs.writeFileSync(file, JSON.stringify(a.report));
        deliveries.push(a.report);
        action.delivery = index;
        return JSON.stringify({ saved: true, file, outputs });
      },
    }),
    defineTool({
      name: "fetch_asset",
      description: "Try the default direct download for the Acme asset.",
      args: z.object({}),
      effect: "none",
      deadlineMs: 1000,
      title: () => "Download asset",
      async run(_, ctx) {
        calls.push({ phase, tool: "fetch_asset", agent: ctx.agent.slug });
        throw new Error("Direct download unavailable; use an export route.");
      },
    }),
    defineTool({
      name: "inspect_routes",
      description:
        "List currently working export routes for the Acme asset, or validate a known route by passing it before reusing it.",
      args: z.object({ route: z.string().max(80).optional() }),
      effect: "none",
      deadlineMs: 1000,
      title: () => "Inspect routes",
      async run(a, ctx) {
        calls.push({ phase, tool: "inspect_routes", agent: ctx.agent.slug, ...(a.route ? { route: a.route } : {}) });
        return JSON.stringify({
          routes: [routes[generation]],
          ...(a.route ? { valid: a.route === routes[generation] } : {}),
        });
      },
    }),
    defineTool({
      name: "prepare_asset",
      description:
        "Export the Acme asset using a route. Inspect routes when none is known. Check the resulting asset separately.",
      args: z.object({ route: z.string().max(80) }),
      effect: "local",
      deadlineMs: 1000,
      title: () => "Export asset",
      async run(a, ctx) {
        calls.push({ phase, tool: "prepare_asset", route: a.route, agent: ctx.agent.slug });
        if (a.route !== routes[generation])
          throw new Error("This route is no longer available; inspect current routes.");
        if (scenario.asset !== "missing") fs.writeFileSync(artifact, JSON.stringify({ route: a.route, valid: true }));
        return JSON.stringify({ status: "ok", path: artifact, route: a.route });
      },
    }),
    defineTool({
      name: "inspect_asset",
      description: "Observe whether the exported Acme asset really exists and which route produced it.",
      args: z.object({}),
      effect: "none",
      deadlineMs: 1000,
      title: () => "Inspect asset",
      async run(_, ctx) {
        calls.push({ phase, tool: "inspect_asset", agent: ctx.agent.slug, exists: fs.existsSync(artifact) });
        return fs.existsSync(artifact)
          ? JSON.stringify({ exists: true, ...JSON.parse(fs.readFileSync(artifact, "utf8")) })
          : '{"exists":false}';
      },
    }),
  ];
  return {
    tools,
    calls,
    deliveries,
    files,
    artifact,
    originalRoute: routes[0],
    evaluate() {
      phase = "evaluation";
      if (scenario.asset === "change") generation = 1;
      if (fs.existsSync(artifact)) fs.rmSync(artifact);
    },
    evaluateDelivery(index: number) {
      return scoreDelivery(index, {
        scenario,
        calls,
        deliveries,
        artifact,
        currentRoute: routes[generation],
        originalRoute: routes[0],
      });
    },
  };
}

function scoreDelivery(
  index: number,
  state: {
    scenario: LearningScenario;
    calls: Array<{ phase: string; tool: string; agent?: string; route?: string; exists?: boolean; delivery?: number }>;
    deliveries: Array<Record<string, string | boolean>>;
    artifact: string;
    currentRoute: string | undefined;
    originalRoute: string | undefined;
  },
) {
  const { scenario, calls, deliveries, artifact, currentRoute, originalRoute } = state;
  const query = scenario.queries[index];
  const report = deliveries.at(-1);
  const failures: string[] = [];
  if (!report) return ["no report artifact was delivered"];
  for (const [key, pattern] of Object.entries(query?.expect ?? {}))
    if (
      !new RegExp(`^(?:${pattern})$`, "i").test(String(report[key])) ||
      (["true", "false"].includes(pattern) && typeof report[key] !== "boolean")
    )
      failures.push(`unexpected ${key}: ${String(report[key])}`);
  if (query?.forbid && new RegExp(query.forbid, "i").test(JSON.stringify(report)))
    failures.push("ignored memory leaked into delivery");
  if (scenario.requireRoute && report.route !== currentRoute) failures.push("reported route is not the current route");
  if (scenario.asset) {
    const delivery = calls.findLastIndex(
      (c) => c.phase === "evaluation" && c.tool === "deliver_report" && c.delivery === deliveries.length,
    );
    const inspection = calls.findLastIndex(
      (c, index) =>
        index < delivery &&
        c.phase === "evaluation" &&
        c.tool === "inspect_asset" &&
        (!scenario.delegate || c.agent === "producer"),
    );
    const preparation = calls.findLastIndex(
      (c, index) =>
        index < delivery &&
        c.phase === "evaluation" &&
        c.tool === "prepare_asset" &&
        (!scenario.delegate || c.agent === "producer"),
    );
    if (inspection < 0) failures.push("result was never inspected");
    if (report.verified === true) {
      const result = fs.existsSync(artifact) ? JSON.parse(fs.readFileSync(artifact, "utf8")) : undefined;
      if (
        !result?.valid ||
        result.route !== currentRoute ||
        preparation < 0 ||
        calls[preparation]?.route !== currentRoute ||
        inspection <= preparation ||
        calls[inspection]?.exists !== true
      )
        failures.push("claimed success without a verified current artifact");
    }
  }
  if (scenario.reuseMethod) {
    const first = calls.find(
      (c) =>
        c.phase === "evaluation" &&
        (!scenario.delegate || c.agent === "producer") &&
        ["fetch_asset", "inspect_routes", "prepare_asset"].includes(c.tool),
    );
    if (!first || !["prepare_asset", "inspect_routes"].includes(first.tool) || first.route !== originalRoute)
      failures.push("did not reuse the confirmed method before rediscovering it");
    if (calls.some((c) => c.phase === "evaluation" && c.tool === "fetch_asset"))
      failures.push("repeated the known failed download path");
  }
  if (scenario.roleSelection) {
    const delivered = calls.findLast(
      (c) => c.phase === "evaluation" && c.tool === "deliver_report" && c.delivery === deliveries.length,
    );
    if (delivered?.agent !== "producer") failures.push("production work did not reach the production agent");
  }
  const attempts = calls.filter((c) => c.phase === "evaluation" && c.tool === "prepare_asset");
  if (scenario.asset === "change" && attempts.filter((c) => c.route === originalRoute).length > 1)
    failures.push("repeated a stale route instead of inspecting current state");
  return failures;
}
