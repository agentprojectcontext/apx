import type { Result } from "@apx/protocol";
import { randomAgentName } from "@apx/protocol/client";
import { AgentAvatar, BLOB_NAMES, Button, Checkbox, IconButton, Icons, Input, Skeleton, Switch } from "@apx/ui";
import { type ReactNode, useState } from "react";
import type { V1Group, V1Groups } from "../data/setup.ts";
import { PRIVACY_URL, setUsage, useTelemetry } from "../data/telemetry.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { CrewHero } from "./CrewHero.tsx";
import type { Draft, StepProps } from "./draft.ts";
import { JUST_INSTALLED } from "./firstRun.ts";

/** A step's kicker, title (with its muted or green end) and text. */
export function StepHead(props: {
  kicker: MessageKey;
  title: string;
  end: string;
  green?: boolean;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <>
      <div className="wiz__kicker">
        <span />
        {t(props.kicker)}
      </div>
      <h2 className="wiz__title">
        {props.title} <span className={props.green ? "is-green" : "is-muted"}>{props.end}</span>
      </h2>
      {props.children && <p className="wiz__body">{props.children}</p>}
    </>
  );
}

/**
 * The first screen: the website's hero, then what comes next (start, or start fresh / bring v1 when it is here).
 * Right after the desktop app installed APX it says so.
 */
export function Welcome({
  v1,
  agent,
  onStart,
}: {
  v1: Result<"setup.status">["v1"];
  /** The super-agent this install has now (its name was picked at random on a fresh one). */
  agent: { name: string; blob?: string | undefined } | undefined;
  onStart: (mode: Draft["mode"]) => void;
}) {
  const t = useT();
  // Asked once, unticked: the answer goes with the first step the owner takes.
  const ask = useTelemetry((s) => s.state?.enabled === true && s.state.usage === null);
  const [share, setShare] = useState(false);
  const begin = (mode: Draft["mode"]) => {
    if (ask) void setUsage(share);
    onStart(mode);
  };
  const pill = JUST_INSTALLED ? (
    <span className="wiz__pill crew__pill">
      {t("setup.welcome.installed")} <span className="is-muted">{t("setup.welcome.installedMuted")}</span>
      <span className="wiz__lock">
        <Icons.Check size={12} />
      </span>
    </span>
  ) : (
    <span className="wiz__pill crew__pill">
      {t("setup.welcome.pill")} <span className="is-muted">{t("setup.welcome.pillMuted")}</span>
      <span className="wiz__lock">
        <Icons.Lock size={12} />
      </span>
    </span>
  );
  return (
    <div className="wiz__welcome crew__stage">
      <CrewHero pill={pill} />
      <div className="wiz__welcomenext">
        <p className="wiz__body">{t(JUST_INSTALLED ? "setup.welcome.installedBody" : "setup.welcome.body")}</p>
        {/* Two ways in only when there is a v1 to bring; otherwise just the way in. */}
        {v1 ? (
          <div className="wiz__choices">
            <button type="button" className="wiz__choice" onClick={() => begin("new")}>
              <span className="wiz__choicetitle">
                <Icons.Sparkles size={16} />
                {t("setup.welcome.new")}
              </span>
              <span className="wiz__choicebody">{t("setup.welcome.newBody")}</span>
            </button>
            <button type="button" className="wiz__choice is-brand" onClick={() => begin("import")}>
              <span className="wiz__choicetitle">
                <Icons.Download size={16} />
                {t("setup.welcome.import")}
              </span>
              <span className="wiz__choicebody">
                {v1.version
                  ? t(v1.projects === 1 ? "setup.welcome.importBody.one" : "setup.welcome.importBody.other", {
                      version: v1.version,
                      home: v1.home,
                      projects: v1.projects,
                    })
                  : t(v1.projects === 1 ? "setup.welcome.importNoVersion.one" : "setup.welcome.importNoVersion.other", {
                      home: v1.home,
                      projects: v1.projects,
                    })}
              </span>
            </button>
          </div>
        ) : (
          <Button id="welcome-start" size="lg" onClick={() => begin("new")}>
            {t(JUST_INSTALLED ? "setup.next" : "setup.welcome.start")}
          </Button>
        )}
        {ask && (
          <div className="wiz__share">
            <Checkbox
              checked={share}
              onCheckedChange={setShare}
              label={t("telemetry.check")}
              description={
                <>
                  {t("telemetry.checkHint")}{" "}
                  <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
                    {t("telemetry.whatIsSent")}
                  </a>
                </>
              }
            />
          </div>
        )}
        <span className="wiz__waiting">
          <AgentAvatar
            name={v1?.agent_name ?? agent?.name ?? "crew"}
            blob={v1?.agent_blob ?? agent?.blob ?? "ovni"}
            size={24}
            animated={false}
          />
          <b>{v1?.agent_name ?? agent?.name}</b>
          <span className="is-mono">{t("setup.welcome.waiting")}</span>
          <span className="wiz__dots">•••</span>
        </span>
      </div>
    </div>
  );
}

