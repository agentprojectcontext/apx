import type { ChannelInfo } from "@apx/protocol";
import { Button, Icons, Input, SettingRow, Textarea } from "@apx/ui";
import { useState } from "react";
import { PublicAddress } from "../../config/PublicAddress.tsx";
import { notify } from "../../data/notices.ts";
import { type MessageKey, useT } from "../../i18n/index.ts";
import { ConnectionCard, OwnerLink } from "./parts.tsx";
import type { Create, PaneProps } from "./types.ts";

export type BotKind =
  | "telegram"
  | "discord"
  | "slack"
  | "matrix"
  | "mattermost"
  | "signal"
  | "googlechat"
  | "sms"
  | "ntfy"
  | "nextcloud"
  | "irc"
  | "twitch"
  | "teams"
  | "line";

/**
 * One field of the secret; `plain` ones (a server's address, a number) are not hidden as they are typed, `multiline`
 * ones take a pasted file (a JSON key).
 */
type TokenSpec = { label: MessageKey; placeholder: string; pattern: RegExp; plain?: boolean; multiline?: boolean };

/**
 * What each bot channel needs: the steps to make the bot, and its token(s). Slack takes two (the bot's and the app's,
 * for Socket Mode), stored together as one secret.
 */
/** An Azure app's or tenant's id. */
const GUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

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
  googlechat: {
    name: "Google Chat",
    steps: ["gc.step1", "gc.step2", "gc.step3", "gc.step4"],
    tokens: [
      {
        label: "gc.subscription",
        placeholder: "projects/acme/subscriptions/apx-chat",
        pattern: /^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/,
        plain: true,
      },
      {
        label: "gc.key",
        placeholder: '{ "type": "service_account", … }',
        pattern: /^\{[\s\S]*"private_key"[\s\S]*\}$/,
        multiline: true,
      },
    ],
  },
  sms: {
    name: "SMS",
    steps: ["sms.step1", "sms.step2", "sms.step3"],
    tokens: [
      { label: "sms.sid", placeholder: "AC0123…", pattern: /^AC[0-9a-fA-F]{32}$/, plain: true },
      { label: "sms.token", placeholder: "abc123…", pattern: /^[A-Za-z0-9]{16,}$/ },
      { label: "sg.number", placeholder: "+15550001111", pattern: /^\+[1-9]\d{6,14}$/, plain: true },
    ],
  },
  ntfy: {
    name: "ntfy",
    steps: ["nt.step1", "nt.step2", "nt.step3"],
    tokens: [
      { label: "nt.server", placeholder: "https://ntfy.sh", pattern: /^https?:\/\/\S+$/, plain: true },
      { label: "nt.topic", placeholder: "apx-7f3k9q2m8x", pattern: /^[-_A-Za-z0-9]{1,64}$/, plain: true },
      { label: "nt.token", placeholder: "tk_…", pattern: /^(tk_\S+)?$/ },
    ],
  },
  nextcloud: {
    name: "Nextcloud Talk",
    steps: ["nc.step1", "nc.step2", "nc.step3"],
    tokens: [
      { label: "mm.server", placeholder: "https://cloud.example.org", pattern: /^https?:\/\/\S+$/, plain: true },
      { label: "nc.user", placeholder: "apx-bot", pattern: /^\S+$/, plain: true },
      { label: "nc.password", placeholder: "xxxxx-xxxxx-…", pattern: /^\S{8,}$/ },
    ],
  },
  irc: {
    name: "IRC",
    steps: ["irc.step1", "irc.step2", "irc.step3"],
    tokens: [
      { label: "mm.server", placeholder: "ircs://irc.libera.chat:6697", pattern: /^ircs?:\/\/\S+$/, plain: true },
      {
        label: "irc.nick",
        placeholder: "acme-bot",
        pattern: /^[A-Za-z[\]\\`_^{|}][\w[\]\\`^{|}-]{0,29}$/,
        plain: true,
      },
      { label: "irc.password", placeholder: "", pattern: /^\S*$/ },
    ],
  },
  twitch: {
    name: "Twitch",
    steps: ["tw.step1", "tw.step2", "tw.step3"],
    tokens: [
      { label: "tw.login", placeholder: "acme_bot", pattern: /^\w{3,25}$/, plain: true },
      { label: "tw.token", placeholder: "oauth:…", pattern: /^(oauth:)?\w{20,}$/ },
      { label: "tw.channel", placeholder: "#acme", pattern: /^#?\w{3,25}$/, plain: true },
    ],
  },
  teams: {
    name: "Microsoft Teams",
    steps: ["tm.step1", "tm.step2", "tm.step3", "tm.step4", "tm.step5"],
    tokens: [
      { label: "tm.appId", placeholder: "00000000-0000-0000-0000-000000000000", pattern: GUID, plain: true },
      { label: "tm.secret", placeholder: "abc8Q~…", pattern: /^\S{8,}$/ },
      { label: "tm.tenant", placeholder: "00000000-0000-0000-0000-000000000000", pattern: GUID, plain: true },
    ],
  },
  line: {
    name: "LINE",
    steps: ["ln.step1", "ln.step2", "ln.step3", "ln.step4"],
    tokens: [
      { label: "ln.secret", placeholder: "0123456789abcdef…", pattern: /^[0-9a-fA-F]{32}$/ },
      { label: "ln.token", placeholder: "eyJhbGciOi…", pattern: /^[A-Za-z0-9+/=._-]{40,}$/ },
    ],
  },
};

