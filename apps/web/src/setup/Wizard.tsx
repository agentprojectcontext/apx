import type { ModelChoice } from "@apx/protocol";
import { AgentAvatar, Button, Icons } from "@apx/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import logo from "../assets/logo.png";
import { bootstrap } from "../data/actions.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { secretary } from "../data/identity.ts";
import { loadModelsConfig, saveModelsConfig, useModels } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { addProject, closeSetup, finishSetup, importV1, scanV1, useSetup, type V1Groups } from "../data/setup.ts";
import { useData } from "../data/state.ts";
import { updateAgent } from "../data/team.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { go } from "../shell/nav.ts";
import { type Draft, defaultDraft } from "./draft.ts";
import { ChannelsStep, DoneStep, EnginesStep, MemoryStep, ProjectStep } from "./StepsConfig.tsx";
import { AgentStep, GROUP, ImportStep, Welcome } from "./StepsIntro.tsx";

const STEP_KEY: Record<Step, MessageKey> = {
  welcome: "setup.step.welcome",
  import: "setup.step.import",
  agent: "setup.step.agent",
  engines: "setup.step.engines",
  memory: "setup.step.memory",
  channels: "setup.step.channels",
  project: "setup.step.project",
  done: "setup.step.done",
};
type Step = "welcome" | "import" | "agent" | "engines" | "memory" | "channels" | "project" | "done";

/**
 * The first-run setup, the whole window: welcome (start fresh or bring v1), the super-agent's face, the engines, memory,
 * channels and a first project, then done. Each step saves as it goes on; the card on the right shows the crew so far.
 */
