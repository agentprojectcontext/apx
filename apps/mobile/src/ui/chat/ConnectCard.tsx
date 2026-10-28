import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { t } from "../../i18n";
import type { ApxClient, Message } from "../../protocol";
import { ChannelMark, isChannelBrand } from "../ChannelMark";
import { Icon } from "../Icon";
import { Tag } from "../kit";
import { makeStyles, useTheme } from "../theme";

type ConnectPart = Extract<Message["parts"][number], { type: "connect" }>;
type Offer = ConnectPart["offers"][number];

/** What is connected already: integration ids and channel types, read once per card. */
function useConnected(client: ApxClient | undefined) {
  const [connected, setConnected] = useState<Set<string>>();
  useEffect(() => {
    if (!client) return;
    let live = true;
    void Promise.all([
      client.call("integrations.list", {}).then(
        (r) => r.integrations.filter((i) => i.connected).map((i) => `integration:${i.id}`),
        () => [],
      ),
      client.call("channels.list", {}).then(
        (r) => r.channels.map((c) => `channel:${c.type}`),
        () => [],
      ),
    ]).then(([integrations, channels]) => live && setConnected(new Set([...integrations, ...channels])));
    return () => {
      live = false;
    };
  }, [client]);
  return connected;
}

/**
 * Apps and channels the agent offers to connect for what the owner asked. Their forms live in APX on the computer,
 * so the phone says what is connected and where to connect the rest.
 */
export function ConnectCard({ part, client }: { part: ConnectPart; client: ApxClient | undefined }) {
  const theme = useTheme();
  const s = useStyles();
  const connected = useConnected(client);
  const isOn = (offer: Offer) => connected?.has(`${offer.kind}:${offer.id}`) ?? false;
  const pending = part.offers.some((offer) => !offer.coming && !isOn(offer));
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Icon name="Plug" size={14} color={theme.fgMuted} />
        <Text style={s.title}>{t("connectTitle")}</Text>
      </View>
      {part.why ? <Text style={s.why}>{part.why}</Text> : null}
      <View style={s.rows}>
        {part.offers.map((offer) => (
          <View key={`${offer.kind}:${offer.id}`} style={s.row}>
            <View style={s.tile}>
              {offer.kind === "channel" && isChannelBrand(offer.id) ? (
                <ChannelMark type={offer.id} size={18} />
              ) : (
                <Text style={s.letter}>{offer.label.slice(0, 1).toUpperCase()}</Text>
              )}
            </View>
            <View style={s.main}>
              <Text numberOfLines={1} style={s.name}>
                {offer.label}
              </Text>
              {offer.description ? (
                <Text numberOfLines={2} style={s.description}>
                  {offer.description}
                </Text>
              ) : null}
            </View>
            {offer.coming ? (
              <Tag>{t("connectSoon")}</Tag>
            ) : isOn(offer) ? (
              <Tag tone="brand">{t("connectConnected")}</Tag>
            ) : null}
          </View>
        ))}
      </View>
      {connected && pending ? (
        <View style={s.hint}>
          <Icon name="Monitor" size={14} color={theme.fgSubtle} />
          <Text style={s.hintText}>{t("connectOnComputer")}</Text>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    alignSelf: "stretch",
    padding: 14,
    gap: 10,
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { color: theme.fgMuted, fontSize: 13, fontWeight: "500" },
  why: { color: theme.fg, fontSize: 14, lineHeight: 20 },
  rows: { gap: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 10 },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: theme.fill,
    alignItems: "center",
    justifyContent: "center",
  },
  letter: { color: theme.fgMuted, fontSize: 14, fontWeight: "600" },
  main: { flex: 1, minWidth: 0 },
  name: { color: theme.fg, fontSize: 14, fontWeight: "500" },
  description: { color: theme.fgMuted, fontSize: 12, lineHeight: 16 },
  hint: { flexDirection: "row", alignItems: "center", gap: 6 },
  hintText: { color: theme.fgSubtle, fontSize: 12, flexShrink: 1 },
}));
