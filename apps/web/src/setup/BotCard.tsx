import { Badge, Button, Input } from "@apx/ui";
import { useState } from "react";
import { KindTile } from "../channels/KindIcon.tsx";
import { botSpec, useTokens } from "../config/BotSection.tsx";
import { saveChannel, useChannels } from "../data/channels.ts";
import { notify } from "../data/notices.ts";
import { useData } from "../data/state.ts";
import { type MessageKey, useT } from "../i18n/index.ts";

/** A bot channel connected from the setup (Discord, Slack): its token(s), Connect, and how to make the bot. */
export function BotCard({ kind, line, body }: { kind: "discord" | "slack"; line: MessageKey; body: MessageKey }) {
  const t = useT();
  const agents = useData((s) => s.agents);
  const channel = useChannels((s) => s.channels.find((c) => c.type === kind));
  const spec = botSpec(kind);
  const tokens = useTokens(kind);
  const [busy, setBusy] = useState(false);
  const [howTo, setHowTo] = useState(false);
  const connect = async () => {
    const boss = Object.values(agents).find((a) => a.kind === "secretary");
    if (!boss) return;
    setBusy(true);
    const ok = await saveChannel(
      kind,
      { agent_id: boss.id, enabled: true, strangers: "pair", concurrency: "steer", owner_thread: "home" },
      tokens.joined,
    );
    setBusy(false);
    if (ok) {
      tokens.clear();
      notify(t("tg.tokenSaved"), "info");
    }
  };
  return (
    <div className={`wiz__engine${channel?.token_set ? " is-on" : ""}`}>
      <div className="wiz__enginehead">
        <KindTile kind={kind} size={34} />
        <span className="wiz__enginetitles">
          <b className="is-mono">{spec.name.toUpperCase()}</b>
          <span>{t(line)}</span>
        </span>
        {channel?.token_set && (
          <Badge tone="brand" dot>
            {channel.account ?? t("setup.channels.connected")}
          </Badge>
        )}
      </div>
      <p className="wiz__enginebody">{t(body)}</p>
      {!channel?.token_set && (
        <>
          {tokens.specs.map((s, i) => (
            <div className="wiz__keyrow" key={s.label}>
              <Input
                type={s.plain ? "text" : "password"}
                autoComplete="off"
                aria-label={`${spec.name}: ${t(s.label)}`}
                placeholder={s.placeholder}
                value={tokens.values[i]}
                onChange={(e) => tokens.set(i, e.currentTarget.value)}
              />
              {i === tokens.specs.length - 1 && (
                <Button size="sm" loading={busy} disabled={!tokens.ok} onClick={() => void connect()}>
                  {t("setup.channels.connect")}
                </Button>
              )}
            </div>
          ))}
          <button type="button" className="wiz__hintline is-link" onClick={() => setHowTo((v) => !v)}>
            {t("setup.channels.howTo", { name: spec.name })}
          </button>
          {howTo && (
            <ol className="wiz__howto">
              {spec.steps.map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ol>
          )}
        </>
      )}
    </div>
  );
}
