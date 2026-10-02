import type { Agent } from "@apx/protocol";
import { AgentAvatar, Button, Dialog, EngineIcon, IconButton, Icons, Menu } from "@apx/ui";
import { useState } from "react";
import { AgentModelPicker } from "../../config/models/AgentModelPicker.tsx";
import { setAgentBrowserProfile } from "../../data/actions.ts";
import { PROFILE_KEY } from "../../data/engines.ts";
import { blobOf } from "../../data/identity.ts";
import { setAgentParent } from "../../data/team.ts";
import { useT } from "../../i18n/index.ts";
import { engineOf } from "./useTeamInfo.tsx";

const PROFILES = ["shared", "isolated", "incognito"] as const;

/** The selected agent beside the canvas: who it is, who it reports to (with confirmation), model and browser. */
export function AgentDetail({
  agent,
  team,
  onClose,
  onChat,
}: {
  agent: Agent;
  team: Agent[];
  onClose(): void;
  onChat(): void;
}) {
  const t = useT();
  const [pending, setPending] = useState<string>();
  const fromFile = agent.source === "apc" && Boolean(agent.slug);
  // Its own reports cannot become its parent: the core refuses loops, the list does not offer them.
  const below = new Set<string>();
  const walk = (slug: string | undefined) => {
    for (const a of team)
      if (slug && a.parent === slug && a.slug && !below.has(a.slug)) {
        below.add(a.slug);
        walk(a.slug);
      }
  };
  walk(agent.slug);
  const parents = team.filter((a) => a.slug && a.id !== agent.id && !below.has(a.slug));
  const nameOf = (slug: string | undefined) => team.find((a) => a.slug === slug)?.name ?? t("team.parent.none");

  return (
    <aside className="teamdetail" aria-label={agent.name}>
      <header className="teamdetail__head">
        <AgentAvatar name={agent.name} blob={blobOf(agent)} size={40} animated={false} />
        <div className="teamdetail__names">
          <div className="teamdetail__name">{agent.name}</div>
          <div className="teamdetail__slug">{agent.slug ?? agent.id}</div>
        </div>
        <IconButton size="sm" label={t("common.close")} icon={<Icons.X size={14} />} onClick={onClose} />
      </header>
      {agent.role && <div className="teamdetail__role">{agent.role}</div>}
      {agent.description && <p className="teamdetail__desc">{agent.description}</p>}
      <Button size="sm" leadingIcon={<Icons.MessageCircle size={14} />} onClick={onChat}>
        {t("team.chatWith", { name: agent.name })}
      </Button>

      <dl className="teamdetail__facts">
        <dt>{t("team.parent")}</dt>
        <dd>
          {fromFile ? (
            <Pick
              label={t("team.parent")}
              text={nameOf(agent.parent)}
              options={[
                { value: "", text: t("team.parent.none") },
                ...parents.map((p) => ({ value: p.slug ?? "", text: p.name })),
              ]}
              value={agent.parent ?? ""}
              onPick={(v) => v !== (agent.parent ?? "") && setPending(v)}
            />
          ) : (
            <span className="teamdetail__muted">{t("team.parent.global")}</span>
          )}
        </dd>
        {agent.area && (
          <>
            <dt>{t("team.area")}</dt>
            <dd>{agent.area}</dd>
          </>
        )}
        <dt>{t("team.engine")}</dt>
        <dd className="teamdetail__engine">
          <EngineIcon engine={engineOf(agent)} size={14} />
          <AgentModelPicker agent={agent} chip />
        </dd>
        <dt>{t("team.browserProfile")}</dt>
        <dd>
          <Pick
            label={t("team.browserProfile")}
            text={t(PROFILE_KEY[agent.browser_profile])}
            options={PROFILES.map((p) => ({ value: p, text: t(PROFILE_KEY[p]) }))}
            value={agent.browser_profile}
            onPick={(v) => void setAgentBrowserProfile(agent.id, v as (typeof PROFILES)[number])}
          />
        </dd>
        {fromFile && (
          <>
            <dt>{t("team.file")}</dt>
            <dd className="teamdetail__mono">.apc/agents/{agent.slug}.md</dd>
          </>
        )}
      </dl>

      {pending !== undefined && (
        <Dialog
          open
          onOpenChange={(o) => !o && setPending(undefined)}
          title={t("team.parent.confirmTitle")}
          footer={
            <>
              <Button variant="secondary" onClick={() => setPending(undefined)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => {
                  const to = pending;
                  setPending(undefined);
                  void setAgentParent(agent.id, to);
                }}
              >
                {t("team.parent.confirm")}
              </Button>
            </>
          }
        >
          <p className="teamdetail__confirm">
            {t("team.parent.confirmBody", {
              name: agent.name,
              from: nameOf(agent.parent),
              to: nameOf(pending || undefined),
              file: `.apc/agents/${agent.slug}.md`,
            })}
          </p>
        </Dialog>
      )}
    </aside>
  );
}

/** A select-like button over a menu of options (the panel's pickers look the same). */
function Pick(props: {
  label: string;
  text: string;
  value: string;
  options: Array<{ value: string; text: string }>;
  onPick(value: string): void;
}) {
  return (
    <Menu
      align="start"
      items={props.options.map((o) => ({
        label: o.text,
        icon: o.value === props.value ? <Icons.Check /> : <span />,
        onSelect: () => props.onPick(o.value),
      }))}
      trigger={
        <button type="button" className="selectbtn" aria-label={props.label}>
          <span className="selectbtn__text">{props.text}</span>
          <Icons.ChevronDown size={12} />
        </button>
      }
    />
  );
}
