import "../styles/setup.css";
import "../styles/screens.css";
import "../styles/wizard.css";
import type { ModelChoice, ProjectKind } from "@apx/protocol";
import { AgentAvatar, Button, IconButton, Icons } from "@apx/ui";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import logo from "../assets/logo.png";
import { bootstrap } from "../data/actions.ts";
import { loadChannels, useChannels } from "../data/channels.ts";
import { client } from "../data/client.ts";
import { closeCard } from "../data/cornerCards.ts";
import { secretary } from "../data/identity.ts";
import { loadModelsConfig, saveModelsConfig, useModels } from "../data/models.ts";
import { notify } from "../data/notices.ts";
import { setPrefs } from "../data/prefs.ts";
import { updateBase } from "../data/projects.ts";
import {
  addProject,
  closeSetup,
  finishSetup,
  importV1,
  SETUP_RESUME_KEY as RESUME_KEY,
  scanV1,
  useSetup,
  type V1Groups,
} from "../data/setup.ts";
import { useData } from "../data/state.ts";
import { updateAgent } from "../data/team.ts";
import { type MessageKey, useLanguage, usePack, useT } from "../i18n/index.ts";
import { useDesktopClass } from "../shell/desktop.ts";
import { LanguageMenu } from "../shell/LanguageMenu.tsx";
import { go, useNav } from "../shell/nav.ts";
import { ALL_SLIDES } from "../shell/welcomeFilm.ts";
import { BuildVersion } from "./BuildVersion.tsx";
import { type Draft, defaultDraft } from "./draft.ts";
import { ChannelsStep, DoneStep, EnginesStep, MemoryStep, ProjectStep } from "./StepsConfig.tsx";
import { AgentStep, GROUP, ImportStep, Welcome } from "./StepsIntro.tsx";

/** Simple names its steps for someone who never set up an agent. */
const SIMPLE_KEY: Partial<Record<Step, MessageKey>> = { engines: "setup.step.brain" };
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

/** Where an unfinished setup was left on this device, if it is readable. */
function resumed(): { draft: Draft; at: number } | undefined {
  try {
    const v = JSON.parse(localStorage.getItem(RESUME_KEY) ?? "null") as { draft?: Partial<Draft>; at?: unknown } | null;
    if (!v?.draft || typeof v.at !== "number") return undefined;
    return { draft: { ...defaultDraft(), ...v.draft }, at: Math.max(0, Math.floor(v.at)) };
  } catch {
    return undefined;
  }
}

/** Its strings load with it (the "setup" pack): nothing shows until they are here. */
export function Wizard() {
  const setup = usePack("setup");
  const resources = usePack("resources");
  return setup && resources ? <WizardBody /> : null;
}

/**
 * The first-run setup, the whole window: welcome (start fresh or bring v1), the super-agent's face, the engines, memory,
 * channels and a first project, then done. Each step saves as it goes on; the card on the right shows the crew so far.
 */