export const GROUP: Record<V1Group, { label: MessageKey; body: MessageKey; icon: typeof Icons.Bot }> = {
  projects: { label: "setup.v1.projects", body: "setup.v1.projectsBody", icon: Icons.Folder },
  skills: { label: "setup.v1.skills", body: "setup.v1.skillsBody", icon: Icons.Sparkles },
  keys: { label: "setup.v1.keys", body: "setup.v1.keysBody", icon: Icons.KeyRound },
  vars: { label: "setup.v1.vars", body: "setup.v1.varsBody", icon: Icons.Lock },
  mcps: { label: "setup.v1.mcps", body: "setup.v1.mcpsBody", icon: Icons.Plug },
  memory: { label: "setup.v1.memory", body: "setup.v1.memoryBody", icon: Icons.Brain },
  chats: { label: "setup.v1.chats", body: "setup.v1.chatsBody", icon: Icons.MessageCircle },
  identity: { label: "setup.v1.identity", body: "setup.v1.identityBody", icon: Icons.User },
  embeddings: { label: "setup.v1.embeddings", body: "setup.v1.embeddingsBody", icon: Icons.Search },
  services: { label: "setup.v1.services", body: "setup.v1.servicesBody", icon: Icons.Image },
  channels: { label: "setup.v1.channels", body: "setup.v1.channelsBody", icon: Icons.Send },
  tasks: { label: "setup.v1.tasks", body: "setup.v1.tasksBody", icon: Icons.ListChecks },
  commitments: { label: "setup.v1.commitments", body: "setup.v1.commitmentsBody", icon: Icons.Calendar },
  routines: { label: "setup.v1.routines", body: "setup.v1.routinesBody", icon: Icons.Clock },
};

/** What v1 has, one row per part, each on unless the owner turns it off. */
export function ImportStep({ home, scan, draft: d, set }: StepProps & { home: string; scan: V1Groups | undefined }) {
  const t = useT();
  const count = (g: V1Groups[number]) =>
    g.id === "projects"
      ? t("setup.v1.projectsCount", { n: g.count, agents: g.detail ?? "0" })
      : g.id === "chats"
        ? t("setup.v1.chatsCount", { n: g.count, messages: g.detail ?? "0" })
        : g.id === "embeddings" || g.id === "identity"
          ? (g.detail ?? "—")
          : g.id === "channels"
            ? g.count
              ? "Telegram"
              : "—"
            : g.count.toLocaleString();
  return (
    <>
      <StepHead kicker="setup.import.kicker" title={t("setup.import.title")} end={t("setup.import.titleMuted")}>
        {t("setup.import.body", { home })}
      </StepHead>
      {!scan ? (
        <Skeleton height={320} />
      ) : (
        <div className="wiz__card wiz__rows">
          {scan.map((g) => {
            const G = GROUP[g.id];
            const empty = g.count === 0;
            return (
              <div key={g.id} className={`wiz__row${empty ? " is-empty" : ""}`}>
                <span className="wiz__rowicon">
                  <G.icon size={14} />
                </span>
                <span className="wiz__rowmain">
                  <span className="wiz__rowname">
                    {t(G.label)} <span className="is-muted">{count(g)}</span>
                  </span>
                  <span className="wiz__rowbody">{t(G.body)}</span>
                </span>
                <Switch
                  size="sm"
                  aria-label={t(G.label)}
                  disabled={empty}
                  checked={!empty && d.importOn[g.id] !== false}
                  onCheckedChange={(on) => set({ importOn: { ...d.importOn, [g.id]: on } })}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

/** The super-agent's name and face. */
export function AgentStep({ draft: d, set }: StepProps) {
  const t = useT();
  return (
    <>
      <StepHead kicker="setup.agent.kicker" title={t("setup.agent.title")} end={t("setup.agent.titleMuted")}>
        {t("setup.agent.body")}
      </StepHead>
      <div className="wiz__field">
        <span>{t("setup.agent.name")}</span>
        <Input
          className="wiz__name"
          aria-label={t("setup.agent.name")}
          placeholder={t("setup.agent.namePlaceholder")}
          value={d.name}
          maxLength={80}
          onChange={(e) => set({ name: e.currentTarget.value })}
          trailing={
            <IconButton
              size="sm"
              label={t("setup.agent.randomName")}
              icon={<Icons.Dices size={16} />}
              onClick={() => set({ name: randomAgentName(d.name.trim()) })}
            />
          }
        />
      </div>
      <div className="wiz__field">
        <span>{t("setup.agent.blobs", { n: BLOB_NAMES.length })}</span>
        <div className="wiz__blobs">
          {BLOB_NAMES.map((b) => (
            <button
              key={b}
              type="button"
              aria-label={b}
              aria-pressed={d.blob === b}
              className={`wiz__blob${d.blob === b ? " is-on" : ""}`}
              onClick={() => set({ blob: b })}
            >
              <AgentAvatar name={b} blob={b} size={36} animated={false} />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
