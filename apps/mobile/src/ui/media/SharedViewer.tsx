import { useVideoPlayer, VideoView } from "expo-video";
import { useMemo } from "react";
import { Image, Modal, ScrollView, StatusBar, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { sizeText } from "../../chat/media";
import { saveMedia, shareMedia } from "../../chat/mediaFiles";
import { sharedItem } from "../../chat/shared";
import { fullWhen } from "../../format";
import type { Workspace } from "../../hooks/useWorkspace";
import { t } from "../../i18n";
import type { SharedFile } from "../../protocol";
import { Flasher } from "../Flash";
import { Icon } from "../Icon";
import { Button, IconButton, ProjectAvatar, Spinner } from "../kit";
import { makeStyles, useTheme } from "../theme";
import { useMediaClient, useMediaUri } from "./context";
import { KIND_ICON, ONE } from "./sharedKinds";
import { Sender } from "./sharedSender";

function Player({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return <VideoView player={player} nativeControls contentFit="contain" style={{ flex: 1 }} />;
}

/** The file itself: a picture to zoom, a video to play; a sound or a document opens in another app. */
function Stage({ file, onShare }: { file: SharedFile; onShare: () => void }) {
  const s = useStyles();
  const { width } = useWindowDimensions();
  const item = useMemo(() => sharedItem(file, file.name), [file]);
  const shown = file.kind === "image" || file.kind === "video";
  const { uri, error } = useMediaUri(item, shown);
  if (!shown)
    return (
      <View style={s.center}>
        <Icon name={KIND_ICON[file.kind]} size={56} color="rgba(255, 255, 255, 0.7)" />
        <Button label={t("shareOrOpen")} icon="Share2" onPress={onShare} />
      </View>
    );
  if (error)
    return (
      <View style={s.center}>
        <Text style={s.error}>{error}</Text>
      </View>
    );
  if (!uri)
    return (
      <View style={s.center}>
        <Spinner size={24} color="#fff" />
      </View>
    );
  if (file.kind === "video") return <Player uri={uri} />;
  return (
    <ScrollView
      maximumZoomScale={3}
      centerContent
      contentContainerStyle={s.center}
      showsHorizontalScrollIndicator={false}
      showsVerticalScrollIndicator={false}
    >
      <Image source={{ uri }} resizeMode="contain" style={{ width, height: "100%", minHeight: 300 }} />
    </ScrollView>
  );
}

/** One shared file full screen on black, with where it was said and what can be done with it below. */
export function SharedViewer({
  file,
  data,
  onClose,
  onChat,
}: {
  file: SharedFile;
  data: Workspace;
  onClose: () => void;
  onChat: () => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const client = useMediaClient();
  const item = useMemo(() => sharedItem(file, file.name || t(ONE[file.kind])), [file]);
  const project = data.projects.find((p) => p.id === file.project_id);
  const share = () => void shareMedia(client, item);
  return (
    <Modal statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={onClose}>
      <StatusBar barStyle="light-content" />
      <View style={s.root}>
        <View style={[s.bar, { paddingTop: insets.top + 6 }]}>
          <IconButton icon="X" label={t("close")} color="#fff" onPress={onClose} />
          <Text numberOfLines={1} style={s.title}>
            {item.name}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        <View style={s.stage}>
          <Stage file={file} onShare={share} />
        </View>
        <View style={[s.info, { paddingBottom: insets.bottom + 14 }]}>
          <View style={s.line}>
            {project ? <ProjectAvatar name={project.name} size={16} /> : null}
            <Text numberOfLines={1} style={s.where}>
              {project ? `${project.name} · ${file.thread_title}` : file.thread_title}
            </Text>
          </View>
          <View style={s.line}>
            <Sender author={file.author} data={data} size={18} />
            <Text style={s.meta}>
              · {fullWhen(file.created_at)}
              {file.bytes ? ` · ${sizeText(file.bytes)}` : ""}
            </Text>
          </View>
          <View style={s.actions}>
            <Button label={t("sharedGoToChat")} icon="MessageSquare" onPress={onChat} style={{ flex: 1 }} />
            {file.kind === "image" || file.kind === "video" ? (
              <IconButton
                icon="Download"
                label={t("saveToGallery")}
                color={theme.fg}
                onPress={() => void saveMedia(client, item)}
                style={s.round}
              />
            ) : null}
            <IconButton icon="Share2" label={t("shareOrOpen")} color={theme.fg} onPress={share} style={s.round} />
          </View>
        </View>
        <Flasher />
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((theme) => ({
  root: { flex: 1, backgroundColor: "#000" },
  bar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 8, paddingBottom: 6 },
  title: { flex: 1, color: "#fff", fontSize: 15, fontWeight: "600", textAlign: "center" },
  stage: { flex: 1 },
  center: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: 20 },
  error: { color: theme.danger, fontSize: 13, paddingHorizontal: 24, textAlign: "center" },
  info: {
    gap: 8,
    paddingTop: 14,
    paddingHorizontal: 16,
    borderTopLeftRadius: theme.radiusLg,
    borderTopRightRadius: theme.radiusLg,
    backgroundColor: theme.surface,
  },
  line: { flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 },
  where: { flexShrink: 1, color: theme.fg, fontSize: 14, fontWeight: "500" },
  meta: { flexShrink: 1, color: theme.fgMuted, fontSize: 12 },
  actions: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  round: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.fill },
}));
