import { Text, View } from "react-native";
import { type Key, t } from "../../i18n";
import type { Message } from "../../protocol";
import { Icon, type IconName } from "../Icon";
import { makeStyles, useTheme } from "../theme";

type Delivery = NonNullable<Message["delivery"]>;
type Reaction = NonNullable<Message["reactions"]>[number];

const TICKS: Record<Delivery, { icon: IconName; label: Key }> = {
  pending: { icon: "Clock", label: "deliveryPending" },
  sent: { icon: "Check", label: "deliverySent" },
  delivered: { icon: "CheckCheck", label: "deliveryDelivered" },
  read: { icon: "CheckCheck", label: "deliveryRead" },
  failed: { icon: "TriangleAlert", label: "deliveryFailed" },
};

/** How far a message sent on a channel got: queued, sent, on their phone, read, or not sent. */
export function DeliveryTicks({ state }: { state: Delivery }) {
  const theme = useTheme();
  const tick = TICKS[state];
  const color = state === "read" ? theme.info : state === "failed" ? theme.danger : theme.fgSubtle;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t(tick.label)}>
      <Icon name={tick.icon} size={13} color={color} strokeWidth={2} />
    </View>
  );
}

/** The emoji on a message, the agent's and theirs, each saying whose it is. */
export function Reactions({ list, agentName }: { list: Reaction[]; agentName: string }) {
  const s = useStyles();
  return (
    <View style={s.reactions}>
      {list.map((reaction) => {
        const label = reaction.by === "agent" ? t("reactionAgent", { agent: agentName }) : t("reactionThem");
        return (
          <View key={reaction.by} style={s.reaction} accessible accessibilityLabel={`${label}: ${reaction.emoji}`}>
            <Text style={s.emoji}>{reaction.emoji}</Text>
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  reactions: { flexDirection: "row", gap: 4, marginTop: -2 },
  reaction: {
    paddingHorizontal: 6,
    height: 24,
    borderRadius: 12,
    justifyContent: "center",
    backgroundColor: theme.surfaceRaised,
    borderWidth: 1,
    borderColor: theme.border,
  },
  emoji: { fontSize: 13 },
}));
