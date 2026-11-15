import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { t } from "../../i18n";
import type { ApxClient, Surface } from "../../protocol";
import { Icon } from "../Icon";
import { IconButton, Spinner } from "../kit";
import { SurfaceFull, SurfaceWeb } from "../SurfaceWeb";
import { makeStyles, useTheme } from "../theme";

/** Widgets already fetched, by id and version, so scrolling the chat back does not ask the core again. */
const fetched = new Map<string, Surface>();

/** A widget an agent made, live in the chat as tall as its content, and full screen (the phone may turn) on a tap. */
export function SurfaceCard({
  part,
  client,
}: {
  part: { surface_id: string; version: number; title: string };
  client?: ApxClient;
}) {
  const theme = useTheme();
  const s = useStyles();
  const key = `${part.surface_id}@${part.version}`;
  const [surface, setSurface] = useState<Surface | "gone" | undefined>(fetched.get(key));
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!client || fetched.has(key)) return;
    let live = true;
    client
      .call("surfaces.get", { surface: part.surface_id })
      .then((got) => {
        fetched.set(key, got);
        if (live) setSurface(got);
      })
      .catch(() => live && setSurface("gone"));
    return () => {
      live = false;
    };
  }, [client, key, part.surface_id]);
  if (!client || surface === "gone")
    return (
      <View style={s.gone}>
        <Icon name="LayoutGrid" size={14} color={theme.fgMuted} />
        <Text numberOfLines={1} style={s.goneText}>
          {surface === "gone" ? t("widgetGone", { title: part.title }) : part.title}
        </Text>
      </View>
    );
  return (
    <View style={s.card}>
      <View style={s.head}>
        <Icon name="LayoutGrid" size={13} color={theme.fgMuted} />
        <Text numberOfLines={1} style={s.title}>
          {part.title}
        </Text>
        <IconButton icon="Maximize" size={16} label={t("widgetFull")} onPress={() => surface && setFull(true)} />
      </View>
      {surface ? (
        <SurfaceWeb surface={surface} client={client} fit />
      ) : (
        <View style={s.loading}>
          <Spinner size={18} />
        </View>
      )}
      {full && surface ? <SurfaceFull surface={surface} client={client} onClose={() => setFull(false)} /> : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  card: {
    alignSelf: "stretch",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radiusMd,
    backgroundColor: theme.bg,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: 12,
    paddingRight: 4,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  title: { flex: 1, color: theme.fgMuted, fontSize: 12, fontWeight: "600" },
  loading: { height: 160, alignItems: "center", justifyContent: "center" },
  gone: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  goneText: { flex: 1, color: theme.fgMuted, fontSize: 13 },
}));
