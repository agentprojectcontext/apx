import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Image, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SHARED_FILTERS, type SharedFilter, sharedCount, sharedItem } from "../chat/shared";
import { fullWhen } from "../format";
import type { Workspace } from "../hooks/useWorkspace";
import { type Key, t } from "../i18n";
import type { SharedFile, SharedKind } from "../protocol";
import { Icon } from "../ui/Icon";
import { Chip, EmptyState, ProjectAvatar, Spinner, SubHeader, useType } from "../ui/kit";
import { useMediaUri } from "../ui/media/context";
import { SharedViewer } from "../ui/media/SharedViewer";
import { KIND_ICON, ONE } from "../ui/media/sharedKinds";
import { Sender } from "../ui/media/sharedSender";
import { makeStyles, useTheme } from "../ui/theme";

export type SharedActions = {
  list: (params: {
    kind?: SharedKind;
    query?: string;
    offset: number;
    limit: number;
  }) => Promise<{ items: SharedFile[]; more: boolean; counts: Record<SharedKind, number> }>;
  poster: (media_id: string) => Promise<string | undefined>;
};

const PAGE = 40;
const GAP = 10;
const SEARCH_WAIT_MS = 300;

const LABEL: Record<SharedFilter, Key> = {
  all: "sharedAll",
  image: "sharedImages",
  video: "sharedVideos",
  audio: "sharedAudio",
  document: "sharedDocuments",
};

/** A picture's own bytes, or a video's first frame from the core; other kinds show their icon. */
function Thumb({ file, size, poster }: { file: SharedFile; size: number; poster: SharedActions["poster"] }) {
  const theme = useTheme();
  const s = useStyles();
  // One item per file: the loader runs again whenever it gets a new one.
  const item = useMemo(() => sharedItem(file, ""), [file]);
  const picture = useMediaUri(item, file.kind === "image").uri;
  const [frame, setFrame] = useState<string>();
  useEffect(() => {
    if (file.kind !== "video") return;
    let live = true;
    poster(file.media_id).then(
      (data) => live && data && setFrame(`data:image/jpeg;base64,${data}`),
      () => {},
    );
    return () => {
      live = false;
    };
  }, [file.kind, file.media_id, poster]);
  const uri = picture ?? frame;
  return (
    <View style={[s.thumb, { height: size }]}>
      {uri ? (
        <Image source={{ uri }} resizeMode="cover" style={s.fill} />
      ) : (
        <Icon name={KIND_ICON[file.kind]} size={30} color={theme.fgSubtle} />
      )}
      {file.kind === "video" ? (
        <View style={s.play}>
          <Icon name="Play" size={14} color="#fff" />
        </View>
      ) : null}
    </View>
  );
}

function Card({
  file,
  size,
  data,
  poster,
  onOpen,
}: {
  file: SharedFile;
  size: number;
  data: Workspace;
  poster: SharedActions["poster"];
  onOpen: () => void;
}) {
  const type = useType();
  const s = useStyles();
  const project = data.projects.find((p) => p.id === file.project_id);
  const name = file.name || t(ONE[file.kind]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onOpen}
      style={({ pressed }) => [s.card, { width: size }, pressed && { opacity: 0.85 }]}
    >
      <Thumb file={file} size={size} poster={poster} />
      <View style={s.body}>
        <Text numberOfLines={1} style={s.name}>
          {name}
        </Text>
        <View style={s.line}>
          {project ? <ProjectAvatar name={project.name} size={14} /> : null}
          <Text numberOfLines={1} style={[type.meta, { flexShrink: 1 }]}>
            {project ? `${project.name} · ${file.thread_title}` : file.thread_title}
          </Text>
        </View>
        <Text numberOfLines={1} style={type.meta}>
          {fullWhen(file.created_at)}
        </Text>
        <Sender author={file.author} data={data} size={16} />
      </View>
    </Pressable>
  );
}