export function Wizard() {
  const t = useT();
  const status = useSetup((s) => s.status);
  const agents = useData((s) => s.agents);
  const config = useModels((s) => s.config);
  const [d, setD] = useState<Draft>(() => defaultDraft());
  const [at, setAt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<V1Groups>();
  const set = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const boss = secretary(agents);

  const steps: Step[] = useMemo(
    () => [
      "welcome",
      ...(d.mode === "import" ? (["import"] as const) : []),
      "agent",
      "engines",
      "memory",
      "channels",
      "project",
      "done",
    ],
    [d.mode],
  );
  const step = steps[at] ?? "welcome";

  useEffect(() => {
    void loadModelsConfig();
  }, []);
  // The chain starts from what the install has: its default, then the router's fallbacks.
  useEffect(() => {
    if (!config || d.chainSet) return;
    const chain = [config.default.model, ...config.router.chain].filter((m): m is string => Boolean(m));
    setD((cur) => ({ ...cur, chain: [...new Set(chain)], chainSet: true }));
  }, [config, d.chainSet]);
  // The super-agent as it is now, until the owner changes it.
  useEffect(() => {
    if (!boss || d.nameSet) return;
    setD((cur) => ({ ...cur, name: boss.name, blob: boss.blob ?? "", nameSet: true }));
  }, [boss, d.nameSet]);

  const start = (mode: Draft["mode"]) => {
    set({ mode });
    setAt(1);
    if (mode === "import" && !scan) void scanV1().then(setScan);
  };

  const blocked: MessageKey | undefined =
    step === "agent" && !d.blob
      ? "setup.agent.needBlob"
      : step === "agent" && !d.name.trim()
        ? "setup.agent.needName"
        : step === "engines" && !d.chain.length
          ? "setup.engines.needOne"
          : undefined;

  /** What leaving a step saves. */
  const save = async (): Promise<boolean> => {
    if (step === "import") {
      const groups = (scan ?? []).filter((g) => g.count > 0 && d.importOn[g.id] !== false).map((g) => g.id);
      if (!groups.length) return true;
      const r = await importV1(groups);
      if (!r) return false;
      const list = (Object.entries(r.imported) as Array<[keyof typeof GROUP, number]>)
        .map(([k, n]) => `${t(GROUP[k].label)} ${n}`)
        .join(" · ");
      notify(t("setup.import.result", { list }), "info");
      if (r.errors.length) notify(t("setup.import.failed", { error: r.errors.join("; ") }));
      // What came in (projects, agents, chats, channels) shows in the panel and the next steps.
      await Promise.all([bootstrap().catch(() => {}), loadChannels()]);
      return true;
    }
    if (step === "agent" && boss) return updateAgent(boss.id, { name: d.name.trim(), blob: d.blob });
    if (step === "engines" && config) {
      const [first, ...rest] = d.chain;
      const choice: ModelChoice = first ? { model: first, router: rest.length > 0 } : { router: true };
      return saveModelsConfig({ default: choice, router: { ...config.router, chain: rest } });
    }
    if (step === "memory") {
      try {
        const now = await client.call("memory.settings", {});
        await client.call("memory.set_settings", {
          mode: d.memory,
          auto_compact: d.compact,
          ...(now.aux_model ? { aux_model: now.aux_model } : {}),
        });
      } catch {}
      return true;
    }
    if (step === "project" && d.projectChoice === "folder" && d.path.trim()) {
      const name = await addProject(d.path.trim());
      if (!name) return false;
      notify(t("setup.project.added", { name }), "info");
    }
    return true;
  };
  const next = async () => {
    if (blocked || busy) return;
    setBusy(true);
    const ok = await save();
    setBusy(false);
    if (ok) setAt((i) => Math.min(i + 1, steps.length - 1));
  };
  const finish = async () => {
    await finishSetup();
    await bootstrap().catch(() => {});
    go.inbox();
  };

  const name = d.name.trim() || t("setup.preview.unset");
  const body: Record<Step, ReactNode> = {
    welcome: <Welcome v1={status?.v1 ?? null} onStart={start} />,
    import: <ImportStep home={status?.v1?.home ?? "~/.apx"} scan={scan} draft={d} set={set} />,
    agent: <AgentStep draft={d} set={set} />,
    engines: <EnginesStep draft={d} set={set} />,
    memory: <MemoryStep draft={d} set={set} />,
    channels: <ChannelsStep name={d.name.trim() || t("agent.super")} />,
    project: <ProjectStep draft={d} set={set} />,
    done: <DoneStep name={name} />,
  };

  return (
    <div className="wiz" data-apx-look="minimal" data-apx-mode="dark">
      <header className="wiz__head">
        <div className="wiz__brand">
          <img src={logo} alt="" width={24} height={24} />
          <span>APX</span>
        </div>
        <nav className="wiz__steps" aria-label={t("setup.menu")}>
          {steps.map((s, i) => (
            <button
              key={s}
              type="button"
              className={`wiz__step${i <= at ? " is-done" : ""}${i === at ? " is-on" : ""}`}
              disabled={i > at}
              onClick={() => setAt(i)}
            >
              <span className="wiz__bar" />
              {t(STEP_KEY[s])}
            </button>
          ))}
        </nav>
        <button type="button" className="wiz__exit" onClick={closeSetup}>
          {t("setup.exit")}
        </button>
      </header>
      <div className="wiz__scroll">
        <div className={`wiz__grid${step === "welcome" ? " is-single" : ""}`}>
          <div className="wiz__main">
            {body[step]}
            {step !== "welcome" && (
              <div className="wiz__foot">
                {at > 0 && (
                  <button type="button" className="wiz__back" onClick={() => setAt((i) => Math.max(i - 1, 0))}>
                    {t("setup.back")}
                  </button>
                )}
                <span className="wiz__spacer" />
                {blocked && <span className="wiz__hint">{t(blocked)}</span>}
                {step === "done" ? (
                  <Button size="lg" onClick={() => void finish()}>
                    {t("setup.open")}
                  </Button>
                ) : (
                  <Button size="lg" disabled={Boolean(blocked)} loading={busy} onClick={() => void next()}>
                    {step === "project" ? t("setup.create") : t("setup.next")}
                  </Button>
                )}
              </div>
            )}
          </div>
          {step !== "welcome" && <Preview draft={d} imports={scan} />}
        </div>
      </div>
    </div>
  );
}

/** The crew so far: its face and name, and one line per part as the steps set it. */
function Preview({ draft: d, imports }: { draft: Draft; imports: V1Groups | undefined }) {
  const t = useT();
  const ready = Boolean(d.blob && d.name.trim());
  const memory: Record<Draft["memory"], MessageKey> = {
    notes: "setup.memory.notes",
    semantic: "setup.memory.semantic",
    off: "setup.memory.off",
  };
  const all = useChannels((s) => s.channels);
  const channels = useMemo(() => all.filter((c) => c.token_set).map((c) => c.label), [all]);
  const groups = (imports ?? []).filter((g) => g.count > 0);
  const on = groups.filter((g) => d.importOn[g.id] !== false).length;
  const row = (key: MessageKey, value: ReactNode, mono = false) => (
    <div className="wiz__prow">
      <span className="wiz__pkey">{t(key)}</span>
      <span className={`wiz__pval${mono ? " is-mono" : ""}`}>
        {value || <span className="wiz__unset">{t("setup.preview.unset")}</span>}
      </span>
    </div>
  );
  return (
    <aside className="wiz__preview">
      <div className="wiz__ptop">
        {d.blob ? (
          <AgentAvatar name={d.name || "crew"} blob={d.blob} size={132} status="online" />
        ) : (
          <span className="wiz__pempty">
            <Icons.Plus size={28} />
          </span>
        )}
        {d.name.trim() ? <div className="wiz__pname">{d.name.trim()}</div> : <span className="wiz__pnameempty" />}
        <span className={`wiz__ptag${ready ? " is-ready" : ""}`}>{t("agent.super")}</span>
      </div>
      {row("setup.preview.engines", d.chain.join(" → "), true)}
      {row("setup.preview.memory", t(memory[d.memory]))}
      {row("setup.preview.channels", channels.join(", "))}
      {row(
        "setup.preview.projects",
        `Default${d.projectChoice === "folder" && d.path.trim() ? ` · ${d.path.trim().split("/").filter(Boolean).at(-1)}` : ""}`,
      )}
      {d.mode === "import" && row("setup.preview.imports", t("setup.preview.groups", { n: on, total: groups.length }))}
    </aside>
  );
}