function WizardBody() {
  const t = useT();
  const lang = useLanguage();
  const mode = useNav((s) => s.mode);
  const desktop = useDesktopClass();
  const status = useSetup((s) => s.status);
  const agents = useData((s) => s.agents);
  const config = useModels((s) => s.config);
  const [d, setD] = useState<Draft>(() => resumed()?.draft ?? defaultDraft());
  const [at, setAt] = useState(() => resumed()?.at ?? 0);
  // A reload, or a sign-in that came back in another tab, opens the setup where the owner left it.
  useEffect(() => {
    try {
      localStorage.setItem(RESUME_KEY, JSON.stringify({ draft: d, at }));
    } catch {}
  }, [d, at]);
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<V1Groups>();
  const set = (p: Partial<Draft>) => setD((cur) => ({ ...cur, ...p }));
  const boss = secretary(agents);

  const steps: Step[] = useMemo(
    () =>
      d.style === "simple"
        ? ["welcome", "engines", "channels", "done"]
        : [
            "welcome",
            ...(d.mode === "import" ? (["import"] as const) : []),
            "agent",
            "engines",
            "memory",
            "channels",
            "project",
            "done",
          ],
    [d.mode, d.style],
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
  // The base project as it is now, until the owner names it.
  const base = useData((s) => s.base);
  useEffect(() => {
    if (d.baseSet) return;
    setD((cur) => ({ ...cur, baseName: base.name, baseKind: base.kind ?? "", baseSet: true }));
  }, [base, d.baseSet]);
  // The super-agent as it is now, until the owner changes it.
  useEffect(() => {
    if (!boss || d.nameSet) return;
    setD((cur) => ({ ...cur, name: boss.name, blob: boss.blob ?? "", nameSet: true }));
  }, [boss, d.nameSet]);

  const start = (mode: Draft["mode"], style: Draft["style"]) => {
    const v1 = status?.v1;
    // Importing brings v1's super-agent: the preview shows its name and face from the first step.
    if (mode === "import" && (v1?.agent_name || v1?.agent_blob))
      set({ mode, style, nameSet: true, name: v1.agent_name ?? d.name, blob: v1.agent_blob ?? d.blob });
    else set({ mode, style });
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
      // v1 searched by meaning with these engines: memory starts there too, with v1's choice on skills.
      if (r.imported.embeddings) {
        const now = await client.call("memory.settings", {}).catch(() => undefined);
        set({ memory: "semantic", ...(now ? { skillPicker: now.skill_picker } : {}) });
      }
      // v1's main model and fallbacks came in as the default and the router: the engines step starts from them.
      if (r.imported.keys) {
        await loadModelsConfig();
        set({ chainSet: false });
      }
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
          skill_picker: d.skillPicker,
          auto_compact: d.compact,
          ...(now.aux_model ? { aux_model: now.aux_model } : {}),
        });
      } catch {}
      return true;
    }
    if (step === "project") {
      const name = d.baseName.trim() || base.name;
      const kind = d.baseKind || null;
      if (name !== base.name || (kind ?? "") !== (base.kind ?? ""))
        if (!(await updateBase({ name, kind: kind as ProjectKind | null }))) return false;
    }
    if (step === "project" && d.projectChoice === "folder" && d.path.trim()) {
      const project = await addProject(d.path.trim());
      if (!project) return false;
      notify(t("setup.project.added", { name: project.name }), "info");
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
  // The super-agent's chat opens with its first greeting, in the language on screen.
  const finish = async () => {
    try {
      localStorage.removeItem(RESUME_KEY);
    } catch {}
    setPrefs({ panelMode: d.style });
    // Someone who just installed has nothing to compare: what is new starts with the next release.
    closeCard({ welcomeSeen: [...ALL_SLIDES] });
    await finishSetup();
    const greeted = await client.call("setup.greet", { language: lang }).catch(() => undefined);
    await bootstrap().catch(() => {});
    go.inboxThread(greeted?.thread ?? "home");
  };

  const name = d.name.trim() || t("setup.preview.unset");
  const body: Record<Step, ReactNode> = {
    welcome: <Welcome v1={status?.v1 ?? null} agent={boss} onStart={start} />,
    import: <ImportStep home={status?.v1?.home ?? "~/.apx"} scan={scan} draft={d} set={set} />,
    agent: <AgentStep draft={d} set={set} />,
    engines: <EnginesStep draft={d} set={set} onPicked={() => void next()} />,
    memory: <MemoryStep draft={d} set={set} />,
    channels: <ChannelsStep name={d.name.trim() || t("agent.super")} simple={d.style === "simple"} />,
    project: <ProjectStep draft={d} set={set} />,
    done: <DoneStep name={name} simple={d.style === "simple"} onFinish={() => void finish()} />,
  };

  return (
    <div className="wiz">
      <header className={`wiz__head${desktop}`}>
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
              {t((d.style === "simple" && SIMPLE_KEY[s]) || STEP_KEY[s])}
            </button>
          ))}
        </nav>
        <LanguageMenu className="topbar__lang" />
        <IconButton
          size="sm"
          label={mode === "dark" ? t("theme.light") : t("theme.dark")}
          icon={mode === "dark" ? <Icons.Sun size={14} /> : <Icons.Moon size={14} />}
          onClick={go.toggleMode}
        />
        <button type="button" className="wiz__exit" onClick={closeSetup}>
          {t("setup.exit")}
        </button>
      </header>
      <div className="wiz__scroll">
        <div className={`wiz__grid${step === "welcome" || d.style === "simple" ? " is-single" : ""}`}>
          <div className="wiz__main">
            {body[step]}
            {step !== "welcome" && step !== "done" && (
              <div className="wiz__foot">
                {at > 0 && (
                  <button type="button" className="wiz__back" onClick={() => setAt((i) => Math.max(i - 1, 0))}>
                    {t("setup.back")}
                  </button>
                )}
                <span className="wiz__spacer" />
                {blocked && d.style === "advanced" && <span className="wiz__hint">{t(blocked)}</span>}
                {d.style === "simple" && step === "channels" && (
                  <Button size="lg" variant="ghost" onClick={() => void next()}>
                    {t("setup.reach.skip")}
                  </Button>
                )}
                {/* Simple's brain goes on by itself once one is picked: Continue shows only when one is there. */}
                {!(blocked && d.style === "simple") && (
                  <Button size="lg" disabled={Boolean(blocked)} loading={busy} onClick={() => void next()}>
                    {step === "project" ? t("setup.create") : t("setup.next")}
                  </Button>
                )}
              </div>
            )}
          </div>
          {/* Simple meets its agent at the end, by name: until then each step stands alone. */}
          {step !== "welcome" && d.style === "advanced" && <Preview draft={d} imports={scan} />}
        </div>
      </div>
      <BuildVersion className={step === "welcome" ? "" : " is-side"} />
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
      {d.style === "advanced" && row("setup.preview.memory", t(memory[d.memory]))}
      {row("setup.preview.channels", channels.join(", "))}
      {d.style === "advanced" &&
        row(
          "setup.preview.projects",
          `${d.baseName.trim() || "Default"}${d.projectChoice === "folder" && d.path.trim() ? ` · ${d.path.trim().split("/").filter(Boolean).at(-1)}` : ""}`,
        )}
      {d.mode === "import" && row("setup.preview.imports", t("setup.preview.groups", { n: on, total: groups.length }))}
    </aside>
  );
}
