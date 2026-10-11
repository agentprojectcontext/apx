import type { ChannelInfo } from "@apx/protocol";
import { Badge, Button, Icons, Input, SettingRow, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { type ChannelDraft, loadChannels, saveChannel, useChannels } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";
import { Behavior, Deliveries, Notices, Pairing, People, STATUS } from "./ChannelParts.tsx";
import { RoomsSection } from "./RoomsSection.tsx";

export type BotKind = "telegram" | "discord" | "slack" | "matrix" | "mattermost" | "signal";

/** One field of the secret; `plain` ones (a server's address, a number) are not hidden as they are typed. */
type TokenSpec = { label: MessageKey; placeholder: string; pattern: RegExp; plain?: boolean };

/**
 * What each bot channel needs: the steps to make the bot, and its token(s). Slack takes two (the bot's and the app's,
 * for Socket Mode), stored together as one secret.
 */
const BOTS: Record<BotKind, { name: string; steps: MessageKey[]; tokens: TokenSpec[] }> = {
  telegram: {
    name: "Telegram",
    steps: ["tg.step1", "tg.step2", "tg.step3"],
    // What BotFather hands out: the bot's number, a colon and its secret.
    tokens: [{ label: "tg.token", placeholder: "123456789:AA…", pattern: /^\d+:[\w-]{20,}$/ }],
  },
  discord: {
    name: "Discord",
    steps: ["dc.step1", "dc.step2", "dc.step3", "dc.step4"],
    tokens: [{ label: "tg.token", placeholder: "MTA…", pattern: /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/ }],
  },
  slack: {
    name: "Slack",
    steps: ["sl.step1", "sl.step2", "sl.step3", "sl.step4"],
    tokens: [
      { label: "sl.botToken", placeholder: "xoxb-…", pattern: /^xoxb-[\w-]{10,}$/ },
      { label: "sl.appToken", placeholder: "xapp-…", pattern: /^xapp-[\w-]{10,}$/ },
    ],
  },
  matrix: {
    name: "Matrix",
    steps: ["mx.step1", "mx.step2", "mx.step3"],
    tokens: [
      { label: "mx.server", placeholder: "https://matrix.example.org", pattern: /^https?:\/\/\S+$/, plain: true },
      { label: "mx.token", placeholder: "syt_…", pattern: /^\S{16,}$/ },
    ],
  },
  mattermost: {
    name: "Mattermost",
    steps: ["mm.step1", "mm.step2", "mm.step3"],
    tokens: [
      { label: "mm.server", placeholder: "https://chat.example.org", pattern: /^https?:\/\/\S+$/, plain: true },
      { label: "tg.token", placeholder: "abc123…", pattern: /^[a-z0-9]{20,}$/ },
    ],
  },
  signal: {
    name: "Signal",
    steps: ["sg.step1", "sg.step2", "sg.step3"],
    tokens: [
      { label: "sg.daemon", placeholder: "http://127.0.0.1:8080", pattern: /^https?:\/\/\S+$/, plain: true },
      { label: "sg.number", placeholder: "+15550001111", pattern: /^\+\d{6,15}$/, plain: true },
    ],
  },
};

export const isBotKind = (k: string): k is BotKind => Object.hasOwn(BOTS, k);
/** How to make a kind's bot and the token(s) it takes (the setup connects Discord and Slack with it too). */
export const botSpec = (kind: BotKind) => BOTS[kind];

/** A bot channel (Telegram, Discord, Slack): connect it, choose who answers, approve who may write, see what went out. */
export function BotSection({ kind }: { kind: BotKind }) {
  const t = useT();
  const channels = useChannels((s) => s.channels);
  const ready = useChannels((s) => s.ready);
  useEffect(() => {
    void loadChannels();
    const id = setInterval(() => void loadChannels(), 5000);
    return () => clearInterval(id);
  }, []);
  const channel = channels.find((c) => c.type === kind);
  const name = BOTS[kind].name;
  return (
    <>
      {ready && (channel ? <Connected channel={channel} kind={kind} /> : <Setup kind={kind} />)}
      {channel && (
        <Pairing
          channelId={channel.id}
          itsMe={{ title: t("tg.itsMe", { channel: name }), hint: t("tg.itsMeHint", { channel: name }) }}
        />
      )}
      {channel && <Notices />}
      {channel && <People channelId={channel.id} />}
      {channel && <Deliveries channelId={channel.id} />}
    </>
  );
}

/** The token fields of a kind, as one value ("xoxb-… xapp-…" for Slack) once every field holds a valid token. */
export function useTokens(kind: BotKind) {
  const specs = BOTS[kind].tokens;
  const [values, setValues] = useState<string[]>(() => specs.map(() => ""));
  const ok = specs.every((s, i) => s.pattern.test((values[i] ?? "").trim()));
  return {
    specs,
    values,
    set: (i: number, v: string) => setValues((cur) => cur.map((x, j) => (j === i ? v : x))),
    clear: () => setValues(specs.map(() => "")),
    ok,
    joined: values.map((v) => v.trim()).join(" "),
  };
}

function Setup({ kind }: { kind: BotKind }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const secretary = Object.values(agents).find((a) => a.kind === "secretary");
  const tokens = useTokens(kind);
  const [agent, setAgent] = useState(secretary?.id ?? "roby");
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    await saveChannel(
      kind,
      { agent_id: agent, enabled: true, strangers: "pair", concurrency: "steer", owner_thread: "home" },
      tokens.joined,
    );
    setBusy(false);
  };
  return (
    <div className="tgsetup">
      <ol className="tgsetup__steps">
        {BOTS[kind].steps.map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ol>
      {tokens.specs.map((spec, i) => (
        <div className="pform__field" key={spec.label}>
          <span className="pform__label">{t(spec.label)}</span>
          <Input
            aria-label={t(spec.label)}
            type={spec.plain ? "text" : "password"}
            autoComplete="off"
            placeholder={spec.placeholder}
            value={tokens.values[i]}
            onChange={(e) => tokens.set(i, e.currentTarget.value)}
          />
          {i === tokens.specs.length - 1 && <span className="pform__hint">{t("tg.tokenHint")}</span>}
        </div>
      ))}
      <SettingRow title={t("tg.agent")} description={t("tg.agentHint", { channel: BOTS[kind].name })}>
        <AgentSelect size="sm" className="tgagent" value={agent} onChange={(id) => id && setAgent(id)} />
      </SettingRow>
      <div>
        <Button disabled={!tokens.ok} loading={busy} onClick={() => void connect()}>
          {t("tg.connect")}
        </Button>
      </div>
    </div>
  );
}

/** Paste new token(s): the core stores them and starts the bot again at once. */
function TokenField({
  channel,
  kind,
  onSave,
  onCancel,
}: {
  channel: ChannelInfo;
  kind: BotKind;
  onSave(token: string): Promise<boolean>;
  onCancel?(): void;
}) {
  const t = useT();
  const tokens = useTokens(kind);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!tokens.ok) return;
    setBusy(true);
    const done = await onSave(tokens.joined);
    setBusy(false);
    if (!done) return;
    tokens.clear();
    notify(t("tg.tokenSaved"), "info");
    onCancel?.();
  };
  return (
    <div className="tgtoken">
      {tokens.specs.map((spec, i) => (
        <Input
          key={spec.label}
          aria-label={t(spec.label)}
          type={spec.plain ? "text" : "password"}
          autoComplete="off"
          autoFocus={Boolean(onCancel) && i === 0}
          placeholder={channel.token_set ? `${t("tg.tokenNew")} (${spec.placeholder})` : spec.placeholder}
          value={tokens.values[i]}
          onChange={(e) => tokens.set(i, e.currentTarget.value)}
          onKeyDown={(e) => e.key === "Enter" && void save()}
        />
      ))}
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      )}
      <Button size="sm" variant="secondary" disabled={!tokens.ok} loading={busy} onClick={() => void save()}>
        {t("common.save")}
      </Button>
    </div>
  );
}

