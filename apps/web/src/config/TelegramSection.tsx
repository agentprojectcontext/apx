import type { ChannelInfo } from "@apx/protocol";
import { Badge, Button, Icons, Input, SettingRow, Switch } from "@apx/ui";
import { useEffect, useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { AgentSelect } from "../common/pickers/AgentSelect.tsx";
import { type ChannelDraft, loadChannels, saveChannel, useChannels } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { useT } from "../i18n/index.ts";
import { Behavior, Deliveries, Notices, Pairing, People, STATUS } from "./ChannelParts.tsx";

const CHANNEL_ID = "telegram";

/** Telegram: connect a bot, choose who answers, approve who may write, see what was sent. */
export function TelegramSection() {
  const channels = useChannels((s) => s.channels);
  const ready = useChannels((s) => s.ready);
  useEffect(() => {
    void loadChannels();
    const id = setInterval(() => void loadChannels(), 5000);
    return () => clearInterval(id);
  }, []);
  const channel = channels.find((c) => c.type === "telegram");
  return (
    <>
      {ready && (channel ? <Connected channel={channel} /> : <Setup />)}
      {channel && <Pairing channelId={channel.id} itsMe />}
      {channel && <Notices />}
      {channel && <People channelId={channel.id} />}
      {channel && <Deliveries channelId={channel.id} />}
    </>
  );
}

function Setup() {
  const t = useT();
  const agents = useData((s) => s.agents);
  const secretary = Object.values(agents).find((a) => a.kind === "secretary");
  const [token, setToken] = useState("");
  const [agent, setAgent] = useState(secretary?.id ?? "roby");
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    await saveChannel(
      CHANNEL_ID,
      { agent_id: agent, enabled: true, strangers: "pair", concurrency: "queue", owner_thread: "home" },
      token.trim(),
    );
    setBusy(false);
  };
  return (
    <div className="tgsetup">
      <ol className="tgsetup__steps">
        <li>{t("tg.step1")}</li>
        <li>{t("tg.step2")}</li>
        <li>{t("tg.step3")}</li>
      </ol>
      <div className="pform__field">
        <span className="pform__label">{t("tg.token")}</span>
        <Input
          aria-label={t("tg.token")}
          type="password"
          autoComplete="off"
          placeholder="123456789:AA…"
          value={token}
          onChange={(e) => setToken(e.currentTarget.value)}
        />
        <span className="pform__hint">{t("tg.tokenHint")}</span>
      </div>
      <SettingRow title={t("tg.agent")} description={t("tg.agentHint", { channel: "Telegram" })}>
        <AgentSelect size="sm" className="tgagent" value={agent} onChange={(id) => id && setAgent(id)} />
      </SettingRow>
      <div>
        <Button disabled={!TOKEN.test(token.trim())} loading={busy} onClick={() => void connect()}>
          {t("tg.connect")}
        </Button>
      </div>
    </div>
  );
}

/** What BotFather hands out: the bot's number, a colon and its secret. */
const TOKEN = /^\d+:[\w-]{20,}$/;

/** Paste a new bot token: the core stores it and starts the bot again at once. */
function TokenField({
  channel,
  onSave,
  onCancel,
}: {
  channel: ChannelInfo;
  onSave(token: string): Promise<boolean>;
  onCancel?(): void;
}) {
  const t = useT();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = TOKEN.test(token.trim());
  const save = async () => {
    if (!ok) return;
    setBusy(true);
    const done = await onSave(token.trim());
    setBusy(false);
    if (!done) return;
    setToken("");
    notify(t("tg.tokenSaved"), "info");
    onCancel?.();
  };
  return (
    <div className="tgtoken">
      <Input
        aria-label={t("tg.token")}
        type="password"
        autoComplete="off"
        autoFocus={Boolean(onCancel)}
        placeholder={channel.token_set ? t("tg.tokenNew") : "123456789:AA…"}
        value={token}
        onChange={(e) => setToken(e.currentTarget.value)}
        onKeyDown={(e) => e.key === "Enter" && void save()}
      />
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
      )}
      <Button size="sm" variant="secondary" disabled={!ok} loading={busy} onClick={() => void save()}>
        {t("common.save")}
      </Button>
    </div>
  );
}

/** The stored token, masked, with "Change token"; the field shows only when asked for. */
function StoredToken({ channel, onSave }: { channel: ChannelInfo; onSave(token: string): Promise<boolean> }) {
  const t = useT();
  const [changing, setChanging] = useState(false);
  if (changing) return <TokenField channel={channel} onSave={onSave} onCancel={() => setChanging(false)} />;
  return (
    <div className="tgtoken">
      <code className="tgtoken__hint">{channel.token_hint ?? "••••"}</code>
      <Button size="sm" variant="secondary" leadingIcon={<Icons.Pencil size={14} />} onClick={() => setChanging(true)}>
        {t("tg.tokenChangeButton")}
      </Button>
    </div>
  );
}

function Connected({ channel }: { channel: ChannelInfo }) {
  const t = useT();
  // A refused or missing token is fixed right where the error shows, not at the bottom of the page.
  const fixToken = channel.status === "error" || !channel.token_set;
  const draft: ChannelDraft = {
    agent_id: channel.agent_id,
    enabled: channel.enabled,
    strangers: channel.strangers,
    concurrency: channel.concurrency,
    owner_thread: channel.owner_thread,
  };
  const save = (patch: Partial<ChannelDraft>, newToken?: string) =>
    saveChannel(channel.id, { ...draft, ...patch }, newToken);
  return (
    <>
      <div className="pcard tgcard">
        <div className="pcard__top">
          <span className={`tgcard__tile${channel.status === "running" ? "" : " is-idle"}`}>
            <KindTile kind="telegram" />
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
            <TokenField channel={channel} onSave={(token) => save({}, token)} />
          </div>
        )}
      </div>

      <Behavior channel={channel} save={save} />
      {!fixToken && (
        <SettingRow title={t("tg.token")} description={t("tg.tokenStored")}>
          <StoredToken channel={channel} onSave={(token) => save({}, token)} />
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
