// The disk holding APX is almost full: the panel's low-disk warning, with what the phone can do about it.
import { useState } from "react";
import { Text, View } from "react-native";
import { sizeText } from "../chat/media";
import { t } from "../i18n";
import { Icon } from "../ui/Icon";
import { Button, Card, useType } from "../ui/kit";
import { makeStyles, useTheme } from "../ui/theme";

/** Free space left, and a button that removes only what APX rebuilds on its own (caches, old logs). */
export function DiskWarning({ free, freeSpace }: { free: number; freeSpace: () => Promise<number> }) {
  const type = useType();
  const theme = useTheme();
  const s = useStyles();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string>();
  return (
    <Card style={s.card}>
      <View accessible accessibilityRole="alert" style={s.head}>
        <Icon name="HardDrive" size={16} color={theme.warning} />
        <Text style={[type.body, { flex: 1 }]}>{t("diskLow", { free: sizeText(free) })}</Text>
      </View>
      <Text style={type.meta}>{said ?? t("diskLowHint")}</Text>
      <Button
        label={t("diskFree")}
        size="sm"
        variant="secondary"
        busy={busy}
        style={s.button}
        onPress={() => {
          setBusy(true);
          void freeSpace()
            .then(
              (bytes) => setSaid(t("diskFreed", { size: sizeText(bytes) })),
              (error: unknown) => setSaid(error instanceof Error ? error.message : String(error)),
            )
            .finally(() => setBusy(false));
        }}
      />
    </Card>
  );
}

const useStyles = makeStyles(() => ({
  card: { gap: 6 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  button: { alignSelf: "flex-start" },
}));
