// Settings of the AI model step: who answers (an agent of the crew, or a bot just for this flow), on which harness,
// model and effort, how freely it acts, and whether it may hand work to other agents (DECISIONS.md#d-172).
import type { Agent, CatalogEngine } from "@apx/protocol";
import { AgentAvatar, EngineIcon, Field, Input, SegmentedControl, Select, Switch, Textarea } from "@apx/ui";
import { blobOf } from "../data/identity.ts";
import { baseRef, effortLabel, forAgents, modelOf, splitRef, useModels, withEffort } from "../data/models.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import type { FlowNode } from "./steps.tsx";

type Ai = Extract<FlowNode, { kind: "agent" }>;
const NATIVE = "native";
/** CLIs run in their own sessions; every other engine is a model API on APX's own loop. */
const isCli = (engine: string) => /^(claude|codex|aider|antigravity|acp:)/.test(engine);
/** The harness a step runs on: the engine of its model when that is a CLI, else APX's. */
export const harnessOf = (n: Pick<Ai, "model">) => {
  const engine = n.model ? splitRef(n.model).engine : "";
  return isCli(engine) ? engine : NATIVE;
};

const AUTONOMY: { value: NonNullable<Ai["autonomy"]>; label: MessageKey }[] = [
  { value: "manual", label: "flow.ai.manual" },
  { value: "auto", label: "flow.ai.auto" },
  { value: "total", label: "flow.ai.total" },
];
const WRITE: { value: NonNullable<Ai["write"]>; label: MessageKey }[] = [
  { value: "ask", label: "flow.ai.ask" },
  { value: "auto", label: "flow.ai.edits" },
  { value: "read-only", label: "flow.ai.readOnly" },
];

/** The models a harness offers: APX's, every model API set up; a CLI's, its own. */
function modelOptions(harness: string, catalog: readonly CatalogEngine[]) {
  const engines = harness === NATIVE ? catalog.filter(forAgents) : catalog.filter((e) => e.id === harness);
  return engines.flatMap((e) =>
    e.models
      .filter((m) => m.chat)
      .map((m) => ({ value: `${e.id}/${m.id}`, label: m.name, ...(harness === NATIVE ? { hint: e.label } : {}) })),
  );
}

