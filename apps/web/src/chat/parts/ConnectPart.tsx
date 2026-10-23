import type { ConnectOffer, Part } from "@apx/protocol";
import { Badge, Button, Icons, IntegrationIcon } from "@apx/ui";
import { useCallback, useEffect, useState } from "react";
import { KindTile } from "../../channels/KindIcon.tsx";
import { CHANNEL_KINDS, isChannelKind } from "../../channels/kinds.ts";
import { send } from "../../data/actions.ts";
import { loadChannels, useChannels } from "../../data/channels.ts";
import { client } from "../../data/client.ts";
import { useData } from "../../data/state.ts";
import { useT } from "../../i18n/index.ts";
import { ConnectDialog, ConnectForm, describe, type Integration } from "../../resources/IntegrationsTab.tsx";
import { go } from "../../shell/nav.ts";

type Connect = Extract<Part, { type: "connect" }>;

/** The marks stacked on "Explore more": the best known first. */
const STACK = ["github", "gmail", "notion", "slack", "google-drive", "linear"];
const STACK_SIZE = 4;

/**
 * Apps and channels the agent offers to connect for what the owner asked. An integration's form opens here, and once
 * it is connected the agent is told, while the chat is still on this answer; a channel opens its setup in Settings.
 */
export function ConnectPart({ part, threadId, messageId }: { part: Connect; threadId: string; messageId: string }) {
  const t = useT();
  const last = useData((s) => s.messages[threadId]?.at(-1)?.id === messageId);
  const channels = useChannels((s) => s.channels);
  const channelsReady = useChannels((s) => s.ready);
  const [integrations, setIntegrations] = useState<Integration[]>();
  const [open, setOpen] = useState<Integration>();
  const [exploring, setExploring] = useState(false);

  useEffect(() => {
    if (!channelsReady) void loadChannels();
  }, [channelsReady]);
  const loadIntegrations = useCallback(async () => {
    try {
      setIntegrations((await client.call("integrations.list", {})).integrations);
    } catch {
      // Without the list its Connect buttons stay off; Resources › Integrations still connects it.
    }
  }, []);
  useEffect(() => {
    void loadIntegrations();
  }, [loadIntegrations]);

  const connected = (o: ConnectOffer) =>
    o.kind === "channel"
      ? channels.some((c) => c.type === o.id)
      : Boolean(integrations?.find((i) => i.id === o.id)?.connected);

  /** The rest of the catalog, not connected and not on the card. */
  const more = (integrations ?? []).filter(
    (i) => !i.connected && !i.coming && !part.offers.some((o) => o.kind === "integration" && o.id === i.id),
  );
  const stack = [...more].sort((a, b) => rank(a.id) - rank(b.id)).slice(0, STACK_SIZE);
  const connectedNow = async (label: string) => {
    await loadIntegrations();
    if (last) await send(threadId, t("connect.done", { name: label })).catch(() => {});
  };

  const connect = (o: ConnectOffer) => {
    if (o.kind === "channel") {
      if (isChannelKind(o.id)) go.channelConfig(o.id);
      return;
    }
    const i = integrations?.find((x) => x.id === o.id);
    if (i) setOpen(i);
  };

  return (
    <div className="inputcard connectcard">
      <div className="inputcard__head">
        <Icons.Plug size={14} />
        <span className="inputcard__title">{t("connect.title")}</span>
      </div>
      {part.why && <p className="inputcard__prompt">{part.why}</p>}
      <div className="connectcard__rows">
        {part.offers.map((o) => {
          const kind = o.kind === "channel" && isChannelKind(o.id) ? o.id : undefined;
          const on = connected(o);
          return (
            <div key={`${o.kind}:${o.id}`} className="connectcard__row">
              {kind ? <KindTile kind={kind} size={28} /> : <IntegrationIcon id={o.id} name={o.label} size={28} />}
              <span className="int__rowmain">
                <b>{kind ? t(CHANNEL_KINDS[kind].name) : o.label}</b>
                <span>{kind ? t(CHANNEL_KINDS[kind].text) : describe(o, t)}</span>
              </span>
              {o.coming ? (
                <Badge>{t("setup.channels.soon")}</Badge>
              ) : on ? (
                <Badge tone="brand" dot>
                  {t("connect.connected")}
                </Badge>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={o.kind === "integration" && !integrations}
                  onClick={() => connect(o)}
                >
                  {t("int.connect")}
                </Button>
              )}
            </div>
          );
        })}
      </div>
      {more.length > 0 && (
        <button type="button" className="connectcard__more" onClick={() => setExploring(true)}>
          <span className="connectcard__stack" aria-hidden="true">
            {stack.map((i) => (
              <IntegrationIcon key={i.id} id={i.id} name={i.label} size={18} />
            ))}
          </span>
          {t("connect.more", { count: more.length })}
          <Icons.ExternalLink size={12} />
        </button>
      )}
      {exploring && integrations && (
        <ConnectDialog
          list={integrations}
          onClose={() => setExploring(false)}
          onConnected={async (id) => {
            setExploring(false);
            await connectedNow(integrations.find((i) => i.id === id)?.label ?? id);
          }}
        />
      )}
      {open && (
        <ConnectForm
          i={open}
          title={t("int.connectTitle", { name: open.label })}
          onClose={() => setOpen(undefined)}
          onDone={async () => {
            setOpen(undefined);
            await connectedNow(open.label);
          }}
        />
      )}
    </div>
  );
}

const rank = (id: string) => {
  const at = STACK.indexOf(id);
  return at < 0 ? STACK.length : at;
};
