import { useState } from "react";
import { Modal, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { t } from "../i18n";
import { copyText } from "./copy";
import { Icon, type IconName } from "./Icon";
import { BottomSheet, IconButton, ListRow } from "./kit";
import { makeStyles, useTheme } from "./theme";

/**
 * What a long press on a message offers: copy it whole, pick part of it, or share it. Picking happens in a page of
 * its own, since text in the chat's upside-down list cannot be selected on Android.
 */
export function MessageSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const theme = useTheme();
  const [selecting, setSelecting] = useState(false);
  if (selecting) return <SelectText text={text} onClose={onClose} />;
  const actions: Array<[string, IconName, () => void]> = [
    [t("copyText"), "Copy", () => void copyText(text).then(onClose)],
    [t("selectText"), "TextSelect", () => setSelecting(true)],
    [t("shareText"), "Share2", () => void Share.share({ message: text }).finally(onClose)],
  ];
  return (
    <BottomSheet onClose={onClose}>
      {actions.map(([label, icon, run]) => (
        <ListRow
          key={label}
          label={label}
          leading={<Icon name={icon} size={18} color={theme.fgMuted} />}
          chevron={false}
          onPress={run}
        />
      ))}
    </BottomSheet>
  );
}

function SelectText({ text, onClose }: { text: string; onClose: () => void }) {
  const s = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={[s.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={s.bar}>
          <IconButton icon="X" label={t("close")} onPress={onClose} />
          <Text style={s.title}>{t("selectText")}</Text>
          <IconButton icon="Copy" label={t("copyText")} onPress={() => void copyText(text).then(onClose)} />
        </View>
        <ScrollView contentContainerStyle={s.body}>
          <Text selectable style={s.text}>
            {text}
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: theme.bg },
  bar: {
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderColor: theme.border,
  },
  title: { flex: 1, color: theme.fg, fontSize: 16, fontWeight: "600" },
  body: { padding: 20 },
  text: { color: theme.fg, fontSize: 16, lineHeight: 24 },
}));