export function AiFields({ n, update, agents }: { n: Ai; update: (n: FlowNode) => void; agents: Agent[] }) {
  const t = useT();
  const catalog = useModels((s) => s.catalog);
  const bot = Boolean(n.bot);
  const harness = harnessOf(n);
  const cli = harness !== NATIVE;
  const clis = catalog.filter((e) => e.kind === "harness" && e.available && isCli(e.id));
  const harnesses = [{ id: NATIVE, label: t("flow.ai.apx") }, ...clis.map((e) => ({ id: e.id, label: e.label }))];
  // A harness picked before that is not on this computer now stays shown, so the owner sees what will run.
  if (cli && !harnesses.some((h) => h.id === harness)) harnesses.push({ id: harness, label: harness });
  const own = cli
    ? t("models.engineDefault", { engine: harnesses.find((h) => h.id === harness)?.label ?? harness })
    : t(bot ? "flow.ai.defaultModel" : "flow.ai.agentModel");
  const models = [
    { value: cli ? harness : "", label: own },
    ...modelOptions(harness, catalog).filter((o) => o.value !== harness),
  ];
  const base = n.model ? baseRef(n.model) : "";
  if (base && !models.some((o) => o.value === base)) models.push({ value: base, label: base });
  const model = n.model ? modelOf(n.model, catalog) : undefined;
  const effort = n.model ? splitRef(n.model).effort : undefined;
  const efforts = model?.efforts ?? [];
  // Changing harness starts over on its default model and its own kind of permission.
  const pickHarness = (h: string) => {
    const { model: _m, autonomy: _a, write: _w, delegate: _d, ...rest } = n;
    update(h === NATIVE ? rest : { ...rest, model: h });
  };
  const pickSource = (v: string) => {
    const { agent: _a, bot: _b, delegate: _d, ...rest } = n;
    update(v === "bot" ? { ...rest, bot: { name: n.label, system: "" } } : { ...rest, agent: "" });
  };
  return (
    <>
      <div className="fe-presets">
        <span className="fe-ins__label">{t("flow.ai.who")}</span>
        <SegmentedControl
          size="sm"
          label={t("flow.ai.who")}
          value={bot ? "bot" : "agent"}
          onValueChange={pickSource}
          options={[
            { value: "agent", label: t("flow.ai.anAgent") },
            { value: "bot", label: t("flow.ai.aBot") },
          ]}
        />
      </div>
      {n.bot ? (
        <>
          <Field label={t("flow.ai.botName")}>
            {(id) => (
              <Input
                id={id}
                value={n.bot?.name ?? ""}
                maxLength={60}
                onChange={(e) => update({ ...n, bot: { name: e.target.value, system: n.bot?.system ?? "" } })}
              />
            )}
          </Field>
          <Field label={t("flow.ai.system")} hint={t("flow.ai.systemHint")}>
            {(id) => (
              <Textarea
                id={id}
                rows={6}
                maxLength={8000}
                value={n.bot?.system ?? ""}
                onChange={(e) => update({ ...n, bot: { name: n.bot?.name ?? "", system: e.target.value } })}
              />
            )}
          </Field>
        </>
      ) : (
        <Field label={t("flow.f.agent")}>
          {() => (
            <Select
              label={t("flow.f.agent")}
              value={n.agent || null}
              placeholder={t("flow.f.choose")}
              onValueChange={(v) => update({ ...n, agent: v ?? "" })}
              options={agents.map((a) => ({
                value: a.id,
                label: a.name,
                ...(a.role ? { hint: a.role } : {}),
                icon: <AgentAvatar name={a.name} blob={blobOf(a)} size={16} animated={false} />,
              }))}
            />
          )}
        </Field>
      )}
      <Field label={t("flow.ai.harness")}>
        {() => (
          <Select
            label={t("flow.ai.harness")}
            value={harness}
            onValueChange={(v) => v && v !== harness && pickHarness(v)}
            options={harnesses.map((h) => ({
              value: h.id,
              label: h.label,
              ...(h.id === NATIVE ? {} : { icon: <EngineIcon engine={h.id} size={14} /> }),
            }))}
          />
        )}
      </Field>
      <div className="fe-ai__model">
        <Field label={t("flow.f.model")}>
          {() => (
            <Select
              label={t("flow.f.model")}
              value={cli ? base || harness : base}
              onValueChange={(v) => {
                const { model: _m, ...rest } = n;
                update(v ? { ...rest, model: v } : rest);
              }}
              options={models}
            />
          )}
        </Field>
        {efforts.length > 0 && n.model && (
          <Field label={t("models.effort")}>
            {() => (
              <Select
                label={t("models.effort")}
                value={effort ?? ""}
                onValueChange={(v) => n.model && update({ ...n, model: withEffort(n.model, v || undefined) })}
                options={[
                  {
                    value: "",
                    label: model?.default_effort
                      ? t("models.effortDefaultIs", { effort: effortLabel(model.default_effort) })
                      : t("models.effortDefault"),
                  },
                  ...efforts.map((e) => ({ value: e, label: effortLabel(e) })),
                ]}
              />
            )}
          </Field>
        )}
      </div>
      <div className="fe-presets">
        <span className="fe-ins__label">{t("flow.ai.permission")}</span>
        {cli ? (
          <SegmentedControl
            size="sm"
            label={t("flow.ai.permission")}
            value={n.write ?? "ask"}
            onValueChange={(v) => update({ ...n, write: v as Ai["write"] })}
            options={WRITE.map((o) => ({ value: o.value, label: t(o.label) }))}
          />
        ) : (
          <SegmentedControl
            size="sm"
            label={t("flow.ai.permission")}
            value={n.autonomy ?? ""}
            onValueChange={(v) => {
              const { autonomy: _a, ...rest } = n;
              update(v ? { ...rest, autonomy: v as Ai["autonomy"] } : rest);
            }}
            options={[
              { value: "", label: t(bot ? "flow.ai.asUsual" : "flow.ai.agentOwn") },
              ...AUTONOMY.map((o) => ({ value: o.value, label: t(o.label) })),
            ]}
          />
        )}
      </div>
      {!bot && !cli && (
        <Switch
          size="sm"
          checked={n.delegate === true}
          onCheckedChange={(on) => {
            const { delegate: _d, ...rest } = n;
            update(on ? { ...rest, delegate: true } : rest);
          }}
          label={t("flow.ai.delegate")}
          description={t("flow.ai.delegateHint")}
        />
      )}
      <Field label={t("flow.f.task")}>
        {(id) => (
          <Textarea
            id={id}
            rows={5}
            maxLength={8000}
            value={n.prompt}
            onChange={(e) => update({ ...n, prompt: e.target.value })}
          />
        )}
      </Field>
    </>
  );
}

/** What the step's note says: what it keeps of the agent, or what a bot or a CLI starts from. */
export const aiNote = (n: Ai): MessageKey =>
  harnessOf(n) !== NATIVE ? "flow.ai.noteCli" : n.bot ? "flow.ai.noteBot" : "flow.ai.noteAgent";