/** Kinds that deliver only to a webhook: their screen shows the public address to paste into the platform. */
const WEBHOOK_KINDS: readonly BotKind[] = ["teams", "line"];

/** Kinds whose single owner writes from a place only they know (an ntfy topic): that place is the owner. */
const SELF_OWNER: readonly BotKind[] = ["ntfy"];

export const isBotKind = (k: string): k is BotKind => Object.hasOwn(BOTS, k);
/** How to make a kind's bot and the token(s) it takes (the setup connects Discord and Slack with it too). */
export const botSpec = (kind: BotKind) => BOTS[kind];

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
    // An optional field left empty adds nothing.
    joined: values
      .map((v) => v.trim())
      .filter(Boolean)
      .join(" "),
  };
}

/** A new bot account: how to make the bot, its token(s), and Connect, which makes the account with them. */
export function BotConnect({ kind, create }: { kind: BotKind; create: Create }) {
  const t = useT();
  const tokens = useTokens(kind);
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    await create(SELF_OWNER.includes(kind) ? { self_owner: true } : {}, tokens.joined);
    setBusy(false);
  };
  return (
    <>
      <div className="tgsetup">
        <ol className="tgsetup__steps">
          {BOTS[kind].steps.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ol>
        {tokens.specs.map((spec, i) => (
          <div className="pform__field" key={spec.label}>
            <span className="pform__label">{t(spec.label)}</span>
            <TokenInput spec={spec} value={tokens.values[i] ?? ""} onChange={(v) => tokens.set(i, v)} />
            {i === tokens.specs.length - 1 && <span className="pform__hint">{t("tg.tokenHint")}</span>}
          </div>
        ))}
        <div>
          <Button disabled={!tokens.ok} loading={busy} onClick={() => void connect()}>
            {t("acct.connect")}
          </Button>
        </div>
      </div>
      {/* The account's own address shows once it is made: its id is the core's to give. */}
      {WEBHOOK_KINDS.includes(kind) && <PublicAddress />}
    </>
  );
}

/** One field of a kind's secret: hidden as it is typed unless plain; a pasted file (JSON key) gets a text area. */
function TokenInput({
  spec,
  value,
  onChange,
  placeholder = spec.placeholder,
  autoFocus,
  onEnter,
}: {
  spec: TokenSpec;
  value: string;
  onChange(v: string): void;
  placeholder?: string;
  autoFocus?: boolean;
  onEnter?(): void;
}) {
  const t = useT();
  if (spec.multiline)
    return (
      <Textarea
        aria-label={t(spec.label)}
        className="tgtoken__key"
        rows={4}
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    );
  return (
    <Input
      aria-label={t(spec.label)}
      type={spec.plain ? "text" : "password"}
      autoComplete="off"
      autoFocus={autoFocus}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      onKeyDown={(e) => e.key === "Enter" && onEnter?.()}
    />
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
        <TokenInput
          key={spec.label}
          spec={spec}
          autoFocus={Boolean(onCancel) && i === 0}
          placeholder={channel.token_set ? `${t("tg.tokenNew")} (${spec.placeholder})` : spec.placeholder}
          value={tokens.values[i] ?? ""}
          onChange={(v) => tokens.set(i, v)}
          onEnter={() => void save()}
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

/** A bot's connection: its state, its token (fixed right where an error shows), and the address webhooks reach. */
export function BotAccount({ kind, ...pane }: PaneProps & { kind: BotKind }) {
  const t = useT();
  const { channel, saveNow } = pane;
  const name = BOTS[kind].name;
  // A refused or missing token is fixed right where the error shows, not at the bottom of the page.
  const fixToken = channel.status === "error" || !channel.token_set;
  return (
    <>
      <ConnectionCard {...pane}>
        {fixToken && (
          <div className="tgcard__fix">
            <span className="tgcard__fixlabel">{t(channel.token_set ? "tg.tokenFix" : "tg.tokenMissing")}</span>
            <TokenField channel={channel} kind={kind} onSave={saveNow} />
          </div>
        )}
      </ConnectionCard>
      {!fixToken && (
        <SettingRow title={t("tg.token")} description={t("tg.tokenStored")}>
          <StoredToken channel={channel} kind={kind} onSave={saveNow} />
        </SettingRow>
      )}
      <OwnerLink channelId={channel.id} type={channel.type} name={name} />
      {WEBHOOK_KINDS.includes(kind) && <PublicAddress channelId={channel.id} />}
    </>
  );
}