/** Every file sent in a chat as cards, by kind and name; one opens full screen, and from there its chat. */
export function SharedFilesPage({
  data,
  back,
  actions,
  openMessage,
}: {
  data: Workspace;
  back: () => void;
  actions: SharedActions;
  openMessage: (thread: string, message: string) => void;
}) {
  const theme = useTheme();
  const s = useStyles();
  const { width } = useWindowDimensions();
  const size = Math.floor((width - 32 - GAP) / 2);
  const [filter, setFilter] = useState<SharedFilter>("all");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SharedFile[]>();
  const [counts, setCounts] = useState<Record<SharedKind, number>>();
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<SharedFile>();

  useEffect(() => {
    const wait = setTimeout(() => setQuery(typed.trim()), SEARCH_WAIT_MS);
    return () => clearTimeout(wait);
  }, [typed]);

  const { list } = actions;
  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      try {
        const r = await list({
          ...(filter === "all" ? {} : { kind: filter }),
          ...(query ? { query } : {}),
          offset,
          limit: PAGE,
        });
        setItems((prev) => (offset && prev ? [...prev, ...r.items] : r.items));
        setCounts(r.counts);
        setMore(r.more);
        setError("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [list, filter, query],
  );
  useEffect(() => {
    void load(0);
  }, [load]);

  const label = (f: SharedFilter) => {
    const n = sharedCount(counts, f);
    return n === undefined ? t(LABEL[f]) : `${t(LABEL[f])} ${n}`;
  };
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SubHeader title={t("sharedFiles")} back={back} />
      <View style={s.search}>
        <Icon name="Search" size={16} color={theme.fgSubtle} />
        <TextInput
          value={typed}
          onChangeText={setTyped}
          placeholder={t("sharedSearch")}
          placeholderTextColor={theme.fgSubtle}
          returnKeyType="search"
          style={s.searchInput}
        />
        {loading && items ? <Spinner size={14} /> : null}
      </View>
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
          {SHARED_FILTERS.map((f) => (
            <Chip key={f} label={label(f)} selected={filter === f} onPress={() => setFilter(f)} />
          ))}
        </ScrollView>
      </View>
      {error ? (
        <EmptyState title={t("couldNotOpen")} body={error} icon="TriangleAlert" />
      ) : !items ? (
        <View style={s.loading}>
          <Spinner size={20} />
        </View>
      ) : !items.length ? (
        <EmptyState icon="Paperclip" title={t(query ? "sharedNoMatch" : "sharedEmpty")} body={t("sharedEmptyBody")} />
      ) : (
        <FlatList
          data={items}
          numColumns={2}
          keyExtractor={(f) => `${f.message_id}:${f.media_id}`}
          columnWrapperStyle={{ gap: GAP }}
          contentContainerStyle={s.grid}
          onEndReachedThreshold={0.6}
          onEndReached={() => more && !loading && void load(items.length)}
          ListFooterComponent={more ? <Spinner size={18} /> : null}
          renderItem={({ item }) => (
            <Card file={item} size={size} data={data} poster={actions.poster} onOpen={() => setOpen(item)} />
          )}
        />
      )}
      {open ? (
        <SharedViewer
          file={open}
          data={data}
          onClose={() => setOpen(undefined)}
          onChat={() => {
            setOpen(undefined);
            openMessage(open.thread_id, open.message_id);
          }}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => ({
  search: {
    height: 40,
    marginHorizontal: 16,
    marginBottom: 10,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: theme.fill,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchInput: { flex: 1, color: theme.fg, fontSize: 15, paddingVertical: 0 },
  chips: { gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  loading: { padding: 40, alignItems: "center" },
  grid: { paddingHorizontal: 16, paddingBottom: 40, gap: GAP },
  card: {
    borderRadius: theme.radiusMd,
    overflow: "hidden",
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  thumb: { width: "100%", alignItems: "center", justifyContent: "center", backgroundColor: theme.fill },
  fill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  play: {
    position: "absolute",
    right: 8,
    bottom: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingLeft: 2,
  },
  body: { padding: 10, gap: 4 },
  name: { color: theme.fg, fontSize: 14, fontWeight: "600" },
  line: { flexDirection: "row", alignItems: "center", gap: 5 },
}));
