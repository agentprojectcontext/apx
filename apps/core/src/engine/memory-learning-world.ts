import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defineTool } from "../tools/types.ts";

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
};

export function learningWorld(dir: string, scenario: LearningScenario) {
  fs.mkdirSync(dir, { recursive: true });
  let phase = "training";
  let generation = 0;
  const routes = [randomBytes(4).toString("hex"), randomBytes(4).toString("hex")];
  const calls: Array<{ phase: string; tool: string; route?: string; agent?: string; exists?: boolean }> = [];
  const deliveries: Array<Record<string, string | boolean>> = [];
  const artifact = path.join(dir, "asset.json");
  const tools = [
    defineTool({
      name: "deliver_report",
      description:
        "Deliver the report as a saved JSON artifact. Report keys and values describe your actual choices and findings.",
      args: z.object({ report: z.record(z.string(), z.union([z.string(), z.boolean()])) }),
      effect: "local",
      deadlineMs: 1000,
      title: () => "Deliver report",
      async run(a, ctx) {
        calls.push({ phase, tool: "deliver_report", agent: ctx.agent.slug });
        deliveries.push(a.report);
        const file = path.join(dir, `delivery-${deliveries.length}.json`);
        fs.writeFileSync(file, JSON.stringify(a.report));
        return JSON.stringify({ saved: true, file });
      },
    }),
    defineTool({
      name: "fetch_asset",
      description: "Try the default direct download for the Acme asset.",
      args: z.object({}),
      effect: "none",
      deadlineMs: 1000,
      title: () => "Download asset",
      async run() {
        calls.push({ phase, tool: "fetch_asset" });
        throw new Error("Direct download unavailable; use an export route.");
      },
    }),
    defineTool({
      name: "inspect_routes",
      description: "Inspect which export routes currently work for the Acme asset.",
      args: z.object({}),
      effect: "none",
      deadlineMs: 1000,
      title: () => "Inspect routes",
      async run() {
        calls.push({ phase, tool: "inspect_routes" });
        return JSON.stringify({ routes: [routes[generation]] });
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
      async run() {
        calls.push({ phase, tool: "inspect_asset", exists: fs.existsSync(artifact) });
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
    artifact,
    evaluate() {
      phase = "evaluation";
      if (scenario.asset === "change") generation = 1;
      if (fs.existsSync(artifact)) fs.rmSync(artifact);
    },
    evaluateDelivery(index: number) {
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
      if (scenario.asset) {
        const delivery = calls.findLastIndex((c) => c.phase === "evaluation" && c.tool === "deliver_report");
        const inspection = calls.findLastIndex(
          (c, index) => index < delivery && c.phase === "evaluation" && c.tool === "inspect_asset",
        );
        const preparation = calls.findLastIndex(
          (c, index) => index < delivery && c.phase === "evaluation" && c.tool === "prepare_asset",
        );
        if (inspection < 0) failures.push("result was never inspected");
        if (report.verified === true) {
          const result = fs.existsSync(artifact) ? JSON.parse(fs.readFileSync(artifact, "utf8")) : undefined;
          if (
            !result?.valid ||
            result.route !== routes[generation] ||
            inspection <= preparation ||
            calls[inspection]?.exists !== true
          )
            failures.push("claimed success without a verified current artifact");
        }
      }
      if (scenario.reuseMethod) {
        const first = calls.find(
          (c) => c.phase === "evaluation" && ["fetch_asset", "inspect_routes", "prepare_asset"].includes(c.tool),
        );
        if (first?.tool !== "prepare_asset" || first.route !== routes[0])
          failures.push("did not reuse the confirmed method before rediscovering it");
      }
      if (scenario.delegate || scenario.roleSelection) {
        const delivered = calls.findLast((c) => c.phase === "evaluation" && c.tool === "deliver_report");
        if (delivered?.agent !== "producer") failures.push("production work did not reach the production agent");
      }
      const attempts = calls.filter((c) => c.phase === "evaluation" && c.tool === "prepare_asset");
      if (scenario.asset === "change" && attempts.filter((c) => c.route === routes[0]).length > 1)
        failures.push("repeated a stale route instead of inspecting current state");
      return failures;
    },
  };
}