/** The stored token, masked, with "Change token"; the field shows only when asked for. */
function StoredToken({
  channel,
  kind,
  onSave,
}: {
  channel: ChannelInfo;
  kind: BotKind;
  onSave(token: string): Promise<boolean>;
}) {
  const t = useT();
  const [changing, setChanging] = useState(false);
  if (changing) return <TokenField channel={channel} kind={kind} onSave={onSave} onCancel={() => setChanging(false)} />;
  return (
    <div className="tgtoken">
      <code className="tgtoken__hint">{channel.token_hint ?? "••••"}</code>
      <Button size="sm" variant="secondary" leadingIcon={<Icons.Pencil size={14} />} onClick={() => setChanging(true)}>
        {t("tg.tokenChangeButton")}
      </Button>
    </div>
  );
}

function Connected({ channel, kind }: { channel: ChannelInfo; kind: BotKind }) {
  const t = useT();
  // A refused or missing token is fixed right where the error shows, not at the bottom of the page.
  const fixToken = channel.status === "error" || !channel.token_set;
  const draft: ChannelDraft = {
    agent_id: channel.agent_id,
    enabled: channel.enabled,
    strangers: channel.strangers,
    concurrency: channel.concurrency,
    owner_thread: channel.owner_thread,
    ...(channel.rooms ? { rooms: channel.rooms } : {}),
    closers: channel.closers,
    research: channel.research,
  };
  const save = (patch: Partial<ChannelDraft>, newToken?: string) =>
    saveChannel(channel.id, { ...draft, ...patch }, newToken);
  return (
    <>
      <div className="pcard tgcard">
        <div className="pcard__top">
          <span className={`tgcard__tile${channel.status === "running" ? "" : " is-idle"}`}>
            <KindTile kind={kind} />
          </span>
          <div className="pcard__titles">
            <div className="pcard__name">{channel.account ?? channel.label}</div>
            <div className="pcard__id">{t(`tg.status.${channel.status}`)}</div>
          </div>
          <Badge tone={STATUS[channel.status]} dot>
            {channel.enabled ? t(`tg.status.${channel.status}`) : t("providers.off")}
          </Badge>
          <Switch
            size="sm"
            checked={channel.enabled}
            onCheckedChange={(on) => void save({ enabled: on })}
            label={t("providers.on")}
          />
        </div>
        {channel.error && <div className="tgcard__error">{channel.error}</div>}
        {fixToken && (
          <div className="tgcard__fix">
            <span className="tgcard__fixlabel">{t(channel.token_set ? "tg.tokenFix" : "tg.tokenMissing")}</span>
            <TokenField channel={channel} kind={kind} onSave={(token) => save({}, token)} />
          </div>
        )}
      </div>

      <Behavior channel={channel} save={save} />
      {kind === "discord" && <RoomsSection channel={channel} save={(rooms) => save({ rooms })} />}
      {!fixToken && (
        <SettingRow title={t("tg.token")} description={t("tg.tokenStored")}>
          <StoredToken channel={channel} kind={kind} onSave={(token) => save({}, token)} />
        </SettingRow>
      )}
      <div className="tgremove">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Icons.Trash2 size={14} />}
          onClick={() => void saveChannel(channel.id, null)}
        >
          {t("tg.remove")}
        </Button>
      </div>
    </>
  );
}
