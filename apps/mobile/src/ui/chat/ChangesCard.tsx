import { Text, View } from "react-native";
import { t } from "../../i18n";
import type { Message } from "../../protocol";
import { Icon } from "../Icon";
import { makeStyles, useTheme } from "../theme";

type ChangesPart = Extract<Message["parts"][number], { type: "changes" }>;

/** What a code chat's folder has uncommitted after the turn, or the files the agent wrote in it. */
export function ChangesCard({ part }: { part: ChangesPart }) {
  const theme = useTheme();
  const s = useStyles();
  const n = part.files.length + (part.more ?? 0);
  const statusColor = (status: string) =>
    status === "??" || status === "A" ? theme.brand : status === "D" ? theme.danger : theme.warning;
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Icon name="FileText" size={14} color={theme.fgMuted} />
        <Text style={s.title}>
          {t(part.scratch ? "changesScratchEdited" : part.edits ? "changesEdited" : "changesTitle", { n })}
        </Text>
        <Text numberOfLines={1} ellipsizeMode="head" style={s.cwd}>
          {part.cwd}
        </Text>
      </View>
      <View style={s.list}>
        {part.files.map((file) => (
          <View key={file.path} style={s.file}>
            <Text style={[s.status, { color: statusColor(file.status) }]}>
              {file.status === "??" ? "+" : file.status}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="middle" style={s.path}>
              {file.path}
            </Text>
            {file.added !== undefined ? (
              <Text style={s.stat}>
                <Text style={{ color: theme.brand }}>+{file.added}</Text>{" "}
                <Text style={{ color: theme.danger }}>−{file.removed ?? 0}</Text>
              </Text>
            ) : null}
          </View>
        ))}
        {part.more ? <Text style={s.more}>{t("changesMore", { n: part.more })}</Text> : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    alignSelf: "stretch",
    borderRadius: theme.radiusLg,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    overflow: "hidden",
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderColor: theme.border,
  },
  title: { color: theme.fg, fontSize: 13, fontWeight: "500" },
  cwd: { flex: 1, color: theme.fgSubtle, fontSize: 11, fontFamily: theme.mono, textAlign: "right" },
  list: { paddingHorizontal: 12, paddingVertical: 6 },
  file: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 26 },
  status: { width: 16, fontSize: 12, fontWeight: "700", fontFamily: theme.mono, textAlign: "center" },
  path: { flex: 1, color: theme.fg, fontSize: 12, fontFamily: theme.mono },
  stat: { fontSize: 11, fontFamily: theme.mono },
  more: { color: theme.fgSubtle, fontSize: 12, paddingVertical: 4, paddingLeft: 24 },
}));
